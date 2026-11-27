// The built-in reader, off the main thread so a slow phone's page never stutters while it decodes. Frames come in as pixels and
// go nowhere else: this worker has no network code. The WebAssembly file is a build asset served from this site, never a CDN.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { QR_READ_OPTIONS, decodeFrame } from "./wasmPipeline.js";

prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });

self.onmessage = async ({ data: { id, data, width, height, frame, mode } }) => {
  try { self.postMessage({ id, codes: await decodeFrame(readBarcodes, { data, width, height }, frame, undefined, mode === "qr" ? QR_READ_OPTIONS : undefined) }); } catch (failure) { self.postMessage({ id, codes: [], error: String(failure?.message || failure) }); }
};
