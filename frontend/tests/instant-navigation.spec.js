import { test as base, expect } from "@playwright/test";

// Browser-only fixtures with realistic 300-600 ms API delays. No hosted service is contacted.
const stamp = "2026-10-01T00:00:00Z";
const attemptId = "11111111-1111-4111-8111-111111111111";
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const liveBook = index => ({
  id: 9001 + index, title: `Nav Book ${index + 1}`, subtitle: null, authors: [{ id: 5, name: "Nav Author" }],
  cover_image_url: `/test-cover/${index + 1}.gif`, published_year: 1990 + index, page_count: 200 + index, english_title: null,
});
const detail = index => ({ ...liveBook(index), description: `Description of Nav Book ${index + 1}.`, tags: [{ id: 1, name: "fantasy", type: "genre" }] });
const books = Array.from({ length: 40 }, (_, index) => liveBook(index));
const entry = {
  id: 501, book_id: 9001, book: { id: 9001, title: "Nav Book 1", cover_image_url: "/test-cover/1.gif", authors: [{ id: 5, name: "Nav Author" }], page_count: 200, isbn13: null, english_title: null },
  private_title: null, private_author: null, private_catalogue: null, is_owned: true, is_wanted: false, version: 2, save_note: null,
  reading_state: "reading", created_at: stamp, updated_at: stamp,
};
const attempt = { id: attemptId, state: "reading", started_on: "2026-10-01", ended_on: null, progress_unit: "percent", progress_value: 40, total_pages: 200,
  edition_id: null, edition_source_id: null, edition_format: null, note: null, reaction: null, created_at: stamp, updated_at: stamp };

const test = base.extend({
  app: [async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, delay: 450, hold: {}, requests: [] };
    const wait = async key => { await new Promise(done => setTimeout(done, state.delay)); if (state.hold[key]) await state.hold[key]; };
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://covers.openlibrary.org") return route.abort();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (url.pathname.startsWith("/test-cover/")) {
        if (state.hold.cover) await state.hold.cover;
        else await new Promise(done => setTimeout(done, 150));
        return route.fulfill({ status: 200, body: PIXEL, contentType: "image/gif" });
      }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      state.requests.push(path);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") { await wait("auth"); return reply(state.authenticated ? 200 : 401, {}); }
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1,
        features: { reading_actions: true, private_context: false, privacy_controls: false, reading_export: false, library_import: false, next_read: false } });
      if (path === "/me/books" || path === "/me/preferences") return reply(200, []);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/home") { await wait("home"); return reply(200, { current_reads: [{ entry, attempt }], reading_count: 1, paused_count: 0 }); }
      if (path === "/me/library") { await wait("library"); return reply(200, { items: [entry], counts: { all: 1, owned: 1, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null }); }
      if (path === "/me/library/lookup") return reply(200, { items: JSON.parse(route.request().postData()).book_ids.map(id => ({ book_id: id, entry_id: id === 9001 ? 501 : null,
        is_owned: id === 9001, is_wanted: false, version: id === 9001 ? 2 : null, reading_state: id === 9001 ? "reading" : null })) });
      if (path === "/me/library/501/reading") { await wait("workspace"); return reply(200, { entry, current_attempt: attempt, editions: [] }); }
      if (path === "/me/library/501/attempts") return reply(200, { items: [attempt], next_cursor: null });
      if (path === "/books") {
        await wait("books");
        const size = Number(url.searchParams.get("size") || 20), page = Number(url.searchParams.get("page") || 1);
        return reply(200, { items: books.slice((page - 1) * size, page * size), total: books.length, page, size });
      }
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) { await wait("book"); return reply(200, detail(Number(one[1]) - 9001)); }
      return reply(404, { detail: "Not found" });
    });
    // Every 50 ms, record whether <main> has no real heading (only a "Loading..." heading, or nothing at all).
    await page.addInitScript(() => {
      window.__blank = [];
      const real = text => text.trim().length > 0 && !/^(loading|opening|checking)/i.test(text.trim());
      setInterval(() => {
        const main = document.getElementById("bv-main");
        if (!main) return;
        const headings = [...main.querySelectorAll("h1, h2, h3")].map(node => node.textContent || "").filter(real);
        if (!headings.length) window.__blank.push(main.innerText.trim().slice(0, 60) || "(empty)");
        const covered = [...main.querySelectorAll(".bv-cover")].some(cover => cover.querySelector("img") && cover.querySelector(".bv-jacket"));
        if (covered) window.__jacket = (window.__jacket || 0) + 1;
      }, 50);
    });
    await provide(state);
  }, { auto: true }],
});

const blanks = page => page.evaluate(() => window.__blank);
const reset = page => page.evaluate(() => { window.__blank = []; window.__jacket = 0; });
const bookHeading = (page, title = "Nav Book 1") => page.getByRole("heading", { level: 1, name: title, exact: true });
const card = (page, title = "Nav Book 1") => page.getByRole("link", { name: title, exact: true });
const signedIn = app => { app.authenticated = true; };

test("no empty page on first load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your personal reading home.", exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await blanks(page)).toEqual([]);
});

test("landing to Discover to a book and back never shows an empty page, and the cover never flashes its jacket", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Explore Nav Book 1" })).toBeVisible();
  await reset(page);
  await page.getByRole("link", { name: "Explore books", exact: true }).first().click();
  await expect(card(page)).toBeVisible();
  await expect(page).toHaveURL(/\/browse$/);
  await card(page).click();
  await expect(bookHeading(page)).toBeVisible();
  await expect(page.getByText("Description of Nav Book 1.")).toBeVisible();
  await page.goBack();
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(600);
  expect(await blanks(page)).toEqual([]);
  expect(await page.evaluate(() => window.__jacket || 0)).toBe(0);
});

test("a book page opens at once from the card while its details are still loading", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(card(page)).toBeVisible();
  let release; app.hold.book = new Promise(done => { release = () => { app.hold.book = null; done(); }; });
  await card(page).click();
  await expect(bookHeading(page)).toBeVisible();
  await expect(page.getByText("Nav Author").first()).toBeVisible();
  await expect(page.getByText("About this book")).toBeVisible();
  await expect(page.getByText("Description of Nav Book 1.")).toHaveCount(0);
  await expect(page.getByText("A description isn’t available")).toHaveCount(0);
  release();
  await expect(page.getByText("Description of Nav Book 1.")).toBeVisible();
});

test("going back to a book already seen is instant from the cache, then refreshes", async ({ page, app }) => {
  await page.goto("/browse");
  await card(page).click();
  await expect(page.getByText("Description of Nav Book 1.")).toBeVisible();
  await page.goBack();
  await expect(card(page)).toBeVisible();
  let release; app.hold.book = new Promise(done => { release = () => { app.hold.book = null; done(); }; });
  await card(page).click();
  await expect(page.getByText("Description of Nav Book 1.")).toBeVisible();
  release();
});

test("a card's book is prefetched once, however often it is hovered, and fills the cache", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(card(page, "Nav Book 12")).toBeVisible();
  const fetched = () => app.requests.filter(path => path === "/books/9012").length;
  await card(page, "Nav Book 12").hover();
  await expect.poll(fetched).toBe(1);
  await card(page, "Nav Book 1").hover();
  await card(page, "Nav Book 12").hover();
  await page.waitForTimeout(300);
  expect(fetched()).toBe(1);
  let release; app.hold.book = new Promise(done => { release = () => { app.hold.book = null; done(); }; });
  await card(page, "Nav Book 12").click();
  await expect(page.getByText("Description of Nav Book 12.")).toBeVisible();
  release();
});

test("Home to the reading workspace never shows an empty page", async ({ page, app }) => {
  signedIn(app);
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  await reset(page);
  await page.getByRole("link", { name: "Continue your reading: Nav Book 1" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nav Book 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeVisible();
  expect(await blanks(page)).toEqual([]);
});

test("My Books to the workspace opens from the library data, and the actions wait for the live reading", async ({ page, app }) => {
  signedIn(app);
  await page.goto("/my-books");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  await reset(page);
  let release; app.hold.workspace = new Promise(done => { release = () => { app.hold.workspace = null; done(); }; });
  await page.getByRole("link", { name: "Nav Book 1", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nav Book 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start reading", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toHaveCount(0);
  expect(await blanks(page)).toEqual([]);
  release();
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start reading", exact: true })).toHaveCount(0);
});

test("revisiting My Books is instant from the cache", async ({ page, app }) => {
  signedIn(app);
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "My Books", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Nav Book 1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Pick up where you left off." })).toBeVisible();
  let release; app.hold.library = new Promise(done => { release = () => { app.hold.library = null; done(); }; });
  await page.getByRole("link", { name: "My Books", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Nav Book 1", exact: true })).toBeVisible();
  release();
});

test("no private data reaches localStorage, and the caches are memory only", async ({ page, app }) => {
  signedIn(app);
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue your reading: Nav Book 1" }).click();
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeVisible();
  await page.goto("/my-books");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const marker of [attemptId, "progress_value", "reading_state", "is_owned", "save_note", "\"entry\""]) expect(stored).not.toContain(marker);
});

test("the cache and the sign-in hint are gone after logout", async ({ page, app }) => {
  signedIn(app);
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("bookvane:session-hint:v1"))).toBeNull();
  await expect(page.getByRole("link", { name: "Nav Book 1", exact: true })).toHaveCount(0);
});

test("route code is preloaded once the page is idle", async ({ page }) => {
  const chunk = page.waitForRequest(request => /LibraryImportPage/.test(request.url()), { timeout: 10000 });
  await page.goto("/");
  await chunk;
});
