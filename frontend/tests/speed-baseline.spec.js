import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// A repeatable speed baseline. Every API call is mocked and answered after the same fixed delay, so the numbers depend on how many
// requests the app makes one after another (its "stages") and not on the network. No hosted service is contacted.
//   stages:    requests in a row that had to finish before the page's main content was visible
//   contentMs: milliseconds from navigation start until that content was visible
// Each page is loaded several times and the best run counts: a busy machine can only make a load slower or add a false stage, never
// faster, so the best run is the one that shows how the app itself is built.
// The measured numbers live in speed-baseline.json; a run may not be worse (stages equal or lower, contentMs within +250 ms).
// Later speed work lowers the numbers: delete the file and run three times with UPDATE_SPEED_BASELINE=1 (it keeps the highest of the runs).
const DELAY = 300, TOLERANCE = 250, RUNS = process.env.SPEED_TIMELINE ? 1 : 5;
const FILE = fileURLToPath(new URL("./speed-baseline.json", import.meta.url));
const sleep = ms => new Promise(done => setTimeout(done, ms));

const book = (id, title) => ({ id, title, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: 300, published_year: 2001, english_title: null });
const entry = (id, extra = {}) => ({ id: 100 + id, book_id: id, book: book(id, `Saved ${id}`), is_owned: id % 2 === 1, is_wanted: id % 2 === 0, version: 1, reading_state: null,
  private_title: null, private_author: null, save_note: null, snippet: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...extra });
const ENTRIES = [1, 2, 3].map(id => entry(id));
const READING = { entry: { ...entry(4), id: 104, reading_state: "reading", is_owned: true, is_wanted: false, version: 3 }, attempt: { id: "attempt-4", state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: 100, total_pages: 300 } };
const live = (label, count = 20) => Array.from({ length: count }, (_, index) => book(9001 + index, `Live ${label} ${index + 1}`));

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    // `log` holds every API call with its start and end (ms); `slow` overrides the delay for one call (path, method, query).
    const state = { log: [], saved: new Map(), slow: null, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      const start = Date.now();
      await sleep(state.slow?.(path, method, url.searchParams) ?? DELAY);
      state.log.push({ path, method, search: url.search, start, end: Date.now() }); // the end is taken before answering, so a follow-on call can never look earlier
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: [READING], reading_count: 1, paused_count: 0 });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 3, pages_read: 900, by_month: Array(12).fill(0), top_genres: [], biggest_month: null, shelf: { owned_unfinished: 2, want: 1, oldest_waiting: null } });
      if (path === "/me/up-next") return reply(200, []);
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/library") {
        const facet = url.searchParams.get("facet") || "all", owned = url.searchParams.get("owned") === "true";
        let items = [...ENTRIES, READING.entry].sort((a, b) => b.id - a.id);
        const counts = { all: items.length, owned: items.filter(item => item.is_owned).length, want: items.filter(item => item.is_wanted).length, reading: 1, paused: 0, finished: 0, dnf: 0 };
        if (facet === "want") items = items.filter(item => item.is_wanted);
        if (owned) items = items.filter(item => item.is_owned);
        return reply(200, { items, counts, total: items.length, next_cursor: null, facets: {}, index: null });
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => { const found = state.saved.get(id); return { book_id: id, entry_id: found?.id ?? null, version: found?.version ?? null, is_owned: found?.is_owned ?? false, is_wanted: found?.is_wanted ?? false, reading_state: null }; }) });
      if (/^\/me\/library\/books\/\d+$/.test(path) && method === "PUT") {
        const id = Number(path.split("/").at(-1)), saved = { ...entry(1), id: 500 + id, book_id: id, book: book(id, `Live Book ${id - 9000}`), is_owned: false, is_wanted: true, ...body, version: 1 };
        state.saved.set(id, saved);
        return reply(200, saved);
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: [...ENTRIES, READING.entry].find(item => item.id === Number(workspace[1])) || ENTRIES[0], current_attempt: Number(workspace[1]) === 104 ? READING.attempt : null, editions: [] });
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: [], next_cursor: null });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/books") {
        const filtered = url.searchParams.has("tag") || url.searchParams.has("tags");
        const items = live(filtered ? "Genre" : "Browse");
        return reply(200, { items, total: items.length, page: 1, size: 20 });
      }
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...live("Book", 5)[Number(path.split("/")[2]) - 9001], description: "A synthetic description.", tags: [] });
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    // The "signed in last time" hint, set the way the other specs set it; nothing else survives between loads.
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem("bookvane:session-hint:v1", "1"); } catch { /* none */ } });
    await provide(state);
  },
});

// Requests in a row: a request is in stage N+1 when it started after a stage-N request had ended. Only requests that had finished by
// the time the content showed count, because those are the ones the page waited for.
function stagesBefore(log, until) {
  const done = log.filter(call => call.end <= until).sort((a, b) => a.start - b.start), stage = new Map();
  for (const call of done) stage.set(call, 1 + Math.max(0, ...done.filter(other => other !== call && other.end <= call.start).map(other => stage.get(other))));
  return Math.max(0, ...stage.values());
}

// "Main content visible" for each page. These wait with locator.waitFor (fast polling), because expect()'s own polling backs off to 1 s
// and would add up to a second of measurement error.
const visible = (...locators) => async () => { for (const locator of locators) await locator.waitFor({ state: "visible", timeout: 30_000 }); };
const PAGES = {
  "/home": { url: "/home", ready: page => visible(page.getByRole("heading", { name: "Reading now" }), page.getByRole("heading", { name: "Up next" }))() },
  "/my-books": { url: "/my-books", ready: page => visible(page.locator(".bv-personal-book").first())() },
  "/browse (signed in)": { url: "/browse", ready: page => visible(page.locator(".bv-book-card h3", { hasText: "Live Browse 1" }).first())() },
  "/book/{id} (direct)": { url: "/book/9001", ready: async page => {
    await visible(page.getByRole("heading", { level: 1, name: "Live Book 1" }))();
    await page.waitForFunction(() => { const want = [...document.querySelectorAll("button")].find(node => /Want to read/.test(node.textContent)); return Boolean(want) && !want.disabled; }, null, { polling: "raf", timeout: 30_000 });
  } },
  "/my-books/{entryId} (direct)": { url: "/my-books/104", ready: page => visible(page.getByRole("textbox", { name: /^Page or %/ }))() },
};

async function measure(page, app, target) {
  // Start from a quiet page: anything still in flight from the last load must not count towards this one.
  await page.goto("about:blank");
  await sleep(DELAY + 250);
  app.log.length = 0;
  const began = Date.now();
  await page.goto(target.url, { waitUntil: "commit" });
  await target.ready(page);
  const seen = Date.now();
  // SPEED_TIMELINE=1 prints each call as "path  start-end" in ms from navigation, for the request map in the handoff note.
  if (process.env.SPEED_TIMELINE) console.log([`${target.url}  content visible at ${seen - began} ms`, ...[...app.log].sort((x, y) => x.start - y.start).map(call => `  ${call.method} ${call.path}${call.search}  ${call.start - began}-${call.end - began}`)].join("\n"));
  return { stages: stagesBefore(app.log, seen), contentMs: seen - began };
}

const baseline = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};

for (const [name, target] of Object.entries(PAGES)) {
  test(`speed baseline: ${name}`, async ({ page, app }) => {
    const runs = [];
    for (let index = 0; index < RUNS; index += 1) runs.push(await measure(page, app, target));
    const result = { stages: Math.min(...runs.map(run => run.stages)), contentMs: Math.min(...runs.map(run => run.contentMs)) };
    test.info().annotations.push({ type: "measured", description: `${name}: ${result.stages} stages, ${result.contentMs} ms (runs: ${runs.map(run => `${run.stages}/${run.contentMs}`).join(", ")})` });
    expect(app.errors).toEqual([]);
    if (process.env.UPDATE_SPEED_BASELINE) {
      // Repeated update runs keep the highest value per page, so the file holds what the app does on an ordinary, slightly busy machine.
      const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
      const next = { ...old, [name]: { stages: Math.max(result.stages, old[name]?.stages ?? 0), contentMs: Math.max(result.contentMs, old[name]?.contentMs ?? 0) } };
      writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
      return;
    }
    expect(baseline[name], `${name} has no entry in speed-baseline.json; run once with UPDATE_SPEED_BASELINE=1`).toBeTruthy();
    expect(result.stages, `${name}: requests in a row`).toBeLessThanOrEqual(baseline[name].stages);
    expect(result.contentMs, `${name}: content time`).toBeLessThanOrEqual(baseline[name].contentMs + TOLERANCE);
  });
}

// Interaction checks. Each waits on a slow (800 ms) server answer and asserts what the reader sees meanwhile. They describe the
// wanted behaviour and fail today, so they are marked fixme until the speed work that fixes them turns them on.
const slow = path => (path === "/me/library" || path === "/books" || path.startsWith("/me/library/books/")) ? 800 : DELAY;

async function settled(page, app) { await page.waitForLoadState("load"); await expect.poll(() => app.log.length).toBeGreaterThan(0); }

test.fixme("switching a My Books tab shows the new results within 100 ms", async ({ page, app }) => {
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(4);
  await settled(page, app);
  app.slow = slow;
  await page.getByRole("group", { name: "Shelf" }).getByRole("button", { name: /^Want to read/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1, { timeout: 100 });
});

test.fixme("Owned only shows the new results within 100 ms", async ({ page, app }) => {
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(4);
  await settled(page, app);
  app.slow = slow;
  await page.getByRole("switch", { name: /Owned only/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(3, { timeout: 100 });
});

test.fixme("Want to read shows as saved within 100 ms while the save is still pending", async ({ page, app }) => {
  await page.goto("/book/9001");
  const want = page.getByRole("button", { name: /Want to read/ }).first();
  await expect(want).toBeEnabled({ timeout: 30_000 });
  app.slow = slow;
  await want.click();
  await expect(want).toHaveAttribute("aria-pressed", "true", { timeout: 100 });
  expect(app.log.some(call => call.method === "PUT" && call.path.startsWith("/me/library/books/"))).toBe(false); // the save has not answered yet
});

test.fixme("changing the Discover genre keeps the previous results on screen until the new ones arrive", async ({ page, app }) => {
  await page.goto("/browse");
  const before = page.locator(".bv-book-card h3", { hasText: "Live Browse 1" }).first();
  await expect(before).toBeVisible({ timeout: 30_000 });
  await settled(page, app);
  app.slow = slow;
  const asked = Date.now();
  await page.getByRole("radiogroup", { name: "Browse genres" }).getByRole("radio", { name: "Fantasy" }).check({ force: true });
  const after = page.locator(".bv-book-card h3", { hasText: "Live Genre 1" }).first();
  for (const wait of [100, 400, 700]) {
    await page.waitForTimeout(Math.max(0, asked + wait - Date.now()));
    await expect(after).toHaveCount(0);
    await expect(before).toBeVisible({ timeout: 50 });
    await expect(page.locator(".bv-skeleton, [aria-busy=\"true\"] .bv-skeleton")).toHaveCount(0);
  }
  await expect(after).toBeVisible({ timeout: 5000 });
});
