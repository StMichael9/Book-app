import { test as base, expect } from "@playwright/test";

// Browser-only fixtures. Every API request is intercepted; no database or
// hosted API is contacted and these records are never imported anywhere.
const books = [
  { id: 1, title: "Test-only Fantasy", authors: [{ id: 1, name: "Test Author" }], tags: [{ id: 1, name: "fantasy" }] },
  { id: 2, title: "Test-only Science Fiction", authors: [{ id: 2, name: "Another Author" }], tags: [{ id: 2, name: "science_fiction" }] },
  { id: 3, title: "Test-only Mystery", authors: [{ id: 1, name: "Test Author" }], tags: [{ id: 3, name: "mystery" }] },
];

const test = base.extend({
  app: async ({ page }, runFixture) => {
    const state = {
      authenticated: true,
      saved: [{ id: 1, book_id: 1, status: "want", book: books[0] }],
      preferences: [{ tag_id: 1, tag: { id: 1, name: "fantasy", type: "genre" }, source_text: "Keep this note" }],
      preferencesFailures: 0,
      malformedPreferences: false,
      shelfFailures: 0,
      mutationFails: false,
      expireNext: false,
      refreshFails: false,
      requests: [],
      errors: [],
      resetTokens: new Set(),
      catalogue: books,
    };
    page.on("pageerror", (error) => state.errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5187") {
        state.errors.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const method = request.method();
      const body = method === "POST" ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, query: url.searchParams });
      const reply = (status, json, headers) => route.fulfill({ status, json, headers });
      if (path === "/auth/refresh") {
        const denied = !state.authenticated || state.refreshFails;
        if (state.holdRefresh) await state.holdRefresh;
        return !denied
          ? reply(200, { message: "Access token refreshed" }, state.emitCookies ? {
            "set-cookie": "access_token=test-previous-session; Path=/; HttpOnly; SameSite=Lax",
          } : undefined)
          : reply(401, { detail: "Session expired" });
      }
      if (path === "/auth/register") return reply(201, { message: "User created" });
      if (path === "/auth/login") {
        if (state.loginFails) return reply(401, { detail: "Invalid email or password" });
        state.authenticated = true;
        return reply(200, { message: "Login successful" }, state.emitCookies ? {
          "set-cookie": "access_token=test-new-session; Path=/; HttpOnly; SameSite=Lax",
        } : undefined);
      }
      if (path === "/auth/logout") {
        state.authenticated = false;
        return reply(200, { message: "Logout successful" });
      }
      if (path === "/auth/forgot-password") return reply(202, { message: "If that account exists, a reset link will be sent." });
      if (path === "/auth/reset-password") {
        if (body.token === "invalid" || state.resetTokens.has(body.token)) return reply(400, { detail: "Invalid or expired reset link" });
        state.resetTokens.add(body.token);
        return reply(200, { message: "Password updated" });
      }
      if (path.startsWith("/me/") || path.endsWith("/status")) {
        if (!state.authenticated || state.expireNext) {
          state.expireNext = false;
          return reply(401, { detail: "Not authenticated" });
        }
      }
      if (path === "/me/preferences") {
        if (method === "GET") {
          if (state.preferencesFailures-- > 0) return reply(503, { detail: "Preferences temporarily unavailable" });
          if (state.malformedPreferences) return reply(200, { unexpected: true });
          return reply(200, state.preferences);
        }
        if (state.mutationFails) return reply(503, { detail: "Save unavailable" });
        state.preferences = body.tag_ids.map((id) => ({
          tag_id: id, tag: { id, name: id === 1 ? "fantasy" : "mystery", type: "genre" }, source_text: body.source_text,
        }));
        return reply(200, state.preferences);
      }
      if (path === "/me/books") {
        if (state.holdShelves) await state.holdShelves;
        if (state.shelfFailures-- > 0) return reply(503, { detail: "Shelf temporarily unavailable" });
        return reply(200, state.saved);
      }
      if (/^\/books\/\d+\/status$/.test(path)) {
        if (state.mutationFails) return reply(503, { detail: "Save unavailable" });
        const bookId = Number(path.split("/")[2]);
        state.saved = state.saved.filter((item) => item.book_id !== bookId);
        if (method === "DELETE") return route.fulfill({ status: 204 });
        const item = { id: bookId, book_id: bookId, status: body.status, book: books.find((book) => book.id === bookId) };
        state.saved.push(item);
        return reply(200, item);
      }
      if (path === "/books") {
        if (state.searchFails) return reply(503, { detail: "Search temporarily unavailable" });
        let items = state.catalogue.filter((book) =>
          (!url.searchParams.get("book") || book.title.toLowerCase().includes(url.searchParams.get("book").toLowerCase())) &&
          (!url.searchParams.get("author") || book.authors.some((author) => author.name.toLowerCase().includes(url.searchParams.get("author").toLowerCase()))) &&
          url.searchParams.getAll("tag").every((tag) => book.tags.some((item) => item.name === tag)));
        if (url.searchParams.get("exclude_owned") === "true") items = items.filter((book) => !state.saved.some((item) => item.book_id === book.id && item.status === "owned"));
        if (url.searchParams.get("shelf_status")) items = items.filter((book) => state.saved.some((item) => item.book_id === book.id && item.status === url.searchParams.get("shelf_status")));
        const size = Number(url.searchParams.get("size") || 20);
        const pageNumber = Number(url.searchParams.get("page") || 1);
        return reply(200, { items: items.slice((pageNumber - 1) * size, pageNumber * size), total: items.length, page: pageNumber, size });
      }
      if (/^\/books\/\d+$/.test(path)) {
        const book = books.find((item) => item.id === Number(path.split("/")[2]));
        return book ? reply(200, book) : reply(404, { detail: "Book not found" });
      }
      if (path.startsWith("/autocomplete/")) {
        const values = path.endsWith("/authors") ? books.flatMap((book) => book.authors) : books.flatMap((book) => book.tags);
        return reply(200, [...new Map(values.map((item) => [item.id, item])).values()].filter((item) => item.name.includes(url.searchParams.get("q"))));
      }
      state.errors.push(`Unhandled API request: ${method} ${path}`);
      return reply(500, { detail: "Unhandled test route" });
    });
    await runFixture(state);
    expect(state.errors).toEqual([]);
  },
});

test("failed preference load cannot overwrite saved preferences; retry restores them", async ({ page, app }) => {
  app.preferencesFailures = 1;
  await page.goto("/preferences");
  await expect(page.getByRole("alert")).toHaveText("Preferences temporarily unavailable");
  await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
  expect(app.requests.filter((request) => request.path === "/me/preferences" && request.method === "POST")).toHaveLength(0);
  expect(app.preferences[0].source_text).toBe("Keep this note");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Tell us more (optional)")).toHaveValue("Keep this note");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences[0].tag_id).toBe(1);
});

test("malformed preferences are not treated as an empty saved preference list", async ({ page, app }) => {
  app.malformedPreferences = true;
  await page.goto("/preferences");
  await expect(page.getByRole("alert")).toHaveText("Unable to load preferences.");
  await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
});

test("failed preference save preserves edits and can be retried", async ({ page, app }) => {
  await page.goto("/preferences");
  await page.getByLabel("Tell us more (optional)").fill("Updated note");
  app.mutationFails = true;
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Save unavailable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Tell us more (optional)")).toHaveValue("Updated note");
  expect(app.preferences[0].source_text).toBe("Keep this note");
  app.mutationFails = false;
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences[0].source_text).toBe("Updated note");
});

test("explicitly clearing loaded preferences still works", async ({ page, app }) => {
  await page.goto("/preferences");
  await page.getByRole("button", { name: "fantasy ×" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences).toEqual([]);
});

test("Want to Own to removed updates both shelves immediately and persists on reload", async ({ page, app }) => {
  await page.goto("/my-books");
  const owned = page.locator(".library-shelf").nth(0);
  const want = page.locator(".library-shelf").nth(1);
  await expect(want.locator(".book-card-redesign")).toHaveCount(1);
  await want.getByRole("button", { name: "Own", exact: true }).click();
  await expect(want.locator(".book-card-redesign")).toHaveCount(0);
  await expect(owned.locator(".book-card-redesign")).toHaveCount(1);
  await page.reload();
  await expect(owned.locator(".book-card-redesign")).toHaveCount(1);
  await owned.getByRole("button", { name: /Owned$/ }).click();
  await expect(owned.locator(".book-card-redesign")).toHaveCount(0);
  await expect(want.locator(".book-card-redesign")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".book-card-redesign")).toHaveCount(0);
  expect(app.saved).toEqual([]);
});

test("a failed status write does not move or remove the saved book", async ({ page, app }) => {
  await page.goto("/my-books");
  const want = page.locator(".library-shelf").nth(1);
  await expect(want.locator(".book-card-redesign")).toHaveCount(1);
  app.mutationFails = true;
  await want.getByRole("button", { name: "Own", exact: true }).click();
  await expect(page.getByText("Save unavailable", { exact: true })).toBeVisible();
  await expect(want.locator(".book-card-redesign")).toHaveCount(1);
  expect(app.saved[0].status).toBe("want");
});

test("failed shelf load offers retry instead of claiming the library is empty", async ({ page, app }) => {
  app.shelfFailures = 1;
  await page.goto("/my-books");
  await expect(page.getByText("We couldn’t open this shelf right now.")).toHaveCount(2);
  await page.getByRole("button", { name: "Try again" }).first().click();
  await expect(page.locator(".library-shelf").nth(1).locator(".book-card-redesign")).toHaveCount(1);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(2);
});

test("status buttons wait for saved statuses and prevent overwriting an unknown shelf state", async ({ page, app }) => {
  let release;
  app.holdShelves = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Own", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Want to read", exact: true })).toBeEnabled();
});

test("changing status in details is reflected when navigating to My Books", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Own", exact: true }).click();
  await page.getByRole("link", { name: "My books", exact: true }).click();
  await expect(page.locator(".library-shelf").nth(0).locator(".book-card-redesign")).toHaveCount(1);
  await expect(page.locator(".library-shelf").nth(1).locator(".book-card-redesign")).toHaveCount(0);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(1);
});

test("category search, tag removal, reset and browser back follow current controls", async ({ page, app }) => {
  await page.goto("/browse?tag=fantasy");
  await expect(page.locator(".book-card-redesign")).toHaveCount(1);
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("button", { name: "fantasy ×" }).click();
  await page.getByLabel("Search books", { exact: true }).fill("Mystery");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/book=Mystery/);
  await expect(page.locator(".book-card-redesign h3")).toHaveText(["Test-only Mystery"]);
  const request = app.requests.filter((item) => item.path === "/books").at(-1);
  expect(request.query.get("book")).toBe("Mystery");
  expect(request.query.getAll("tag")).toEqual([]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.getByRole("heading", { name: "Find your next read", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Search books", { exact: true })).toHaveValue("Mystery");
  await expect(page.locator(".book-card-redesign h3")).toHaveText(["Test-only Mystery"]);
});

test("author search updates a category URL and autocomplete selection", async ({ page, app }) => {
  await page.goto("/browse?tag=fantasy");
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("button", { name: "fantasy ×" }).click();
  await page.getByLabel("Author", { exact: true }).fill("Another");
  await page.getByRole("button", { name: "Another Author", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".book-card-redesign h3")).toHaveText(["Test-only Science Fiction"]);
  expect(app.requests.filter((item) => item.path === "/books").at(-1).query.get("author")).toBe("Another Author");
});

test("science-fiction landing links and discovery requests use the actual catalogue tag", async ({ page, app }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Science fiction" }).click();
  await expect(page).toHaveURL(/tag=science_fiction/);
  await expect(page.locator(".book-card-redesign h3")).toHaveText(["Test-only Science Fiction"]);
  await page.getByRole("link", { name: "Discover books" }).click();
  await expect(page.locator(".browse-shelf").first().locator(".book-card-redesign")).toHaveCount(2);
  expect(app.requests.some((request) => request.query.get("tag") === "science fiction")).toBe(false);
});

test("signed-out phone visitors can reach sign in and registration from navigation", async ({ page, app }) => {
  app.authenticated = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const drawer = page.locator("#mobile-navigation");
  await expect(drawer.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Join Bookvane", exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Join Bookvane", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await drawer.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("registration, onboarding, logout and protected routes remain connected", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/register");
  await page.getByLabel("Email", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/my-books");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("failed login displays an error and remains signed out", async ({ page, app }) => {
  app.authenticated = false;
  app.loginFails = true;
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page).toHaveURL(/\/login$/);
});

test("expired access retries once after refresh and permanent expiry returns to login", async ({ page, app }) => {
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Want to read", exact: true })).toBeEnabled();
  app.expireNext = true;
  await page.getByRole("button", { name: "Own", exact: true }).click();
  await expect(page.getByRole("button", { name: "Owned", exact: true })).toBeEnabled();
  expect(app.requests.filter((request) => request.path === "/auth/refresh")).toHaveLength(2);
  app.expireNext = true;
  app.refreshFails = true;
  await page.getByRole("button", { name: "Owned", exact: true }).click();
  await page.goto("/my-books");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("password recovery screens handle generic response, invalid link and single use", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("browser-test@example.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that account exists");
  await page.goto("/reset-password#token=invalid");
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid or expired reset link");
  await page.goto("/reset-password#token=browser-test-token");
  await page.reload();
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.goto("/reset-password#token=browser-test-token");
  await page.reload();
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid or expired reset link");
});

test("a late startup refresh failure cannot undo a successful login", async ({ page, app }) => {
  app.authenticated = false;
  let release;
  app.holdRefresh = new Promise((resolve) => { release = resolve; });
  await page.goto("/login");
  await expect.poll(() => app.requests.some((request) => request.path === "/auth/refresh")).toBe(true);
  await page.getByLabel("Email", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Working…", exact: true })).toBeVisible();
  expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(0);
  const response = page.waitForResponse((result) => result.url().endsWith("/auth/refresh"));
  release();
  await response;
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.getByRole("link", { name: "My books", exact: true })).toBeVisible();
});

test("a delayed existing-session refresh cannot overwrite cookies from a newer login", async ({ page, context, app }) => {
  app.emitCookies = true;
  let release;
  app.holdRefresh = new Promise((resolve) => { release = resolve; });
  await page.goto("/login");
  await expect.poll(() => app.requests.some((request) => request.path === "/auth/refresh")).toBe(true);
  await page.getByLabel("Email", { exact: true }).fill("different-browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Working…", exact: true })).toBeVisible();
  expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(0);
  const response = page.waitForResponse((result) => result.url().endsWith("/auth/refresh"));
  release();
  await response;
  await expect(page).toHaveURL(/\/browse$/);
  await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "access_token")?.value).toBe("test-new-session");
});

test("search and missing-book failures show errors instead of crashing", async ({ page, app }) => {
  app.searchFails = true;
  await page.goto("/browse?view=all");
  await expect(page.getByText("Search temporarily unavailable", { exact: true })).toBeVisible();
  await page.goto("/book/999");
  await expect(page.getByText("Book not found", { exact: true })).toBeVisible();
});

test("pagination renders different records and a new search returns to page one", async ({ page, app }) => {
  app.catalogue = Array.from({ length: 42 }, (_, index) => ({
    ...books[0], id: 100 + index, title: `Pagination-only record ${index + 1}`,
  }));
  await page.goto("/browse?view=all");
  await expect(page.locator(".book-card-redesign")).toHaveCount(20);
  const firstPage = await page.locator(".book-card-redesign h3").allTextContents();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.locator(".book-card-redesign h3").first()).toHaveText("Pagination-only record 21");
  const secondPage = await page.locator(".book-card-redesign h3").allTextContents();
  expect(firstPage.some((title) => secondPage.includes(title))).toBe(false);
  await page.getByLabel("Search books", { exact: true }).fill("record 4");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".book-card-redesign")).toHaveCount(4);
  expect(app.requests.filter((request) => request.path === "/books").at(-1).query.get("page")).toBe("1");
});

test("ordinary authenticated discovery has bounded request counts and one shared library read", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "My books", exact: true })).toBeVisible();
  await expect(page.locator(".browse-shelf__skeleton")).toHaveCount(0);
  expect(app.requests.filter((request) => request.path === "/books").length).toBeLessThanOrEqual(10);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(1);
  expect(app.requests.filter((request) => request.path === "/auth/refresh")).toHaveLength(1);
});

test("shelf read failure blocks detail-page writes until retry succeeds", async ({ page, app }) => {
  app.shelfFailures = 1;
  await page.goto("/book/1");
  await expect(page.getByRole("alert")).toContainText("Couldn’t load your saved books");
  await expect(page.getByRole("button", { name: "Own", exact: true })).toBeDisabled();
  expect(app.requests.some((request) => request.path.endsWith("/status"))).toBe(false);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Want to read", exact: true })).toBeEnabled();
});
