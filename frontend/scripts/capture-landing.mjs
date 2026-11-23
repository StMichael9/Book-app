// Regenerates the landing page pictures in public/landing: real captures of the running app with mocked data, as WebP, light and dark.
// Run: build with VITE_API_BASE_URL=http://127.0.0.1:5689/test-api, serve it (vite preview --port 5689), then `node scripts/capture-landing.mjs`.
// Phone stills are 390 wide and the desktop ones 1440 wide, at 2x. Nothing here touches a real account or a real API.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.CAPTURE_BASE || "http://127.0.0.1:5689", OUT = new URL("../public/landing/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const GENRES = [{ key: "fiction", label: "Fiction" }];
const book = { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 360, english_title: null };
const entry = (over = {}) => ({ id: 101, book_id: 1, book, is_owned: true, is_wanted: false, version: 1, reading_state: "reading", private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z", ...over });
const attempt = (over = {}) => ({ id: "a1", state: "reading", started_on: "2026-11-13", ended_on: null, progress_unit: "pages", progress_value: 148, total_pages: 360, note: "Slow and strange so far. The statues are the best part.", reaction: null, updated_at: "2026-11-13T10:00:00Z", ...over });
const ISBNS = { 9780141439518: ["Emma", "Jane Austen"], 9780743273565: ["The Great Gatsby", "F. Scott Fitzgerald"], 9780451524935: ["Nineteen Eighty-Four", "George Orwell"], 9780061120084: ["To Kill a Mockingbird", "Harper Lee"] };
const REVIEW = [{ ordinal: 2, source: { title: "Middlemarch", author: "George Eliot", context: {}, warnings: [], events: [{ state: "finished", started_on: "2025-11-01", ended_on: "2025-12-20" }] }, candidates: [], plan: { kind: "existing", differences: [{ field: "finished_on", file: "2025-12-20", existing: "2026-01-03", use: "existing" }] }, disposition: "review" }];

async function mock(page, scene) {
  const state = { entry: entry(), attempt: attempt(scene.attempt) };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.origin !== new URL(BASE).origin) return route.abort();
    if (!url.pathname.startsWith("/test-api/")) return route.continue();
    const path = url.pathname.slice("/test-api".length), reply = json => route.fulfill({ status: 200, json });
    const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
    if (path === "/auth/refresh") return reply({});
    if (path === "/events") return route.fulfill({ status: 204, body: "" });
    if (path === "/genres") return reply(GENRES);
    if (path === "/autocomplete/tags/batch") return reply([]);
    if (path === "/me/profile") return reply({ display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
    if (path === "/me/reading-capabilities") return reply({ enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
    if (path === "/me/home") return reply({ current_reads: [{ entry: state.entry, attempt: state.attempt }], reading_count: 1, paused_count: 0 });
    if (path === "/me/library") return reply({ items: [state.entry], counts: { all: 1, owned: 1, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
    if (path === "/me/library/lookup") return reply({ items: [] });
    if (path === "/me/stats") return reply({ year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
    if (["/me/lists", "/me/up-next", "/me/preferences"].includes(path)) return reply([]);
    if (path === "/me/library/101/reading") return reply({ entry: state.entry, current_attempt: state.attempt, editions: [] });
    if (path === "/me/library/101/attempts") return reply({ items: [], next_cursor: null });
    if (path === "/me/reading-attempts/a1" && method === "PATCH") { const { expected_version: _v, ...changes } = body; state.attempt = { ...state.attempt, ...changes }; state.entry = { ...state.entry, version: 2, reading_state: state.attempt.state }; return reply({ entry: state.entry, attempt: state.attempt }); }
    if (path === "/books/1") return reply({ ...book, description: "A house of endless halls.", published_year: 2020, isbn13: null });
    if (/\/description$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
    const isbn = path.match(/^\/me\/catalogue\/isbn\/(\d+)$/);
    if (isbn) { const [title, author] = ISBNS[isbn[1]] || ["Unknown", "Someone"]; return reply({ isbn13: isbn[1], status: "catalogue", book_id: Number(isbn[1].slice(-4)), edition_id: 1, title, authors: [author], cover_url: null, on_shelf: null }); }
    if (/^\/me\/library\/books\/\d+$/.test(path) || path === "/me/library/private") return reply(state.entry);
    const root = "/me/library-imports";
    if (path === root) return reply({ items: [{ id: "run", source: "goodreads", phase: "preview_ready", row_count: 43, revision: 2, manifest_hash: "m", summary: { counts: { matched: 41, private: 1, needs_choice: 1, duplicates: 0, skipped: 0, applied: 0, pending: 0, total: 43 }, dispositions: { review: 1, invalid: 0 } }, expires_at: "2026-12-01T00:00:00Z" }] });
    if (path === `${root}/run`) return reply({ id: "run", source: "goodreads", phase: "preview_ready", row_count: 43, revision: 2, manifest_hash: "m", summary: { counts: { matched: 41, private: 1, needs_choice: 1, duplicates: 0, skipped: 0, applied: 0, pending: 0, total: 43 }, dispositions: { review: 1, invalid: 0 } }, expires_at: "2026-12-01T00:00:00Z" });
    if (path === `${root}/run/rows`) return reply({ revision: 2, next_after: null, items: REVIEW });
    if (path.startsWith(root)) return reply({});
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}

// A camera that shows the back of a book with a barcode, and a detector that reports whatever the scene pushes.
const camera = page => page.addInitScript(() => {
  window.__codes = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const g = canvas.getContext("2d");
    g.fillStyle = "#cdb892"; g.fillRect(0, 0, 640, 480);
    g.fillStyle = "#b39c73"; for (let y = 40; y < 200; y += 22) g.fillRect(60, y, 380 - (y % 3) * 40, 8);
    g.fillStyle = "#fff"; g.fillRect(150, 250, 340, 190);
    g.fillStyle = "#111"; for (let x = 170, i = 0; x < 470; i++) { const w = 2 + ((i * 7) % 4); g.fillRect(x, 270, w, 130); x += w + 2 + ((i * 5) % 3); }
    g.font = "16px monospace"; g.fillStyle = "#111"; g.fillText("9 780141 439518", 220, 425);
    return canvas.captureStream(10);
  };
  window.BarcodeDetector = class { static async getSupportedFormats() { return ["ean_13"]; } async detect() { return window.__codes.splice(0).map(rawValue => ({ rawValue })); } };
});
const scan = (page, ...codes) => page.evaluate(values => window.__codes.push(...values), codes);

async function save(page, name, theme) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const png = await page.screenshot();
  const b64 = png.toString("base64");
  const webp = await page.evaluate(async data => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  }, b64);
  writeFileSync(new URL(`${name}-${theme}.webp`, OUT), Buffer.from(webp, "base64"));
  console.log("wrote", `${name}-${theme}.webp`, Math.round(webp.length * 0.75 / 1024), "KB");
}

const phone = { width: 390, height: 844 };
const scenes = [
  { names: ["scan-tick"], viewport: phone, camera: true, run: async page => { await open(page); await scan(page, "9780141439518"); await page.locator(".bv-scan-row").first().waitFor(); } },
  { names: ["scan-hero"], viewport: phone, camera: true, run: async page => { await open(page); await scan(page, "9780141439518", "9780743273565", "9780451524935"); await page.locator(".bv-scan-row").nth(2).waitFor(); await page.waitForTimeout(300); } },
  { names: ["import"], viewport: phone, run: async page => { await page.goto(`${BASE}/my-books/import`); await page.getByRole("button", { name: "Continue", exact: true }).click(); await page.getByRole("button", { name: /^Review 1 book first$/ }).click(); await page.locator(".bv-import-row").first().waitFor(); await page.locator(".bv-import-row").first().evaluate(node => node.scrollIntoView({ block: "center" })); } },
  { names: ["private-note"], viewport: phone, run: async page => { await page.goto(`${BASE}/my-books/101`); await page.locator(".bv-notes").scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector(".bv-notes")?.scrollIntoView({ block: "center" })); } },
];
const open = async page => { await page.goto(`${BASE}/my-books`); await page.getByRole("button", { name: "Scan books", exact: true }).click(); await page.getByRole("dialog", { name: "Scan books" }).waitFor(); await page.waitForTimeout(500); };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
for (const theme of ["light", "dark"]) for (const scene of scenes) {
  const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.addInitScript(value => { try { localStorage.setItem("bookvane-theme", value); localStorage.setItem("bookvane:session-hint:v1", "1"); } catch { /* none */ } }, theme);
  await mock(page, scene); if (scene.camera) await camera(page);
  await scene.run(page);
  for (const name of scene.names) await save(page, name, theme);
  await context.close();
}
await browser.close();
