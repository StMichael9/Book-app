import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// A focus ring must stay visible on green surfaces (WCAG 2.4.7): controls inside the green banner use the on-green ring, and the skip link
// (itself green) draws its ring inside its own edge. Browser-only fixtures.
const book = id => ({ id, title: `Focus Book ${id}`, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: 300, published_year: 2001, english_title: null });
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [] };
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(401, { detail: "no" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/books") { const items = Array.from({ length: 30 }, (_, index) => book(9001 + index)); return reply(200, { items, total: 30, page: 1, size: 30 }); }
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...book(9001), description: "x", tags: [] });
      state.errors.push(path);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});
const channels = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = colour => { const [r, g, b] = channels(colour).map(value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const style = (locator, property) => locator.evaluate((node, property) => getComputedStyle(node)[property], property);

for (const [scheme, ring, surface] of [["light", "rgb(255, 253, 245)", "rgb(40, 81, 63)"], ["dark", "rgb(185, 211, 191)", "rgb(47, 42, 35)"]]) {
  test(`the banner's link shows a visible ring on its own surface (${scheme})`, async ({ page, app: _app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const banner = page.locator(".bv-library-banner");
    await expect(banner).toBeVisible();
    expect(await style(banner, "backgroundColor")).toBe(surface);
    const link = banner.getByRole("link");
    await link.focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); // keyboard focus, so :focus-visible applies
    expect(await style(link, "outlineStyle")).toBe("solid");
    expect(parseFloat(await style(link, "outlineWidth"))).toBeGreaterThanOrEqual(3);
    expect(await style(link, "outlineColor")).toBe(ring);
    expect(ratio(await style(link, "outlineColor"), surface)).toBeGreaterThanOrEqual(3);
  });
}

test("the skip link is visible when focused, with an on-green ring inside its edge", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.locator(".bv-skip");
  await expect(skip).toBeFocused();
  expect(await style(skip, "outlineColor")).toBe("rgb(255, 253, 245)");
  expect(parseInt(await style(skip, "outlineOffset"))).toBeLessThan(0);
  expect(ratio(await style(skip, "outlineColor"), await style(skip, "backgroundColor"))).toBeGreaterThanOrEqual(3);
});
