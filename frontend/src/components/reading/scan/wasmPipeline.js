// The built-in reader's pipeline, free of the browser: clean a frame, ask ZXing-C++ (WebAssembly) for barcodes, keep the good ones.
// The worker, the benchmark and the tests all call this, so what is measured is what runs on the phone.
import { cleanFrame } from "./frameClean.js";

// EAN-13 for ISBNs; EAN-8 and UPC only so another barcode can be told apart from an ISBN. The add-on is ignored: only the main code counts.
export const READ_OPTIONS = { formats: ["EAN-13", "EAN-8", "UPC-A", "UPC-E"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, eanAddOnSymbol: "Ignore", maxNumberOfSymbols: 2 };

// `read(image, options)` is zxing-wasm's readBarcodes. The image is cleaned first; a frame number picks the variant (even or odd).
export async function decodeFrame(read, { data, width, height }, frameNumber, makeImage = (pixels, w, h) => new ImageData(pixels, w, h)) {
  const image = makeImage(cleanFrame(data, width, height, frameNumber), width, height);
  const results = await read(image, READ_OPTIONS);
  return results.filter(result => result.isValid !== false && typeof result.text === "string" && result.text).map(result => result.text);
}
