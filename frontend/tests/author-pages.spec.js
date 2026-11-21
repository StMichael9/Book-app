import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Browser fixtures only: the catalogue and the author endpoints (GET /authors/{id}, /authors/{id}/books) are mocked from the contract.
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
const cards = page => grid(page).locator(".bv-book-card");
const count = page => page.locator(".bv-author-page .bv-page-heading .bv-muted");
const NOT_FOUND = "This page isn’t on the shelf.";

test("the author page shows the name, N books and the Browse grid, with no bio or photo", async ({ page, app }) => {
  await page.goto("/author/7");
  await expect(page.getByRole("heading", { level: 1, name: "Ursula Le Guin" })).toBeVisible();
  await expect(count(page)).toHaveText("30 books");
  await expect(cards(page)).toHaveCount(24);
  await expect(page).toHaveTitle("Ursula Le Guin · Bookvane");
  await expect(page.getByText("Ignored bio.")).toHaveCount(0);
  await expect(page.locator("img[src*='/a/id/']")).toHaveCount(0);
  expect(app.errors).toEqual([]);
  const gap = await page.evaluate(() => document.querySelector(".bv-author-page .bv-book-grid").getBoundingClientRect().top - document.querySelector(".bv-author-page .bv-page-heading .bv-muted").getBoundingClientRect().bottom);
  expect(Math.abs(gap - 24)).toBeLessThanOrEqual(2);
});

test("one book says 1 book; no books says only the empty line and shows no grid", async ({ page, app: _app }) => {
  await page.goto("/author/9");
  await expect(count(page)).toHaveText("1 book");
  await expect(cards(page)).toHaveCount(1);
  await page.goto("/author/8");
  await expect(page.getByRole("heading", { level: 1, name: "Nobody Yet" })).toBeVisible();
  await expect(page.getByText("No books by this author yet.")).toBeVisible();
  await expect(page.getByText(/\b0 books\b/)).toHaveCount(0);
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
});

test("paging: page 2 loads, the address holds the page, Back returns to page 1, and a page change scrolls to the top", async ({ page, app: _app }) => {
  await page.goto("/author/7");
  await expect(cards(page)).toHaveCount(24);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/author\/7\?page=2$/);
  await expect(cards(page)).toHaveCount(6);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/author\/7$/);
  await expect(cards(page)).toHaveCount(24);
  await page.goto("/author/7?page=2");
  await expect(cards(page)).toHaveCount(6);
});

test("an unknown author shows the not-found page, and so does a bad id", async ({ page, app: _app }) => {
  await page.goto("/author/99");
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  await page.goto("/author/abc");
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
});

test("a failed books call shows the error with Try again, and the name still shows", async ({ page, app }) => {
  app.booksStatus = 503;
  await page.goto("/author/7");
  await expect(page.getByRole("heading", { level: 1, name: "Ursula Le Guin" })).toBeVisible();
  await expect(page.getByText("The books couldn’t load.")).toBeVisible();
  app.booksStatus = 200;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(cards(page)).toHaveCount(24);
});

test("signed in, the cards carry the shelf marks; signed out they do not", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/author/7");
  await expect(cards(page)).toHaveCount(24);
  await expect(cards(page).filter({ hasText: "Le Guin book 2" }).getByRole("button", { name: /Want to read/, pressed: true })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "Le Guin book 5" }).getByRole("button", { name: /Want to read/, pressed: true })).toHaveCount(0);
});

test("signed out there are no shelf marks and no library lookup", async ({ page, app }) => {
  await page.goto("/author/7");
  await expect(cards(page)).toHaveCount(24);
  expect(app.requests.some(request => request.path.startsWith("/me/library"))).toBe(false);
  await expect(page.locator(".bv-book-card").getByRole("button", { pressed: true })).toHaveCount(0);
});

test("a Browse card links its author to the author page; the card still opens the book; no anchor sits inside another", async ({ page, app: _app }) => {
  await page.goto("/browse");
  const link = cards(page).first().getByRole("link", { name: "Ursula Le Guin", exact: true });
  await expect(link).toHaveAttribute("href", "/author/7");
  expect(await page.locator("a a").count()).toBe(0);
  await link.click();
  await expect(page).toHaveURL(/\/author\/7$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ursula Le Guin" })).toBeVisible();
  await page.goto("/browse");
  await cards(page).first().getByRole("link", { name: "Le Guin book 1", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/1$/);
});

test("the book page header links the author, underlined at rest with offset 3px, with a visible focus ring from the keyboard", async ({ page, app: _app }) => {
  await page.goto("/book/1");
  const link = page.locator(".bv-detail-author").getByRole("link", { name: "Ursula Le Guin", exact: true });
  await expect(link).toHaveAttribute("href", "/author/7");
  expect(await link.evaluate(node => { const style = getComputedStyle(node); return [style.textDecorationLine, style.textUnderlineOffset]; })).toEqual(["underline", "3px"]);
  await link.focus();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect(await link.evaluate(node => { const style = getComputedStyle(node); return [style.outlineStyle, style.outlineWidth]; })).toEqual(["solid", "3px"]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/author\/7$/);
});

test("on a card the author is plain until hover or keyboard focus; a name with no id stays text", async ({ page, app }) => {
  app.browseItems = [bookOf(1, [{ id: 7, name: "Ursula Le Guin" }, { name: "No Id Person" }]), bookOf(2)];
  await page.goto("/browse");
  const card = cards(page).first();
  const link = card.getByRole("link", { name: "Ursula Le Guin", exact: true });
  await expect(card.locator(".bv-author")).toHaveText("Ursula Le Guin, No Id Person");
  await expect(card.getByRole("link", { name: "No Id Person" })).toHaveCount(0);
  expect(await link.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("none");
  await link.hover();
  expect(await link.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("underline");
  await page.mouse.move(0, 0);
  await card.getByRole("link", { name: "Le Guin book 1", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect(await link.evaluate(node => [getComputedStyle(node).textDecorationLine, getComputedStyle(node).outlineStyle])).toEqual(["underline", "solid"]);
});

for (const theme of ["light", "dark"]) test(`the author page does not scroll sideways at 390, 320 and 200% text; ${theme}`, async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/author/7");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(cards(page)).toHaveCount(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
