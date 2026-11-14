import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// S1: a returning reader's page data starts together with the account check, not after it. Every API call is mocked; no hosted service
// is contacted. `log` holds each call with its start and end (ms); the account check is held for REFRESH_MS so "started before it
// answered" is a plain comparison of timestamps.
const REFRESH_MS = 700, ME_MS = 120;
const sleep = ms => new Promise(done => setTimeout(done, ms));

const book = (id, title) => ({ id, title, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: 300, published_year: 2001, english_title: null });
const entry = (id, title, extra = {}) => ({ id: 100 + id, book_id: id, book: book(id, title), is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, save_note: null, snippet: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...extra });
// Each account owns different books, so a result shown under the wrong account is visible.
const OWN = { a: { name: "Alpha", title: "Alpha Reader Book", id: 4 }, b: { name: "Beta", title: "Beta Reader Book", id: 5 } };
const reading = who => ({ entry: entry(OWN[who].id, OWN[who].title, { reading_state: "reading", version: 3 }), attempt: { id: `attempt-${who}`, state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: 100, total_pages: 300 } });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = {
      log: [], errors: [], account: "a", authenticated: true, refresh: "ok", refreshDelay: REFRESH_MS, accessExpired: false, refreshed: false, meDown: false, caps: "v3", expiredEvents: 0,
      calls: (path, method = "GET") => state.log.filter(call => call.path === path && call.method === method),
    };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      const start = Date.now(), call = { path, method, search: url.search, start, end: 0, status: 0 };
      state.log.push(call);
      const reply = (status, json) => { call.end = Date.now(); call.status = status; return route.fulfill({ status, json }); };
      const me = path.startsWith("/me/");
      await sleep(path === "/auth/refresh" ? state.refreshDelay : me ? ME_MS : 40);
      if (path === "/auth/refresh") {
        if (state.refresh === "down") { call.end = Date.now(); call.status = -1; return route.abort(); }
        if (state.refresh === "expired" || !state.authenticated) return reply(401, { detail: "Session expired" });
        state.refreshed = true;
        return reply(200, {});
      }
      if (path === "/auth/login") { state.account = body.email.startsWith("b") ? "b" : "a"; state.authenticated = true; state.refreshed = true; return reply(200, {}); }
      if (path === "/auth/logout") { state.authenticated = false; state.refreshed = false; return reply(200, {}); }
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (me) {
        if (state.meDown) { call.end = Date.now(); call.status = -1; return route.abort(); }
        // A real session is needed: either a valid access cookie, or one that the refresh has just renewed.
        if (!state.authenticated || (state.accessExpired && !state.refreshed)) return reply(401, { detail: "Not authenticated" });
      }
      const who = state.account;
      if (path === "/me/profile") return reply(200, { display_name: OWN[who].name, bio: null, initials: OWN[who].name[0], handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") {
        if (state.caps === "legacy") return reply(404, { detail: "Not found" });
        return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      }
      if (path === "/me/books") return reply(200, []);
      if (state.caps === "legacy" && me) return reply(404, { detail: "Not found" });
      if (path === "/me/home") return reply(200, { current_reads: [reading(who)], reading_count: 1, paused_count: 0 });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 3, pages_read: 900, by_month: Array(12).fill(0), top_genres: [], biggest_month: null, shelf: { owned_unfinished: 2, want: 1, oldest_waiting: null } });
      if (path === "/me/up-next") return reply(200, []);
      if (path === "/me/lists" || path === "/me/preferences") return reply(200, []);
      if (path === "/me/library") {
        const items = [entry(OWN[who].id, OWN[who].title, { reading_state: "reading" }), entry(1, `${OWN[who].name} Shelf Book`)];
        return reply(200, { items, counts: { all: items.length, owned: items.length, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: items.length, next_cursor: null, facets: {}, index: null });
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: null, version: null, is_owned: false, is_wanted: false, reading_state: null })) });
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: entry(OWN[who].id, OWN[who].title, { id: Number(workspace[1]), reading_state: "reading", version: 3 }), current_attempt: reading(who).attempt, editions: [] });
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: [], next_cursor: null });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/books") {
        const items = Array.from({ length: 20 }, (_, index) => book(9001 + index, `Live Browse ${index + 1}`));
        return reply(200, { items, total: items.length, page: 1, size: 20 });
      }
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...book(Number(path.split("/")[2]), "Live Book 1"), description: "A synthetic description.", tags: [] });
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await page.addInitScript(() => { window.__expired = 0; window.addEventListener("bookvane:session-expired", () => { window.__expired += 1; }); });
    await provide(state);
  },
});

const withHint = page => page.addInitScript(() => { try { if (!sessionStorage.getItem("hint-seeded")) { sessionStorage.setItem("hint-seeded", "1"); localStorage.clear(); localStorage.setItem("bookvane:session-hint:v1", "1"); } } catch { /* none */ } });
const mine = state => state.log.filter(call => call.path.startsWith("/me/"));
const refreshEnd = state => state.calls("/auth/refresh", "POST")[0]?.end;

// ---- Requests start with the account check -----------------------------------------------------------------------------------

test("Home: with the hint set, every page request starts before the account check answers, and each is made once", async ({ page, app }) => {
  await withHint(page);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Reading now" })).toBeVisible();
  await expect(page.getByText(OWN.a.title).first()).toBeVisible();
  const answered = refreshEnd(app);
  for (const path of ["/me/profile", "/me/reading-capabilities", "/me/home", "/me/library", "/me/stats", "/me/up-next"]) {
    const calls = app.calls(path);
    expect(calls.length, `${path} is requested once`).toBe(1);
    expect(calls[0].start, `${path} starts before /auth/refresh answers`).toBeLessThan(answered);
  }
  expect(app.errors).toEqual([]);
});

test("My Books: the library page starts with the account check and is requested once", async ({ page, app }) => {
  await withHint(page);
  await page.goto("/my-books");
  await expect(page.locator(".bv-personal-book").first()).toBeVisible();
  const answered = refreshEnd(app);
  for (const path of ["/me/profile", "/me/reading-capabilities", "/me/library"]) {
    expect(app.calls(path).length, `${path} is requested once`).toBe(1);
    expect(app.calls(path)[0].start).toBeLessThan(answered);
  }
  expect(app.errors).toEqual([]);
});

test("Discover: the signed-in /books request starts with the account check and is made once", async ({ page, app }) => {
  await withHint(page);
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card h3", { hasText: "Live Browse 1" }).first()).toBeVisible();
  expect(app.calls("/books").length).toBe(1);
  expect(app.calls("/books")[0].start).toBeLessThan(refreshEnd(app));
  expect(app.errors).toEqual([]);
});

test("a book page: the book and the saved-status check start with the account check", async ({ page, app }) => {
  await withHint(page);
  await page.goto("/book/9001");
  await expect(page.getByRole("heading", { level: 1, name: "Live Book 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeEnabled();
  const answered = refreshEnd(app);
  expect(app.calls("/books/9001").length).toBe(1);
  expect(app.calls("/me/library/lookup", "POST").length).toBe(1);
  expect(app.calls("/me/library/lookup", "POST")[0].start).toBeLessThan(answered);
  expect(app.calls("/me/reading-capabilities")[0].start).toBeLessThan(answered);
  expect(app.errors).toEqual([]);
});

test("the reading workspace opened by its address: the workspace starts with the account check and is requested once", async ({ page, app }) => {
  await withHint(page);
  await page.goto(`/my-books/${100 + OWN.a.id}`);
  await expect(page.getByRole("region", { name: "My reading" })).toBeVisible();
  expect(app.calls(`/me/library/${100 + OWN.a.id}/reading`).length).toBe(1);
  expect(app.calls(`/me/library/${100 + OWN.a.id}/reading`)[0].start).toBeLessThan(refreshEnd(app));
  expect(app.errors).toEqual([]);
});

// ---- Nobody else's data, and nothing for a visitor ----------------------------------------------------------------------------

test("a guest with no hint makes no /me requests on any page", async ({ page, app }) => {
  app.authenticated = false;
  for (const path of ["/", "/browse", "/book/9001", "/home", "/my-books", "/my-books/104"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await sleep(REFRESH_MS + 400);
  }
  expect(mine(app).map(call => call.path)).toEqual([]);
  expect(app.errors).toEqual([]);
});

test("hint set but the session has expired: one calm signed-out landing, no duplicate expiry handling, nothing shown", async ({ page, app }) => {
  app.refresh = "expired"; app.authenticated = false;
  await withHint(page);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /Sign in|Welcome back/ }).first()).toBeVisible();
  expect(app.calls("/auth/refresh", "POST").length).toBe(1);
  expect(await page.evaluate(() => window.__expired)).toBe(0);
  await expect(page.getByText(OWN.a.title)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("bookvane:session-hint:v1"))).toBeNull();
  expect(app.errors).toEqual([]);
});

test("hint set, access cookie expired, refresh works: each request is retried once and the page shows normally", async ({ page, app }) => {
  app.accessExpired = true;
  await withHint(page);
  await page.goto("/home");
  await expect(page.getByText(OWN.a.title).first()).toBeVisible();
  for (const path of ["/me/profile", "/me/reading-capabilities", "/me/home", "/me/library", "/me/stats", "/me/up-next"]) {
    expect(app.calls(path).length, `${path} is called at most twice`).toBeLessThanOrEqual(2);
    expect(app.calls(path).at(-1).status, `${path} ends with success`).toBe(200);
  }
  expect(app.calls("/auth/refresh", "POST").length).toBe(1);
  expect(await page.evaluate(() => window.__expired)).toBe(0);
  expect(app.errors).toEqual([]);
});

test("server unreachable during startup: the existing account-unavailable state shows", async ({ page, app }) => {
  app.refresh = "down"; app.meDown = true;
  await withHint(page);
  await page.goto("/home");
  await expect(page.getByRole("status").filter({ hasText: "Account unavailable" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  await expect(page.getByText(OWN.a.title)).toHaveCount(0);
});

test("a reader who cannot use the new library (older service): the early requests show no error, banner or toast", async ({ page, app }) => {
  app.caps = "legacy";
  await withHint(page);
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card h3", { hasText: "Live Browse 1" }).first()).toBeVisible();
  await sleep(400);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/trouble on our end|couldn’t reach/i)).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test("sign out, then another account signs in: nothing of the first account is shown", async ({ page, app: _app }) => {
  await withHint(page);
  await page.goto("/home");
  await expect(page.getByText(OWN.a.title).first()).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await page.getByLabel("Email address").fill("b@example.test");
  await page.getByLabel(/^password$/i).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(OWN.b.title).first()).toBeVisible();
  await expect(page.getByText(OWN.a.title)).toHaveCount(0);
  await expect(page.getByText(`${OWN.a.name} Shelf Book`)).toHaveCount(0);
  await page.goto("/my-books");
  await expect(page.getByText(`${OWN.b.name} Shelf Book`).first()).toBeVisible();
  await expect(page.getByText(`${OWN.a.name} Shelf Book`)).toHaveCount(0);
});
