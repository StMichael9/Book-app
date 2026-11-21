import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Browser fixtures only: covers are served as SVGs of chosen proportions; the catalogue and the author endpoints (GET /authors/{id}, /authors/{id}/books) are mocked from the contract.
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
      if (one) return reply(200, { ...LEGUIN[Number(one[1]) - 1], tags: [] });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      const author = path.match(/^\/authors\/(\d+)$/);
      if (author) return AUTHORS[author[1]] ? reply(200, { ...AUTHORS[author[1]], bio: "Ignored bio.", photo_url: "https://covers.openlibrary.org/a/id/1-M.jpg" }) : reply(404, { detail: "Not found" });
      const books = path.match(/^\/authors\/(\d+)\/books$/);
      if (books) {
        if (state.booksStatus !== 200) return reply(state.booksStatus, { detail: "Try again" });
        const id = books[1], page = Number(url.searchParams.get("page") || 1);
        if (!AUTHORS[id]) return reply(404, { detail: "Not found" });
        const all = id === "7" ? LEGUIN : id === "9" ? [bookOf(31, [{ id: 9, name: "Solo Writer" }])] : [];
        const items = all.slice((page - 1) * 24, page * 24).map(item => state.authenticated && state.wanted.has(item.id) ? { ...item, shelf: { entry_id: 500 + item.id, status: "want", is_owned: false, is_wanted: true } } : item);
        return reply(200, { items, total: all.length, page, size: 24, pages: Math.max(1, Math.ceil(all.length / 24)) });
      }
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const grid = page => page.locator(".bv-book-grid");
const svg = (w, h, color = "#c9503c") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`;
const cover = (w, h) => `/test-cover/${w}x${h}.svg`;
const withCovers = async (page, shapes, delay = 0) => {
  await page.route("**/test-cover/*", async route => { const [, w, h] = /(\d+)x(\d+)\.svg/.exec(route.request().url()); if (delay) await new Promise(done => setTimeout(done, delay)); return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(Number(w), Number(h)) }); });
  return shapes.map(([w, h], index) => ({ ...bookOf(index + 1), title: `Cover ${w}x${h}`, cover_image_url: cover(w, h) }));
};
const boxes = async frame => { const image = frame.locator("img"); return { f: await frame.boundingBox(), i: await image.boundingBox() }; };
const transparent = value => value === "rgba(0, 0, 0, 0)" || value === "transparent";

test("Browse at 1440 dark: every loaded cover has a transparent frame, whether its image fills it or stands alone", async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("bookvane-theme", "dark"));
  await page.setViewportSize({ width: 1440, height: 900 });
  app.browseItems = await withCovers(page, [[300, 450], [320, 470], [400, 400], [600, 400], [200, 500], [310, 440]]);
  await page.goto("/browse");
  await expect(page.locator(".bv-cover--ready")).toHaveCount(6);
  for (const frame of await page.locator(".bv-cover--ready").all()) {
    const { f, i } = await boxes(frame);
    const bg = await frame.evaluate(node => getComputedStyle(node).backgroundColor);
    const fills = Math.abs(f.width - i.width) <= 1 && Math.abs(f.height - i.height) <= 1;
    expect(transparent(bg) || fills).toBe(true);
    expect(transparent(bg)).toBe(true);                                      // once loaded, never the soft fill
  }
});

test("a near-2:3 cover fills its frame with object-fit: cover; an off-ratio one is whole, frameless, with its own radius and shadow, bottom-aligned", async ({ page, app }) => {
  app.browseItems = await withCovers(page, [[320, 470], [400, 400], [600, 400]]);
  await page.goto("/browse");
  const frames = page.locator(".bv-book-card .bv-cover--ready");
  await expect(frames).toHaveCount(3);
  const near = frames.nth(0);
  await expect(near).not.toHaveClass(/bv-cover--free/);
  await expect(near.locator("img")).toHaveCSS("object-fit", "cover");
  const n = await boxes(near);
  expect(Math.abs(n.f.width - n.i.width)).toBeLessThanOrEqual(1); expect(Math.abs(n.f.height - n.i.height)).toBeLessThanOrEqual(1);
  for (const index of [1, 2]) {
    const free = frames.nth(index), image = free.locator("img");
    await expect(free).toHaveClass(/bv-cover--free/);
    const style = await free.evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.boxShadow, s.borderRadius]; });
    expect(transparent(style[0])).toBe(true); expect(style[1]).toBe("none"); expect(style[2]).toBe("0px");
    const picture = await image.evaluate(node => { const s = getComputedStyle(node); return [s.boxShadow, s.borderRadius, s.objectPosition, s.objectFit]; });
    expect(picture[0]).not.toBe("none"); expect(picture[1]).toBe("4px"); expect(picture[2]).toBe("50% 100%"); expect(picture[3]).toBe("contain");
    const { f, i } = await boxes(free);
    expect(Math.abs((f.y + f.height) - (i.y + i.height))).toBeLessThanOrEqual(1);   // bottom-aligned: a row keeps one baseline
    expect(i.width).toBeLessThanOrEqual(f.width + 1); expect(i.height).toBeLessThanOrEqual(f.height + 1);
  }
  const bottoms = await frames.evaluateAll(nodes => nodes.map(node => Math.round(node.querySelector("img").getBoundingClientRect().bottom)));
  expect(new Set(bottoms).size).toBe(1);
});

test("only artwork within about 7% of 2:3 is cropped to fill, and the crop keeps the top of the cover (the title)", async ({ page, app }) => {
  // 300x500 (0.60) and 360x480 (0.75) used to be cropped by up to 13%; they are now shown whole.
  app.browseItems = await withCovers(page, [[300, 450], [300, 500], [360, 480], [310, 440]]);
  await page.goto("/browse");
  const frames = page.locator(".bv-book-card .bv-cover--ready");
  await expect(frames).toHaveCount(4);
  for (const index of [0, 3]) {
    await expect(frames.nth(index)).not.toHaveClass(/bv-cover--free/);
    await expect(frames.nth(index).locator("img")).toHaveCSS("object-position", "50% 0%");
  }
  for (const index of [1, 2]) await expect(frames.nth(index)).toHaveClass(/bv-cover--free/);
});

test("while an image is loading the frame is an outline only, and a book with no cover keeps its jacket", async ({ page, app }) => {
  app.browseItems = [...await withCovers(page, [[300, 450]], 6000), { ...bookOf(2), title: "No cover", cover_image_url: null }];
  await page.goto("/browse");
  const loading = grid(page).locator(".bv-cover--loading").first();
  await expect(loading).toBeVisible();
  expect(transparent(await loading.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(true);   // no grey fill: an outline only
  expect(await loading.evaluate(node => getComputedStyle(node).boxShadow)).toMatch(/inset/);
  const none = grid(page).locator(".bv-book-card").filter({ hasText: "No cover" }).locator(".bv-cover");
  await expect(none.locator(".bv-cover-fallback")).toHaveCount(1);
  expect(transparent(await none.locator(".bv-cover-fallback").evaluate(node => getComputedStyle(node).backgroundColor))).toBe(false);   // the jacket brings its own colours
  await expect(none).not.toHaveClass(/bv-cover--ready|bv-cover--free/);
  await expect(page.locator(".bv-cover--ready")).toHaveCount(1, { timeout: 12000 });   // the image is held for 6s so the loading checks above never race it
  await expect(page.locator(".bv-cover--ready")).not.toHaveClass(/bv-cover--loading/);
});

for (const theme of ["light", "dark"]) test(`covers have no brown edge on a phone either: ${theme}`, async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.setViewportSize({ width: 390, height: 844 });
  app.browseItems = await withCovers(page, [[320, 470], [450, 450], [300, 450], [600, 400]]);
  await page.goto("/browse");
  await expect(page.locator(".bv-cover--ready")).toHaveCount(4);
  for (const frame of await page.locator(".bv-cover--ready").all()) expect(transparent(await frame.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
