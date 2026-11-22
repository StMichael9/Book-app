import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The reading page and Home's Reading now cards, Direction D: one "Page or %" box, an inline finished prompt, a journal and one fold.
// Browser-only fixtures; every API call is mocked from the contract.
const book = { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 272, english_title: null };
const freshAttempt = () => ({ id: "a1", state: "reading", started_on: "2026-11-13", ended_on: null, progress_unit: null, progress_value: null, total_pages: 360, note: null, reaction: null, updated_at: "2026-11-13T10:00:00Z" });
const freshEntry = () => ({ id: 101, book_id: 1, book, is_owned: true, is_wanted: false, version: 1, reading_state: "reading", private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z" });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entry: freshEntry(), attempt: freshAttempt(), history: [], patches: [], requests: [], progressDays: undefined, isbn: {}, lookups: [], writes: [], inflight: 0, maxInflight: 0, holdLookups: null, readOnly: false, holdPatch: null, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: state.attempt.state === "reading" ? [{ entry: state.entry, attempt: state.attempt }] : [], reading_count: state.attempt.state === "reading" ? 1 : 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [state.entry], counts: { all: 1, owned: 1, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: 101, version: state.entry.version, is_owned: state.entry.is_owned, is_wanted: state.entry.is_wanted, reading_state: state.entry.reading_state })) });
      if (path === "/me/stats" || path === "/me/up-next") return reply(path === "/me/stats" ? 200 : 200, path === "/me/stats" ? { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } : []);
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/library/101/reading") return reply(200, { entry: state.entry, current_attempt: state.attempt, editions: [], ...(state.progressDays !== undefined ? { progress_days: state.progressDays } : {}) });
      if (path === "/me/library/101/attempts") return reply(200, { items: state.history, next_cursor: null });
      if (path === "/me/reading-attempts/a1" && method === "PATCH") {
        state.patches.push(body);
        if (state.holdPatch) await state.holdPatch;
        const { expected_version: _version, ...changes } = body;
        state.attempt = { ...state.attempt, ...changes, updated_at: "2026-11-13T12:00:00Z" };
        state.entry = { ...state.entry, version: state.entry.version + 1, reading_state: state.attempt.state };
        return reply(200, { entry: state.entry, attempt: state.attempt });
      }
      if (path === "/me/library/101" && method === "PATCH") {
        const { expected_version: _version, ...changes } = body;
        state.entry = { ...state.entry, ...changes, version: state.entry.version + 1 };
        return reply(200, state.entry);
      }
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/books/1") return reply(200, { ...book, description: "A house of endless halls.", published_year: 2020, isbn13: null });
      const isbnAt = path.match(/^\/me\/catalogue\/isbn\/(\d+)$/);
      if (isbnAt) {
        state.lookups.push(isbnAt[1]); state.inflight += 1; state.maxInflight = Math.max(state.maxInflight, state.inflight);
        await (state.holdLookups || new Promise(done => setTimeout(done, 40)));
        state.inflight -= 1;
        const answer = state.isbn[isbnAt[1]];
        if (answer === "429") return reply(429, { detail: "Too many requests" });
        return reply(200, answer || { isbn13: isbnAt[1], status: "not_found", book_id: null, edition_id: null, title: null, authors: [], cover_url: null, on_shelf: null });
      }
      if (/^\/me\/library\/books\/\d+$/.test(path) && method === "PUT") { state.writes.push({ path, method, body }); return reply(200, { ...state.entry, id: 900 + Number(path.split("/").pop()) }); }
      if (path === "/me/library/private" && method === "POST") { state.writes.push({ path, method, body }); return reply(200, { ...state.entry, id: 800 + state.writes.length, book_id: null, book: null, private_title: body.title }); }
      if (path === "/me/loans" && route.request().method() === "GET") return route.fulfill({ status: 200, json: { items: [] } }); // My Books and Home ask for open loans; none here
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const EMMA = "9780141439518", GATSBY = "9780743273565", MOCK = "9780061120084", ORWELL = "9780451524935", OL_ONLY = "9780140449136";
const card = (isbn, title, extra = {}) => ({ isbn13: isbn, status: "catalogue", book_id: Number(isbn.slice(-4)), edition_id: 1, title, authors: ["An Author"], cover_url: null, on_shelf: null, ...extra });
const answers = {
  [EMMA]: card(EMMA, "Emma"),
  [GATSBY]: card(GATSBY, "The Great Gatsby", { on_shelf: { is_owned: true, is_wanted: false } }),
  [ORWELL]: card(ORWELL, "Nineteen Eighty-Four"),
  [OL_ONLY]: { isbn13: OL_ONLY, status: "open_library", book_id: null, edition_id: null, title: "The Odyssey", authors: ["Homer"], cover_url: null, on_shelf: null },
};

// A camera stand-in: a canvas stream, and a BarcodeDetector that reports whatever the test pushes onto window.__codes.
const withCamera = (page, mode = "ok") => page.addInitScript(mode => {
  window.__codes = []; window.__stopped = 0; window.__streams = 0; window.__streamTracks = []; window.__instances = [];
  if (mode === "refused") { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Permission denied", "NotAllowedError"); }; return; }
  if (mode === "none") { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); return; }
  // slow-play and slow-formats hold the camera's video start, or the decoder's check of what it can read, open for 600 ms.
  if (mode === "slow-play") { const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const started = real.call(this); return new Promise(done => setTimeout(() => done(started), 600)); }; }
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d"); let shade = 0;
    setInterval(() => { shade = (shade + 20) % 255; context.fillStyle = window.__fill || `rgb(${shade},${shade},${shade})`; context.fillRect(0, 0, 320, 240); }, 100);
    const stream = canvas.captureStream(10); window.__streams += 1;
    const record = { total: stream.getTracks().length, stopped: 0 }; window.__streamTracks.push(record);
    for (const track of stream.getTracks()) { const stop = track.stop.bind(track); let done = false; track.stop = () => { if (!done) { done = true; window.__stopped += 1; record.stopped += 1; } stop(); }; }
    return stream;
  };
  window.BarcodeDetector = class {
    static async getSupportedFormats() { if (mode === "slow-formats") await new Promise(done => setTimeout(done, 600)); return ["ean_13"]; }
    constructor() { this.calls = 0; window.__instances.push(this); }
    async detect() { this.calls += 1; return window.__codes.splice(0).map(rawValue => ({ rawValue })); }
  };
}, mode);
const scan = (page, ...codes) => page.evaluate(values => window.__codes.push(...values), codes);
const open = async page => { await page.goto("/my-books"); await page.getByRole("button", { name: "Scan books", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Scan books" })).toBeVisible(); };

test.use({ viewport: { width: 390, height: 844 } });

test("a phone gets a Scan books button; a wider screen gets only the typed-ISBN field", async ({ page, app: _app }) => {
  await withCamera(page);
  await page.goto("/my-books");
  await expect(page.getByRole("button", { name: "Scan books", exact: true })).toBeVisible();
  await expect(page.getByLabel("Type an ISBN")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "Scan books", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Type an ISBN")).toBeVisible();
});

test("scanning a stack: rows collect, repeats and non-ISBN codes are ignored, and Add N books saves them all as owned", async ({ page, app }) => {
  app.isbn = answers;
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(dialog.getByText("Fit the barcode in the box")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add 0 books" })).toBeDisabled();
  await scan(page, EMMA, EMMA, "5012345678900", "9780141439519");   // a repeat, a shop code and a bad check digit
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(1);
  await scan(page, GATSBY, OL_ONLY, MOCK);
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(4);
  await expect(dialog.locator(`[data-isbn="${EMMA}"]`)).toContainText("Emma");
  await expect(dialog.locator(`[data-isbn="${GATSBY}"]`)).toContainText("Already on your shelf");
  await expect(dialog.locator(`[data-isbn="${OL_ONLY}"]`)).toContainText("The Odyssey");
  await expect(dialog.locator(`[data-isbn="${MOCK}"]`)).toContainText("We’ll find this one — saved for now");
  await expect(dialog.getByRole("button", { name: "I own it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Want to read", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("button", { name: "Add 3 books" })).toBeEnabled();
  expect(app.lookups.filter(isbn => isbn === EMMA)).toHaveLength(1);
  await dialog.getByRole("button", { name: "Add 3 books" }).click();
  await expect(dialog).toHaveCount(0);
  expect(app.writes.map(write => `${write.method} ${write.path}`).sort()).toEqual(["POST /me/library/private", "POST /me/library/private", `PUT /me/library/books/${EMMA.slice(-4)}`].sort());
  expect(app.writes.find(write => write.method === "PUT").body).toEqual({ is_owned: true });
  const odyssey = app.writes.find(write => write.body.isbn === OL_ONLY).body, unknown = app.writes.find(write => write.body.isbn === MOCK).body;
  expect(odyssey).toMatchObject({ title: "The Odyssey", author: "Homer", is_owned: true, is_wanted: false });
  expect(unknown).toMatchObject({ title: `ISBN ${MOCK}`, author: null, is_owned: true });
  expect(new Set([odyssey.request_id, unknown.request_id]).size).toBe(2);
  expect(await page.evaluate(() => window.__stopped)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Scan books", exact: true })).toBeFocused();
});

test("the two pills choose I own it or Want to read for the whole list", async ({ page, app }) => {
  app.isbn = answers;
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await scan(page, EMMA, MOCK);
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Want to read", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Want to read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "I own it", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Add 2 books" }).click();
  await expect(dialog).toHaveCount(0);
  expect(app.writes.find(write => write.method === "PUT").body).toEqual({ is_wanted: true });
  expect(app.writes.find(write => write.method === "POST").body).toMatchObject({ is_owned: false, is_wanted: true });
});

test("Add N books waits for lookups, a row can be removed, and a double click saves once", async ({ page, app }) => {
  app.isbn = answers;
  let release; app.holdLookups = new Promise(done => { release = done; });
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await scan(page, EMMA, ORWELL);
  await expect(dialog.locator(".bv-scan-row.is-looking")).toHaveCount(2);
  await expect(dialog.locator(".bv-scan-state").first()).toHaveText("Looking up…");
  await expect(dialog.getByRole("button", { name: /^Add \d+ books?$/ })).toBeDisabled();
  release();
  await expect(dialog.getByRole("button", { name: "Add 2 books" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Remove Nineteen Eighty-Four" }).click();
  await expect(dialog.getByRole("button", { name: "Add 1 book" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add 1 book" }).dblclick();
  await expect(dialog).toHaveCount(0);
  expect(app.writes).toHaveLength(1);
});

test("at most two lookups run at once, and a rate-limited one offers Retry on its own row", async ({ page, app }) => {
  app.isbn = { ...answers, [ORWELL]: "429" };
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await scan(page, EMMA, GATSBY, ORWELL, OL_ONLY, MOCK);
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(5);
  await expect(dialog.locator(".bv-scan-row.is-looking, .bv-scan-row.is-waiting")).toHaveCount(0);
  expect(app.maxInflight).toBeLessThanOrEqual(2);
  const failed = dialog.locator(`[data-isbn="${ORWELL}"]`);
  await expect(failed).toContainText("Couldn’t look this up.");
  await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible();
  // One line for the title, Retry under the state line, and every row the same height.
  const metrics = await dialog.locator(".bv-scan-row").evaluateAll(rows => rows.map(row => ({ height: Math.round(row.getBoundingClientRect().height), titleHeight: Math.round(row.querySelector(".bv-scan-title").getBoundingClientRect().height) })));
  expect(new Set(metrics.map(item => item.titleHeight)).size).toBe(1);
  const retry = await failed.getByRole("button", { name: "Retry" }).boundingBox(), state = await failed.locator(".bv-scan-state").boundingBox(), remove = await failed.locator(".bv-scan-remove").boundingBox();
  expect(retry.y).toBeGreaterThanOrEqual(state.y + state.height - 1); expect(retry.height).toBeGreaterThanOrEqual(44); expect(remove.x).toBeGreaterThan(retry.x + retry.width);
  app.isbn[ORWELL] = answers[ORWELL];
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(failed).toContainText("Nineteen Eighty-Four");
  await expect(failed.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a refused or missing camera falls back to typing, with one plain sentence", async ({ page, app }) => {
  app.isbn = answers;
  for (const mode of ["refused", "none"]) {
    await withCamera(page, mode);
    await open(page);
    const dialog = page.getByRole("dialog", { name: "Scan books" });
    await expect(dialog.getByText(mode === "refused" ? "Your browser has blocked the camera. Allow it in your browser’s settings for bookvane.me, or type the ISBN." : "Camera’s off. Type the ISBN instead.")).toBeVisible();
    await expect(dialog.getByText("Fit the barcode in the box")).toHaveCount(0);
    await dialog.getByLabel("Type an ISBN").fill("0-14-143951-3");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.locator(`[data-isbn="${EMMA}"]`)).toContainText("Emma");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
  }
  expect(app.writes).toHaveLength(0);
});

test("Escape closes the sheet, stops the camera and returns focus; focus stays inside while it is open", async ({ page, app: _app }) => {
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__stopped)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Scan books", exact: true })).toBeFocused();
});

test("the camera stops when the page is hidden and starts again when it is shown", async ({ page, app: _app }) => {
  await withCamera(page);
  await open(page);
  await expect.poll(() => page.evaluate(() => window.__streams)).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => window.__stopped)).toBeGreaterThan(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => window.__streams)).toBe(2);
});

test("on a wide screen the typed ISBN feeds the same list; a bad one is explained", async ({ page, app }) => {
  app.isbn = answers;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/my-books");
  await page.getByLabel("Type an ISBN").fill("12345");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Enter a valid ISBN.")).toBeVisible();
  await page.getByLabel("Type an ISBN").fill(EMMA);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(dialog.locator(`[data-isbn="${EMMA}"]`)).toContainText("Emma");
  await expect(dialog.locator("video")).toHaveCount(0);
  await dialog.getByLabel("Type an ISBN").fill(OL_ONLY);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Add 2 books" }).click();
  await expect(dialog).toHaveCount(0);
  expect(app.writes).toHaveLength(2);
});

test("if saving fails the books stay in the list and a second Add sends the same request ids", async ({ page, app }) => {
  app.isbn = answers;
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await scan(page, MOCK);
  await expect(dialog.getByRole("button", { name: "Add 1 book" })).toBeEnabled();
  let fail = true;
  await page.route("**/test-api/me/library/private", route => { if (fail) return route.fulfill({ status: 503, json: { detail: "Temporary failure" } }); return route.fallback(); });
  await dialog.getByRole("button", { name: "Add 1 book" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Some books couldn’t be added. Try again.");
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(1);
  fail = false;
  await dialog.getByRole("button", { name: "Add 1 book" }).click();
  await expect(dialog).toHaveCount(0);
  expect(app.writes).toHaveLength(1);
});

for (const theme of ["light", "dark"]) test(`the sheet fits at 390, 320 and 200% text; ${theme}`, async ({ page, app }) => {
  app.isbn = { ...answers, [ORWELL]: "429" };
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await withCamera(page);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const dialog = page.getByRole("dialog", { name: "Scan books" });
    await scan(page, EMMA, GATSBY, ORWELL, OL_ONLY, MOCK);
    await expect(dialog.locator(".bv-scan-row")).toHaveCount(5);
    await expect(dialog.locator(".bv-scan-row.is-looking, .bv-scan-row.is-waiting")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector("dialog").scrollWidth <= innerWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(Math.round(box.width)).toBe(width);
    await page.screenshot({ path: test.info().outputPath(`scan-${theme}-${width}${zoom ? "-200" : ""}.png`) });
    await page.keyboard.press("Escape");
    await page.reload();
  }
});

for (const mode of ["slow-play", "slow-formats"]) test(`hiding the page while the camera is still opening leaves one decoder and no live tracks from the first open; ${mode}`, async ({ page, app: _app }) => {
  await withCamera(page, mode);
  await page.goto("/my-books");
  await page.getByRole("button", { name: "Scan books", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__streams)).toBe(1);
  await page.waitForTimeout(150);                                           // the first open is now waiting on the video or the decoder
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => window.__streams)).toBe(2);
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1, { timeout: 8000 });
  await page.waitForTimeout(1500);                                          // long enough for the first open to finish waiting
  const tracks = await page.evaluate(() => window.__streamTracks);
  expect(tracks[0].stopped).toBe(tracks[0].total);                          // every track of the first open is stopped
  expect(tracks[1].stopped).toBe(0);                                        // the second one is live
  const before = await page.evaluate(() => window.__instances.map(item => item.calls));
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__instances.map(item => item.calls));
  expect(after.filter((calls, index) => calls > before[index])).toHaveLength(1);   // exactly one decoder loop is running
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__streamTracks.every(item => item.stopped === item.total))).toBe(true);
  const closed = await page.evaluate(() => window.__instances.map(item => item.calls));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__instances.map(item => item.calls))).toEqual(closed);   // nothing keeps looking once the sheet is closed
});

// ---- T69: the aiming box and the confirmation over the camera ------------------------------------------------------------------------

const rect = (page, selector) => page.locator(selector).evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; });
const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => { const f = value => { const x = value / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("the camera shows an aiming box: centred, barcode-shaped, dimmed outside, a static green line, and the new hint", async ({ page, app: _app }) => {
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  await expect(dialog.getByText("Fit the barcode in the box")).toBeVisible();
  await expect(dialog.getByText("Point at the barcode on the back")).toHaveCount(0);
  const frame = await rect(page, ".bv-scan-camera"), aim = await rect(page, ".bv-scan-aim"), hint = await rect(page, ".bv-scan-hint");
  expect(Math.abs(aim.x + aim.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(1.5);
  expect(aim.y + aim.height / 2).toBeLessThan(frame.y + frame.height / 2);   // centred in the space above the band kept for the card
  expect(aim.width / frame.width).toBeGreaterThan(0.76); expect(aim.width / frame.width).toBeLessThan(0.8);
  expect(aim.width / aim.height).toBeGreaterThan(2.1); expect(aim.width / aim.height).toBeLessThan(2.3);
  expect(hint.y).toBeGreaterThanOrEqual(aim.y + aim.height);                 // the hint sits under the box, inside the frame
  expect(hint.y + hint.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  const style = await page.locator(".bv-scan-aim").evaluate(node => { const css = getComputedStyle(node), line = getComputedStyle(node, "::before"); return { shadow: css.boxShadow, radius: css.borderTopLeftRadius, stroke: css.borderTopWidth, animation: css.animationName, lineHeight: line.height, lineColor: line.backgroundColor, lineAnimation: line.animationName }; });
  expect(style.shadow).toContain("rgba(0, 0, 0, 0.45)");
  expect(style.radius).toBe("12px"); expect(style.stroke).toBe("2px");
  expect(style.animation).toBe("none"); expect(style.lineAnimation).toBe("none"); expect(style.lineHeight).toBe("2px");
  expect(style.lineColor).not.toBe("rgba(0, 0, 0, 0)");
});

test("an accepted scan turns the box green with a tick for under a second, then clears; a repeat does not flash", async ({ page, app }) => {
  app.isbn = answers;
  await withCamera(page);
  await open(page);
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  const idle = await page.locator(".bv-scan-aim").evaluate(node => getComputedStyle(node).borderTopColor);
  await scan(page, EMMA);
  await expect(page.locator(".bv-scan-camera.is-flash")).toHaveCount(1);
  await expect(page.locator(".bv-scan-tick")).toHaveCSS("opacity", "1");
  expect(await page.locator(".bv-scan-aim").evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe(idle);
  const tick = await rect(page, ".bv-scan-tick"), aim = await rect(page, ".bv-scan-aim");
  expect(Math.round(tick.width)).toBe(40);
  expect(Math.abs(tick.x + 20 - (aim.x + aim.width / 2))).toBeLessThan(1.5);
  await expect(page.locator(".bv-scan-camera.is-flash")).toHaveCount(0, { timeout: 1000 });
  await expect(page.locator(".bv-scan-tick")).toHaveCSS("opacity", "0");
  expect(await page.locator(".bv-scan-aim").evaluate(node => getComputedStyle(node).borderTopColor)).toBe(idle);
  await scan(page, EMMA);                                                    // the same ISBN inside the 3 s window
  await page.waitForTimeout(300);
  await expect(page.locator(".bv-scan-camera.is-flash")).toHaveCount(0);
});

test("the card: Looking up… then the title and Added · N scanned, replaced by the next scan, gone about 3 s after its answer; one announcement per answer", async ({ page, app }) => {
  app.isbn = answers;
  let release; app.holdLookups = new Promise(done => { release = done; });
  await withCamera(page);
  await open(page);
  const card = page.locator(".bv-scan-card");
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  await expect(card).not.toHaveClass(/is-open/);
  await scan(page, EMMA);
  await expect(card).toHaveClass(/is-open/);
  await expect(card.locator(".bv-scan-state")).toHaveText("Looking up…");
  await expect(card.locator(".bv-scan-title")).toHaveText(EMMA);
  await expect(page.getByRole("dialog", { name: "Scan books" }).locator(".bv-sr-only[aria-live='polite']")).toHaveText("");   // nothing is announced until the title is known
  release();
  await expect(card.locator(".bv-scan-title")).toHaveText("Emma");
  await expect(card.locator(".bv-scan-state")).toHaveText("Added · 1 scanned");
  await expect(page.getByRole("dialog", { name: "Scan books" }).locator(".bv-sr-only[aria-live='polite']")).toHaveText("Emma. Added · 1 scanned");
  app.holdLookups = null;
  await scan(page, ORWELL);
  await expect(card.locator(".bv-scan-title")).toHaveText("Nineteen Eighty-Four");
  await expect(card.locator(".bv-scan-state")).toHaveText("Added · 2 scanned");
  await expect(page.getByRole("dialog", { name: "Scan books" }).locator(".bv-sr-only[aria-live='polite']")).toHaveText("Nineteen Eighty-Four. Added · 2 scanned");
  await page.waitForTimeout(1500);
  await expect(card).toHaveClass(/is-open/);                                 // it stays after the answer
  await expect(card).not.toHaveClass(/is-open/, { timeout: 4000 });          // and goes about 3 s after it
  expect(await card.evaluate(node => node.getAttribute("aria-hidden"))).toBe("true");
  expect(await card.evaluate(node => node.tabIndex)).toBe(-1);
});

test("the card for a shelf book, a book we could not find and a failed lookup", async ({ page, app }) => {
  app.isbn = { ...answers, [ORWELL]: "429" };
  await withCamera(page);
  await open(page);
  const card = page.locator(".bv-scan-card");
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  await scan(page, GATSBY);
  await expect(card.locator(".bv-scan-title")).toHaveText("The Great Gatsby");
  await expect(card.locator(".bv-scan-state")).toHaveText("Already on your shelf");
  await scan(page, MOCK);
  await expect(card.locator(".bv-scan-title")).toHaveText(`ISBN ${MOCK}`);
  await expect(card.locator(".bv-scan-state")).toHaveText("Added · 2 scanned");
  await scan(page, ORWELL);
  await expect(card.locator(".bv-scan-state")).toHaveText("Couldn’t look this up.");
  await expect(card.locator(".bv-scan-title")).toHaveText(`ISBN ${ORWELL}`);
});

test("with reduced motion nothing animates: no transitions, but the tick and the card still come and go on the same timings", async ({ page, app }) => {
  app.isbn = answers;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await withCamera(page);
  await open(page);
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  for (const selector of [".bv-scan-card", ".bv-scan-aim", ".bv-scan-tick"]) {
    expect(await page.locator(selector).evaluate(node => { const css = getComputedStyle(node); return [css.transitionDuration, css.animationName]; }), selector).toEqual(["0s", "none"]);
  }
  await scan(page, EMMA);
  await expect(page.locator(".bv-scan-camera.is-flash")).toHaveCount(1);
  await expect(page.locator(".bv-scan-card")).toHaveClass(/is-open/);
  await expect(page.locator(".bv-scan-camera.is-flash")).toHaveCount(0, { timeout: 1000 });
  expect(await page.locator(".bv-scan-row").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
});

test("the card and the hint stay readable over a white and a black video frame", async ({ page, app }) => {
  app.isbn = answers;
  await withCamera(page);
  await open(page);
  await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
  const readable = async selector => page.locator(selector).evaluate(node => {
    const text = getComputedStyle(node).color; let el = node, back = "rgba(0, 0, 0, 0)";
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(back)) { back = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    return [text, back];
  });
  for (const fill of ["#ffffff", "#000000"]) {
    await page.evaluate(value => { window.__fill = value; }, fill);
    await scan(page, fill === "#ffffff" ? EMMA : ORWELL);
    await expect(page.locator(".bv-scan-card.is-open .bv-scan-state")).toContainText("scanned");
    for (const selector of [".bv-scan-card .bv-scan-title", ".bv-scan-card .bv-scan-state"]) { const [text, back] = await readable(selector); expect(ratio(text, back), `${selector} over ${fill}`).toBeGreaterThanOrEqual(4.5); }
    await page.waitForTimeout(3600);
  }
  const [text, back] = await readable(".bv-scan-hint");
  expect(ratio(text, back)).toBeGreaterThanOrEqual(4.5);
});

for (const theme of ["light", "dark"]) test(`the aiming box and card fit at 390, 320 and 200% text with no sideways scroll; ${theme}`, async ({ page, app }) => {
  app.isbn = answers;
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await withCamera(page);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.locator(".bv-scan-camera.is-on")).toHaveCount(1);
    // The sheet opens and the card slides in: measure once two reads about 50ms apart agree (2s cap).
    const settled = async () => {
      const reads = () => Promise.all([rect(page, ".bv-scan-camera"), rect(page, ".bv-scan-card"), rect(page, ".bv-scan-aim")]);
      let last = JSON.stringify(await reads());
      for (const started = Date.now(); Date.now() - started < 2000;) {
        await page.waitForTimeout(50);
        const now = JSON.stringify(await reads());
        if (now === last) break;
        last = now;
      }
      return JSON.parse(last);
    };
    const [before, , aimBefore] = await settled();
    await scan(page, EMMA);
    await expect(page.locator(".bv-scan-card.is-open .bv-scan-state")).toHaveText("Added · 1 scanned");
    const [frame, card, aim] = await settled();
    expect(frame.height).toBe(before.height);                                // nothing shifts when the card arrives
    expect(aim).toEqual(aimBefore);                                          // and the box does not move either
    expect(card.y).toBeGreaterThanOrEqual(aim.y + aim.height);               // the card never covers the box
    expect(aim.width / frame.width).toBeGreaterThanOrEqual(0.6);
    expect(Math.abs(aim.width / aim.height - 2.2)).toBeLessThan(0.1);
    expect(card.x).toBeGreaterThanOrEqual(frame.x); expect(card.x + card.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(card.y + card.height).toBeLessThanOrEqual(frame.y + frame.height + 1.5);
    expect(aim.x).toBeGreaterThanOrEqual(frame.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector("dialog").scrollWidth <= innerWidth)).toBe(true);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: test.info().outputPath(`feedback-${theme}-${width}${zoom ? "-200" : ""}.png`) });
    await page.keyboard.press("Escape");
    await page.reload();
  }
});

// No grey panel behind a cover: the blank beside a row that is still being looked up is an outline only.
for (const name of ["light", "dark"]) test(`the scan sheet's blank cover is an outline, not a grey fill; ${name}`, async ({ page, app }) => {
  app.isbn = answers;
  let release; app.holdLookups = new Promise(done => { release = done; });
  await page.emulateMedia({ colorScheme: name });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), name);
  await withCamera(page);
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await scan(page, EMMA);
  await expect(dialog.locator(".bv-scan-row.is-looking .bv-scan-cover-blank")).toHaveCount(1);
  const blank = await dialog.locator(".bv-scan-cover-blank").first().evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.boxShadow]; });
  expect(blank[0]).toBe("rgba(0, 0, 0, 0)"); expect(blank[1]).toMatch(/inset/);
  release();
  await expect(dialog.locator(".bv-scan-row.is-looking")).toHaveCount(0);
});
