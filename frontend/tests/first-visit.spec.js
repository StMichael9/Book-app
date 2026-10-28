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
    const state = { authenticated: false, delay: 450, hold: {}, requests: [], bookDelay: 300, inFlight: 0, peak: 0 };
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
      if (one) {
        state.inFlight += 1; state.peak = Math.max(state.peak, state.inFlight);
        try { await wait("book"); } finally { state.inFlight -= 1; }
        return reply(200, detail(Number(one[1]) - 9001));
      }
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
const bookRequests = app => app.requests.filter(path => /^\/books\/\d+$/.test(path));
const link = (page, name) => page.getByRole("link", { name, exact: true });

test("every card in view is prefetched, not just the first eight, and never more than four at a time", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 3200 });
  await page.goto("/browse");
  await expect(link(page, "Nav Book 20")).toBeVisible();
  await expect.poll(() => new Set(bookRequests(app)).size, { timeout: 15000 }).toBeGreaterThanOrEqual(18);
  expect(app.peak).toBeLessThanOrEqual(4);
});

test("nothing is prefetched for cards in view when the reader asked to save data, but a hover still warms its card", async ({ page, app }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
  await page.setViewportSize({ width: 1280, height: 3200 });
  await page.goto("/browse");
  await expect(link(page, "Nav Book 20")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(bookRequests(app)).toEqual([]);
  await link(page, "Nav Book 3").hover();
  await expect.poll(() => bookRequests(app)).toEqual(["/books/9003"]);
});

test("a signed-in reader's Home, My Books and first workspaces are fetched once the session is known", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/browse");
  await expect(link(page, "Nav Book 1")).toBeVisible();
  await expect.poll(() => ["/me/home", "/me/library", "/me/library/501/reading"].every(path => app.requests.includes(path)), { timeout: 10000 }).toBe(true);
  let release; app.hold.library = new Promise(done => { release = () => { app.hold.library = null; done(); }; });
  await page.getByRole("link", { name: "My Books", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Nav Book 1", exact: true })).toBeVisible();
  release();
});

test("a signed-in reader opens a workspace from My Books without waiting", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/browse");
  await expect.poll(() => app.requests.includes("/me/library/501/reading"), { timeout: 10000 }).toBe(true);
  await page.getByRole("link", { name: "My Books", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Nav Book 1", exact: true })).toBeVisible();
  let release; app.hold.workspace = new Promise(done => { release = () => { app.hold.workspace = null; done(); }; });
  await page.getByRole("link", { name: "Nav Book 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeVisible();
  release();
});

test("pointing at a navigation link warms that page's data", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/home");
  await expect(link(page, "Nav Book 1")).toBeVisible();
  const discoverLists = () => app.requests.filter(path => path === "/books").length;
  const before = discoverLists();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Discover" }).hover();
  await expect.poll(discoverLists).toBe(before + 1);
});

for (const [name, signedIn, path, heading] of [
  ["a signed-out visit to Discover", false, "/browse", null],
  ["a signed-out visit straight to a book", false, "/book/9003", null],
  ["a signed-in visit to Home", true, "/home", "Pick up where you left off."],
  ["a signed-in visit to My Books", true, "/my-books", "My Books"],
]) test(`${name} is never an empty page, even with a ${450} ms API`, async ({ page, app }) => {
  app.authenticated = signedIn;
  await page.goto(path);
  if (heading) await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first().or(page.getByRole("heading", { level: 1, name: "Nav Book 3" }))).toBeVisible();
  await page.waitForTimeout(800);
  expect(await blanks(page)).toEqual([]);
});
