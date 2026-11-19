import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The signed-out landing page, direction E: a cloth band holds the header, the promise and one action; a paper sheet rests on its edge.
// Browser-only fixtures: every API call is mocked.
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
const visit = async page => { await page.goto("/"); await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); await expect(page.locator(".bv-landing-band")).toBeVisible(); };

test("signed out: the header sits inside the band, which holds the heading, the line and one primary action", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const header = page.locator(".bv-header"), band = page.locator(".bv-landing-band");
  await expect(header).toHaveClass(/bv-header--band/);
  expect(await style(header, "backgroundColor")).toBe("rgb(40, 81, 63)");
  expect(await style(band, "backgroundColor")).toBe("rgb(40, 81, 63)");
  expect(Math.abs((await box(header)).bottom - (await box(band)).top)).toBeLessThanOrEqual(1); // one continuous band
  await expect(band.getByRole("heading", { level: 1, name: "Bring your Goodreads shelves home." })).toBeVisible();
  await expect(band.getByText("Your shelves, reading dates and notes, in one private place only you can see.")).toBeVisible();
  await expect(band.locator(".bv-button")).toHaveCount(1); // one filled action
  await expect(band.getByRole("link", { name: "Import my library", exact: true })).toHaveAttribute("href", "/register?src=landing&returnTo=%2Fmy-books%2Fimport");
  await expect(band.getByRole("link", { name: "Explore books", exact: true })).toHaveAttribute("href", "/browse");
  await expect(page.getByRole("heading", { name: "Private by default.", exact: true })).toBeVisible();
  await expect(page.getByText("No feed, no public ratings. Bookvane never asks for your Goodreads login.")).toBeVisible();
  await expect(page.getByText("A little space for your reading life")).toBeVisible();
  expect(app.errors).toEqual([]);
});

test("the paper sheet rests on the band's lower edge, and no cover sits on the cloth", async ({ page, app: _app }) => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await visit(page);
    const band = await box(page.locator(".bv-landing-band")), sheet = await box(page.locator(".bv-landing-sheet"));
    expect(sheet.top, `${width}: the sheet starts inside the band`).toBeLessThan(band.bottom);
    expect(sheet.bottom, `${width}: and ends below it`).toBeGreaterThan(band.bottom);
    const cover = await box(page.locator(".bv-landing-sheet .bv-cover"));
    expect(cover.top).toBeGreaterThanOrEqual(sheet.top); expect(cover.bottom).toBeLessThanOrEqual(sheet.bottom);
    expect(await style(page.locator(".bv-landing-sheet"), "backgroundColor")).toBe("rgb(253, 250, 243)"); // paper, not cloth
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal scroll`).toBe(true);
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  }
});

test("320px at 200% text still holds: no horizontal scroll, the action stays reachable", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await visit(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "Import my library", exact: true })).toBeVisible();
});

test("one primary action: Import my library signs up first and carries the source; Explore books goes to Discover", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await page.getByRole("link", { name: "Import my library", exact: true }).click();
  await expect(page).toHaveURL(/\/register\?src=landing&returnTo=%2Fmy-books%2Fimport$/);
  await page.goto("/");
  await page.locator(".bv-landing-band").getByRole("link", { name: "Explore books", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator(".bv-header")).not.toHaveClass(/bv-header--band/); // the band is the landing's only
});

test("a signed-in reader still lands on Home, with no band", async ({ page, app }) => {
  app.authenticated = true;
  await page.addInitScript(() => { try { localStorage.setItem("bookvane:session-hint:v1", "1"); } catch { /* none */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".bv-landing-band")).toHaveCount(0);
  await expect(page.locator(".bv-header")).not.toHaveClass(/bv-header--band/);
});

test("dark: the band takes the dark cloth and its text keeps AA contrast", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const band = await style(page.locator(".bv-landing-band"), "backgroundColor");
  expect(band).toBe("rgb(29, 58, 45)");
  expect(await style(page.locator(".bv-header"), "backgroundColor")).toBe(band);
  for (const [label, locator] of [["heading", page.locator(".bv-landing-copy h1")], ["line", page.locator(".bv-landing-lead")], ["brand", page.locator(".bv-header .bv-brand")], ["Sign in", page.locator(".bv-header").getByRole("link", { name: "Sign in" })], ["Explore books", page.locator(".bv-landing-actions").getByRole("link", { name: "Explore books" })]])
    expect(ratio(await style(locator, "color"), band), label).toBeGreaterThanOrEqual(4.5);
  const primary = page.getByRole("link", { name: "Import my library", exact: true });
  expect(ratio(await style(primary, "color"), await style(primary, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);
});

test("light: band text contrast numbers", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const band = await style(page.locator(".bv-landing-band"), "backgroundColor");
  expect(band).toBe("rgb(40, 81, 63)");
  for (const [label, locator] of [["heading", page.locator(".bv-landing-copy h1")], ["line", page.locator(".bv-landing-lead")], ["brand", page.locator(".bv-header .bv-brand")], ["Sign in", page.locator(".bv-header").getByRole("link", { name: "Sign in" })], ["Explore books", page.locator(".bv-landing-actions").getByRole("link", { name: "Explore books" })]])
    expect(ratio(await style(locator, "color"), band), label).toBeGreaterThanOrEqual(4.5);
  const primary = page.getByRole("link", { name: "Import my library", exact: true });
  expect(ratio(await style(primary, "color"), await style(primary, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);
});

test("focus is visible on the band in both themes: an on-band ring of at least 3:1", async ({ page, app: _app }) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page);
    const band = await style(page.locator(".bv-landing-band"), "backgroundColor");
    for (const target of [page.locator(".bv-header").getByRole("link", { name: "Sign in" }), page.getByRole("link", { name: "Import my library", exact: true }), page.locator(".bv-landing-actions").getByRole("link", { name: "Explore books" })]) {
      await target.focus();
      expect(await style(target, "outlineStyle"), scheme).toBe("solid");
      expect(parseFloat(await style(target, "outlineWidth")), scheme).toBeGreaterThanOrEqual(3);
      expect(ratio(await style(target, "outlineColor"), band), scheme).toBeGreaterThanOrEqual(3);
    }
  }
});

test("reduced motion: the band and its sheet have no animation or transition", async ({ page, app: _app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page);
  for (const selector of [".bv-landing-band", ".bv-landing-sheet", ".bv-header"]) {
    expect(await style(page.locator(selector), "animationName"), selector).toBe("none");
  }
});
