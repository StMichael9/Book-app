// Builds the scan benchmark's test frames: tests/fixtures/barcodes/*.jpg plus manifest.json. They are drawn here, not photographed
// (no photos could be taken or licensed on the build machine), then degraded the way a phone camera degrades a barcode: glare, blur,
// low light, a curved spine, wear, a small print, a sideways book, a price add-on. A seeded generator keeps the set identical every run.
// Run: node scripts/make-barcode-fixtures.mjs   (needs Playwright's browser; set PLAYWRIGHT_CHANNEL=msedge if needed)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const OUT = new URL("../tests/fixtures/barcodes/", import.meta.url);
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

// [name, kind, text, drawing options]. Every ISBN here has a good check digit; the UPC-A and shop EAN are real-format codes.
const ISBNS = ["9780141439518", "9780743273565", "9780451524935", "9780061120084", "9780385333481", "9781503280786"];
const specs = [];
const add = (kind, count, make) => { for (let i = 0; i < count; i += 1) specs.push({ kind, ...make(i) }); };
add("clean", 3, i => ({ text: ISBNS[i], m: 3.4 }));
add("small", 4, i => ({ text: ISBNS[i], m: [1.7, 1.9, 2.1, 1.8][i] }));
add("blur", 3, i => ({ text: ISBNS[i], m: 3, blur: [1.2, 1.8, 2.4][i] }));
add("low_contrast", 3, i => ({ text: ISBNS[i], m: 3, ink: ["#6f6f6f", "#7a7468", "#66707a"][i], paper: ["#b6b6b6", "#b9b3a2", "#a9b3bb"][i] }));
add("low_light", 3, i => ({ text: ISBNS[i], m: 3, dark: [0.4, 0.3, 0.22][i], noise: [12, 16, 22][i] }));
add("glare", 4, i => ({ text: ISBNS[i], m: 3.2, glare: [0.25, 0.35, 0.3, 0.4][i] }));
add("sideways", 3, i => ({ text: ISBNS[i], m: 3, rotate: [90, 270, 84][i] }));
add("tilted", 4, i => ({ text: ISBNS[i], m: 3, rotate: [9, -14, 20, -22][i] }));
add("upside_down", 2, i => ({ text: ISBNS[i], m: 3, rotate: 180 }));
add("curved", 4, i => ({ text: ISBNS[i], m: 3, curve: [4, 6, 8, 10][i] }));
add("worn", 4, i => ({ text: ISBNS[i], m: 3.2, wear: [0.05, 0.08, 0.11, 0.14][i] }));
add("glossy", 4, i => ({ text: ISBNS[i], m: 2.6, glare: 0.28, blur: [0.8, 1.2, 1.5, 1.8][i], ink: "#555", paper: "#c4c0b4", curve: 3 }));
add("add_on", 5, i => ({ text: ISBNS[i], m: 3, addon: ["52499", "51995", "53995", "50000", "54995"][i] }));
add("upc_a", 3, i => ({ text: ["036000291452", "012345678905", "042100005264"][i], m: 3.4, upc: true }));
add("shop_ean", 2, i => ({ text: ["5012345678900", "4006381333931"][i], m: 3.4 }));
const IS_ISBN = text => /^97[89]\d{10}$/.test(text);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const manifest = [];
let n = 0;
for (const spec of specs) {
  n += 1;
  const name = `${String(n).padStart(2, "0")}-${spec.kind}.jpg`;
  const dataUrl = await page.evaluate(({ spec, seed }) => {
    let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
    const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
    const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    const ADD = ["GGLLL", "GLGLL", "GLLGL", "GLLLG", "LGGLL", "LLGGL", "LLLGG", "LGLGL", "LGLLG", "LLGLG"];
    const d = [...spec.text].map(Number);
    let bits = "101";
    if (spec.upc) { for (let i = 0; i < 6; i += 1) bits += L[d[i]]; bits += "01010"; for (let i = 6; i < 12; i += 1) bits += R[d[i]]; }
    else { const par = PAR[d[0]]; for (let i = 0; i < 6; i += 1) bits += (par[i] === "L" ? L : G)[d[i + 1]]; bits += "01010"; for (let i = 7; i < 13; i += 1) bits += R[d[i]]; }
    bits += "101";
    let addBits = "";
    if (spec.addon) { const a = [...spec.addon].map(Number), par = ADD[(3 * (a[0] + a[2] + a[4]) + 9 * (a[1] + a[3])) % 10]; addBits = "01011"; a.forEach((digit, i) => { addBits += (par[i] === "L" ? L : G)[digit]; if (i < 4) addBits += "01"; }); }
    const W = 640, H = 360, canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const paper = spec.paper || "#f4efe4", ink = spec.ink || "#111";
    ctx.fillStyle = "#3b3a36"; ctx.fillRect(0, 0, W, H);                       // the cover around the label
    ctx.save(); ctx.translate(W / 2, H / 2);
    if (spec.rotate) ctx.rotate(spec.rotate * Math.PI / 180);
    const m = spec.m, quiet = 9 * m, total = bits.length * m, addW = addBits ? (8 + addBits.length) * m : 0, boxW = quiet * 2 + total + addW, boxH = 62 * m * 0.8 + 18 * m / 1.2;
    ctx.fillStyle = paper; ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    const left = -boxW / 2 + quiet, top = -boxH / 2 + 4 * m, barH = boxH - 12 * m;
    const column = (x, i, h) => { const bend = spec.curve ? Math.sin(((x + boxW / 2) / boxW) * Math.PI) * spec.curve : 0; ctx.fillRect(x * 1, top - bend, m, h); return i; };
    ctx.fillStyle = ink;
    [...bits].forEach((bit, i) => { if (bit === "1") column(left + i * m, i, barH); });
    if (addBits) [...addBits].forEach((bit, i) => { if (bit === "1") column(left + total + 8 * m + i * m, i, barH * 0.85); });
    ctx.font = `${Math.round(5.5 * m)}px monospace`; ctx.textBaseline = "top"; ctx.fillText(spec.text.split("").join(" "), left, top + barH + m);
    if (spec.wear) { ctx.fillStyle = paper; for (let k = 0; k < spec.wear * 900; k += 1) { const x = left + rnd() * total, y = top + rnd() * barH; ctx.globalAlpha = 0.5 + rnd() * 0.5; ctx.fillRect(x, y, m * (0.3 + rnd() * 0.6), m * (1 + rnd() * 7)); } ctx.globalAlpha = 1; }
    ctx.restore();
    if (spec.glare) { const g = ctx.createRadialGradient(W * (0.3 + rnd() * 0.4), H * 0.5, 2, W * (0.3 + rnd() * 0.4), H * 0.5, W * spec.glare * 0.4); g.addColorStop(0, "rgba(255,255,255,0.97)"); g.addColorStop(0.6, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (spec.blur) { const copy = document.createElement("canvas"); copy.width = W; copy.height = H; copy.getContext("2d").drawImage(canvas, 0, 0); ctx.filter = `blur(${spec.blur}px)`; ctx.drawImage(copy, 0, 0); ctx.filter = "none"; }
    if (spec.dark) { ctx.fillStyle = `rgba(0,0,0,${1 - spec.dark})`; ctx.fillRect(0, 0, W, H); }
    const noise = spec.noise ?? 3, image = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < image.data.length; i += 4) { const v = (rnd() - 0.5) * 2 * noise; image.data[i] += v; image.data[i + 1] += v; image.data[i + 2] += v; }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.82);
  }, { spec, seed: 1000 + n });
  writeFileSync(new URL(name, OUT), Buffer.from(dataUrl.split(",")[1], "base64"));
  manifest.push({ file: name, kind: spec.kind, expected: spec.text, isbn: IS_ISBN(spec.text), addon: spec.addon || null });
}
writeFileSync(new URL("manifest.json", OUT), JSON.stringify({ note: "Drawn and degraded by scripts/make-barcode-fixtures.mjs (seeded), not photographed.", frames: manifest }, null, 1) + "\n");
await browser.close();
console.log("wrote", manifest.length, "frames");
