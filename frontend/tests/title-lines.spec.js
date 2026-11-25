import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Signed-out browser fixtures only. A second title line (english_title) shows only when it adds something: a catalogue repeat such as an
// edition or format tag, "by {author}" or a series name stays hidden, and a real translation still shows.
const CASES = [
  ["Twilight", "Twilight [audiobook]", false],
  ["Animal Farm", "Animal Farm by George Orwell", false],
  ["To Kill a Mockingbird", "To kill a mockingbird.", false],
  ["Harry Potter and the Half-Blood Prince", "Harry Potter and the Half-Blood Prince - Gryffindor Edition", false],
  ["Harry Potter and the Order of the Phoenix", "Harry Potter", false],
  ["Война и мир", "War and Peace", true],
];
const bookOf = (id, title, english) => ({ id, title, subtitle: null, authors: [{ id: 7, name: "A Writer" }], tags: [], cover_image_url: null, page_count: 200, published_year: 1970, english_title: english, description: "A story." });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [], items: CASES.map(([title, english], index) => bookOf(index + 1, title, english)) };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(401, { detail: "Not signed in" });
      if (path === "/books") return reply(200, { items: state.items, total: state.items.length, page: 1, size: 20 });
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

test("a second title line that only repeats the title is hidden, and a real translation still shows", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.locator("article.bv-book-card")).toHaveCount(CASES.length);
  for (const [title, english, shown] of CASES) {
    const card = page.locator("article.bv-book-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card, `${title} / ${english}`).toHaveCount(1);
    await expect(card.locator(".bv-english-title")).toHaveCount(shown ? 1 : 0);
    if (shown) await expect(card.locator(".bv-english-title")).toHaveText(english);
  }
  expect(app.errors).toEqual([]);
});
