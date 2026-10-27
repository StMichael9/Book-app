import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

// Browser-only fixtures: every API request is intercepted and no hosted service is contacted.
const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL("../src/data/book-snapshot.json", import.meta.url)), "utf8"));
const WHITELIST = ["id", "title", "subtitle", "authors", "cover_image_url", "published_year", "page_count", "english_title"];
const CACHE_KEY = /^bookvane:books:v1:[^:]+:(anon|member):(landing|browse)$/;

// The landing and guest Discover order, which the snapshot must paint in the same way the live data will.
const plainTitle = title => Boolean(title) && /^[ -~‘’“”–—]+$/.test(title);
const rank = book => (book.cover_image_url ? 0 : 2) + (plainTitle(book.title) ? 0 : 1);
const impression = items => items.map((book, index) => ({ book, index })).sort((a, b) => rank(a.book) - rank(b.book) || a.index - b.index).map(({ book }) => book);
const firstSnapshot = impression(snapshot.items)[0];

const liveBooks = (label, count = 40) => Array.from({ length: count }, (_, index) => ({
  id: 9001 + index, title: `Live ${label} ${index + 1}`, subtitle: null, authors: [{ id: 5, name: "Live Author" }],
  cover_image_url: null, published_year: 2001, page_count: 200, english_title: null,
}));

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, label: "One", titleSize: 0, holdBooks: null, booksStatus: 200, requests: [] };
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = route.request().method();
      state.requests.push({ path, method });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/me/reading-capabilities") return reply(200, { enabled: false, contract_version: 1 });
      if (path === "/me/books") return reply(200, [{ id: 1, book_id: 9001, status: "want", book: { id: 9001, title: "SECRET-SHELF-MARKER", authors: [] } }]);
      if (path === "/me/preferences") return reply(200, []);
      if (path.startsWith("/me/")) return reply(200, []);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/books") {
        if (state.holdBooks) await state.holdBooks;
        if (state.booksStatus !== 200) return reply(state.booksStatus, { detail: "Temporarily unavailable" });
        const size = Number(url.searchParams.get("size") || 20), page = Number(url.searchParams.get("page") || 1);
        const label = state.authenticated ? `Member ${state.label}` : state.label;
        const all = liveBooks(label).map(book => ({ ...book, title: book.title + "x".repeat(state.titleSize) }));
        return reply(200, { items: all.slice((page - 1) * size, page * size), total: all.length, page, size });
      }
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const hold = app => { let release; app.holdBooks = new Promise(done => { release = () => { app.holdBooks = null; done(); }; }); return release; };
const heroLink = (page, title) => page.getByRole("link", { name: `Explore ${title}`, exact: true });
const cardTitle = (page, title) => page.getByRole("heading", { level: 3, name: title, exact: true });
const stored = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
const cacheKeys = async page => Object.keys(await stored(page)).filter(key => key.startsWith("bookvane:books:"));

test("snapshot shape: 1 to 30 books with only the card fields", () => {
  expect(Object.keys(snapshot).sort()).toEqual(["generatedAt", "items", "source", "total"]);
  expect(snapshot.source).toBe("https://api.bookvane.me/books?size=30");
  expect(Number.isInteger(snapshot.total) && snapshot.total >= snapshot.items.length).toBe(true);
  expect(snapshot.items.length).toBeGreaterThanOrEqual(1);
  expect(snapshot.items.length).toBeLessThanOrEqual(30);
  const ids = new Set();
  for (const book of snapshot.items) {
    expect(Number.isSafeInteger(book.id) && book.id > 0).toBe(true);
    expect(ids.has(book.id)).toBe(false); ids.add(book.id);
    expect(Object.keys(book).every(key => WHITELIST.includes(key))).toBe(true);
    expect(typeof book.title).toBe("string");
    expect(Array.isArray(book.authors) && book.authors.every(author => Number.isSafeInteger(author.id) && typeof author.name === "string" && Object.keys(author).length === 2)).toBe(true);
  }
});

test("first paint shows the snapshot while the API is slow, then live books replace it in place", async ({ page, app }) => {
  const release = hold(app);
  await page.goto("/");
  await expect(heroLink(page, firstSnapshot.title)).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live One 1")).toBeVisible();
  await expect(heroLink(page, firstSnapshot.title)).toHaveCount(0);
});

test("snapshot books stay and the page works when the API fails", async ({ page, app }) => {
  app.booksStatus = 503;
  await page.goto("/");
  await expect(heroLink(page, firstSnapshot.title)).toBeVisible();
  await expect(page.getByText("The books are taking a moment.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore books" })).toBeVisible();
});

test("a return visit shows the cached books instantly, then live data replaces them", async ({ page, app }) => {
  await page.goto("/");
  await expect(heroLink(page, "Live One 1")).toBeVisible();
  await expect.poll(() => cacheKeys(page)).toEqual([expect.stringMatching(CACHE_KEY)]);
  app.label = "Two";
  const release = hold(app);
  await page.reload();
  await expect(heroLink(page, "Live One 1")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live Two 1")).toBeVisible();
  await expect(heroLink(page, "Live One 1")).toHaveCount(0);
});

test("Discover's first unfiltered page is instant from the snapshot and from the cache", async ({ page, app }) => {
  const release = hold(app);
  await page.goto("/browse");
  await expect(cardTitle(page, impression(snapshot.items.slice(0, 20))[0].title)).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0);
  release();
  await expect(cardTitle(page, "Live One 1")).toBeVisible();
  app.label = "Two";
  const again = hold(app);
  await page.reload();
  await expect(cardTitle(page, "Live One 1")).toBeVisible();
  again();
  await expect(cardTitle(page, "Live Two 1")).toBeVisible();
  expect(await cacheKeys(page)).toEqual([expect.stringMatching(/:browse$/)]);
});

test("filtered, searched and later pages never use the snapshot or the cache", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(cardTitle(page, "Live One 1")).toBeVisible();
  app.label = "Two";
  for (const query of ["?tag=fantasy", "?book=anything", "?page=2"]) {
    const release = hold(app);
    await page.goto(`/browse${query}`);
    await expect(page.getByRole("status", { name: "Loading books" })).toBeVisible();
    await expect(cardTitle(page, "Live One 1")).toHaveCount(0);
    await expect(cardTitle(page, impression(snapshot.items.slice(0, 20))[0].title)).toHaveCount(0);
    release();
    await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0);
  }
});

test("the cache is gone after logout", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/");
  await expect(heroLink(page, "Live Member One 1")).toBeVisible();
  expect(await cacheKeys(page)).toEqual([expect.stringMatching(/:member:landing$/)]);
  hold(app);
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(heroLink(page, firstSnapshot.title)).toBeVisible();
  await expect(heroLink(page, "Live Member One 1")).toHaveCount(0);
  expect(await cacheKeys(page)).toEqual([]);
});

test("no account, library or reading data is ever written to storage", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/");
  await expect(heroLink(page, "Live Member One 1")).toBeVisible();
  await page.goto("/my-books");
  await expect(page.getByText("SECRET-SHELF-MARKER").first()).toBeVisible();
  const local = await stored(page);
  const session = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])));
  for (const values of [local, session]) expect(JSON.stringify(values)).not.toContain("SECRET-SHELF-MARKER");
  const entries = Object.entries(local).filter(([key]) => key.startsWith("bookvane:books:"));
  expect(entries.length).toBeGreaterThan(0);
  for (const [, value] of entries) {
    const { data } = JSON.parse(value);
    expect(Object.keys(data).sort()).toEqual(["items", "page", "size", "total"]);
    for (const book of data.items) expect(Object.keys(book).every(key => WHITELIST.includes(key))).toBe(true);
  }
});

test("a new build id ignores the old cache", async ({ page, app }) => {
  const stale = { savedAt: Date.now(), data: { items: liveBooks("Old Build", 8), total: 8, page: 1, size: 30 } };
  await page.addInitScript(value => localStorage.setItem("bookvane:books:v1:some-old-build:anon:landing", value), JSON.stringify(stale));
  const release = hold(app);
  await page.goto("/");
  await expect(heroLink(page, firstSnapshot.title)).toBeVisible();
  await expect(heroLink(page, "Live Old Build 1")).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live One 1")).toBeVisible();
});

test("a cache older than 24 hours is ignored", async ({ page, app }) => {
  await page.goto("/");
  await expect(heroLink(page, "Live One 1")).toBeVisible();
  await expect.poll(() => cacheKeys(page)).toHaveLength(1);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.startsWith("bookvane:books:"));
    const entry = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...entry, savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  });
  app.label = "Two";
  const release = hold(app);
  await page.reload();
  await expect(heroLink(page, firstSnapshot.title)).toBeVisible();
  await expect(heroLink(page, "Live One 1")).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live Two 1")).toBeVisible();
});

test("an oversized response is shown but never stored", async ({ page, app }) => {
  app.titleSize = 9000;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Explore Live One 1/ })).toBeVisible();
  expect(await cacheKeys(page)).toEqual([]);
});

test("blocked storage never breaks the page", async ({ page, app }) => {
  expect(app.booksStatus).toBe(200);
  await page.addInitScript(() => {
    const blocked = key => String(key).startsWith("bookvane:books:");
    const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key) { if (blocked(key)) throw new Error("blocked"); return getItem.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (blocked(key)) throw new Error("blocked"); return setItem.call(this, key, value); };
    Storage.prototype.removeItem = function (key) { if (blocked(key)) throw new Error("blocked"); return removeItem.call(this, key); };
    Object.defineProperty(Storage.prototype, "length", { get() { throw new Error("blocked"); } });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(heroLink(page, "Live One 1")).toBeVisible();
  await page.goto("/browse");
  await expect(cardTitle(page, "Live One 1")).toBeVisible();
  expect(errors).toEqual([]);
});
