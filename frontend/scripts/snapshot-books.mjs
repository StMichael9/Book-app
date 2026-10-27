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

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: SOURCE, total: payload.total, items }, null, 2) + "\n");
console.log(`Wrote ${items.length} of ${payload.total} books (ids ${Math.min(...items.map(book => book.id))}-${Math.max(...items.map(book => book.id))}) to src/data/book-snapshot.json`);
