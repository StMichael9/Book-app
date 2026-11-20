import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The skip link is green, so its focus ring sits inside its own edge in the on-green ink (WCAG 2.4.7). Browser-only fixtures.
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

// A text field draws no ring: on keyboard or mouse focus its border really is green (computed), and the second pixel is the inset shadow.
for (const [scheme, green] of [["light", "rgb(40, 81, 63)"], ["dark", "rgb(185, 211, 191)"]]) {
  test(`a focused text field has a green border and no outline (${scheme})`, async ({ page, app: _app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    const field = page.getByLabel("Email address");
    await expect(field).toBeVisible();
    const before = await style(field, "borderTopColor");
    expect(before).not.toBe(green);
    await field.click(); // a mouse click on a text field: still the green border
    // The border eases to green over 150ms, so the computed value is read once it has settled.
    for (const side of ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"]) await expect.poll(() => style(field, side), { message: side }).toBe(green);
    expect(parseFloat(await style(field, "outlineWidth")) === 0 || (await style(field, "outlineStyle")) === "none").toBe(true);
    expect(await style(field, "boxShadow")).toContain(green);
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); // keyboard focus: the same
    await expect.poll(() => style(field, "borderTopColor")).toBe(green);
  });
}

test("the phone header has room for the keyboard ring above its controls", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const join = page.locator(".bv-header").getByRole("link", { name: "Join free", exact: true });
  await expect(join).toBeVisible();
  const top = (await join.boundingBox()).y;
  await join.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  expect(parseFloat(await style(join, "outlineOffset")) + parseFloat(await style(join, "outlineWidth")), "how far the ring reaches").toBeLessThanOrEqual(top);
});
