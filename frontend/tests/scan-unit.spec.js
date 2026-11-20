import { test, expect } from "@playwright/test";
import { acceptScan, canDetectEan13, createRepeatGuard, isbn13Valid, startDecoder, typedIsbn } from "../src/components/reading/scan/decoder.js";
import { isSaveable, rowFromAnswer } from "../src/components/reading/scan/scanList.js";

// Pure logic of the scan sheet: which codes are accepted, how typed ISBNs are read, the repeat window and what a lookup answer means for a row.
test("only 978 and 979 codes with a good check digit are accepted", () => {
  expect(acceptScan("9780141439518")).toBe(true);
  expect(acceptScan("9780141439519")).toBe(false);            // wrong check digit
  expect(acceptScan("5012345678900")).toBe(false);            // a shop code, not an ISBN
  expect(acceptScan("978014143951")).toBe(false);             // too short
  expect(acceptScan("97801414395180")).toBe(false);           // too long
  expect(acceptScan("978014143951X")).toBe(false);
  expect(acceptScan(undefined)).toBe(false);
  expect(acceptScan("9790000000001")).toBe(true);           // 979 is an ISBN prefix too
  expect(isbn13Valid("5012345678900")).toBe(true);            // a good EAN-13 is not enough on its own
});

test("typed ISBNs: hyphens and spaces are ignored and an ISBN-10 becomes an ISBN-13", () => {
  expect(typedIsbn("978-0-14-143951-8")).toBe("9780141439518");
  expect(typedIsbn(" 9780141439518 ")).toBe("9780141439518");
  expect(typedIsbn("0-14-143951-3")).toBe("9780141439518");
  expect(typedIsbn("080442957X")).toBe("9780804429573");
  expect(typedIsbn("0141439519")).toBeNull();
  expect(typedIsbn("9780141439519")).toBeNull();
  expect(typedIsbn("hello")).toBeNull();
  expect(typedIsbn("")).toBeNull();
});

test("the same ISBN is ignored for three seconds, then counts again; another ISBN is never held back", () => {
  let clock = 1000;
  const guard = createRepeatGuard(3000, () => clock);
  expect(guard("9780141439518")).toBe(true);
  clock += 2999; expect(guard("9780141439518")).toBe(false);
  expect(guard("9780743273565")).toBe(true);
  clock += 1; expect(guard("9780141439518")).toBe(true);      // three seconds after the first accepted scan: the window has passed
  clock += 2999; expect(guard("9780141439518")).toBe(false);
});

test("a lookup answer becomes one of the row states", () => {
  const card = { title: "Emma", authors: ["Jane Austen"], cover_url: "https://x/c.jpg" };
  expect(rowFromAnswer({ status: "catalogue", book_id: 7, on_shelf: null, ...card })).toMatchObject({ state: "found", bookId: 7, title: "Emma" });
  expect(rowFromAnswer({ status: "catalogue", book_id: 7, on_shelf: { is_owned: true, is_wanted: false }, ...card }).state).toBe("on_shelf");
  expect(rowFromAnswer({ status: "open_library", book_id: null, on_shelf: null, ...card })).toMatchObject({ state: "found", bookId: null, title: "Emma" });
  for (const status of ["not_found", "unavailable"]) expect(rowFromAnswer({ status, book_id: null, title: null, authors: [], cover_url: null, on_shelf: null }).state).toBe("not_found");
  expect(["found", "not_found"].every(state => isSaveable({ state }))).toBe(true);
  expect(["on_shelf", "looking", "waiting", "failed"].some(state => isSaveable({ state }))).toBe(false);
});

// Which engine reads the barcodes: BarcodeDetector only where it says it reads ean_13, otherwise zxing (loaded on demand).
function stand({ formats, throws = false, hasDetector = true }) {
  const log = { detectors: 0, loads: 0, zxingStopped: 0, zxingElement: null, codes: [] };
  class Detector {
    static async getSupportedFormats() { if (throws) throw new Error("not supported"); return formats; }
    constructor() { log.detectors += 1; }
    async detect() { return [{ rawValue: "9780141439518" }]; }
  }
  class Reader {
    async decodeFromVideoElement(video, callback) { log.zxingElement = video; callback({ getText: () => "9780743273565" }); return { stop: () => { log.zxingStopped += 1; } }; }
  }
  const load = async () => { log.loads += 1; return { BrowserMultiFormatReader: Reader, BarcodeFormat: { EAN_13: "ean13" }, DecodeHintType: { POSSIBLE_FORMATS: "formats" } }; };
  return { log, env: hasDetector ? { BarcodeDetector: Detector } : {}, load, onCode: code => log.codes.push(code) };
}

test("a BarcodeDetector without ean_13 is not used: zxing is loaded instead", async () => {
  for (const options of [{ formats: ["qr_code", "code_128"] }, { formats: [], throws: true }, { formats: [], hasDetector: false }]) {
    const { log, env, load, onCode } = stand(options), video = { readyState: 4 };
    expect(await canDetectEan13(env)).toBe(false);
    const stop = await startDecoder(video, onCode, { env, load });
    expect(log.detectors).toBe(0);
    expect(log.loads).toBe(1);
    expect(log.zxingElement).toBe(video);
    expect(log.codes).toEqual(["9780743273565"]);
    stop();
    expect(log.zxingStopped).toBe(1);
  }
});

test("a BarcodeDetector that reads ean_13 is used, and zxing is never loaded", async () => {
  const { log, env, load, onCode } = stand({ formats: ["qr_code", "ean_13"] });
  expect(await canDetectEan13(env)).toBe(true);
  const stop = await startDecoder({ readyState: 4 }, onCode, { env, load });
  await new Promise(done => setTimeout(done, 400));
  stop();
  const seen = log.codes.length;
  expect(log.detectors).toBe(1);
  expect(log.loads).toBe(0);
  expect(seen).toBeGreaterThan(0);
  await new Promise(done => setTimeout(done, 400));
  expect(log.codes.length).toBe(seen);   // stopped means stopped
});
