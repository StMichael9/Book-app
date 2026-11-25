import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The signed-out landing page, direction E, "Paper top", leading with the scan. Browser-only fixtures: every API call is mocked.
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
const visit = async page => { await page.goto("/"); await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); await expect(page.locator(".bv-landing-hero")).toBeVisible(); };
const SIGNUP = "/register?src=landing";
const IMPORT = "/switch";

test("paper top: no band, the header is on paper, and the hero holds the approved words and both doors", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await expect(page.locator(".bv-landing-band, .bv-header--band")).toHaveCount(0);
  expect(await style(page.locator(".bv-header"), "backgroundColor")).toBe("rgb(243, 238, 227)");
  const hero = page.locator(".bv-landing-hero");
  await expect(hero.getByRole("heading", { level: 1, name: "Your reading life, kept private." })).toBeVisible();
  await expect(hero.getByText("Scan the barcodes on your books with your phone. Free to use, and private unless you choose to share.")).toBeVisible();
  await expect(page.getByText("No card. No feed. Nothing public by default.")).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "Create a free account", exact: true })).toHaveAttribute("href", SIGNUP);
  await expect(hero.getByRole("link", { name: "Browse books first", exact: true })).toHaveAttribute("href", "/browse");
  expect(app.errors).toEqual([]);
});

test("Create a free account carries the source; Browse books first lands on Discover with the search field focused; the library door signs up first", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await expect(page.getByRole("link", { name: "Bring your library over", exact: true })).toHaveAttribute("href", IMPORT);
  await page.locator(".bv-landing-hero").getByRole("link", { name: "Create a free account", exact: true }).click();
  await expect(page).toHaveURL(/\/register\?src=landing$/);
  await visit(page);
  await page.locator(".bv-landing-hero").getByRole("link", { name: "Browse books first", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator("#bv-search-query")).toBeFocused();
});

test("desktop is two columns with the phone on the right; the phone stacks it under the text", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  let copy = await box(page.locator(".bv-landing-copy")), phone = await box(page.locator(".bv-landing-hero .bv-landing-shot"));
  expect(phone.left).toBeGreaterThan(copy.right - 1);
  expect(phone.width).toBeLessThanOrEqual(423);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  copy = await box(page.locator(".bv-landing-copy")); phone = await box(page.locator(".bv-landing-hero .bv-landing-shot"));
  expect(phone.top).toBeGreaterThanOrEqual(copy.bottom - 1);
  for (const door of await page.locator(".bv-landing-hero .bv-landing-doors .bv-button").all()) expect((await door.boundingBox()).width).toBeGreaterThan(300);
});

test("the sections come in the approved order, and the old sections are gone", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  expect(await page.locator(".bv-landing-block h2, .bv-landing-paid h2, .bv-landing-faq h2, .bv-landing-final h2").allInnerTexts()).toEqual(["Scan a stack of books at once.", "Moving from Goodreads or StoryGraph?", "Only you can see your notes.", "How Bookvane is paid for", "Questions", "Start your shelf."]);
  for (const gone of ["Two ways to begin", "Open a new chapter", "Every book you’ve read, own and want, in one quiet place."]) await expect(page.getByText(gone)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scan your first books" })).toHaveAttribute("href", SIGNUP);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Scan your first books" })).toHaveAttribute("href", "/register?src=landing&returnTo=%2Fmy-books");
});

test("320px at 200% text still holds: no horizontal scroll, the doors stay reachable", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await visit(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".bv-landing-hero").getByRole("link", { name: "Create a free account", exact: true })).toBeVisible();
});

test("a signed-in reader still lands on Home", async ({ page, app }) => {
  app.authenticated = true;
  await page.addInitScript(() => { try { localStorage.setItem("bookvane:session-hint:v1", "1"); } catch { /* none */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".bv-landing-hero")).toHaveCount(0);
});

test("dark: the landing text keeps AA contrast and the dark captures load", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const paper = await style(page.locator(".bv-root"), "backgroundColor");
  for (const [label, locator] of [["heading", page.locator(".bv-landing-copy h1")], ["line", page.locator(".bv-landing-lead")]]) expect(ratio(await style(locator, "color"), paper), label).toBeGreaterThanOrEqual(4.5);
  const primary = page.locator(".bv-landing-hero").getByRole("link", { name: "Create a free account", exact: true });
  expect(ratio(await style(primary, "color"), await style(primary, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".bv-landing-hero img")).toHaveAttribute("src", "/landing/scan-hero-dark@2x.png");
});

test("focus is visible on the doors, in both themes", async ({ page, app: _app }) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page);
    const paper = await style(page.locator(".bv-root"), "backgroundColor");
    for (const target of [page.locator(".bv-landing-hero").getByRole("link", { name: "Create a free account", exact: true }), page.locator(".bv-landing-hero").getByRole("link", { name: "Browse books first", exact: true })]) {
      await target.focus();
      expect(await style(target, "outlineStyle"), scheme).toBe("solid");
      expect(parseFloat(await style(target, "outlineWidth")), scheme).toBeGreaterThanOrEqual(3);
      expect(ratio(await style(target, "outlineColor"), paper), scheme).toBeGreaterThanOrEqual(3);
    }
  }
});

test("reduced motion: the FAQ chevron does not animate", async ({ page, app: _app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page);
  expect(await style(page.locator(".bv-landing-faq summary svg").first(), "transitionDuration")).toBe("0s");
});
