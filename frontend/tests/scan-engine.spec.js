import { test as base, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { GENRES } from "./support/genres.js";
import { aimRegion } from "../src/components/reading/scan/decoder.js";
import { cleanFrame, greyscale, invert, sharpen, stretch } from "../src/components/reading/scan/frameClean.js";
import { runBenchmark } from "../scripts/scan-bench.mjs";

// Scan phase B: the built-in reader (ZXing-C++ in a worker) on browsers without BarcodeDetector, the clean-up and aiming region, tap to
// focus, the counters, and the benchmark that fails if the read rate drops. The camera is mocked; no real device is involved.
const EMMA = "9780141439518";
const FIXTURE = readFileSync(new URL("./fixtures/barcodes/01-clean.jpg", import.meta.url)).toString("base64");
const entry = { id: 101, book_id: 1, book: { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 272, english_title: null }, is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z" };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [], lookups: [], events: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") { state.events.push(JSON.parse(request.postData()).name); return route.fulfill({ status: 204, body: "" }); }
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [entry], counts: { all: 1, owned: 1, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (["/me/lists", "/me/up-next", "/me/preferences"].includes(path)) return reply(200, []);
      if (/^\/me\/library\/101\/(reading|attempts)$/.test(path)) return reply(404, { detail: "Not found" });   // background prefetch, not part of this fixture
      const isbn = path.match(/^\/me\/catalogue\/isbn\/(\d+)$/);
      if (isbn) { state.lookups.push(isbn[1]); return reply(200, { isbn13: isbn[1], status: "catalogue", book_id: 5, edition_id: 1, title: "Emma", authors: ["Jane Austen"], cover_url: null, on_shelf: null }); }
      state.errors.push(`Unhandled ${request.method()} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

// engine "native" mocks BarcodeDetector; "wasm" removes it, and the camera shows a real EAN-13 picture, so the worker and the WebAssembly really run.
const withCamera = (page, { engine = "native", caps = {} } = {}) => page.addInitScript(({ engine, caps, picture }) => {
  window.__codes = []; window.__applied = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d"), image = new Image();
    ctx.fillStyle = "#333"; ctx.fillRect(0, 0, 640, 360);
    if (engine === "wasm") { image.onload = () => setInterval(() => ctx.drawImage(image, 0, 0), 100); image.src = `data:image/jpeg;base64,${picture}`; } else setInterval(() => ctx.fillRect(0, 0, 640, 360), 100);
    const stream = canvas.captureStream(10), [track] = stream.getVideoTracks();
    track.getCapabilities = () => caps;
    track.applyConstraints = async constraint => { window.__applied.push(constraint.advanced[0]); };
    return stream;
  };
  if (engine === "wasm") delete window.BarcodeDetector;
  else window.BarcodeDetector = class { static async getSupportedFormats() { return ["ean_13"]; } async detect() { return window.__codes.splice(0).map(rawValue => ({ rawValue })); } };
}, { engine, caps, picture: FIXTURE });
const scanOnce = (page, ...codes) => page.evaluate(values => window.__codes.push(...values), codes);
const scan = (page, ...codes) => page.evaluate(values => window.__codes.push(...values, ...values), codes);
const open = async (page, { clock = false } = {}) => {
  if (clock) await page.clock.install();
  await page.goto("/my-books");
  await page.getByRole("button", { name: "Scan books", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(dialog.locator(".bv-scan-camera.is-on")).toBeVisible({ timeout: 20000 });
  return dialog;
};

test.use({ viewport: { width: 390, height: 844 } });

test("without BarcodeDetector the built-in reader reads a real barcode picture through the worker and WebAssembly", async ({ page, app }) => {
  await withCamera(page, { engine: "wasm" });
  const dialog = await open(page);
  await expect(dialog.locator(`[data-isbn="${EMMA}"]`)).toContainText("Emma", { timeout: 30000 });
  expect(app.lookups).toEqual([EMMA]);
  expect(app.events).toContain("scan_engine_wasm");
  expect(app.errors).toEqual([]);
});

test("the counters: engine, typed fallback, no read after 8 seconds, and a barcode that is not an ISBN", async ({ page, app }) => {
  await withCamera(page);
  const dialog = await open(page, { clock: true });
  expect(app.events).toContain("scan_engine_native");
  await scanOnce(page, "5012345678900"); await page.clock.runFor(400); await scanOnce(page, "5012345678900"); await page.clock.runFor(400);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toBeVisible();
  await page.clock.runFor(8500);
  await expect.poll(() => app.events.filter(name => name === "scan_non_isbn")).toHaveLength(1);
  await expect.poll(() => app.events).toContain("scan_timeout");
  await dialog.getByLabel("Type an ISBN").fill(EMMA);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => app.events).toContain("scan_typed");
});

test("tap to focus: the hint shows once where it works, a tap focuses at that point and goes back to continuous focus", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { focusMode: ["single-shot", "continuous"], pointsOfInterest: ["none"] } });
  const dialog = await open(page, { clock: true });
  await expect(dialog.getByText("Tap the barcode to focus.")).toBeVisible();
  const camera = dialog.locator(".bv-scan-camera"), box = await camera.boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
  const applied = await page.evaluate(() => window.__applied);
  const tap = applied.find(item => item.focusMode === "single-shot");
  expect(tap.pointsOfInterest[0].x).toBeCloseTo(0.25, 1);
  expect(tap.pointsOfInterest[0].y).toBeCloseTo(0.5, 1);
  await expect(dialog.getByText("Tap the barcode to focus.")).toHaveCount(0);
  await page.clock.runFor(2100);
  expect((await page.evaluate(() => window.__applied)).at(-1)).toEqual({ focusMode: "continuous" });
});

test("no tap-to-focus support means no hint and no focus request", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { focusMode: ["continuous"] } });
  const dialog = await open(page);
  await expect(dialog.getByText("Tap the barcode to focus.")).toHaveCount(0);
  const box = await dialog.locator(".bv-scan-camera").boundingBox();
  await page.mouse.click(box.x + 40, box.y + 40);
  expect((await page.evaluate(() => window.__applied)).filter(item => item.focusMode === "single-shot")).toEqual([]);
});

test("the built-in reader and its WebAssembly are not in the main bundle", async () => {
  const dist = new URL("../dist/assets/", import.meta.url), html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const entry = html.match(/assets\/(index-[^"]+\.js)/)?.[1];
  expect(entry).toBeTruthy();
  const main = readFileSync(new URL(entry, dist), "utf8");
  expect(main).not.toMatch(/zxing_reader|readBarcodes|prepareZXingModule/);
  expect(readdirSync(dist).some(file => file.endsWith(".wasm"))).toBe(true);
});

test("aimRegion maps the aiming box back to the camera's pixels through the cover crop, padded, and gives up on nonsense", () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  // A 1920x1080 picture in a 300x300 box: scaled to 300 high (0.2778), 266 px trimmed off each side.
  const video = { videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: () => rect(0, 0, 300, 300) };
  const aim = { getBoundingClientRect: () => rect(75, 100, 150, 68) };
  const region = aimRegion(video, aim, 0);
  const scale = 300 / 1080, shift = (1920 * scale - 300) / 2;
  expect(region.sx).toBeCloseTo((75 + shift) / scale, 3);
  expect(region.sy).toBeCloseTo(100 / scale, 3);
  expect(region.sw).toBeCloseTo(150 / scale, 3);
  expect(region.sh).toBeCloseTo(68 / scale, 3);
  expect(aimRegion(video, aim, 0.2).sw).toBeGreaterThan(region.sw);
  expect(aimRegion({ ...video, videoWidth: 0 }, aim)).toBeNull();
  expect(aimRegion(video, { getBoundingClientRect: () => rect(0, 0, 5, 5) })).toBeNull();
});

test("clean-up: grey, a contrast stretch that survives glare, a sharpen that keeps the edges, and a different variant on odd frames", () => {
  const width = 8, height = 4, rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) { const v = i % 2 ? 140 : 100; rgba.set([v, v, v, 255], i * 4); }
  const grey = greyscale(rgba, width, height), stretched = stretch(grey);
  expect(Math.max(...stretched) - Math.min(...stretched)).toBeGreaterThan(200);       // 40 grey levels became about 255
  const glared = new Uint8ClampedArray(1000).fill(120); glared.fill(255, 0, 10);       // 1% glare spot
  glared.fill(60, 500, 800);
  const out = stretch(glared);
  expect(out[0]).toBe(255);
  expect(out[600]).toBeLessThan(10);                                                    // the dark bars are not squashed by the glare
  expect(invert(new Uint8ClampedArray([0, 255, 100]))).toEqual(new Uint8ClampedArray([255, 0, 155]));
  const edge = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255].flatMap(v => [v, v, v, v, v, v, v, v]));
  const sharp = sharpen(edge.slice(0, 64), 8, 8);
  expect(sharp[3 * 8 + 3]).toBe(0);
  expect(sharp[4 * 8 + 3]).toBe(255);
  const even = cleanFrame(rgba, width, height, 0), odd = cleanFrame(rgba, width, height, 1);
  expect(even.length).toBe(width * height * 4);
  expect(even[0]).not.toBe(odd[0]);                                                     // odd frames are inverted
});

test("the benchmark: the built-in reader's read rate over the barcode set does not drop below the recorded baseline", async () => {
  test.setTimeout(240000);
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/barcodes/baseline.json", import.meta.url), "utf8"));
  const result = await runBenchmark();
  console.log(`scan benchmark: ${result.wasm}/${result.total} = ${(result.wasmRate * 100).toFixed(1)}% (baseline ${baseline.wasmRate * 100}%, old engine ${baseline.oldRate * 100}%)`, result.misses.join(", "));
  expect(result.total).toBe(baseline.total);
  expect(result.wasmRate).toBeGreaterThanOrEqual(baseline.minRate);
});
