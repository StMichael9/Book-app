import { test as base, expect } from "@playwright/test";

// Browser-only fixtures. Every API request is intercepted; no database or
// hosted API is contacted and these records are never imported anywhere.
const books = [
  { id: 1, title: "Test-only Fantasy", authors: [{ id: 1, name: "Test Author" }], tags: [{ id: 1, name: "fantasy" }] },
  { id: 2, title: "Test-only Science Fiction", authors: [{ id: 2, name: "Another Author" }], tags: [{ id: 2, name: "science_fiction" }] },
  { id: 3, title: "Test-only Mystery", authors: [{ id: 1, name: "Test Author" }], tags: [{ id: 3, name: "mystery" }] },
];

const test = base.extend({
  app: async ({ page, baseURL }, runFixture) => {
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
      if (url.origin !== new URL(baseURL).origin) {
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
        if (path === "/autocomplete/tags/batch") return reply(200, [...new Map(values.map(item => [item.id, item])).values()].filter(item => url.searchParams.getAll("name").includes(item.name)));
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
  await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
  expect(app.requests.filter((request) => request.path === "/me/preferences" && request.method === "POST")).toHaveLength(0);
  expect(app.preferences[0].source_text).toBe("Keep this note");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Fantasy", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences[0].tag_id).toBe(1);
});

test("malformed preferences are not treated as an empty saved preference list", async ({ page, app }) => {
  app.malformedPreferences = true;
  await page.goto("/preferences");
  await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
});

test("failed preference save preserves edits and can be retried", async ({ page, app }) => {
  await page.goto("/preferences");
  await page.getByLabel("Mystery", { exact: true }).check();
  app.mutationFails = true;
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("alert")).toContainText("Your choices are still here");
  await expect(page.getByLabel("Mystery", { exact: true })).toBeChecked();
  expect(app.preferences[0].source_text).toBe("Keep this note");
  app.mutationFails = false;
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences[0].source_text).toBe("Keep this note");
  expect(app.preferences.map(item => item.tag_id)).toContain(3);
});

test("explicitly clearing loaded preferences still works", async ({ page, app }) => {
  await page.goto("/preferences");
  await page.getByLabel("Fantasy", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences).toEqual([]);
});

test("Want to Own to removed updates both shelves immediately and persists on reload", async ({ page, app }) => {
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Add Test-only Fantasy to Own" }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  await page.getByRole("tab", { name: /^Own/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Test-only Fantasy from Own" }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  await page.getByRole("tab", { name: /^Want/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  expect(app.saved).toEqual([]);
});

test("a failed status write does not move or remove the saved book", async ({ page, app }) => {
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  app.mutationFails = true;
  await page.getByRole("button", { name: "Add Test-only Fantasy to Own" }).click();
  await expect(page.getByRole("alert")).toContainText("couldn’t be saved");
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  expect(app.saved[0].status).toBe("want");
});

test("failed shelf load offers retry instead of claiming the library is empty", async ({ page, app }) => {
  app.shelfFailures = 1;
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "Your library couldn’t load." })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).first().click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(2);
});

test("status buttons wait for saved statuses and prevent overwriting an unknown shelf state", async ({ page, app }) => {
  let release;
  app.holdShelves = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Add Test-only Fantasy to Own" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Want" })).toBeEnabled();
});

test("changing status in details is reflected when navigating to My Books", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Test-only Fantasy to Own" }).click();
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Own" })).toBeEnabled();
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "My Books", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  await page.getByRole("tab", { name: /^Own/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(1);
});

test("category search, tag removal, reset and browser back follow current controls", async ({ page, app }) => {
  await page.goto("/browse?tag=fantasy");
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("dialog").getByLabel("Fantasy", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByLabel("Search book titles", { exact: true }).fill("Mystery");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/book=Mystery/);
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Test-only Mystery"]);
  const request = app.requests.filter((item) => item.path === "/books").at(-1);
  expect(request.query.get("book")).toBe("Mystery");
  expect(request.query.getAll("tag")).toEqual([]);
  await page.getByRole("button", { name: "Clear search & filters", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.getByRole("heading", { name: "Find your next chapter.", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Search book titles", { exact: true })).toHaveValue("Mystery");
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Test-only Mystery"]);
});

test("direct author search updates a category URL", async ({ page, app }) => {
  await page.goto("/browse?tag=fantasy");
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("dialog").getByLabel("Fantasy", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByLabel("Search by", { exact: true }).selectOption("author");
  await page.getByLabel("Search authors", { exact: true }).fill("Another Author");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Test-only Science Fiction"]);
  expect(app.requests.filter((item) => item.path === "/books").at(-1).query.get("author")).toBe("Another Author");
});

test("science-fiction landing links and discovery requests use the actual catalogue tag", async ({ page, app }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Science fiction/ }).click();
  await expect(page).toHaveURL(/tag=science_fiction/);
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Test-only Science Fiction"]);
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(3);
  expect(app.requests.some((request) => request.query.get("tag") === "science fiction")).toBe(false);
});

test("signed-out phone visitors can reach sign in and registration from navigation", async ({ page, app }) => {
  app.authenticated = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("registration, onboarding, logout and protected routes remain connected", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/register");
  await page.getByLabel("Email address", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/preferences$/);
  await page.getByRole("link", { name: "Back to discovery", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/my-books");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("failed login displays an error and remains signed out", async ({ page, app }) => {
  app.authenticated = false;
  app.loginFails = true;
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page).toHaveURL(/\/login$/);
});

test("expired access retries once after refresh and permanent expiry returns to login", async ({ page, app }) => {
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Want" })).toBeEnabled();
  app.expireNext = true;
  await page.getByRole("button", { name: "Add Test-only Fantasy to Own" }).click();
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Own" })).toBeEnabled();
  expect(app.requests.filter((request) => request.path === "/auth/refresh")).toHaveLength(2);
  app.expireNext = true;
  app.refreshFails = true;
  await page.getByRole("button", { name: "Remove Test-only Fantasy from Own" }).click();
  await page.goto("/my-books");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("password recovery screens handle generic response, invalid link and single use", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/forgot-password");
  await page.getByLabel("Email address", { exact: true }).fill("browser-test@example.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
  await page.goto("/reset-password#token=invalid");
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This link is no longer valid." })).toBeVisible();
  await page.goto("/reset-password#token=browser-test-token");
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByText("Your password is updated. You can sign in again.")).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.goto("/reset-password#token=browser-test-token");
  await page.getByLabel("New password").fill("Test-password-123");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This link is no longer valid." })).toBeVisible();
});

test("a late startup refresh failure cannot undo a successful login", async ({ page, app }) => {
  app.authenticated = false;
  let release;
  app.holdRefresh = new Promise((resolve) => { release = resolve; });
  await page.goto("/login");
  await expect.poll(() => app.requests.some((request) => request.path === "/auth/refresh")).toBe(true);
  await page.getByLabel("Email address", { exact: true }).fill("browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Signing in…", exact: true })).toBeVisible();
  expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(0);
  const response = page.waitForResponse((result) => result.url().endsWith("/auth/refresh"));
  release();
  await response;
  await expect(page).toHaveURL(/\/my-books$/);
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
});

test("a delayed existing-session refresh cannot overwrite cookies from a newer login", async ({ page, context, app }) => {
  app.emitCookies = true;
  let release;
  app.holdRefresh = new Promise((resolve) => { release = resolve; });
  await page.goto("/login");
  await expect.poll(() => app.requests.some((request) => request.path === "/auth/refresh")).toBe(true);
  await page.getByLabel("Email address", { exact: true }).fill("different-browser-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Signing in…", exact: true })).toBeVisible();
  expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(0);
  const response = page.waitForResponse((result) => result.url().endsWith("/auth/refresh"));
  release();
  await response;
  await expect(page).toHaveURL(/\/my-books$/);
  await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "access_token")?.value).toBe("test-new-session");
});

test("search and missing-book failures show errors instead of crashing", async ({ page, app }) => {
  app.searchFails = true;
  await page.goto("/browse?view=all");
  await expect(page.getByRole("heading", { name: "The books couldn’t load." })).toBeVisible();
  await page.goto("/book/999");
  await expect(page.getByRole("heading", { name: "This book couldn’t be found." })).toBeVisible();
});

test("pagination renders different records and a new search returns to page one", async ({ page, app }) => {
  app.catalogue = Array.from({ length: 42 }, (_, index) => ({
    ...books[0], id: 100 + index, title: `Pagination-only record ${index + 1}`,
  }));
  await page.goto("/browse?view=all");
  await expect(page.locator(".bv-book-card")).toHaveCount(20);
  const firstPage = await page.locator(".bv-book-card h3").allTextContents();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.locator(".bv-book-card h3").first()).toHaveText("Pagination-only record 21");
  const secondPage = await page.locator(".bv-book-card h3").allTextContents();
  expect(firstPage.some((title) => secondPage.includes(title))).toBe(false);
  await page.getByLabel("Search book titles", { exact: true }).fill("record 4");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(4);
  expect(app.requests.filter((request) => request.path === "/books").at(-1).query.get("page")).toBe("1");
});

test("ordinary authenticated discovery has bounded request counts and one shared library read", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Want" })).toBeEnabled();
  expect(app.requests.filter((request) => request.path === "/books").length).toBeLessThanOrEqual(10);
  expect(app.requests.filter((request) => request.path === "/me/books")).toHaveLength(1);
  expect(app.requests.filter((request) => request.path === "/auth/refresh")).toHaveLength(1);
});

test("shelf read failure blocks detail-page writes until retry succeeds", async ({ page, app }) => {
  app.shelfFailures = 1;
  await page.goto("/book/1");
  await expect(page.getByRole("alert")).toContainText("Your saved books couldn’t load");
  await expect(page.getByRole("button", { name: "Add Test-only Fantasy to Own" })).toBeDisabled();
  expect(app.requests.some((request) => request.path.endsWith("/status"))).toBe(false);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Test-only Fantasy from Want" })).toBeEnabled();
});
