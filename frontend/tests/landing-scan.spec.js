import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";
import { COPY, LIVE, faqItems, paidItems } from "../src/components/ui-v2/landing/landingCopy.js";

// The scan-first landing page: what shows with the default flags, what stays off the page, and the FAQ data that mirrors the visible answers.
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(401, { detail: "Session expired" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});
const visit = async page => { await page.goto("/"); await expect(page.locator(".bv-landing-hero")).toBeVisible(); };

test("with the default flags nothing that is not live appears", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const main = page.locator(".bv-landing-hero, .bv-landing-block, .bv-landing-paid, .bv-landing-faq, .bv-landing-final");
  const text = (await main.allInnerTexts()).join("\n"), html = (await main.evaluateAll(nodes => nodes.map(node => node.innerHTML))).join("\n");
  for (const word of [/lend|loan/i, /\bclubs?\b/i, /Club Plus/, /Patron/]) expect(text, String(word)).not.toMatch(word);
  expect(html).not.toContain("/switch");
  expect(text).toContain("Book links");
  expect(text).toContain("Bookvane is free forever. Here’s how it’s paid for, and none of it is selling your reading.");
  await page.locator(".bv-landing-faq summary", { hasText: "How is Bookvane free?" }).click();
  await expect(page.getByText("We don’t show ads.")).toBeVisible();
  await expect(page.locator(".bv-landing-faq details", { hasText: "Do you sell my data?" })).toContainText("No.");
  expect(app.errors).toEqual([]);
});

test("the FAQPage data lists exactly the visible questions, once", async ({ page, app: _app }) => {
  await visit(page);
  const ld = await page.locator("script#bv-landing-faq").evaluate(node => JSON.parse(node.textContent));
  expect(ld["@type"]).toBe("FAQPage");
  const visible = await page.locator(".bv-landing-faq summary span").allInnerTexts();
  expect(ld.mainEntity.map(item => item.name)).toEqual(visible);
  expect(visible).toHaveLength(11);
  expect(await page.locator("script#bv-landing-faq").count()).toBe(1);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://bookvane.me/");
  expect(await page.title()).toBe(COPY.title);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("a flag switches its line on, and only that line", () => {
  expect(LIVE).toEqual({ switchPage: false, lending: false, clubs: false, patron: false, clubPlus: false });
  expect(paidItems(LIVE).map(item => item.key)).toEqual(["links"]);
  expect(paidItems({ ...LIVE, patron: true, clubPlus: true }).map(item => item.key)).toEqual(["patron", "links", "clubPlus"]);
  expect(faqItems(LIVE)[0].a).toBe("Bookvane is free to use. It’s paid for by a small commission on some Bookshop.org links if you buy. We don’t show ads.");
  expect(faqItems({ ...LIVE, patron: true, clubPlus: true })[0].a).toContain("readers who choose to be Patrons, a small commission on some Bookshop.org links if you buy, and Club Plus for reading clubs");
});

test("the pictures carry width, height and alt text, and nothing scrolls sideways at 1440, 390 or 320, in both themes", async ({ page, app: _app }) => {
  for (const scheme of ["light", "dark"]) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    await visit(page);
    for (const image of await page.locator(".bv-landing-still").all()) {
      expect(Number(await image.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(await image.getAttribute("height"))).toBeGreaterThan(0);
      expect((await image.getAttribute("alt")).length).toBeGreaterThan(10);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${scheme} ${width}`).toBe(true);
  }
});
