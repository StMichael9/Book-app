import { test as base, expect } from "@playwright/test";
import { installGenres, genreId } from "./support/genres.js";

// Browser fixtures only: the book page, its books and the author endpoints (GET /authors/{id}, /authors/{id}/books) are mocked from the contract.
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
      if (path === "/me/lists") return reply(200, []);
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, state.authenticated ? {} : { detail: "Not signed in" });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return state.authenticated ? reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } }) : reply(404, { detail: "Not found" });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: state.wanted.has(id) ? 500 + id : null, is_owned: false, is_wanted: state.wanted.has(id), version: state.wanted.has(id) ? 1 : null })) });
      if (path === "/books") { const items = state.browseItems || LEGUIN.slice(0, 20); return reply(200, { items, total: items.length, page: 1, size: 20 }); }
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return reply(200, { ...(state.coverBooks || LEGUIN)[Number(one[1]) - 1], tags: [{ id: genreId("fantasy"), name: "fantasy" }] });
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

const svg = (w, h, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`;
const LONG = "Bilbo Baggins is a hobbit who enjoys a comfortable, unambitious life, rarely travelling further than his pantry or cellar. ".repeat(8);
const ARROWS = /[→←›»«]/;
const names = ["The Hobbit", "The Fellowship of the Ring", "The Two Towers", "The Return of the King", "The Silmarillion", "Unfinished Tales", "Roverandom"];
const setup = async (page, app, { signedIn = true, authors = [{ id: 7, name: "J.R.R. Tolkien" }], first = {} } = {}) => {
  app.authenticated = signedIn;
  await page.route("**/test-cover/*", route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(300, 450, "#3c7dc9") }));
  const books = names.map((title, index) => ({ ...bookOf(index + 1, index === 0 ? authors : [{ id: 7, name: "J.R.R. Tolkien" }]), title, published_year: 1937, page_count: 310, description: LONG, cover_image_url: "/test-cover/c.svg", ...(index === 0 ? first : {}) }));
  app.coverBooks = books; app.browseItems = books;
  return books;
};
const theme = async (page, name) => { await page.emulateMedia({ colorScheme: name }); await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), name); };
const moreBy = page => page.locator(".bv-more-by");
const visibleItems = page => moreBy(page).locator("li").evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).length);

test("1440: the cover has no panel, and the head, actions and About share the text column; About starts within the cover's height", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  await expect(page.locator(".bv-detail-art .bv-cover--ready")).toHaveCount(1);
  const art = await page.locator(".bv-detail-art .bv-cover").boundingBox(), image = await page.locator(".bv-detail-art img").boundingBox();
  expect(Math.abs(art.width - 300)).toBeLessThanOrEqual(1);
  expect(Math.abs(art.width - image.width)).toBeLessThanOrEqual(1);
  expect(await page.locator(".bv-detail-art").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const head = await page.locator(".bv-book-head").boundingBox(), actions = await page.locator(".bv-book-actions").boundingBox(), about = await page.locator(".bv-book-about").boundingBox();
  expect(Math.abs(head.x - actions.x)).toBeLessThanOrEqual(1); expect(Math.abs(head.x - about.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(head.x - (art.x + 300 + 64))).toBeLessThanOrEqual(2);
  expect(about.y).toBeLessThan(art.y + art.height);
  expect(head.y + head.height).toBeLessThanOrEqual(actions.y + 1); expect(actions.y + actions.height).toBeLessThanOrEqual(about.y + 1);
  const h1 = await page.locator("h1").evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  expect(h1).toBeGreaterThan(54); expect(h1).toBeLessThanOrEqual(60);
});

test("1440: Want to read, I own it and Add to list share one row; Open or start your reading sits under them with a real arrow icon and a 44px target", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  const row = [page.locator("[data-shelf=want]"), page.locator("[data-shelf=owned]"), page.getByRole("button", { name: "Add to list" })];
  const boxes = [];
  for (const item of row) { await expect(item).toBeVisible(); boxes.push(await item.boundingBox()); }
  const centres = boxes.map(box => box.y + box.height / 2);
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(6);
  expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x); expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x);
  expect(boxes[0].width).toBeLessThan(260);                                // content width, not stretched
  const addStyle = await page.getByRole("button", { name: "Add to list" }).evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.textDecorationLine]; });
  expect(addStyle[0]).toBe("rgba(0, 0, 0, 0)"); expect(addStyle[1]).toBe("none");
  const open = page.getByRole("link", { name: "Open or start your reading" });
  await expect(open).toBeVisible();
  await expect(open.locator("svg")).toHaveCount(1);
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await open.boundingBox()).y).toBeGreaterThan(boxes[0].y + boxes[0].height);
  expect(await open.locator("span").evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("none");
});

test("the page has no typed arrow characters, only icons", async ({ page, app }) => {
  await setup(page, app);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/book/1");
    await expect(moreBy(page).locator("li").first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(ARROWS);
    await expect(page.locator(".bv-breadcrumb svg")).toHaveCount(1);
  }
});

test("a subtitle that only repeats the title is hidden; a real one is shown", async ({ page, app }) => {
  await setup(page, app, { first: { title: "The Color Purple", subtitle: "Color Purple" } });
  await page.goto("/book/1");
  await expect(page.getByRole("heading", { level: 1, name: "The Color Purple" })).toBeVisible();
  await expect(page.locator(".bv-book-head .bv-lead")).toHaveCount(0);
  await setup(page, app, { first: { title: "Circe", subtitle: "A Novel of Gods and Mortals" } });
  await page.goto("/book/1");
  await expect(page.locator(".bv-book-head .bv-lead")).toHaveText("A Novel of Gods and Mortals");
  await setup(page, app, { first: { title: "A Study in Scarlet", subtitle: "Study in Scarlet: The First Sherlock Holmes" } });
  await page.goto("/book/1");
  await expect(page.locator(".bv-book-head .bv-lead")).toHaveCount(0);
});

test("More by: 5 books at 1440 and 4 at 390, never the current book, titles and covers link to the book, See all goes to the author page", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  await expect(moreBy(page).getByRole("heading", { level: 2, name: "More by J.R.R. Tolkien" })).toBeVisible();
  expect(await visibleItems(page)).toBe(5);
  await expect(moreBy(page).getByRole("link", { name: "The Hobbit", exact: true })).toHaveCount(0);
  await expect(moreBy(page).getByRole("link", { name: "The Two Towers", exact: true })).toHaveAttribute("href", "/book/3");
  await expect(moreBy(page).getByRole("link", { name: /^See all/ })).toHaveAttribute("href", "/author/7");
  await expect(moreBy(page).getByRole("link", { name: /^See all/ }).locator("svg")).toHaveCount(1);
  expect(await moreBy(page).locator(".bv-more-by-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(5);
  for (const item of await moreBy(page).locator("li").all()) expect(await item.locator("button").count()).toBe(0);   // no shelf buttons in this row
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/book/1");
  await expect(moreBy(page).locator("li").first()).toBeVisible();
  expect(await visibleItems(page)).toBe(4);
  expect(await moreBy(page).locator(".bv-more-by-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  await moreBy(page).getByRole("link", { name: "The Silmarillion", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/5$/);
});

test("More by is hidden with fewer than 2 other books, with no author id, and when the books can't load", async ({ page, app }) => {
  await setup(page, app);
  await page.route(/\/test-api\/authors\/7\/books/, route => route.fulfill({ status: 200, json: { items: names.slice(0, 2).map((title, index) => ({ ...bookOf(index + 1), title })), total: 2, page: 1, size: 24, pages: 1 } }));
  await page.goto("/book/1");
  await expect(page.locator(".bv-detail")).toBeVisible();
  await expect(page.locator(".bv-description")).toBeVisible();
  await expect(moreBy(page)).toHaveCount(0);                               // only 1 other book is left
  await page.route(/\/test-api\/authors\/7\/books/, route => route.fulfill({ status: 200, json: { items: names.slice(0, 3).map((title, index) => ({ ...bookOf(index + 1), title })), total: 3, page: 1, size: 24, pages: 1 } }));
  await page.goto("/book/1");
  await expect(moreBy(page).locator("li")).toHaveCount(2);                 // 2 left is enough
  await page.route(/\/test-api\/authors\/7\/books/, route => route.fulfill({ status: 503, json: { detail: "Try again" } }));
  await page.goto("/book/1");
  await expect(page.locator(".bv-description")).toBeVisible();
  await expect(moreBy(page)).toHaveCount(0);                               // an error hides it quietly
  await setup(page, app, { authors: [{ name: "No Id Author" }] });
  await page.goto("/book/1");
  await expect(page.locator(".bv-detail-author")).toHaveText("No Id Author");
  await expect(moreBy(page)).toHaveCount(0);
});

test("while the other books load, More by shows cover skeletons in the same grid", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release; const held = new Promise(done => { release = done; });
  await page.route(/\/test-api\/authors\/7\/books/, async route => { await held; return route.fallback(); });
  await page.goto("/book/1");
  await expect(moreBy(page).locator(".bv-skeleton--cover")).toHaveCount(5);
  const before = await moreBy(page).locator(".bv-more-by-grid").boundingBox();
  release();
  await expect(moreBy(page).locator("li")).toHaveCount(5);
  const after = await moreBy(page).locator(".bv-more-by-grid").boundingBox();
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1); expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
});

for (const name of ["light", "dark"]) test(`no sideways scroll at 390, 320 and 200% text; phones put the cover beside the head, the two shelf buttons in two columns, Add to list on its own line; ${name}`, async ({ page, app }) => {
  await theme(page, name);
  await setup(page, app);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/book/1");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(moreBy(page).locator("li").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (zoom) continue;
    const art = await page.locator(".bv-detail-art .bv-cover").boundingBox(), head = await page.locator(".bv-book-head").boundingBox();
    expect(Math.abs(art.width - 120)).toBeLessThanOrEqual(1);
    expect(head.x).toBeGreaterThanOrEqual(art.x + art.width);              // beside the cover
    expect(Math.abs(head.y - art.y)).toBeLessThanOrEqual(2);
    const want = await page.locator("[data-shelf=want]").boundingBox(), own = await page.locator("[data-shelf=owned]").boundingBox(), add = await page.getByRole("button", { name: "Add to list" }).boundingBox();
    expect(Math.abs(want.y - own.y)).toBeLessThanOrEqual(1); expect(want.x + want.width).toBeLessThanOrEqual(own.x);
    expect(add.y).toBeGreaterThan(want.y + want.height - 1);
    expect(Math.abs(want.width - own.width)).toBeLessThanOrEqual(2);
  }
});

test("keyboard order: title, actions, Open, About, then More by", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  await expect(moreBy(page).locator("li").first()).toBeVisible();
  await page.locator("#bv-book-title").focus();
  const seen = [];
  for (let press = 0; press < 14; press += 1) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => { const node = document.activeElement; return node?.getAttribute("aria-label") || node?.textContent?.trim() || ""; }));
  }
  const at = pattern => seen.findIndex(text => pattern.test(text));
  const [want, own, add, open, showMore, seeAll, first] = [at(/Want to read/), at(/I own it/), at(/Add to list/), at(/Open or start/), at(/Show more/), at(/See all/), at(/View The Fellowship|The Fellowship of the Ring/)];
  expect(want).toBeGreaterThanOrEqual(0);
  expect(own).toBeGreaterThan(want); expect(add).toBeGreaterThan(own); expect(open).toBeGreaterThan(add);
  expect(showMore).toBeGreaterThan(open); expect(seeAll).toBeGreaterThan(showMore); expect(first).toBeGreaterThan(seeAll);
});

test("the Open link's arrow moves 2px on hover, and not at all with reduced motion", async ({ page, app }) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book/1");
  const open = page.getByRole("link", { name: "Open or start your reading" });
  const shift = async () => { await open.hover(); await page.waitForTimeout(300); return open.locator("svg").evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41); };
  expect(await open.locator("svg").evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)).toBe(0);
  expect(await shift()).toBe(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  expect(await shift()).toBe(0);
});

test("the Open link goes to start or open the reading, and shows only when reading actions exist", async ({ page, app }) => {
  await setup(page, app);
  await page.goto("/book/1");
  await expect(page.getByRole("link", { name: "Open or start your reading" })).toHaveAttribute("href", "/my-books/start/1");
  app.authenticated = false;
  await page.goto("/book/1");
  await expect(page.locator(".bv-detail")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open or start your reading" })).toHaveCount(0);
});
