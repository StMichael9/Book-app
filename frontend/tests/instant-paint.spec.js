import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

// Browser-only fixtures: every API request is intercepted and no hosted service is contacted.
const frontend = new URL("../", import.meta.url);
const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL("src/data/book-snapshot.json", frontend)), "utf8"));
const plainTitle = title => Boolean(title) && /^[ -~‘’“”–—]+$/.test(title);
const rank = book => (book.cover_image_url ? 0 : 2) + (plainTitle(book.title) ? 0 : 1);
const impression = items => items.map((book, index) => ({ book, index })).sort((a, b) => rank(a.book) - rank(b.book) || a.index - b.index).map(({ book }) => book);
const heroSnapshot = impression(snapshot.items).slice(0, 3);
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const live = (label, cover) => Array.from({ length: 30 }, (_, index) => ({
  id: 9001 + index, title: `Live ${label} ${index + 1}`, subtitle: null, authors: [{ id: 5, name: "Live Author" }],
  cover_image_url: typeof cover === "function" ? cover(index) : cover, published_year: 2001, page_count: 200, english_title: null,
}));

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, holdRefresh: null, holdCover: null, cover: null, remoteCovers: [], coverStatus: 200 };
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://covers.openlibrary.org") { state.remoteCovers.push(url.pathname); return route.abort(); }
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (url.pathname.startsWith("/test-cover/")) {
        if (state.holdCover) await state.holdCover;
        return state.coverStatus === 200 ? route.fulfill({ status: 200, body: PIXEL, contentType: "image/gif" }) : route.fulfill({ status: state.coverStatus, body: "" });
      }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") {
        if (state.holdRefresh) await state.holdRefresh;
        return reply(state.authenticated ? 200 : 401, {});
      }
      if (path === "/me/reading-capabilities") return reply(200, { enabled: false, contract_version: 1 });
      if (path.startsWith("/me/")) return reply(200, []);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/books") {
        const size = Number(url.searchParams.get("size") || 20);
        const all = live("One", state.cover);
        return reply(200, { items: all.slice(0, size), total: all.length, page: 1, size });
      }
      if (/^\/books\/\d+$/.test(path)) {
        const id = Number(path.split("/")[2]);
        return reply(200, { ...live("One", state.cover)[id - 9001], description: "A synthetic description.", tags: [] });
      }
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const holdRefresh = app => { let release; app.holdRefresh = new Promise(done => { release = () => { app.holdRefresh = null; done(); }; }); return release; };
const heroLink = (page, title) => page.getByRole("link", { name: `Explore ${title}`, exact: true });

test("snapshot covers are self-hosted webp files of card size", () => {
  expect(snapshot.items.length).toBeGreaterThan(0);
  for (const book of snapshot.items) {
    expect(book.cover_image_url).toBe(`/covers/snapshot/${book.id}.webp`);
    const file = fileURLToPath(new URL(`public/covers/snapshot/${book.id}.webp`, frontend));
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(30 * 1024);
    const head = readFileSync(file).subarray(0, 12);
    expect(head.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(head.subarray(8, 12).toString("latin1")).toBe("WEBP");
  }
});

test("landing books are visible while /auth/refresh is still pending", async ({ page, app }) => {
  const release = holdRefresh(app);
  await page.goto("/");
  await expect(heroLink(page, heroSnapshot[0].title)).toBeVisible();
  await expect(page.getByText("Opening Bookvane…")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live One 1")).toBeVisible();
});

test("a reader who was signed in last time still waits for the account check instead of flashing the guest page", async ({ page, app }) => {
  app.authenticated = true;
  await page.addInitScript(() => localStorage.setItem("bookvane:session-hint:v1", "1"));
  const release = holdRefresh(app);
  await page.goto("/");
  await expect(page.getByText("Opening Bookvane…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your personal reading home.", exact: true })).toHaveCount(0);
  release();
  await expect(heroLink(page, "Live One 1")).toBeVisible();
});

test("Discover's plain first page also paints before the account check returns", async ({ page, app }) => {
  const release = holdRefresh(app);
  await page.goto("/browse");
  await expect(page.getByRole("heading", { level: 3, name: impression(snapshot.items.slice(0, 20))[0].title, exact: true })).toBeVisible();
  release();
});

test("hero snapshot covers use the self-hosted files and only the three hero covers are high priority", async ({ page, app }) => {
  const release = holdRefresh(app);
  await page.goto("/");
  for (const book of heroSnapshot) {
    const image = heroLink(page, book.title).locator("img");
    await expect(image).toHaveAttribute("src", `/covers/snapshot/${book.id}.webp`);
    await expect(image).toHaveAttribute("fetchpriority", "high");
    await expect(image).toHaveAttribute("loading", "eager");
  }
  const rowImages = page.locator(".bv-book-card img");
  expect(await rowImages.count()).toBeGreaterThan(0);
  expect(await rowImages.evaluateAll(nodes => nodes.filter(node => node.getAttribute("fetchpriority") === "high").length)).toBe(0);
  const response = await page.request.get(`/covers/snapshot/${heroSnapshot[0].id}.webp`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  release();
});

test("remote Open Library covers are requested at -M, except the single large cover on a book page", async ({ page, app }) => {
  app.cover = index => `https://covers.openlibrary.org/b/id/${1000 + index}-L.jpg`;
  await page.goto("/browse");
  await expect(page.getByRole("heading", { level: 3, name: "Live One 1", exact: true })).toBeVisible();
  await expect.poll(() => app.remoteCovers.length).toBeGreaterThan(0);
  expect(app.remoteCovers.every(path => /-M\.jpg$/.test(path))).toBe(true);
  app.remoteCovers.length = 0;
  await page.goto("/book/9001");
  await expect(page.getByRole("heading", { name: "Live One 1", exact: true }).first()).toBeVisible();
  await expect.poll(() => app.remoteCovers.length).toBeGreaterThan(0);
  expect(app.remoteCovers).toContain("/b/id/1000-L.jpg");
});

test("a book without a cover still gets the typographic jacket", async ({ page, app }) => {
  app.cover = null;
  await page.goto("/browse");
  const card = page.locator(".bv-book-card").filter({ has: page.getByRole("heading", { level: 3, name: "Live One 1", exact: true }) });
  await expect(card.getByRole("img", { name: "Cover unavailable for Live One 1" })).toBeVisible();
  await expect(card.locator(".bv-jacket")).toHaveCount(1);
});

test("a cover that fails to load falls back to the jacket", async ({ page, app }) => {
  app.cover = index => `/test-cover/missing-${index}.png`;
  app.coverStatus = 404;
  await page.goto("/browse");
  const card = page.locator(".bv-book-card").filter({ has: page.getByRole("heading", { level: 3, name: "Live One 1", exact: true }) });
  await expect(card.getByRole("img", { name: "Cover unavailable for Live One 1" })).toBeVisible();
});

test("while a cover loads there is a plain tinted block with no jacket text, then the image fades in", async ({ page, app }) => {
  app.cover = index => `/test-cover/slow-${index}.png`;
  let release; app.holdCover = new Promise(done => { release = done; });
  await page.goto("/browse");
  const card = page.locator(".bv-book-card").filter({ has: page.getByRole("heading", { level: 3, name: "Live One 1", exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator(".bv-jacket")).toHaveCount(0);
  const cover = card.locator(".bv-cover");
  await expect(cover).toHaveClass(/bv-cover--loading/);
  expect(await cover.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await card.locator("img").evaluate(node => getComputedStyle(node).opacity)).toBe("0");
  app.holdCover = null; release();
  await expect(cover).not.toHaveClass(/bv-cover--loading/);
  await expect(card.locator("img")).toHaveCSS("opacity", "1");
  await expect(card.locator(".bv-jacket")).toHaveCount(0);
  expect(await card.locator("img").evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0.15s");
});

test("reduced motion means no fade", async ({ page, app }) => {
  app.cover = index => `/test-cover/still-${index}.png`;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/browse");
  await expect(page.getByRole("heading", { level: 3, name: "Live One 1", exact: true })).toBeVisible();
  const image = page.locator(".bv-book-card").filter({ has: page.getByRole("heading", { level: 3, name: "Live One 1", exact: true }) }).locator("img");
  await expect(image).toHaveCSS("opacity", "1");
  await expect(image).toHaveCSS("transition-duration", "0s");
});

test("the signed-in hint is a bare flag that follows the account check", async ({ page, app }) => {
  const hint = () => page.evaluate(() => localStorage.getItem("bookvane:session-hint:v1"));
  app.authenticated = true;
  await page.goto("/browse");
  await expect.poll(hint).toBe("1");
  app.authenticated = false;
  await page.reload();
  await expect.poll(hint).toBeNull();
});
