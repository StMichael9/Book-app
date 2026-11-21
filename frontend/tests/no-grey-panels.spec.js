import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Browser fixtures only: covers are SVGs served by the test; the catalogue and the author endpoints (GET /authors/{id}, /authors/{id}/books) are mocked from the contract.
// Author 7 has 30 books (two pages: 24 and 6), author 8 has none, author 9 has one, and any other id is a 404.
const AUTHORS = { 7: { id: 7, name: "Ursula Le Guin", book_count: 30 }, 8: { id: 8, name: "Nobody Yet", book_count: 0 }, 9: { id: 9, name: "Solo Writer", book_count: 1 } };
const bookOf = (id, authors = [{ id: 7, name: "Ursula Le Guin" }]) => ({ id, title: `Le Guin book ${id}`, subtitle: null, authors, tags: [], cover_image_url: null, page_count: 200, published_year: 1970, english_title: null, description: "A story." });
const LEGUIN = Array.from({ length: 30 }, (_, index) => bookOf(index + 1));

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], authenticated: false, wanted: new Set([2, 3]), booksStatus: 200, browseItems: null };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path, method, query: url.searchParams, body });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, state.authenticated ? {} : { detail: "Not signed in" });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return state.authenticated ? reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } }) : reply(404, { detail: "Not found" });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: state.wanted.has(id) ? 500 + id : null, is_owned: false, is_wanted: state.wanted.has(id), version: state.wanted.has(id) ? 1 : null })) });
      if (path === "/books") { const items = state.browseItems || LEGUIN.slice(0, 20); return reply(200, { items, total: items.length, page: 1, size: 20 }); }
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return reply(200, { ...(state.coverBooks || LEGUIN)[Number(one[1]) - 1], tags: [] });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      const author = path.match(/^\/authors\/(\d+)$/);
      if (author) return AUTHORS[author[1]] ? reply(200, { ...AUTHORS[author[1]], bio: "Ignored bio.", photo_url: "https://covers.openlibrary.org/a/id/1-M.jpg" }) : reply(404, { detail: "Not found" });
      const books = path.match(/^\/authors\/(\d+)\/books$/);
      if (books) {
        if (state.booksStatus !== 200) return reply(state.booksStatus, { detail: "Try again" });
        const id = books[1], page = Number(url.searchParams.get("page") || 1);
        if (!AUTHORS[id]) return reply(404, { detail: "Not found" });
        const all = id === "7" ? (state.coverBooks || LEGUIN) : id === "9" ? [bookOf(31, [{ id: 9, name: "Solo Writer" }])] : [];
        const items = all.slice((page - 1) * 24, page * 24).map(item => state.authenticated && state.wanted.has(item.id) ? { ...item, shelf: { entry_id: 500 + item.id, status: "want", is_owned: false, is_wanted: true } } : item);
        return reply(200, { items, total: all.length, page, size: 24, pages: Math.max(1, Math.ceil(all.length / 24)) });
      }
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

import { greyBehindCovers } from "./support/cover-bg.js";

const svg = (w, h, color = "#c9503c") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`;
const withCovers = async (page, shapes, delay = 0) => {
  await page.route("**/test-cover/*", async route => { const [, w, h] = /(\d+)x(\d+)\.svg/.exec(route.request().url()); if (delay) await new Promise(done => setTimeout(done, delay)); return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(Number(w), Number(h)) }); });
  return shapes.map(([w, h], index) => ({ ...bookOf(index + 1), title: `Cover ${w}x${h}`, cover_image_url: `/test-cover/${w}x${h}.svg` }));
};
const theme = async (page, name) => { await page.emulateMedia({ colorScheme: name }); await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), name); };

for (const name of ["light", "dark"]) {
  test(`Browse, the book page and the author page have no panel behind a cover, loaded or still loading; ${name}`, async ({ page, app }) => {
    await theme(page, name);
    await page.setViewportSize({ width: 1440, height: 900 });
    const loaded = await withCovers(page, [[300, 450], [450, 450], [600, 400], [320, 470]]);
    app.browseItems = loaded;
    app.coverBooks = loaded;
    await page.goto("/browse");
    await expect(page.locator(".bv-cover--ready")).toHaveCount(4);
    expect(await greyBehindCovers(page)).toEqual([]);
    await page.goto("/author/7");
    await expect(page.locator(".bv-cover--ready").first()).toBeVisible();
    expect(await greyBehindCovers(page)).toEqual([]);
    await page.goto("/book/1");
    await expect(page.locator(".bv-detail-art .bv-cover--ready")).toHaveCount(1);
    expect(await greyBehindCovers(page)).toEqual([]);
  });

  test(`while covers load, Browse and the book page show outlines only: no fill, no panel; ${name}`, async ({ page, app }) => {
    await theme(page, name);
    await page.setViewportSize({ width: 1440, height: 900 });
    const slow = await withCovers(page, [[300, 450], [450, 450]], 4000);
    app.browseItems = slow;
    app.coverBooks = slow;
    await page.goto("/browse");
    await expect(page.locator(".bv-cover--loading")).toHaveCount(2);
    expect(await greyBehindCovers(page)).toEqual([]);
    const outline = await page.locator(".bv-cover--loading").first().evaluate(node => getComputedStyle(node).boxShadow);
    expect(outline).toMatch(/inset/);
    await page.goto("/book/1");
    await expect(page.locator(".bv-detail-art .bv-cover--loading")).toHaveCount(1);
    expect(await greyBehindCovers(page)).toEqual([]);
  });

  test(`skeletons: cover-shaped ones are outline only and text bars use the line colour; ${name}`, async ({ page, app }) => {
    await theme(page, name);
    await page.route(/\/test-api\/books\/1(\?.*)?$/, () => new Promise(() => {}));   // the book never answers, so its page stays on its skeletons
    void app;
    await page.goto("/book/1");
    await expect(page.locator(".bv-skeleton--cover").first()).toBeVisible();
    const cover = await page.locator(".bv-skeleton--cover").first().evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.boxShadow]; });
    expect(cover[0]).toBe("rgba(0, 0, 0, 0)"); expect(cover[1]).toMatch(/inset/);
    const bar = await page.locator(".bv-skeleton--title").first().evaluate(node => getComputedStyle(node).backgroundColor);
    const line = await page.evaluate(() => { const probe = document.createElement("span"); probe.style.color = "var(--bv-line)"; document.querySelector(".bv-root").append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    expect(bar).toBe(line);
  });
}

test("the book page cover has no padded panel: the picture is the frame, the frame is transparent, the text column has not moved", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const books = await withCovers(page, [[320, 470]]);
  app.browseItems = books; app.coverBooks = books;
  await page.goto("/book/1");
  const art = page.locator(".bv-detail-art");
  await expect(art.locator(".bv-cover--ready")).toHaveCount(1);
  const frame = await art.locator(".bv-cover").boundingBox(), image = await art.locator("img").boundingBox(), panel = await art.boundingBox(), body = await page.locator(".bv-detail-body").boundingBox();
  expect(Math.abs(frame.width - image.width)).toBeLessThanOrEqual(1); expect(Math.abs(frame.height - image.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.x - panel.x)).toBeLessThanOrEqual(1);              // no padding: the cover is the left edge of its column
  expect(frame.width).toBeLessThanOrEqual(320.5); expect(frame.width).toBeGreaterThan(300);
  expect(Math.abs(frame.y - (panel.y + 14))).toBeLessThanOrEqual(1);
  expect(await art.evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.paddingLeft, s.borderTopLeftRadius]; })).toEqual(["rgba(0, 0, 0, 0)", "0px", "0px"]);
  expect(Math.abs(body.x - (panel.x + 330 + 64))).toBeLessThanOrEqual(2);   // the grid column and gap are unchanged
});

for (const name of ["light", "dark"]) test(`the book page at 390, 320 and 200% text keeps its cover on the page with no sideways scroll; ${name}`, async ({ page, app }) => {
  await theme(page, name);
  const books = await withCovers(page, [[320, 470]]);
  app.browseItems = books; app.coverBooks = books;
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/book/1");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.locator(".bv-detail-art .bv-cover--ready")).toHaveCount(1);
    const frame = await page.locator(".bv-detail-art .bv-cover").boundingBox();
    expect(Math.abs(frame.width - 158)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await greyBehindCovers(page)).toEqual([]);
  }
});
