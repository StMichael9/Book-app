import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The header and the phone bars: stable links, no theme switch, a slim hide-on-scroll phone bar, header search, an empty avatar
// circle while the profile loads and a 44 px logo. Browser-only fixtures; every API call is mocked.
const books = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, title: `Header fixture ${index + 1}`, subtitle: null, authors: [{ id: 1, name: "An Author" }], tags: [], cover_image_url: null, page_count: 200, published_year: 2001, english_title: null }));

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: true, holdCaps: null, holdProfile: null, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      state.requests.push({ path, method });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return state.authenticated ? reply(200, {}) : reply(401, { detail: "Session expired" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") { if (state.holdProfile) await state.holdProfile; return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 }); }
      if (path === "/me/reading-capabilities") { if (state.holdCaps) await state.holdCaps; return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } }); }
      if (path === "/books") return reply(200, { items: books, total: books.length, page: 1, size: 24 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...books[0], description: null });
      if (path === "/me/library/lookup") return reply(200, { items: body(request).book_ids.map(id => ({ book_id: id, entry_id: null, version: null, is_owned: false, is_wanted: false, reading_state: null })) });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null, facets: {}, index: null });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/stats" || path === "/me/up-next" || path === "/me/lists" || path === "/me/preferences") return reply(200, path === "/me/stats" ? { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } : []);
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});
const body = request => request.postDataJSON();
// A link's label: the last <span> in a tab (after its icon or avatar), else its own text.
const links = locator => locator.getByRole("link").evaluateAll(nodes => nodes.map(node => { const spans = node.querySelectorAll("span"); return (spans.length ? spans[spans.length - 1] : node).textContent.trim(); }));
const hold = () => { let release; const promise = new Promise(done => { release = done; }); return { promise, release }; };

test("a signed-in reader sees the same links before and after the reading capabilities load", async ({ page, app }) => {
  const caps = hold(); app.holdCaps = caps.promise;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browse");
  const desktop = page.getByRole("navigation", { name: "Main navigation" });
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toBeVisible();
  const before = await links(desktop);
  expect(before).toEqual(["Home", "Discover", "My Books"]);
  caps.release();
  await expect.poll(() => app.requests.some(request => request.path === "/me/reading-capabilities")).toBe(true);
  await page.waitForTimeout(600);
  expect(await links(desktop)).toEqual(before);
  // The same on a phone.
  caps.release();
  const phoneCaps = hold(); app.holdCaps = phoneCaps.promise;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/browse");
  const bottom = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(bottom.getByRole("link", { name: "Discover" })).toBeVisible();
  const phoneBefore = await links(bottom);
  expect(phoneBefore).toEqual(["Home", "Discover", "My Books", "You"]);
  phoneCaps.release();
  await page.waitForTimeout(600);
  expect(await links(bottom)).toEqual(phoneBefore);
});

test("a guest keeps today's links, and nobody sees a Preferences link", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preferences" })).toHaveCount(0);
  app.authenticated = false;
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect(await links(page.getByRole("navigation", { name: "Main navigation" }))).toEqual(["Discover", "My Books"]);
  await expect(page.getByRole("link", { name: "Preferences" })).toHaveCount(0);
});

test("there is no theme button in the header on desktop or on a phone, and Settings keeps its switch", async ({ page, app: _app }) => {
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/browse");
    await expect(page.locator("#bv-main")).toBeVisible();
    await expect(page.getByRole("button", { name: /Use (dark|light) theme/ })).toHaveCount(0);
  }
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Switch theme" })).toBeVisible();
});

test("on a phone the top bar is a slim logo bar that hides on scroll down and returns on scroll up", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/browse");
  const header = page.locator(".bv-header");
  await expect(page.locator(".bv-book-card").first()).toBeVisible();
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(56);
  // Only the logo: no avatar and no theme switch for a signed-in reader.
  await expect(header.getByRole("link", { name: "Bookvane home" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Your profile" })).toBeHidden();
  await expect(header.getByRole("button")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(async () => (await header.boundingBox()).y + (await header.boundingBox()).height).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(async () => (await header.boundingBox()).y).toBeGreaterThanOrEqual(0);
  // The bottom bar stays.
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
});

test("with reduced motion the phone top bar does not hide", async ({ page, app: _app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/browse");
  await expect(page.locator(".bv-book-card").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(500);
  const box = await page.locator(".bv-header").boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
});

test("header search goes to Discover's search on Enter, and an empty Enter does nothing", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/my-books");
  const search = page.getByRole("searchbox", { name: "Search books" });
  await expect(search).toHaveAttribute("placeholder", "Search books");
  await search.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/my-books$/);
  await search.fill("dune messiah");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/browse\?q=dune(\+|%20)messiah$/);
  // It sits on the right, before the avatar.
  const box = await search.boundingBox(), avatar = await page.getByRole("link", { name: "Your profile", exact: true }).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(avatar.x);
  expect(box.x).toBeGreaterThan(720);
});

test("the header search is not shown on a phone", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/browse");
  await expect(page.locator("#bv-main")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search books" })).toBeHidden();
});

test("the avatar is an empty circle until the profile loads, then the initial", async ({ page, app }) => {
  const profile = hold(); app.holdProfile = profile.promise;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browse");
  const link = page.getByRole("link", { name: "Your profile", exact: true });
  await expect(link).toBeVisible();
  await expect(link.locator(".bv-avatar--empty")).toBeVisible();
  await expect(link.locator("svg")).toHaveCount(0);
  await expect(link.locator("b")).toHaveCount(0);
  profile.release();
  await expect(link.locator("b")).toHaveText("R");
  await expect(link.locator(".bv-avatar--empty")).toHaveCount(0);
});

test("the logo link is at least 44 px tall", async ({ page, app: _app }) => {
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/browse");
    await expect(page.locator("#bv-main")).toBeVisible();
    const box = await page.locator(".bv-header").getByRole("link", { name: "Bookvane home" }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
