import { deflateSync } from "node:zlib";
import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Signed-out browser fixtures only. Covers are generated PNGs of chosen proportions, served with a cache header so a return
// visit takes the browser-cache path. Shapes 0.59 to 0.75 fill the 2:3 frame; 0.56 and 1.0 are shown whole (bv-cover--free).
const SHAPES = [[280, 500], [295, 500], [335, 500], [375, 500], [500, 500]];
const bookOf = (id, extra = {}) => ({ id, title: `Book ${id}`, subtitle: null, authors: [{ id: 7, name: "Ursula Le Guin" }], tags: [], cover_image_url: null, page_count: 200, published_year: 1970, english_title: null, description: "A story.", ...extra });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii"); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0); return Buffer.concat([head, data, tail]); };
function png(width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) row.set([0xc9, 0x50, 0x3c], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [], items: SHAPES.map(([w, h], index) => bookOf(index + 1, { title: `Cover ${w}x${h}`, cover_image_url: `/test-cover/${w}x${h}.png` })) };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      const shape = /^\/test-cover\/(\d+)x(\d+)\.png$/.exec(url.pathname);
      if (shape) return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "public, max-age=3600" }, body: png(Number(shape[1]), Number(shape[2])) });
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(401, { detail: "Not signed in" });
      if (path === "/books") return reply(200, { items: state.items, total: state.items.length, page: 1, size: 20 });
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) { const book = state.items.find(item => item.id === Number(one[1])); return book ? reply(200, book) : reply(404, { detail: "Not found" }); }
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const card = (page, title) => page.locator("article.bv-book-card").filter({ has: page.getByRole("heading", { name: title }) });
const coverClasses = async page => {
  const result = {};
  for (const [w, h] of SHAPES) {
    const frame = card(page, `Cover ${w}x${h}`).locator(".bv-cover");
    await expect(frame).toHaveClass(/bv-cover--ready/);
    result[`${w}x${h}`] = (await frame.getAttribute("class")).split(/\s+/).filter(name => name !== "bv-cover--loading").sort().join(" ");
  }
  return result;
};

test("covers from 0.58 to 0.76 fill the frame, anything else is shown whole, and a return visit keeps each cover as it was", async ({ page, app }) => {
  await page.goto("/browse");
  for (const [w, h] of [[295, 500], [335, 500], [375, 500]]) await expect(card(page, `Cover ${w}x${h}`).locator(".bv-cover")).not.toHaveClass(/bv-cover--free/);
  for (const [w, h] of [[280, 500], [500, 500]]) await expect(card(page, `Cover ${w}x${h}`).locator(".bv-cover")).toHaveClass(/bv-cover--free/);
  const first = await coverClasses(page);
  // The crop inside the frame is split evenly (top and bottom), not kept to the top.
  await expect(card(page, "Cover 335x500").locator(".bv-cover img")).toHaveCSS("object-position", "50% 50%");

  await page.getByRole("link", { name: "View Cover 335x500" }).click();
  await expect(page).toHaveURL(/\/book\/3$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/browse/);
  expect(await coverClasses(page)).toEqual(first);
  expect(app.errors).toEqual([]);
});

test("each author's name shows once on a card", async ({ page, app }) => {
  app.items = [
    bookOf(1, { title: "Ulysses", authors: ["James Joyce", "James Joyce", "James Joyce", "james joyce", "J Joyce"].map(name => ({ name })) }),
    bookOf(2, { title: "Bleak House", authors: [{ name: "Charles Dickens" }, { name: "Charles Dickens" }] }),
    bookOf(3, { title: "Good Omens", authors: [{ name: "Terry Pratchett" }, { name: "Neil Gaiman" }] }),
  ];
  await page.goto("/browse");
  await expect(card(page, "Ulysses").locator(".bv-author")).toHaveText("James Joyce");
  await expect(card(page, "Bleak House").locator(".bv-author")).toHaveText("Charles Dickens");
  await expect(card(page, "Good Omens").locator(".bv-author")).toHaveText("Terry Pratchett, Neil Gaiman");
});
