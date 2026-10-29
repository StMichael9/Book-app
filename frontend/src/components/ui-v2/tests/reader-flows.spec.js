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
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
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
      if (path === "/me/reading-capabilities") { if (state.holdCapabilities) await state.holdCapabilities; return reply(200, { enabled: Boolean(state.v3), contract_version: 1, writable: true, features: { reading_actions: true } }); }
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
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
      if (path === "/autocomplete/tags/batch") return reply(200, subjects.filter(item => url.searchParams.getAll("name").includes(item.name)));
      if (path === "/autocomplete/tags") return reply(200, subjects.filter((item) => item.name.includes(url.searchParams.get("q"))));
      if (route.request().method() === "GET" && /^\/me\/(home|library|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      state.errors.push(`Unhandled request: ${method} ${path}`); return reply(500, {});
    });
    await runFixture(state); expect(state.errors).toEqual([]);
  },
});

async function signIn(page) { await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByLabel("Password", { exact: true }).fill("valid-password"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); }
const mutations = (app) => app.requests.filter((request) => request.path.endsWith("/status"));

test("charcoal dark surfaces keep sage actions, form boundaries and focus readable", async ({ page, app }) => {
  app.authenticated = true;
  app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  await page.addInitScript(() => localStorage.setItem("bookvane-theme", "dark"));
  async function checkContrast(selector, property = "color", minimum = 4.5) {
    const pairs = await page.locator(selector).evaluateAll((elements, property) => {
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      const luminance = (color) => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      return elements.filter((el) => el.getClientRects().length && !el.disabled).map((el) => {
        let surface = property === "outlineColor" ? el.parentElement : el;
        while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
        const foreground = luminance(getComputedStyle(el)[property]), background = luminance(getComputedStyle(surface).backgroundColor);
        return { label: el.textContent || el.id, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
    }, property);
    expect(pairs.length, selector).toBeGreaterThan(0);
    for (const pair of pairs) expect(pair.ratio, `${property}: ${pair.label}`).toBeGreaterThanOrEqual(minimum);
  }
  await page.goto("/"); await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await expect(page.locator(".bv-root")).toHaveCSS("background-color", "rgb(30, 29, 27)");
  await expect(page.locator(".bv-root")).toHaveCSS("color", "rgb(235, 232, 225)");
  await expect(page.locator(".bv-library-banner")).toHaveCSS("background-color", "rgb(38, 37, 35)");
  await checkContrast(".bv-lead, .bv-help, .bv-genre-card, .bv-genre-card > span:last-child, .bv-button, .bv-text-link, .bv-library-banner p");
  const explore = page.getByRole("link", { name: "Explore books", exact: true });
  await expect(explore).toHaveCSS("background-color", "rgb(169, 201, 179)");
  await expect(explore).toHaveCSS("color", "rgb(30, 29, 27)");
  await explore.hover(); await checkContrast(".bv-hero-actions .bv-button");
  await page.keyboard.press("Tab"); await explore.focus();
  await expect(explore).toHaveCSS("outline-color", "rgb(217, 130, 108)");
  await checkContrast(".bv-hero-actions .bv-button", "outlineColor", 3);
  await page.goto("/browse"); await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgb(38, 37, 35)");
  await checkContrast(".bv-dialog p, .bv-dialog .bv-button, .bv-check-tile, .bv-dialog input:not([type=checkbox])");
  await checkContrast(".bv-check-tile, .bv-dialog input:not([type=checkbox])", "borderTopColor", 3);
  await page.keyboard.press("Escape");
  app.authenticated = false;
  await page.goto("/login"); await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await checkContrast(".bv-field input, .bv-field small, .bv-auth-card .bv-button, .bv-auth-switch");
  await checkContrast(".bv-field input", "borderTopColor", 3);
  app.authenticated = true;
  await page.goto("/book/1"); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want to read" })).toBeEnabled();
  app.mutationFails = true; await page.getByRole("button", { name: "Add Pride and Prejudice to Owned" }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await checkContrast(".bv-field-error, .bv-button--saved, .bv-help");
  await page.goto("/account"); await page.getByRole("button", { name: "Switch theme" }).click();
  await expect(page.locator(".bv-root")).toHaveCSS("background-color", "rgb(250, 248, 242)");
  await expect(page.locator(".bv-root")).toHaveCSS("color", "rgb(32, 46, 40)");
});

test("anonymous save survives registration and resumes exactly once", async ({ page, app }) => {
  await page.goto("/browse"); await page.getByRole("button", { name: "Add The Time Machine to Want to read", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("dialog")).toContainText("The Time Machine");
  await page.getByRole("dialog").getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/3/); await expect(page.getByRole("button", { name: "Remove The Time Machine from Want to read" })).toHaveAttribute("aria-pressed", "true");
  expect(mutations(app)).toHaveLength(1); expect(app.saved[0].status).toBe("want");
  await page.getByRole("link", { name: "View My Books" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["The Time Machine"]);
});

test("save confirmation waits for the API and shelf moves update the shared library", async ({ page, app }) => {
  app.authenticated = true; let release; app.holdSave = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1"); const want = page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" }); await expect(want).toBeEnabled(); await want.click();
  await expect(want).toHaveText("Saving…"); await expect(want).toHaveAttribute("aria-pressed", "false"); expect(app.saved).toHaveLength(0);
  release(); app.holdSave = null; await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want to read" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add Pride and Prejudice to Owned" }).click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Owned" })).toHaveAttribute("aria-pressed", "true");
  expect(app.saved).toHaveLength(1); expect(app.saved[0].status).toBe("owned"); await page.goto("/my-books?status=owned");
  await page.getByRole("button", { name: "Remove Pride and Prejudice from Owned" }).click(); await expect(page.getByRole("heading", { name: "Give your books a home." })).toBeVisible(); expect(app.saved).toHaveLength(0);
});

test("failed writes retain the prior status and offer a real retry", async ({ page, app }) => {
  app.authenticated = true; app.mutationFails = true; await page.goto("/book/1"); const button = page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" }); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByRole("alert")).toContainText("couldn’t be saved"); await expect(button).toHaveAttribute("aria-pressed", "false");
  app.mutationFails = false; await button.click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want to read" })).toHaveAttribute("aria-pressed", "true");
});

test("initial library load blocks writes and failures do not imply an empty shelf", async ({ page, app }) => {
  app.authenticated = true; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }]; let release; app.holdShelves = new Promise((resolve) => { release = resolve; });
  await page.goto("/book/1"); await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" })).toBeDisabled(); expect(mutations(app)).toHaveLength(0);
  app.shelfFailures = 1; release(); app.holdShelves = null; await expect(page.getByRole("alert")).toContainText("saved books couldn’t load");
  await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" })).toBeDisabled(); await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want to read" })).toBeEnabled(); expect(mutations(app)).toHaveLength(0);
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
  await page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click();
  await signIn(page); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want to read" })).toBeEnabled();
  await page.getByRole("link", { name: "Back to discovery" }).click(); await expect(page).toHaveURL(/author=Jane&tag=romance/);
  expect(mutations(app)).toHaveLength(1);
});

test("save-after-sign-in failures offer a retry without repeating registration", async ({ page, app }) => {
  app.mutationFails = true; await page.goto("/browse"); await page.getByRole("button", { name: "Add Frankenstein to Want to read" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click(); await signIn(page);
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible(); await expect(page.getByRole("alert")).toHaveCount(1); expect(app.saved).toHaveLength(0);
  app.mutationFails = false; await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("button", { name: "Remove Frankenstein from Want to read" })).toBeEnabled(); await expect(page).not.toHaveURL(/save=/);
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
  await page.getByRole("button", { name: "Add Pride and Prejudice to Owned" }).click();
  await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Owned" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/save=/);
  await expect(page.getByRole("button", { name: "Retry save" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/browse?tag=romance");
  expect(app.saved[0].status).toBe("owned");
  expect(mutations(app)).toHaveLength(2);
});

for (const theme of ["light", "dark"]) test(`minimalist landing is clear, responsive and account-free; ${theme}`, async ({ page, app }) => {
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your personal reading home.", exact: true })).toBeVisible();
    await expect(page.locator(".bv-book-card")).toHaveCount(5);
    const explore = page.getByRole("link", { name: "Explore books", exact: true });
    await expect(explore).toHaveAttribute("href", "/browse");
    expect((await explore.boundingBox()).y).toBeLessThan(650);
    await expect(page.getByText("Free. Private. No account needed to explore.", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation", exact: true })).toHaveCount(0);
    await expect(page.locator(".bv-hero-actions").getByRole("link", { name: "Create your library", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`polish-landing-${theme}-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "Explore books", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(app.requests.filter(item => item.path === "/auth/register")).toHaveLength(0);
});

test("minimalist root does not flash marketing during auth/capability checks and returns V3 readers Home", async ({ page, app }) => {
  app.authenticated = true; app.v3 = true;
  let releaseAuth, releaseCapabilities;
  app.holdRefresh = new Promise(resolve => { releaseAuth = resolve; });
  app.holdCapabilities = new Promise(resolve => { releaseCapabilities = resolve; });
  // A reader who was signed in last time keeps the opening screen; a first-time guest sees the public books at once (instant-paint spec).
  await page.addInitScript(() => localStorage.setItem("bookvane:session-hint:v1", "1"));
  await page.addInitScript(() => {
    window.marketingSeen = false;
    new MutationObserver(() => { if (document.querySelector(".bv-hero")) window.marketingSeen = true; }).observe(document, { childList: true, subtree: true });
  });
  try {
    await page.goto("/");
    await expect(page.getByText("Opening Bookvane…", { exact: true })).toBeVisible();
    await expect(page.locator(".bv-hero")).toHaveCount(0);
    releaseAuth();
    await expect.poll(() => app.requests.filter(item => item.path === "/me/reading-capabilities").length).toBe(1);
    await expect(page.locator(".bv-hero")).toHaveCount(0);
    releaseCapabilities();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Pick up where you left off.", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.marketingSeen)).toBe(false);
    expect(app.requests.filter(item => item.path === "/books")).toHaveLength(0);
  } finally { releaseAuth(); releaseCapabilities(); }
});

test("minimalist landing retains existing legacy fallback and scoped catalogue recovery", async ({ page, app }) => {
  app.authenticated = true; app.catalogueFails = true;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your personal reading home.", exact: true })).toBeVisible();
  // The committed book snapshot keeps the page populated when the catalogue request fails, so there is no error panel.
  await expect(page.getByRole("heading", { name: "The books are taking a moment.", exact: true })).toHaveCount(0);
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await expect(page.getByRole("link", { name: `Explore ${books[0].title}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to your library", exact: true })).toHaveAttribute("href", "/my-books");
  await expect(page.getByRole("link", { name: "Explore books", exact: true })).toBeVisible();
  app.catalogueFails = false;
  await page.reload();
  await expect(page.getByRole("link", { name: `Explore ${books[0].title}`, exact: true })).toBeVisible();
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
});

test("landing prefers covered, plain-English titles and never repeats hero books in the row", async ({ page, app }) => {
  const odd = ["Ὀδύσσεια", "Hrabě Monte Cristo"];
  app.catalogue = Array.from({ length: 10 }, (_, i) => ({ ...books[i % 5], id: i + 1, title: odd[i] || `Plain title ${i + 1}`, cover_image_url: i === 9 ? null : `/test-cover/${i + 1}.jpg` }));
  await page.goto("/");
  await expect(page.locator(".bv-hero-covers a")).toHaveCount(3);
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  const hero = await page.locator(".bv-hero-covers a").evaluateAll(links => links.map(link => link.getAttribute("aria-label")));
  const row = await page.locator(".bv-book-card h3").allTextContents();
  expect(hero).toEqual(["Explore Plain title 3", "Explore Plain title 4", "Explore Plain title 5"]);
  expect(row).toHaveLength(5);
  for (const title of row) expect(hero).not.toContain(`Explore ${title}`);
  for (const title of odd) expect(hero).not.toContain(`Explore ${title}`);
});

// A larger browser default font size (not page zoom) reaches the root as a larger rem.
for (const width of [320, 390]) test(`browser default font size scales text and the layout holds at ${width}px`, async ({ page, app: _app }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card")).not.toHaveCount(0);
  const before = await page.evaluate(() => ({ body: parseFloat(getComputedStyle(document.querySelector(".bv-root")).fontSize), h1: parseFloat(getComputedStyle(document.querySelector("h1")).fontSize) }));
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const after = await page.evaluate(() => ({ body: parseFloat(getComputedStyle(document.querySelector(".bv-root")).fontSize), h1: parseFloat(getComputedStyle(document.querySelector("h1")).fontSize) }));
  expect(after.body).toBeCloseTo(before.body * 2, 0);
  expect(after.h1).toBeCloseTo(before.h1 * 2, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navTops = await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link").evaluateAll(links => links.map(link => link.getBoundingClientRect().top));
  expect(Math.max(...navTops) - Math.min(...navTops)).toBeLessThan(2);
  await expect(page.getByRole("button", { name: /^Add .+ to Want to read$/ }).first()).toBeVisible();
});

test("guest Discover leads with covered, plain-title books; a slow cover shows a plain tinted block until it loads", async ({ page, app }) => {
  app.catalogue = [
    { ...books[0], id: 1, title: "Ἰλιάς", cover_image_url: "/test-cover/1.jpg" },
    { ...books[1], id: 2, title: "No cover yet", cover_image_url: null },
    { ...books[2], id: 3, title: "Slow cover", cover_image_url: "/test-cover/3.jpg" },
  ];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/test-cover/3.jpg", async route => { await held; await route.fallback(); });
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card h3")).toHaveText(["Slow cover", "Ἰλιάς", "No cover yet"]);
  const slow = page.locator(".bv-book-card").first().locator(".bv-cover");
  await expect(slow).toHaveClass(/bv-cover--loading/);
  await expect(slow.locator(".bv-jacket")).toHaveCount(0);
  await expect(slow.locator("img")).toHaveCSS("opacity", "0");
  await expect(page.locator(".bv-book-card").nth(2).locator(".bv-jacket")).toHaveCount(1);
  release();
  await expect(slow).not.toHaveClass(/bv-cover--loading/);
  await expect(slow.locator(".bv-jacket")).toHaveCount(0);
  await expect(slow.locator("img")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("img", { name: "Cover of Slow cover", exact: true })).toBeVisible();
});

test("an English title shows under the title on cards and the book page only when it adds something", async ({ page, app }) => {
  app.catalogue = [
    { ...books[0], title: "Ὀδύσσεια", english_title: "The Odyssey", published_year: -700 },
    { ...books[1], english_title: " frankenstein " },
    { ...books[2], english_title: "" },
    { ...books[3], english_title: null },
    { ...books[4] },
  ];
  await page.goto("/browse"); await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await expect(page.locator(".bv-english-title")).toHaveCount(1);
  const card = page.locator(".bv-book-card").filter({ hasText: "Ὀδύσσεια" });
  await expect(card.locator(".bv-english-title")).toHaveText("The Odyssey");
  await expect(card.locator(".bv-english-title")).toHaveAttribute("lang", "en");
  await expect(card.locator("h3 + .bv-english-title + .bv-author")).toHaveCount(1);
  await page.goto("/book/1");
  await expect(page.locator(".bv-detail-body h1 + .bv-english-title")).toHaveText("The Odyssey");
  await expect(page.locator(".bv-english-title")).toHaveAttribute("lang", "en");
  await expect(page.locator(".bv-book-metadata")).toContainText("700 BCE");
  await expect(page.locator(".bv-book-metadata")).not.toContainText("-700");
  for (const id of [2, 3, 4, 5]) {
    await page.goto(`/book/${id}`); await expect(page.locator(".bv-detail-body h1")).toBeVisible();
    if (id === 2) await expect(page.locator(".bv-book-metadata")).toContainText("Published1818");
    await expect(page.locator(".bv-english-title")).toHaveCount(0);
  }
});

test("a guest whose search finds nothing is told a free account can add any book", async ({ page, app }) => {
  await page.goto("/browse?book=Project+Hail+Mary");
  const panel = page.locator(".bv-guest-noresults");
  await expect(panel).toContainText("Can’t find it here? With a free account you can add any book to your library yourself.");
  await expect(panel.getByRole("link", { name: "Create free account" })).toHaveAttribute("href", `/register?src=noresults&returnTo=${encodeURIComponent("/browse?book=Project+Hail+Mary")}`);
  await expect(panel.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("Try a shorter title, search by author, or remove a subject filter.")).toBeVisible();
  await expect(page.getByText(/look further/i)).toHaveCount(0);
  app.authenticated = true;
  await page.goto("/browse?book=Project+Hail+Mary"); await expect(page.getByRole("heading", { name: "No books found." })).toBeVisible();
  await expect(page.locator(".bv-guest-noresults")).toHaveCount(0);
});

test("register and the save dialog reassure the reader at the point of decision", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/register?bookId=1&save=want&returnTo=%2Fbook%2F1");
  await expect(page.getByText("Saves to Want to read as soon as your account is ready.")).toBeVisible();
  await expect(page.getByText("after you sign in")).toHaveCount(0);
  await expect(page.getByText("Free. Your library is private. We only email you for password resets.")).toBeVisible();
  await expect(page.locator(".bv-auth-card").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await page.goto("/book/1");
  const want = page.getByRole("button", { name: "Add Pride and Prejudice to Want to read" });
  await want.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Free · private · takes a moment");
  expect(await dialog.getByRole("link", { name: "Create an account" }).getAttribute("href")).toContain("src=saveprompt");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden(); await expect(want).toBeFocused();
  await want.click(); await dialog.getByRole("button", { name: "Keep browsing" }).click(); await expect(want).toBeFocused();
});

test("the landing page invites guests to join free and carries its source", async ({ page, app }) => {
  app.authenticated = false;
  await page.goto("/"); await expect(page.locator(".bv-book-card").first()).toBeVisible();
  await expect(page.getByText("Free. Private. No account needed to explore.", { exact: true })).toBeVisible();
  for (const link of [page.locator(".bv-header").getByRole("link", { name: "Join free", exact: true }), page.getByRole("link", { name: "Create your library", exact: true }), page.getByRole("link", { name: "Start your free library", exact: true })])
    await expect(link).toHaveAttribute("href", "/register?src=landing");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const header = page.locator(".bv-header");
    await expect(header.getByRole("link", { name: "Join free", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Discover", exact: true })).toHaveCount(0);
    expect((await header.boundingBox()).height).toBeLessThan(90);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("/discover reaches Discover and the 404 does not mention a library to guests", async ({ page, app }) => {
  await page.goto("/discover"); await expect(page).toHaveURL(/\/browse$/);
  await page.goto("/nowhere"); await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  await expect(page.locator("#bv-main").getByText(/library/i)).toHaveCount(0);
  app.authenticated = true; await page.goto("/nowhere");
  await expect(page.getByText("Try discovery or return to your library.")).toBeVisible();
});

test("book descriptions stay within about seventy characters per line", async ({ page, app }) => {
  app.authenticated = false;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1"); await expect(page.locator(".bv-description p")).toBeVisible();
  const fits = await page.evaluate(() => {
    const probe = document.createElement("span"); probe.style.cssText = "width:70ch;position:absolute;visibility:hidden";
    const target = document.querySelector(".bv-description"); target.append(probe);
    const limit = probe.getBoundingClientRect().width; probe.remove();
    return target.getBoundingClientRect().width <= limit + 1;
  });
  expect(fits).toBe(true);
});
