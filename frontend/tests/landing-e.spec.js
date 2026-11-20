import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The signed-out landing page, direction E, "Paper top": header and promise on paper, a sheet of live covers beside the text, the picks, two
// ways to begin, the privacy promises. Browser-only fixtures: every API call is mocked.
const book = id => ({ id, title: `Landing Book ${id}`, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: 300, published_year: 2001, english_title: null });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return state.authenticated ? reply(200, {}) : reply(401, { detail: "Session expired" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/autocomplete/books") return reply(200, []);
      if (path === "/books") { const items = Array.from({ length: 30 }, (_, index) => book(9001 + index)); return reply(200, { items, total: items.length, page: 1, size: 30 }); }
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...book(Number(path.split("/")[2])), description: "A synthetic description.", tags: [] });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null, facets: {}, index: null });
      if (["/me/stats", "/me/up-next", "/me/lists", "/me/preferences"].includes(path)) return reply(200, path === "/me/stats" ? { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } : []);
      state.errors.push(`Unhandled ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const box = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height }; });
const channels = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = colour => { const [r, g, b] = channels(colour).map(value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const style = (locator, property) => locator.evaluate((node, property) => getComputedStyle(node)[property], property);
const visit = async page => { await page.goto("/"); await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); await expect(page.locator(".bv-landing-hero")).toBeVisible(); await expect(page.locator(".bv-landing-covers a").first()).toBeVisible(); };
const IMPORT = "/register?src=landing&returnTo=%2Fmy-books%2Fimport";
const DARK_SHEET = "rgb(47, 42, 35)";

test("paper top: no band, the header is on paper, and the hero holds the approved words and both doors", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await expect(page.locator(".bv-landing-band, .bv-header--band")).toHaveCount(0);
  expect(await style(page.locator(".bv-header"), "backgroundColor")).toBe("rgb(243, 238, 227)");
  const hero = page.locator(".bv-landing-hero");
  await expect(hero.getByRole("heading", { level: 1, name: "Every book you’ve read, own and want, in one quiet place." })).toBeVisible();
  await expect(hero.getByText("Bring your shelves from Goodreads or StoryGraph, or start with one book. Private unless you choose to share.")).toBeVisible();
  await expect(hero.getByText("Free. No account needed to look around.")).toBeVisible();
  await expect(hero.getByRole("link", { name: "Import my library", exact: true })).toHaveAttribute("href", IMPORT);
  await expect(hero.getByRole("link", { name: "Start with one book", exact: true })).toHaveAttribute("href", "/browse");
  expect(app.errors).toEqual([]);
});

test("Import my library signs up first and carries the source; Start with one book lands on Discover with the search field focused", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await page.locator(".bv-landing-hero").getByRole("link", { name: "Import my library", exact: true }).click();
  await expect(page).toHaveURL(/\/register\?src=landing&returnTo=%2Fmy-books%2Fimport$/);
  await visit(page);
  await page.locator(".bv-landing-hero").getByRole("link", { name: "Start with one book", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator("#bv-search-query")).toBeFocused();
});

test("the cover sheet holds the three live covers inside the hero: no overhang, first cover high priority", async ({ page, app: _app }) => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await visit(page);
    const covers = page.locator(".bv-landing-covers a");
    await expect(covers).toHaveCount(3);
    for (const label of await covers.evaluateAll(links => links.map(link => link.getAttribute("aria-label")))) expect(label).toMatch(/^Explore Landing Book \d+$/);
    const hero = await box(page.locator(".bv-landing-hero")), shelf = await box(page.locator(".bv-landing-shelf"));
    expect(shelf.top, `${width}: top`).toBeGreaterThanOrEqual(hero.top - 1);
    expect(shelf.bottom, `${width}: bottom, no overhang`).toBeLessThanOrEqual(hero.bottom + 1);
    expect(shelf.right).toBeLessThanOrEqual(hero.right + 1);
    expect(await style(page.locator(".bv-landing-shelf"), "backgroundColor")).toBe("rgb(253, 250, 243)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal scroll`).toBe(true);
    await expect(page.getByText("Reading · page 41 of 223")).toBeAttached();
  }
});

test("desktop is two columns, centred with the text; the phone stacks the sheet under full-width doors", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  let copy = await box(page.locator(".bv-landing-copy")), shelf = await box(page.locator(".bv-landing-shelf"));
  expect(shelf.left).toBeGreaterThan(copy.right - 1);
  expect(Math.abs((shelf.top + shelf.bottom) / 2 - (copy.top + copy.bottom) / 2)).toBeLessThanOrEqual(30);
  expect(shelf.width).toBeLessThanOrEqual(421);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  copy = await box(page.locator(".bv-landing-copy")); shelf = await box(page.locator(".bv-landing-shelf"));
  expect(shelf.top).toBeGreaterThanOrEqual(copy.bottom - 1);
  for (const door of await page.locator(".bv-landing-doors .bv-button").all()) expect((await door.boundingBox()).width).toBeGreaterThan(300);
});

test("Open a new chapter shows five books on desktop and four on a phone; the genre links are soft pills", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await expect(page.locator(".bv-landing-open .bv-book-card:visible")).toHaveCount(5);
  await expect(page.locator(".bv-landing-subjects a").first()).toBeVisible();
  expect(parseFloat(await style(page.locator(".bv-landing-subjects a").first(), "borderTopLeftRadius"))).toBeGreaterThan(100);
  expect(await style(page.locator(".bv-landing-open .bv-book-card h3").first(), "fontFamily")).toMatch(/Bookvane Caslon/);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await expect(page.locator(".bv-landing-open .bv-book-card:visible")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("two ways to begin and the four privacy promises carry the approved words, and the old sections are gone", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const ways = page.locator(".bv-landing-ways");
  await expect(ways.getByRole("heading", { level: 2, name: "Two ways to begin" })).toBeVisible();
  await expect(ways.getByRole("heading", { level: 3, name: "Coming from another app?" })).toBeVisible();
  for (const step of ["Export your file from Goodreads or StoryGraph.", "Drop it into Bookvane.", "Check what came across."]) await expect(ways.getByText(step)).toBeVisible();
  await expect(ways.getByText("Shelves, dates, ratings and notes come with you. We never ask for your Goodreads login.")).toBeVisible();
  await expect(ways.getByRole("link", { name: "Import my library", exact: true })).toHaveAttribute("href", IMPORT);
  await expect(ways.getByRole("heading", { level: 3, name: "New to keeping track?" })).toBeVisible();
  await expect(ways.getByText("Search one book you loved. That’s your first shelf.")).toBeVisible();
  await expect(ways.getByRole("link", { name: "Start with one book", exact: true })).toHaveAttribute("href", "/browse");
  const privacy = page.locator(".bv-landing-private");
  await expect(privacy.getByRole("heading", { level: 2, name: "Private by default" })).toBeVisible();
  for (const [title, text] of [["No feed", "No followers or streaks."], ["No public ratings", "Your ratings stay yours."], ["Private notes", "Dates and notes never show."], ["Take it with you", "Download your library any time."]]) {
    await expect(privacy.getByText(title, { exact: true })).toBeVisible();
    await expect(privacy.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(privacy.getByRole("link")).toHaveCount(0);
  for (const gone of ["Make room for your reading life.", "Your next book is waiting.", "A little space for your reading life"]) await expect(page.getByText(gone)).toHaveCount(0);
});

test("320px at 200% text still holds: no horizontal scroll, the doors stay reachable", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await visit(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".bv-landing-hero").getByRole("link", { name: "Import my library", exact: true })).toBeVisible();
});

test("a signed-in reader still lands on Home", async ({ page, app }) => {
  app.authenticated = true;
  await page.addInitScript(() => { try { localStorage.setItem("bookvane:session-hint:v1", "1"); } catch { /* none */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".bv-landing-hero")).toHaveCount(0);
});

test("dark: the sheets are lifted from the page and the landing text keeps AA contrast", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  expect(await style(page.locator(".bv-landing-shelf"), "backgroundColor")).toBe(DARK_SHEET);
  expect(await style(page.locator(".bv-landing-way").first(), "backgroundColor")).toBe(DARK_SHEET);
  const paper = await style(page.locator(".bv-root"), "backgroundColor");
  expect(ratio(DARK_SHEET, paper)).toBeGreaterThanOrEqual(1.25);
  for (const [label, locator, background] of [["heading", page.locator(".bv-landing-copy h1"), paper], ["line", page.locator(".bv-landing-lead"), paper], ["free", page.locator(".bv-landing-free"), paper], ["way text", page.locator(".bv-landing-way .bv-landing-small").first(), DARK_SHEET], ["promise", page.locator(".bv-landing-promises span").first(), paper]])
    expect(ratio(await style(locator, "color"), background), label).toBeGreaterThanOrEqual(4.5);
  const primary = page.locator(".bv-landing-hero").getByRole("link", { name: "Import my library", exact: true });
  expect(ratio(await style(primary, "color"), await style(primary, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);
});

test("focus is visible on the doors and the cover links, in both themes", async ({ page, app: _app }) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page);
    const paper = await style(page.locator(".bv-root"), "backgroundColor");
    for (const target of [page.locator(".bv-landing-hero").getByRole("link", { name: "Import my library", exact: true }), page.locator(".bv-landing-hero").getByRole("link", { name: "Start with one book", exact: true }), page.locator(".bv-landing-covers a").first()]) {
      await target.focus();
      expect(await style(target, "outlineStyle"), scheme).toBe("solid");
      expect(parseFloat(await style(target, "outlineWidth")), scheme).toBeGreaterThanOrEqual(3);
      expect(ratio(await style(target, "outlineColor"), paper), scheme).toBeGreaterThanOrEqual(3);
    }
  }
});

test("reduced motion: nothing on the landing page animates", async ({ page, app: _app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page);
  for (const selector of [".bv-landing-hero", ".bv-landing-shelf", ".bv-landing-way"]) expect(await style(page.locator(selector).first(), "animationName"), selector).toBe("none");
});
