import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// Search suggestions as you type (T61), with /autocomplete/books mocked. No hosted service is contacted.
const FLAG_FILE = fileURLToPath(new URL("../src/components/ui-v2/searchSuggestFlag.js", import.meta.url));
const FLAG_ON = /SEARCH_SUGGEST\s*=\s*true/.test(readFileSync(FLAG_FILE, "utf8"));
const sleep = ms => new Promise(done => setTimeout(done, ms));

const book = (id, title) => ({ id, title, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: 300, published_year: 2001, english_title: null });
const SUGGESTIONS = [
  { id: 9101, title: "Dûne Messiah", authors: ["Frank Herbert"], cover_url: null, year: 1969 },
  { id: 9102, title: "Dune", authors: ["Frank Herbert"], cover_url: null, year: 1965 },
  { id: 9103, title: "The Dune Encyclopedia", authors: [], cover_url: null, year: null },
];

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    // `suggest(q)` can return { delay, status, body } to shape the answer; `calls` lists every suggestion request.
    const state = { suggest: null, calls: [], booksCalls: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(401, { detail: "Session expired" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/autocomplete/books") {
        const q = url.searchParams.get("q") || "";
        state.calls.push({ q, limit: url.searchParams.get("limit"), at: Date.now() });
        const shaped = state.suggest?.(q) || {};
        if (shaped.delay) await sleep(shaped.delay);
        if (shaped.status && shaped.status !== 200) return reply(shaped.status, { detail: "no" });
        return reply(200, shaped.body ?? SUGGESTIONS);
      }
      if (path === "/books") {
        state.booksCalls.push(url.search);
        const items = Array.from({ length: 5 }, (_, index) => book(9001 + index, `Live Browse ${index + 1}`));
        return reply(200, { items, total: items.length, page: 1, size: 20 });
      }
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...book(Number(path.split("/")[2]), `Book ${path.split("/")[2]}`), description: "A synthetic description.", tags: [] });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      // A book page asks for the author's other books (More by); these fixtures have none.
      if (/^\/authors\/\d+\/books$/.test(path)) return route.fulfill({ status: 200, json: { items: [], total: 0, page: 1, size: 24, pages: 1 } });
      if (path === "/me/clubs") return route.fulfill({ status: 200, json: { items: [] } });
      state.errors.push(`Unhandled ${request.method()} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const header = page => page.getByRole("combobox", { name: "Search books" });
const list = page => page.getByRole("listbox", { name: "Book suggestions" });
// The account check settles first (a guest sees "Sign in"), so typing is never done while the header is still being redrawn.
const visit = async (page, path) => { await page.goto(path); await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); };
const typeSlowly = (input, text) => input.pressSequentially(text, { delay: 25 });

if (!FLAG_ON) {
  test("with SEARCH_SUGGEST off: no suggestion request, no list, and Enter searches as before", async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page, "/book/9001");
    const input = page.getByRole("searchbox", { name: "Search books" });
    await typeSlowly(input, "dune");
    await sleep(500);
    expect(app.calls).toEqual([]);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/browse\?q=dune$/);
  });
}

test.describe("with SEARCH_SUGGEST on", () => {
  test.skip(!FLAG_ON, "needs SEARCH_SUGGEST = true");
  test.beforeEach(async ({ page, app: _app }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test("one character sends nothing; two send one request after the pause; fast typing sends one", async ({ page, app }) => {
    await visit(page, "/book/9001");
    const input = header(page);
    await input.pressSequentially("d");
    await sleep(500);
    expect(app.calls).toEqual([]);
    await input.pressSequentially("u");
    await expect(list(page)).toBeVisible();
    expect(app.calls.map(call => call.q)).toEqual(["du"]);
    expect(app.calls[0].limit).toBe("6");
    await input.fill("");
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await sleep(400);
    expect(app.calls.map(call => call.q)).toEqual(["du", "dune"]); // "dun" was never asked: it was typed inside the pause
    expect(app.booksCalls.filter(search => /[?&](q|book)=/.test(search))).toEqual([]); // never /books?q= while typing
  });

  test("each row shows a cover or jacket, the title with the typed letters bold, then author and year", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    await typeSlowly(header(page), "dune");
    const rows = list(page).getByRole("option");
    await expect(rows).toHaveCount(4); // three books and See all
    const first = rows.nth(0);
    await expect(first.locator(".bv-suggest-cover .bv-cover")).toBeVisible(); // the jacket, as this book has no artwork
    await expect(first.locator(".bv-suggest-match")).toHaveText("Dûne"); // case and accents ignored
    await expect(first.locator(".bv-suggest-meta")).toHaveText("Frank Herbert · 1969");
    await expect(rows.nth(1).locator(".bv-suggest-match")).toHaveText("Dune");
    await expect(rows.nth(2).locator(".bv-suggest-meta")).toHaveCount(0); // no author and no year: no line at all
    await expect(rows.nth(3)).toHaveText(/See all results for “dune”/);
    expect(await first.locator(".bv-suggest-match").evaluate(node => getComputedStyle(node).fontWeight)).toBe("700");
    expect(await first.locator(".bv-suggest-title").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(17);
    expect((await first.boundingBox()).height).toBeGreaterThanOrEqual(44);
  });

  test("arrow keys wrap, Enter on a row opens the book, and nothing is highlighted at first", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await expect(list(page).locator("[aria-selected=true]")).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await input.press("ArrowDown");
    await expect(list(page).getByRole("option").nth(0)).toHaveAttribute("aria-selected", "true");
    await input.press("ArrowUp"); // wraps to the See all row
    await expect(list(page).getByRole("option").nth(3)).toHaveAttribute("aria-selected", "true");
    expect(await input.getAttribute("aria-activedescendant")).toBe(await list(page).getByRole("option").nth(3).getAttribute("id"));
    await input.press("ArrowDown"); // wraps to the first book
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/book\/9102$/);
  });

  test("Enter with nothing highlighted searches as before; the See all row does the same", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await input.press("Enter");
    await expect(page).toHaveURL(/\/browse\?q=dune$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/book\/9001$/);
    await header(page).fill(""); // Back can bring the field back with "dune" still in it; type into an empty field
    await typeSlowly(header(page), "dune");
    await expect(header(page)).toHaveValue("dune");
    await list(page).getByRole("option", { name: /See all results/ }).click();
    await expect(page).toHaveURL(/\/browse\?q=dune$/);
  });

  test("a click opens the book; Escape closes the list and a second Escape clears the field", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await input.press("Escape");
    await expect(list(page)).toHaveCount(0);
    await expect(input).toHaveValue("dune");
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await typeSlowly(input, "dune");
    await list(page).getByRole("option").nth(1).click();
    await expect(page).toHaveURL(/\/book\/9102$/);
  });

  test("clicking outside or tabbing away closes the list", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await input.press("Tab");
    await expect(list(page)).toHaveCount(0);
    await input.focus();
    await input.pressSequentially("s");
    await expect(list(page)).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(list(page)).toHaveCount(0);
  });

  test("no match: one line and the See all row; an error: no list at all, and Enter still works", async ({ page, app }) => {
    app.suggest = q => (q === "zzzz" ? { body: [] } : q === "boom" ? { status: 500 } : null);
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "zzzz");
    await expect(page.getByText("No books match “zzzz”")).toBeVisible();
    await expect(list(page).getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "No books match" })).toBeAttached();
    await input.fill("");
    await typeSlowly(input, "boom");
    await expect.poll(() => app.calls.some(call => call.q === "boom")).toBe(true);
    await sleep(300);
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByText(/couldn’t|error|trouble/i)).toHaveCount(0);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/browse\?q=boom$/);
  });

  test("a failing suggestion service (503, or no network) is silent: no banner, no list, Enter still searches", async ({ page, app }) => {
    app.suggest = q => (q === "down" ? { status: 503 } : null);
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "down");
    await expect.poll(() => app.calls.some(call => call.q === "down")).toBe(true);
    await sleep(300);
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByText(/trouble on our end/i)).toHaveCount(0);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/browse\?q=down$/);
    await visit(page, "/book/9001");
    await page.route("**/test-api/autocomplete/books*", route => route.abort());
    await typeSlowly(header(page), "gone");
    await sleep(500);
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByText(/trouble on our end/i)).toHaveCount(0);
    await header(page).press("Enter");
    await expect(page).toHaveURL(/\/browse\?q=gone$/);
  });

  test("the live region announces the count", async ({ page, app: _app }) => {
    await visit(page, "/book/9001");
    await typeSlowly(header(page), "dune");
    await expect(page.getByRole("status").filter({ hasText: "3 books" })).toBeAttached();
  });

  test("a slow answer for an earlier query never replaces the current one, and a request still running is aborted", async ({ page, app }) => {
    app.suggest = q => (q === "du" ? { delay: 900, body: [{ id: 1, title: "Du old", authors: [], cover_url: null, year: null }] } : q === "dun" ? { body: [{ id: 2, title: "Dune new", authors: [], cover_url: null, year: null }] } : null);
    await visit(page, "/book/9001");
    const input = header(page);
    await input.pressSequentially("du");
    await expect.poll(() => app.calls.length).toBe(1);
    await input.pressSequentially("n");
    await expect(list(page).getByRole("option").first()).toContainText("Dune new");
    await sleep(1100);
    await expect(list(page).getByText("Du old")).toHaveCount(0);
  });

  test("an answer for words no longer in the field is dropped", async ({ page, app }) => {
    app.suggest = q => (q === "dune" ? { delay: 600 } : null);
    await visit(page, "/book/9001");
    const input = header(page);
    await typeSlowly(input, "dune");
    await expect.poll(() => app.calls.length).toBe(1);
    await input.fill("d");
    await sleep(900);
    await expect(list(page)).toHaveCount(0);
  });

  test("on a phone, Discover's own box shows the list full width under it, and it opens a book", async ({ page, app: _app }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, "/browse");
    const input = page.getByRole("combobox", { name: "Search book titles" });
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    const form = await page.locator(".bv-search-form").boundingBox(), sheet = await page.locator(".bv-suggest").boundingBox();
    expect(Math.abs(sheet.x - form.x)).toBeLessThanOrEqual(2); // the form has a 1px border
    expect(Math.abs(sheet.width - form.width)).toBeLessThanOrEqual(2);
    expect(sheet.y).toBeGreaterThanOrEqual(form.y + form.height);
    await expect(page.locator(".bv-suggest-hint")).toBeHidden(); // no Enter hint on a phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await list(page).getByRole("option").nth(0).click();
    await expect(page).toHaveURL(/\/book\/9101$/);
  });

  test("Discover: Enter searches the title as before, and Author mode has no suggestions", async ({ page, app }) => {
    await visit(page, "/browse");
    const input = page.getByRole("combobox", { name: "Search book titles" });
    await typeSlowly(input, "dune");
    await expect(list(page)).toBeVisible();
    await input.press("Enter");
    await expect(page).toHaveURL(/\/browse\?book=dune$/);
    await page.getByLabel("Search by").selectOption("author");
    const before = app.calls.length;
    await page.getByRole("searchbox", { name: "Search authors" }).fill("Herbert");
    await sleep(500);
    expect(app.calls.length).toBe(before);
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("dark mode: the list is a readable sheet", async ({ page, app: _app }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await visit(page, "/book/9001");
    await typeSlowly(header(page), "dune");
    await expect(list(page)).toBeVisible();
    const colours = await page.locator(".bv-suggest").evaluate(node => { const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color }; });
    expect(colours.background).toBe("rgb(59, 53, 44)");
    expect(colours.color).toBe("rgb(240, 233, 220)");
  });
});
