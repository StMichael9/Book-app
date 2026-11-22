import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installGenres } from "./support/genres.js";

// Browser fixtures only: every API request is intercepted (the T24 contract).
const BOOK = { id: 1, title: "The Left Hand of Darkness", subtitle: null, authors: [{ id: 7, name: "Ursula Le Guin" }], tags: [], cover_image_url: null, english_title: null, page_count: 304, published_year: 1969 };
const month = (...counts) => Array.from({ length: 12 }, (_, index) => counts[index] || 0);
const STATS = { year: 2026, books_finished: 2, pages_read: 400, by_month: month(1, 1), biggest_month: 1, top_genres: [] };

const test = base.extend({
  app: [async ({ page, baseURL }, provide) => {
    const state = {
      requests: [], errors: [], signedIn: false,
      profile: { display_name: "St Michael", bio: null, initials: "SM", avatar_icon: null, avatar_color: null, handle: "stmichael", profile_public: true, show_prompt: false, reading_since: 2026 },
      lists: [{ id: 7, name: "Winter reads", description: null, is_public: true, book_count: 1, covers: [], books: [BOOK] }, { id: 8, name: "Secret list", description: null, is_public: false, book_count: 1, covers: [], books: [BOOK] }],
    };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      state.requests.push({ path, method });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (/^\/books\/\d+\/description$/.test(path)) return reply(404, { detail: { code: "not_found" } });
      if (path === "/auth/refresh") return state.signedIn ? reply(200, {}) : reply(401, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null });
      if (path === "/me/profile") return reply(200, state.profile);
      if (path === "/me/stats") return reply(200, STATS);
      if (path === "/me/lists") return reply(200, state.lists.map(({ books, ...row }) => ({ ...row, previews: [] })));
      const own = path.match(/^\/me\/lists\/(\d+)$/);
      if (own) { const list = state.lists.find(item => item.id === Number(own[1])); return list ? reply(200, { id: list.id, name: list.name, description: null, is_public: list.is_public, books: list.books }) : reply(404, {}); }
      if (path === "/books") return reply(200, { items: [BOOK], total: 1, page: 1, size: 20 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, BOOK);
      if (/^\/authors\/\d+\/books$/.test(path)) return reply(200, { items: [], total: 0, page: 1, size: 24, pages: 1 });
      if (path === "/u/ada") return reply(200, { display_name: "Ada Reader", initials: "AR", avatar_icon: "feather", avatar_color: "plum", bio: "Quiet reader.", reading_since: 2025, stats: STATS, lists: [{ id: 3, name: "Shared list", description: null, book_count: 1, covers: [] }] });
      if (path === "/u/ada/lists/3") return reply(200, { id: 3, name: "Shared list", description: "Good ones.", owner: { display_name: "Ada Reader", initials: "AR" }, books: [BOOK] });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  }, { auto: true }],
});

// A page-side stub for the clipboard and the share sheet; `window.__share` records what each received.
async function stub(page, { share = false, clipboard = "ok" } = {}) {
  await page.addInitScript(({ share, clipboard }) => {
    window.__share = { copied: [], shared: [] };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { if (clipboard === "fail") throw new Error("denied"); window.__share.copied.push(text); } } });
    Object.defineProperty(navigator, "share", { configurable: true, value: share ? async data => { window.__share.shared.push(data); } : undefined });
  }, { share, clipboard });
}
const recorded = page => page.evaluate(() => window.__share);
const SHARE = { name: "Share", exact: true };

test("book page: Share copies the link with ?ref=share, says Link copied for 2 seconds, then goes back", async ({ page }) => {
  await stub(page);
  await page.goto("/book/1");
  const button = page.getByRole("button", SHARE);
  await expect(button).toBeVisible();
  await expect(button.locator("svg")).toHaveAttribute("width", "18");
  await button.click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect((await recorded(page)).copied).toEqual([`${new URL(page.url()).origin}/book/1?ref=share`]);
  await expect(page.getByRole("button", SHARE)).toBeVisible({ timeout: 4000 });
});

test("book page: the share sheet gets the title, the text and the link when the browser has one", async ({ page }) => {
  await stub(page, { share: true });
  await page.goto("/book/1");
  await page.getByRole("button", SHARE).click();
  const { shared, copied } = await recorded(page);
  expect(shared).toEqual([{ title: "The Left Hand of Darkness", text: "The Left Hand of Darkness by Ursula Le Guin on Bookvane", url: `${new URL(page.url()).origin}/book/1?ref=share` }]);
  expect(copied).toEqual([]);
});

test("a copy that fails says Couldn’t copy the link.", async ({ page }) => {
  await stub(page, { clipboard: "fail" });
  await page.goto("/book/1");
  await page.getByRole("button", SHARE).click();
  await expect(page.getByRole("button", { name: "Couldn’t copy the link." })).toBeVisible();
  await expect(page.getByRole("button", SHARE)).toBeVisible({ timeout: 4000 });
});

test("a public profile and a public list can be shared; the text names the reader", async ({ page }) => {
  await stub(page, { share: true });
  const origin = () => new URL(page.url()).origin;
  await page.goto("/u/ada");
  await expect(page.getByRole("heading", { name: "Ada Reader" })).toBeVisible();
  await expect(page.locator(".bv-profile-head").getByRole("button", SHARE)).toBeVisible();
  await page.getByRole("button", SHARE).click();
  await expect.poll(async () => (await recorded(page)).shared).toEqual([{ title: "Ada Reader", text: "Ada Reader's reading on Bookvane", url: `${origin()}/u/ada?ref=share` }]);
  await page.goto("/u/ada/lists/3");
  await expect(page.getByRole("heading", { name: "Shared list" })).toBeVisible();
  await page.getByRole("button", SHARE).click();
  await expect.poll(async () => (await recorded(page)).shared).toEqual([{ title: "Shared list", text: "Shared list, a list by Ada Reader on Bookvane", url: `${origin()}/u/ada/lists/3?ref=share` }]);
});

test("your own profile shows Share only when it is public", async ({ page, app }) => {
  app.signedIn = true;
  await stub(page);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "St Michael" })).toBeVisible();
  await expect(page.getByRole("button", SHARE)).toBeVisible();
  app.profile.profile_public = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: "St Michael" })).toBeVisible();
  await expect(page.getByRole("button", SHARE)).toHaveCount(0);
});

test("your own lists: Share on a public one, none on a private one", async ({ page, app }) => {
  app.signedIn = true;
  await stub(page);
  await page.goto("/profile/lists/8");
  await expect(page.getByRole("heading", { name: "Secret list" })).toBeVisible();
  await expect(page.getByRole("button", SHARE)).toHaveCount(0);
  await page.goto("/profile/lists/7");
  await expect(page.getByRole("heading", { name: "Winter reads" })).toBeVisible();
  await page.getByRole("button", SHARE).click();
  await expect.poll(async () => (await recorded(page)).copied).toEqual([`${new URL(page.url()).origin}/u/stmichael/lists/7?ref=share`]);
});

test("share screenshots", async ({ page }) => {
  test.skip(!process.env.BV_SHOTS_DIR, "set BV_SHOTS_DIR to export screenshots");
  const dir = process.env.BV_SHOTS_DIR; mkdirSync(dir, { recursive: true });
  await stub(page);
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    for (const [width, height] of [[390, 844], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      for (const [name, path] of [["share-book", "/book/1"], ["share-profile", "/u/ada"], ["share-list", "/u/ada/lists/3"]]) {
        await page.goto(path); await expect(page.getByRole("button", SHARE)).toBeVisible();
        await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/${name}-${width}-${theme}.png`, fullPage: true });
      }
    }
  }
});
