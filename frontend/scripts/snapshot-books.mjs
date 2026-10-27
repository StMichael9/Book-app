// Writes src/data/book-snapshot.json from the public production catalogue (one anonymous, read-only GET).
// Run by hand when the first impression should change: npm run snapshot:books. Builds never call this.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE = "https://api.bookvane.me/books?size=30";
const OUTPUT = fileURLToPath(new URL("../src/data/book-snapshot.json", import.meta.url));

const isId = value => Number.isSafeInteger(value) && value > 0;
const text = value => (typeof value === "string" ? value : null);
const count = value => (Number.isSafeInteger(value) ? value : null);

function pick(book) {
  if (!book || !isId(book.id) || typeof book.title !== "string" || !book.title.trim()) return null;
  return {
    id: book.id,
    title: book.title,
    subtitle: text(book.subtitle),
    authors: (Array.isArray(book.authors) ? book.authors : [])
      .filter(author => author && isId(author.id) && typeof author.name === "string")
      .map(author => ({ id: author.id, name: author.name })),
    cover_image_url: text(book.cover_image_url),
    published_year: count(book.published_year),
    page_count: count(book.page_count),
    english_title: text(book.english_title),
  };
}

const response = await fetch(SOURCE, { headers: { Accept: "application/json", "User-Agent": "bookvane-snapshot-script" } });
if (!response.ok) throw new Error(`Snapshot source answered ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload?.items) || !Number.isSafeInteger(payload.total)) throw new Error("Unexpected catalogue response");

const items = payload.items.map(pick).filter(Boolean).slice(0, 30);
if (!items.length) throw new Error("The catalogue returned no usable books");

// Self-host the covers: one download each, resized to about twice the card width and re-encoded as small webp,
// so the first paint never waits on a third party. A cover that cannot be fetched keeps its remote URL.
const COVER_DIR = new URL("../public/covers/snapshot/", import.meta.url);
const COVER_WIDTH = 320, COVER_BYTES = 25 * 1024;
await mkdir(COVER_DIR, { recursive: true });
const { chromium } = await import("@playwright/test"); // the encoder is the browser Playwright already uses; no extra dependency
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage();
let hosted = 0;
try {
  for (const book of items) {
    if (!book.cover_image_url?.startsWith("https://")) continue;
    const download = await fetch(`${book.cover_image_url}?default=false`, { headers: { "User-Agent": "bookvane-snapshot-script" } }).catch(() => null);
    if (!download?.ok) { console.warn(`Cover for ${book.id} kept as a remote URL (${download?.status ?? "no answer"})`); continue; }
    const base64 = Buffer.from(await download.arrayBuffer()).toString("base64");
    const webp = await page.evaluate(async ({ base64, width, limit }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:application/octet-stream;base64,${base64}`)).blob());
      const scale = Math.min(1, width / bitmap.width);
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let out;
      for (const quality of [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34]) {
        out = await canvas.convertToBlob({ type: "image/webp", quality });
        if (out.size <= limit) break;
      }
      const bytes = new Uint8Array(await out.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }, { base64, width: COVER_WIDTH, limit: COVER_BYTES });
    await writeFile(new URL(`${book.id}.webp`, COVER_DIR), Buffer.from(webp, "base64"));
    book.cover_image_url = `/covers/snapshot/${book.id}.webp`;
    hosted += 1;
  }
} finally {
  await browser.close();
}
console.log(`Self-hosted ${hosted} of ${items.length} covers under public/covers/snapshot`);

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: SOURCE, total: payload.total, items }, null, 2) + "\n");
console.log(`Wrote ${items.length} of ${payload.total} books (ids ${Math.min(...items.map(book => book.id))}-${Math.max(...items.map(book => book.id))}) to src/data/book-snapshot.json`);
