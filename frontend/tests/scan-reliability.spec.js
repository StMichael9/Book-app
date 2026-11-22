import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";
import { classifyScan, startDecoder } from "../src/components/reading/scan/decoder.js";

// Scan reliability: the camera request, zoom, light and focus, the price add-on, a barcode that is not an ISBN, the eight-second tips,
// the one-time camera tip and the blocked-camera line. A mocked camera and a controlled clock: no real device is involved.
const book = { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 272, english_title: null };
const entry = { id: 101, book_id: 1, book, is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z" };
const EMMA = "9780141439518";

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [], lookups: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [entry], counts: { all: 1, owned: 1, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (["/me/lists", "/me/up-next", "/me/preferences"].includes(path)) return reply(200, []);
      const isbn = path.match(/^\/me\/catalogue\/isbn\/(\d+)$/);
      if (isbn) { state.lookups.push(isbn[1]); return reply(200, { isbn13: isbn[1], status: "catalogue", book_id: 5, edition_id: 1, title: "Emma", authors: ["Jane Austen"], cover_url: null, on_shelf: null }); }
      state.errors.push(`Unhandled ${request.method()} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

// A camera whose video track reports what the test says it can do, and records every constraint it is given.
const withCamera = (page, { caps = {}, permission, agent } = {}) => page.addInitScript(({ caps, permission, agent }) => {
  window.__codes = []; window.__requests = []; window.__applied = [];
  if (agent) Object.defineProperty(navigator, "userAgent", { value: agent, configurable: true });
  if (permission) Object.defineProperty(navigator, "permissions", { value: { query: async () => ({ state: permission }) }, configurable: true });
  navigator.mediaDevices.getUserMedia = async constraints => {
    window.__requests.push(constraints);
    if (window.__refuse) throw new DOMException("Permission denied", "NotAllowedError");
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    canvas.getContext("2d").fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(10), [track] = stream.getVideoTracks();
    track.getCapabilities = () => caps;
    track.applyConstraints = async constraint => { window.__applied.push(constraint.advanced[0]); };
    return stream;
  };
  window.BarcodeDetector = class { static async getSupportedFormats() { return ["ean_13", "ean_8", "upc_a", "upc_e"]; } async detect() { return window.__codes.splice(0).map(rawValue => ({ rawValue })); } };
}, { caps, permission, agent });
const scan = (page, ...codes) => page.evaluate(values => window.__codes.push(...values), codes);
const open = async (page, { clock = true } = {}) => {
  if (clock) await page.clock.install();
  await page.goto("/my-books");
  await page.getByRole("button", { name: "Scan books", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".bv-scan-camera.is-on")).toBeVisible();
  return dialog;
};
const settle = (page, ms) => page.clock.runFor(ms);

test.use({ viewport: { width: 390, height: 844 } });

test("the camera is asked for 1080p, facing the book, and a device with zoom starts at about 2x with continuous focus", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { zoom: { min: 1, max: 5, step: 0.1 }, focusMode: ["manual", "continuous"] } });
  const dialog = await open(page);
  const [request] = await page.evaluate(() => window.__requests);
  expect(request.video).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: "environment" } });
  expect(request.audio).toBe(false);
  const applied = await page.evaluate(() => window.__applied);
  expect(applied).toContainEqual({ focusMode: "continuous" });
  expect(applied).toContainEqual({ zoom: 2 });
  const slider = dialog.getByLabel("Zoom");
  await expect(slider).toHaveValue("2");
  await slider.fill("3");
  expect(await page.evaluate(() => window.__applied.at(-1))).toEqual({ zoom: 3 });
});

test("a camera with a smaller zoom range is held to its range; one without zoom or focus shows no slider and applies nothing", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { zoom: { min: 1, max: 1.5, step: 0.1 } } });
  const dialog = await open(page);
  await expect(dialog.getByLabel("Zoom")).toHaveValue("1.5");
  await page.reload();
  await withCamera(page, { caps: {} });
  await page.reload();
  const bare = await open(page, { clock: false });
  await expect(bare.getByLabel("Zoom")).toHaveCount(0);
  expect(await page.evaluate(() => window.__applied)).toEqual([]);
});

test("the light button shows only where the camera has a torch, and turns it on and off", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { torch: true } });
  const dialog = await open(page);
  const light = dialog.getByRole("button", { name: "Turn on the light" });
  await expect(light).toBeVisible();
  await light.click();
  expect(await page.evaluate(() => window.__applied.at(-1))).toEqual({ torch: true });
  await expect(dialog.getByRole("button", { name: "Turn off the light" })).toBeVisible();
  await dialog.getByRole("button", { name: "Turn off the light" }).click();
  expect(await page.evaluate(() => window.__applied.at(-1))).toEqual({ torch: false });
});

test("no torch means no light button", async ({ page, app: _app }) => {
  await withCamera(page, { caps: {} });
  const dialog = await open(page);
  await expect(dialog.getByRole("button", { name: /the light$/ })).toHaveCount(0);
});

test("a 5-digit or 2-digit price add-on is ignored; the ISBN beside it is read once", async ({ page, app }) => {
  await withCamera(page);
  const dialog = await open(page);
  await scan(page, "52499", "12", EMMA, "52499");
  await settle(page, 600);
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(1);
  expect(app.lookups).toEqual([EMMA]);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toHaveCount(0);
});

test("a barcode that is not an ISBN is named only when it is read twice, and Type the ISBN moves to the field", async ({ page, app: _app }) => {
  await withCamera(page);
  const dialog = await open(page);
  await scan(page, "5012345678900");
  await settle(page, 600);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toHaveCount(0);
  await scan(page, "5012345678900");
  await settle(page, 600);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toBeVisible();
  await expect(dialog.getByText("Look for the barcode that starts with 978 or 979. It’s usually on the back cover. Or type the ISBN, which is often printed above the barcode or on the copyright page.")).toBeVisible();
  await dialog.getByRole("button", { name: "Type the ISBN" }).click();
  await expect(dialog.getByLabel("Type an ISBN")).toBeFocused();
  await expect(dialog.locator(".bv-scan-row")).toHaveCount(0);
});

test("two different shop codes read once each never flash the message, and a real ISBN clears it", async ({ page, app: _app }) => {
  await withCamera(page);
  const dialog = await open(page);
  await scan(page, "5012345678900"); await settle(page, 400); await scan(page, "4006381333931"); await settle(page, 400);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toHaveCount(0);
  await scan(page, "4006381333931"); await settle(page, 400);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toBeVisible();
  await scan(page, EMMA); await settle(page, 400);
  await expect(dialog.getByText("This barcode isn’t an ISBN.")).toHaveCount(0);
});

test("after 8 seconds with no read, Having trouble? opens the tips; the light tip is only offered with a torch", async ({ page, app: _app }) => {
  await withCamera(page, { caps: { torch: true } });
  const dialog = await open(page);
  await settle(page, 7000);
  await expect(dialog.getByRole("button", { name: "Having trouble?" })).toHaveCount(0);
  await settle(page, 1200);
  await dialog.getByRole("button", { name: "Having trouble?" }).click();
  for (const tip of ["Turn on the light.", "Hold the phone a little further away.", "Keep the barcode flat and inside the box.", "Tilt the book a little to get rid of glare."]) await expect(dialog.getByText(tip, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Type the ISBN" }).click();
  await expect(dialog.getByLabel("Type an ISBN")).toBeFocused();
  await page.reload();
  await withCamera(page, { caps: {} });
  await page.reload();
  const bare = await open(page, { clock: false });
  await settle(page, 8500);
  await bare.getByRole("button", { name: "Having trouble?" }).click();
  await expect(bare.getByText("Turn on the light.", { exact: true })).toHaveCount(0);
  await expect(bare.getByText("Hold the phone a little further away.", { exact: true })).toBeVisible();
});

test("a read within 8 seconds keeps the tips away, and a read after them clears them", async ({ page, app: _app }) => {
  await withCamera(page);
  const dialog = await open(page);
  await settle(page, 6000);
  await scan(page, EMMA); await settle(page, 600);
  await settle(page, 6000);
  await expect(dialog.getByRole("button", { name: "Having trouble?" })).toHaveCount(0);
  await settle(page, 3000);
  await expect(dialog.getByRole("button", { name: "Having trouble?" })).toBeVisible();
  await scan(page, "9780743273565"); await settle(page, 600);
  await expect(dialog.getByRole("button", { name: "Having trouble?" })).toHaveCount(0);
});

test("the camera tip shows once after the permission prompt, with the line for the phone, and never again", async ({ page, app: _app }) => {
  await withCamera(page, { permission: "prompt", agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" });
  const dialog = await open(page);
  await expect(dialog.getByText("Tip: you can let Bookvane use your camera without asking each time.")).toBeVisible();
  await expect(dialog.getByText("On iPhone, tap aA in the address bar, then Website Settings, then Camera, then Allow.")).toBeVisible();
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog.getByText("Tip: you can let Bookvane use your camera without asking each time.")).toHaveCount(0);
  await page.reload();
  const again = await open(page, { clock: false });
  await expect(again.getByText("Tip: you can let Bookvane use your camera without asking each time.")).toHaveCount(0);
});

test("on Android the tip names the Android choice; a camera that was already allowed gets no tip", async ({ page, app: _app }) => {
  await withCamera(page, { permission: "prompt", agent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36" });
  const dialog = await open(page);
  await expect(dialog.getByText("On Android, choose “While using the site” when asked.")).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await withCamera(page, { permission: "granted" });
  await page.reload();
  const granted = await open(page, { clock: false });
  await expect(granted.getByText("Tip: you can let Bookvane use your camera without asking each time.")).toHaveCount(0);
});

test("a blocked camera says so and offers Type the ISBN", async ({ page, app: _app }) => {
  await withCamera(page);
  await page.addInitScript(() => { window.__refuse = true; });
  await page.goto("/my-books");
  await page.getByRole("button", { name: "Scan books", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Scan books" });
  await expect(dialog.getByText("Your browser has blocked the camera. Allow it in your browser’s settings for bookvane.me, or type the ISBN.")).toBeVisible();
  await dialog.getByRole("button", { name: "Type the ISBN" }).click();
  await expect(dialog.getByLabel("Type an ISBN")).toBeFocused();
});

test("classifyScan: ISBNs, add-ons, other barcodes and misreads", () => {
  expect(classifyScan("9780141439518")).toBe("isbn");
  expect(classifyScan("52499")).toBe("extension");
  expect(classifyScan("12")).toBe("extension");
  expect(classifyScan("5012345678900")).toBe("non_isbn");
  expect(classifyScan("036000291452")).toBe("non_isbn");   // a UPC-A
  expect(classifyScan("96385074")).toBe("non_isbn");      // an EAN-8
  expect(classifyScan("9780141439519")).toBe("ignore");   // a wrong check digit is a misread
  expect(classifyScan("1234567")).toBe("ignore");
  expect(classifyScan(undefined)).toBe("ignore");
});

test("the zxing reader is set to try hard, allow the EAN add-ons and read EAN, UPC and nothing else", async () => {
  let hints = null;
  class Reader { constructor(given) { hints = given; } async decodeFromVideoElement(_video, callback) { callback({ getText: () => "52499" }); callback({ getText: () => EMMA }); return { stop() {} }; } }
  const load = async () => ({ BrowserMultiFormatReader: Reader, BarcodeFormat: { EAN_13: "e13", EAN_8: "e8", UPC_A: "ua", UPC_E: "ue" }, DecodeHintType: { POSSIBLE_FORMATS: "formats", TRY_HARDER: "hard", ALLOWED_EAN_EXTENSIONS: "ext" } });
  const codes = [];
  await startDecoder({ readyState: 4 }, code => codes.push(code), { env: {}, load });
  expect(Object.fromEntries(hints)).toEqual({ formats: ["e13", "e8", "ua", "ue"], hard: true, ext: [2, 5] });
  expect(codes).toEqual([EMMA]);
});

test("the built-in detector is given the EAN and UPC formats it supports, and drops 5-digit and 2-digit results", async () => {
  const seen = [];
  class Detector {
    static async getSupportedFormats() { return ["ean_13", "upc_a", "qr_code"]; }
    constructor(options) { seen.push(options.formats); }
    async detect() { return [{ rawValue: "52499" }, { rawValue: "12" }, { rawValue: EMMA }]; }
  }
  const codes = [];
  const stop = await startDecoder({ readyState: 4 }, code => codes.push(code), { env: { BarcodeDetector: Detector } });
  await new Promise(done => setTimeout(done, 50));
  stop();
  expect(seen[0]).toEqual(["ean_13", "upc_a"]);
  expect(new Set(codes)).toEqual(new Set([EMMA]));
});
