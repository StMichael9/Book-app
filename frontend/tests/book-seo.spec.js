import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Browser fixtures only. A book's page describes the book in the document head (title, description, link-preview tags and
// Book JSON-LD) using only the stored Open Library text, and puts the defaults back when the reader leaves.
const DEFAULT_TITLE = "Bookvane · Your personal reading home";
const OL_TEXT = "A quiet harbour town, a lighthouse keeper who never leaves, and the winter that changes both of them for good. ".repeat(3).trim();
const books = [
  { id: 1, title: "Quiet Harbour", authors: [{ id: 1, name: "Ada Fixture" }, { id: 2, name: "Ben Fixture" }], tags: [], cover_image_url: "https://covers.openlibrary.org/b/id/123-M.jpg",
    description: OL_TEXT, published_year: 1999, page_count: 320, isbn13: "9780306406157", english_title: null },
  { id: 2, title: "Google Only", authors: [{ id: 3, name: "Cy Fixture" }], tags: [], cover_image_url: null, description: null, published_year: 2012, page_count: null, isbn13: null, english_title: null },
];
const GOOGLE_TEXT = "This text comes from Google Books and must never reach the page head.";

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(401, { detail: "Session expired" });
      if (path === "/books") return reply(200, { items: books, total: books.length, page: 1, size: 30 });
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return books[Number(one[1]) - 1] ? reply(200, books[Number(one[1]) - 1]) : reply(404, {});
      const description = path.match(/^\/books\/(\d+)\/description$/);
      if (description) return reply(200, Number(description[1]) === 2 ? { text: GOOGLE_TEXT, source: "google", link: "https://books.google.com/x" } : { text: OL_TEXT, source: "openlibrary", link: null });
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const head = page => page.evaluate(() => ({
  title: document.title,
  description: document.querySelector('meta[name="description"]')?.content,
  ogTitle: document.querySelector('meta[property="og:title"]')?.content,
  ogDescription: document.querySelector('meta[property="og:description"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content,
  ogType: document.querySelector('meta[property="og:type"]')?.content,
  ld: document.getElementById("bv-book-ld")?.textContent ?? null,
}));

test("a book page describes the book from its stored Open Library text", async ({ page, app }) => {
  await page.goto("/book/1");
  await expect(page.getByRole("heading", { name: "Quiet Harbour", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Quiet Harbour by Ada Fixture, Ben Fixture · Bookvane");
  const seo = await head(page);
  expect(seo.description.length).toBeLessThanOrEqual(156);
  expect(OL_TEXT.startsWith(seo.description.replace(/…$/, ""))).toBe(true);
  expect(seo.ogTitle).toBe(seo.title);
  expect(seo.ogDescription).toBe(seo.description);
  expect(seo.ogType).toBe("book");
  expect(seo.ogImage).toContain("wsrv.nl");
  const ld = JSON.parse(seo.ld);
  expect(ld).toMatchObject({ "@context": "https://schema.org", "@type": "Book", name: "Quiet Harbour", url: "https://bookvane.me/book/1", isbn: "9780306406157", numberOfPages: 320, datePublished: "1999" });
  expect(ld.author).toEqual([{ "@type": "Person", name: "Ada Fixture" }, { "@type": "Person", name: "Ben Fixture" }]);
  expect(ld.image).toBe(seo.ogImage);
  expect(await page.locator("#bv-book-ld").count()).toBe(1);
  expect(app.errors).toEqual([]);
});

test("a book whose text came from Google gets the plain fallback, never the Google text", async ({ page, app }) => {
  await page.goto("/book/2");
  await expect(page.getByRole("heading", { name: "Google Only", exact: true })).toBeVisible();
  await expect(page.getByText(GOOGLE_TEXT)).toBeVisible();
  await expect(page).toHaveTitle("Google Only by Cy Fixture · Bookvane");
  const seo = await head(page);
  expect(seo.description).toBe("Google Only by Cy Fixture, 2012. Save it, track it and find what to read next on Bookvane.");
  expect(JSON.stringify(seo)).not.toContain("Google Books");
  const ld = JSON.parse(seo.ld);
  expect(ld.isbn).toBeUndefined();
  expect(ld.numberOfPages).toBeUndefined();
  expect(ld.image).toBeUndefined();
  expect(app.errors).toEqual([]);
});

test("the defaults come back when the reader leaves the book", async ({ page, app: _app }) => {
  await page.goto("/browse");
  const before = await head(page);
  await page.goto("/book/1", { waitUntil: "commit" });
  await expect(page).toHaveTitle(/Quiet Harbour/);
  await page.getByRole("link", { name: "Discover", exact: true }).first().click();
  await expect(page).toHaveURL(/\/browse/);
  await expect(page).toHaveTitle("Discover · Bookvane");
  const after = await head(page);
  expect(after.ld).toBeNull();
  expect(after.ogType).toBe("website");
  expect(after.description).toBe(before.description);
  expect(after.ogTitle).toBe(DEFAULT_TITLE);
});

test("moving from one book to another replaces, not stacks, the head tags", async ({ page, app: _app }) => {
  await page.goto("/book/1");
  await expect(page).toHaveTitle(/Quiet Harbour/);
  await page.evaluate(() => { history.pushState({}, "", "/book/2"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page).toHaveTitle("Google Only by Cy Fixture · Bookvane");
  expect(await page.locator("#bv-book-ld").count()).toBe(1);
  expect(await page.locator('meta[property="og:title"]').count()).toBe(1);
});
