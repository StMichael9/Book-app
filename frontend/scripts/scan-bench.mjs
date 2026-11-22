// The scan benchmark: runs the built-in reader's pipeline (the same code the phone's worker runs) over tests/fixtures/barcodes and reports
// the read rate, overall and by kind. `compareOld` also runs the engine this replaced (zxing-js, EAN-13 only, no clean-up) over the same
// frames. Nothing here touches the network: the WebAssembly is read from node_modules.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeFrame } from "../src/components/reading/scan/wasmPipeline.js";

const DIR = new URL("../tests/fixtures/barcodes/", import.meta.url);
export const manifest = () => JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8")).frames;

// JPEG to RGBA, with the browser's own decoder.
async function loadFrames(frames) {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage();
  const out = [];
  for (const frame of frames) {
    const b64 = readFileSync(new URL(frame.file, DIR)).toString("base64");
    const pixels = await page.evaluate(async b64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let s = ""; for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
      return { b64: btoa(s), width, height };
    }, b64);
    out.push({ ...frame, data: new Uint8ClampedArray(Buffer.from(pixels.b64, "base64")), width: pixels.width, height: pixels.height });
  }
  await browser.close();
  return out;
}

async function wasmReader() {
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  const wasm = fileURLToPath(new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url));
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasm) } });
  return readBarcodes;
}

// The previous engine: zxing-js, EAN-13 only, on the whole grey frame, one try.
async function oldDecode(frame) {
  const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = await import("@zxing/library");
  const grey = new Uint8ClampedArray(frame.width * frame.height);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) grey[i] = (frame.data[p] * 77 + frame.data[p + 1] * 151 + frame.data[p + 2] * 28) >> 8;
  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]]]));
  try { return [reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(grey, frame.width, frame.height)))).getText()]; } catch { return []; }
}

const rateOf = (rows, key) => { const by = {}; for (const row of rows) { by[row.kind] ??= [0, 0]; by[row.kind][1] += 1; if (row[key]) by[row.kind][0] += 1; } return by; };

export async function runBenchmark({ compareOld = false } = {}) {
  const frames = await loadFrames(manifest()), read = await wasmReader();
  const makeImage = (data, width, height) => ({ data, width, height, colorSpace: "srgb" });
  const rows = [];
  for (const frame of frames) {
    // A live camera gives many frames: two consecutive ones (the plain and the sharpened-inverted variant) are tried.
    let hit = false;
    for (const number of [0, 1]) if (!hit) hit = (await decodeFrame(read, frame, number, makeImage)).some(text => text.replace(/^0+/, "") === frame.expected.replace(/^0+/, ""));
    const row = { kind: frame.kind, file: frame.file, expected: frame.expected, wasm: hit };
    if (compareOld) row.old = (await oldDecode(frame)).some(text => text.replace(/^0+/, "") === frame.expected.replace(/^0+/, ""));
    rows.push(row);
  }
  const total = rows.length, wasm = rows.filter(row => row.wasm).length, old = compareOld ? rows.filter(row => row.old).length : null;
  return { total, wasm, wasmRate: wasm / total, old, oldRate: old == null ? null : old / total, byKind: rateOf(rows, "wasm"), byKindOld: compareOld ? rateOf(rows, "old") : null, misses: rows.filter(row => !row.wasm).map(row => row.file) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runBenchmark({ compareOld: true }), null, 1));
