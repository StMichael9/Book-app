// Draws a QR code as an SVG with zxing-wasm's writer. This file and its WebAssembly are fetched only when an invite sheet opens (a dynamic import), never in the main bundle.
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import wasmUrl from "zxing-wasm/writer/zxing_writer.wasm?url";

let ready = false;
export async function qrSvg(text) {
  if (!ready) { prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } }); ready = true; }
  const { svg, error } = await writeBarcode(text, { format: "QRCode", ecLevel: "M", scale: 4, withQuietZones: true });
  if (error || !svg) throw new Error(error || "No QR code");
  return svg;
}
