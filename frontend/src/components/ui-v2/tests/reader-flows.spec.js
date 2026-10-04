import { test as base, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

// Real-title reference fixtures only. All requests are intercepted; these tests
// never contact a hosted API or create real accounts/library records.
const titles = ["Pride and Prejudice", "Frankenstein", "The Time Machine", "The Great Gatsby", "The Hound of the Baskervilles"];
const authors = ["Jane Austen", "Mary Shelley", "H. G. Wells", "F. Scott Fitzgerald", "Arthur Conan Doyle"];
const subjects = ["fantasy", "mystery", "history", "romance", "science_fiction", "classics", "horror", "thriller", "adventure", "humor", "biography", "poetry", "drama", "young_adult", "philosophy"].map((name, i) => ({ id: i + 1, name, type: "genre" }));
const tag = (name) => subjects.find((item) => item.name === name);
const tags = [["romance", "classics"], ["horror", "science_fiction", "classics"], ["science_fiction", "adventure", "classics"], ["classics"], ["mystery", "classics"]];
const books = titles.map((title, i) => ({ id: i + 1, title, authors: [{ id: i + 1, name: authors[i] }], tags: tags[i].map(tag), published_year: [1813, 1818, 1895, 1925, 1902][i], description: "A reference book description for browser validation.", cover_image_url: `/test-cover/${i}.jpg` }));

const test = base.extend({
  app: async ({ page }, runFixture) => {
    const state = { authenticated: false, saved: [], preferences: [{ tag_id: 2, tag: tag("mystery"), source_text: "Preserve this note" }], requests: [], errors: [], catalogue: books, shelfFailures: 0, preferenceFailures: 0, mutationFails: false };
    page.on("pageerror", (error) => state.errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5189") { state.errors.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
      if (url.pathname.startsWith("/test-cover/")) {
        if (state.brokenCover) return route.fulfill({ status: 404, body: "" });
        const number = Number(url.pathname.match(/(\d+)\.jpg/)?.[1]) % 5;
        return route.fulfill({ contentType: "image/jpeg", body: readFileSync(new URL(`../../../../../docs/ui-v2/redesign/assets/cover-${number}.jpg`, import.meta.url)) });
      }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = method === "POST" ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, query: url.searchParams });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") { if (state.holdRefresh) await state.holdRefresh; return state.authenticated ? reply(200, {}) : reply(401, { detail: "Session expired" }); }
      if (path === "/auth/register") return reply(201, {});
      if (path === "/auth/login") { if (state.loginFails) return reply(401, { detail: "Invalid email or password" }); state.authenticated = true; return reply(200, {}); }
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/auth/forgot-password") return reply(202, {});
      if (path === "/auth/reset-password") return body.token === "expired" ? reply(400, { detail: "Invalid or expired reset link" }) : reply(200, {});
      if (path === "/email-signups") return reply(201, {});
      if (path === "/me/books") { if (state.holdShelves) await state.holdShelves; if (state.shelfFailures-- > 0) return reply(503, { detail: "Unavailable" }); return reply(200, state.saved); }
      if (path === "/me/preferences") {
        if (method === "GET") { if (state.preferenceFailures-- > 0) return reply(503, {}); return reply(200, state.malformedPreferences ? { invalid: true } : state.preferences); }
        if (state.mutationFails) return reply(503, {});
        state.preferences = body.tag_ids.map((id) => ({ tag_id: id, tag: subjects.find((item) => item.id === id), source_text: body.source_text }));
        return reply(200, state.preferences);
      }
      if (/^\/books\/\d+\/status$/.test(path)) {
        if (state.holdSave) await state.holdSave;
        if (state.mutationFails) return reply(503, {});
        const id = Number(path.split("/")[2]); state.saved = state.saved.filter((item) => item.book_id !== id);
        if (method === "DELETE") return route.fulfill({ status: 204 });
        const saved = { id, book_id: id, status: body.status, book: state.catalogue.find((item) => item.id === id) }; state.saved.push(saved); return reply(200, saved);
      }
      if (path === "/books") {
        if (state.holdCatalogue) await state.holdCatalogue;
        if (state.catalogueFails) return reply(503, {});
        let items = state.catalogue.filter((book) =>
          (!url.searchParams.get("book") || book.title.toLowerCase().includes(url.searchParams.get("book").toLowerCase())) &&
          (!url.searchParams.get("author") || book.authors.some((author) => author.name.toLowerCase().includes(url.searchParams.get("author").toLowerCase()))) &&
          url.searchParams.getAll("tag").every((value) => book.tags.some((item) => item.name === value)));
        if (url.searchParams.get("exclude_owned") === "true") items = items.filter((book) => !state.saved.some((item) => item.book_id === book.id && item.status === "owned"));
        if (url.searchParams.get("shelf_status")) items = items.filter((book) => state.saved.some((item) => item.book_id === book.id && item.status === url.searchParams.get("shelf_status")));
        const size = Number(url.searchParams.get("size") || 20), p = Number(url.searchParams.get("page") || 1);
        return reply(200, { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, size });
      }
      if (/^\/books\/\d+$/.test(path)) return state.catalogue.find((book) => book.id === Number(path.split("/")[2])) ? reply(200, state.catalogue.find((book) => book.id === Number(path.split("/")[2]))) : reply(404, {});
      if (path === "/autocomplete/tags") return reply(200, subjects.filter((item) => item.name.includes(url.searchParams.get("q"))));
      state.errors.push(`Unhandled request: ${method} ${path}`); return reply(500, {});
    });
    await runFixture(state); expect(state.errors).toEqual([]);
  },
});

async function signIn(page) { await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByLabel("Password", { exact: true }).fill("valid-password"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); }
const mutations = (app) => app.requests.filter((request) => request.path.endsWith("/status"));

test("anonymous save survives registration and resumes exactly once", async ({ page, app }) => {
  await page.goto("/browse"); await page.getByRole("button", { name: "Add The Time Machine to Want", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("dialog")).toContainText("The Time Machine");
  await page.getByRole("dialog").getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/3/); await expect(page.getByRole("button", { name: "Remove The Time Machine from Want" })).toHaveAttribute("aria-pressed", "true");
  expect(mutations(app)).toHaveLength(1); expect(app.saved[0].status).toBe("want");
  await page.getByRole("link", { name: "View My Books" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["The Time Machine"]);
});

test("save confirmation waits for the API and shelf moves update the shared library", async ({ page, app }) => {
  app.authenticated = true; let release; app.holdSave = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1"); const want = page.getByRole("button", { name: "Add Pride and Prejudice to Want" }); await expect(want).toBeEnabled(); await want.click();
  await expect(want).toHaveText("Saving…"); await expect(want).toHaveAttribute("aria-pressed", "false"); expect(app.saved).toHaveLength(0);
  release(); app.holdSave = null; await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add Pride and Prejudice to Own" }).click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Own" })).toHaveAttribute("aria-pressed", "true");
  expect(app.saved).toHaveLength(1); expect(app.saved[0].status).toBe("owned"); await page.goto("/my-books?status=owned");
  await page.getByRole("button", { name: "Remove Pride and Prejudice from Own" }).click(); await expect(page.getByRole("heading", { name: "Give your books a home." })).toBeVisible(); expect(app.saved).toHaveLength(0);
});

test("failed writes retain the prior status and offer a real retry", async ({ page, app }) => {
  app.authenticated = true; app.mutationFails = true; await page.goto("/book/1"); const button = page.getByRole("button", { name: "Add Pride and Prejudice to Want" }); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByRole("alert")).toContainText("couldn’t be saved"); await expect(button).toHaveAttribute("aria-pressed", "false");
  app.mutationFails = false; await button.click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toHaveAttribute("aria-pressed", "true");
});

test("initial library load blocks writes and failures do not imply an empty shelf", async ({ page, app }) => {
  app.authenticated = true; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }]; let release; app.holdShelves = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1"); await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want" })).toBeDisabled(); expect(mutations(app)).toHaveLength(0);
  app.shelfFailures = 1; release(); app.holdShelves = null; await expect(page.getByRole("alert")).toContainText("saved books couldn’t load");
  await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want" })).toBeDisabled(); await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toBeEnabled(); expect(mutations(app)).toHaveLength(0);
});

test("author search, AND filters, hidden owned books, history and pagination use the API contract", async ({ page, app }) => {
  app.authenticated = true; await page.goto("/browse"); await page.getByLabel("Search by", { exact: true }).selectOption("author"); await page.getByLabel("Search authors").fill("Jane");
  await page.getByRole("button", { name: "Filters", exact: true }).click(); await page.getByRole("dialog").getByLabel("Romance", { exact: true }).check(); await page.getByRole("dialog").getByLabel("Classics", { exact: true }).check();
  await page.getByRole("button", { name: "Apply filters" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
  const url = new URL(page.url()); expect(url.searchParams.get("author")).toBe("Jane"); expect(url.searchParams.getAll("tag")).toEqual(["romance", "classics"]);
  await page.getByRole("button", { name: "Clear search & filters" }).click(); await expect(page.locator(".bv-book-card")).toHaveCount(5); await page.goBack(); await expect(page.getByLabel("Search authors")).toHaveValue("Jane");
  await page.goto("/browse?tag=mystery&tag=classics"); await expect(page.locator(".bv-book-card h3")).toHaveText(["The Hound of the Baskervilles"]);
  app.saved = [{ id: 5, book_id: 5, status: "owned", book: books[4] }]; await page.getByRole("button", { name: /Filters/ }).click(); await page.getByLabel("Hide books I own").check(); await page.getByRole("button", { name: "Apply filters" }).click(); await expect(page.getByRole("heading", { name: "No books found." })).toBeVisible();
  await page.getByRole("button", { name: /Filters/ }).click(); await expect(page.getByLabel("Hide books I own")).toBeChecked(); await page.keyboard.press("Escape");
  app.catalogue = Array.from({ length: 45 }, (_, i) => ({ ...books[i % 5], id: i + 1, title: `Book ${i + 1}` })); await page.goto("/browse"); await expect(page.locator(".bv-book-card")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page).toHaveURL(/page=2/); await expect(page.locator(".bv-book-card h3").first()).toHaveText("Book 21");
});

test("preference-load failures cannot overwrite data; saved tag IDs preserve existing notes", async ({ page, app }) => {
  app.authenticated = true; app.preferenceFailures = 1; await page.goto("/preferences"); await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible(); await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
  expect(app.requests.filter((request) => request.path === "/me/preferences" && request.method === "POST")).toHaveLength(0);
  await page.getByRole("button", { name: "Try again" }).click(); await expect(page.getByLabel("Mystery", { exact: true })).toBeChecked(); await page.getByLabel("Romance", { exact: true }).check();
  app.mutationFails = true; await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page.getByRole("alert")).toContainText("choices are still here"); await expect(page.getByLabel("Romance", { exact: true })).toBeChecked();
  app.mutationFails = false; await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page).toHaveURL(/\/browse$/); expect(app.preferences.map((item) => item.tag_id)).toContain(4); expect(app.preferences[0].source_text).toBe("Preserve this note");
});

test("malformed preferences are a load failure rather than writable empty choices", async ({ page, app }) => {
  app.authenticated = true; app.malformedPreferences = true; await page.goto("/preferences"); await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible();
});

test("recovery remains neutral, accepts a fragment token, and handles expired links", async ({ page, app }) => {
  await page.goto("/forgot-password"); await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByRole("button", { name: "Send reset link" }).click(); await expect(page.getByText(/If an account exists/)).toBeVisible();
  await page.goto("/reset-password#token=valid-token"); await expect(page).toHaveURL(/\/reset-password$/); await page.getByLabel("New password").fill("new-password"); await page.getByRole("button", { name: "Reset password" }).click(); await expect(page.getByText("Your password is updated. You can sign in again.")).toBeVisible(); expect(app.requests.find((request) => request.path === "/auth/reset-password").body.token).toBe("valid-token");
  await page.goto("/reset-password#token=expired"); await page.getByLabel("New password").fill("new-password"); await page.getByRole("button", { name: "Reset password" }).click(); await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible();
});

test("dialog traps keyboard focus, closes with Escape, and restores the trigger", async ({ page, app }) => {
  await page.goto("/browse"); const trigger = page.getByRole("button", { name: "Filters", exact: true }); await trigger.focus(); await trigger.click(); await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 23; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement.closest("dialog")))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(trigger).toBeFocused(); expect(app.requests.some((request) => request.path === "/books")).toBe(true);
});

test("missing cover and description have intentional fallbacks; search failures preserve context", async ({ page, app }) => {
  app.brokenCover = true; app.catalogue = [{ ...books[0], description: null }]; await page.goto("/book/1"); await expect(page.getByRole("img", { name: "Cover unavailable for Pride and Prejudice" })).toBeVisible(); await expect(page.getByText(/A description isn’t available/)).toBeVisible();
  app.catalogueFails = true; await page.goto("/browse?author=Jane"); await expect(page.getByRole("heading", { name: "The books couldn’t load." })).toBeVisible(); await expect(page.getByLabel("Search authors")).toHaveValue("Jane"); app.catalogueFails = false; await page.getByRole("button", { name: "Try again" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
});

test("external return URLs are ignored and invalid login preserves the form", async ({ page, app }) => {
  app.loginFails = true; await page.goto("/login?returnTo=https%3A%2F%2Fexample.com"); await signIn(page); await expect(page.getByRole("alert")).toContainText("Invalid email or password"); await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("reader@example.com"); app.loginFails = false; await signIn(page); await expect(page).toHaveURL(/\/my-books$/);
});

for (const width of [320, 390, 768, 1440]) test(`responsive routes and themes at ${width}px`, async ({ page, app }) => {
  await page.setViewportSize({ width, height: 844 }); app.authenticated = true; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  app.catalogue = [{ ...books[0], title: "A deliberately very long book title that must wrap without hiding the reader’s shelf controls" }, ...books.slice(1)];
  for (const path of ["/", "/browse", "/book/1", "/my-books", "/preferences", "/account"]) {
    await page.goto(path); await expect(page.locator("h1")).toBeVisible(); await page.locator(".bv-book-card").first().waitFor({ timeout: 1000 }).catch(() => {});
    const overflow = await page.evaluate(() => [...document.querySelectorAll(".bv-root *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ element: element.className, right: element.getBoundingClientRect().right })).slice(0, 8));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: ${JSON.stringify(overflow)}`).toBe(true);
    await expect(page.locator("body")).not.toContainText(/Shelfbound/i);
  }
  await page.goto("/account"); await page.getByRole("button", { name: "Switch theme" }).click(); await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark"); await page.reload(); await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/browse"); await page.getByRole("button", { name: "Filters", exact: true }).click(); expect(await page.getByRole("dialog").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});


test("discovery context survives book details and signing in to save", async ({ page, app }) => {
  await page.goto("/browse?author=Jane&tag=romance");
  await page.getByRole("link", { name: "View Pride and Prejudice", exact: true }).click();
  await expect(page.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/browse?author=Jane&tag=romance");
  await page.getByRole("button", { name: "Add Pride and Prejudice to Want" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click();
  await signIn(page); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toBeEnabled();
  await page.getByRole("link", { name: "Back to discovery" }).click(); await expect(page).toHaveURL(/author=Jane&tag=romance/);
  expect(mutations(app)).toHaveLength(1);
});

test("save-after-sign-in failures offer a retry without repeating registration", async ({ page, app }) => {
  app.mutationFails = true; await page.goto("/browse"); await page.getByRole("button", { name: "Add Frankenstein to Want" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click(); await signIn(page);
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible(); await expect(page.getByRole("alert")).toHaveCount(1); expect(app.saved).toHaveLength(0);
  app.mutationFails = false; await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("button", { name: "Remove Frankenstein from Want" })).toBeEnabled(); await expect(page).not.toHaveURL(/save=/);
  expect(mutations(app)).toHaveLength(2); expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(1);
});

test("visual review exports the implemented desktop and mobile screens", async ({ page, app }) => {
  const directory = new URL("../../../../../docs/ui-v2/implementation/screenshots/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("bookvane-theme", value), theme);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [name, path, authenticated] of [["landing", "/", false], ["discovery", "/browse", false], ["book", "/book/1", true], ["library", "/my-books", true], ["preferences", "/preferences", true], ["register", "/register", false]]) {
        app.authenticated = authenticated; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
        await page.goto(path); await expect(page.locator("h1")).toBeVisible();
        await expect(page.getByRole("status", { name: "Loading books", exact: true })).toHaveCount(0);
        await expect(page.getByText("Checking account…", { exact: true })).toHaveCount(0);
        if (name === "book") await expect(page.locator("#bv-book-title")).toBeVisible();
        if (name === "library") await expect(page.locator(".bv-book-card")).toHaveCount(1);
        if (name === "preferences") await expect(page.getByRole("button", { name: "Save preferences" })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.locator(".bv-cover img").evaluateAll((images) => Promise.all(images.map((img) => img.decode().catch(() => {}))));
        await page.screenshot({ path: new URL(`${width}-${theme}-${name}.png`, directory).pathname, fullPage: true });
      }
    }
  }
});


test("dark theme keeps primary headings and book titles legible alongside legacy styles", async ({ page, app }) => {
  app.authenticated = true; await page.addInitScript(() => localStorage.setItem("bookvane-theme", "dark"));
  for (const path of ["/browse", "/book/1", "/my-books", "/preferences", "/account"]) {
    await page.goto(path); await expect(page.locator("h1")).toBeVisible();
    if (path === "/browse") await expect(page.locator(".bv-book-card")).toHaveCount(5);
    if (path === "/book/1") await expect(page.locator("#bv-book-title")).toBeVisible();
    const ratios = await page.evaluate(() => {
      const luminance = (color) => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map((value) => Number(value) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const background = luminance(getComputedStyle(document.querySelector(".bv-root")).backgroundColor);
      return [...document.querySelectorAll("h1, .bv-book-card h3, .bv-results-heading h2, .bv-description h2")].map((element) => {
        const text = luminance(getComputedStyle(element).color);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      });
    });
    for (const ratio of ratios) expect(ratio, path).toBeGreaterThanOrEqual(4.5);
  }
});


test("an unfinished save notice does not follow the reader to an unrelated book", async ({ page, app }) => {
  app.authenticated = true; app.mutationFails = true; await page.goto("/book/1?save=want");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Discover", exact: true }).click();
  await page.getByRole("link", { name: "View Frankenstein", exact: true }).click();
  await expect(page.locator("#bv-book-title")).toHaveText("Frankenstein");
  await expect(page.getByRole("button", { name: "Retry save" })).toHaveCount(0);
  expect(mutations(app)).toHaveLength(1);
});


test("library failures have one retry on My Books and still block unknown shelf writes", async ({ page, app }) => {
  app.authenticated = true; app.shelfFailures = 1;
  app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "Your library couldn’t load." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /Want/ })).toContainText("…");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mutations(app)).toHaveLength(0);
});

test("choosing a different shelf after continuation failure replaces the pending save", async ({ page, app }) => {
  app.authenticated = true; app.mutationFails = true;
  await page.goto("/book/1?save=want&from=%2Fbrowse%3Ftag%3Dromance");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  app.mutationFails = false;
  await page.getByRole("button", { name: "Add Pride and Prejudice to Own" }).click();
  await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Own" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/save=/);
  await expect(page.getByRole("button", { name: "Retry save" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/browse?tag=romance");
  expect(app.saved[0].status).toBe("owned");
  expect(mutations(app)).toHaveLength(2);
});
