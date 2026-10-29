import { test, expect } from "@playwright/test";

// Browser fixtures only: every API request is intercepted. Port 5190 serves a build with an affiliate ID, 5189 one without.
const WITH_ID = "http://127.0.0.1:5190", WITHOUT_ID = "http://127.0.0.1:5189", ISBN = "9780306406157";
const book = (id, isbn13 = ISBN) => ({ id, title: `Copy fixture ${id}`, authors: [{ id: 1, name: "Fixture Author" }], tags: [], isbn13,
  description: "A fixture.", published_year: 2001, page_count: 200, cover_image_url: null, english_title: null });
const entry = (id, flags) => ({ id, book_id: id, book: book(id), is_owned: false, is_wanted: false, version: 1, reading_state: null,
  private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...flags });
const entries = [entry(1, { is_wanted: true }), entry(2, { is_owned: true }), entry(3, { reading_state: "reading" }), entry(4, { reading_state: "finished" })];
const FACETS = { want: x => x.is_wanted, owned: x => x.is_owned, reading: x => x.reading_state === "reading", finished: x => x.reading_state === "finished" };

async function mock(page, { signedIn = false, isbn13 = ISBN, nextRead = false } = {}) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/test-api/")) return route.continue();
    const path = url.pathname.slice("/test-api".length), reply = json => route.fulfill({ status: 200, json });
    if (path === "/auth/refresh") return route.fulfill({ status: signedIn ? 200 : 401, json: {} });
    if (path === "/me/reading-capabilities") return reply({ enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: false, next_read: nextRead } });
    if (path === "/events") return route.fulfill({ status: 204, body: "" });
    if (path === "/me/home") return reply({ current_reads: [], reading_count: 0, paused_count: 0 });
    if (path === "/me/next-read") return reply({ source: "want", session_id: url.searchParams.get("session_id"), rotation: 0, interests: [], eligible_count: 1, remaining_count: 1, known_page_count: 1,
      items: [{ key: "book:1", entry_id: 1, version: 1, book: book(1), is_owned: false, is_wanted: true, revisit: false, reasons: [{ code: "want" }] }] });
    if (path === "/me/library") {
      const facet = url.searchParams.get("facet"), items = FACETS[facet] ? entries.filter(FACETS[facet]) : entries;
      const counts = { all: entries.length, ...Object.fromEntries(Object.entries(FACETS).map(([key, test]) => [key, entries.filter(test).length])), paused: 0, dnf: 0 };
      return reply({ items, counts, total: items.length, next_cursor: null });
    }
    if (path === "/me/library/lookup") return reply({ items: [] });
    if (path === "/me/books") return reply([]);
    if (/^\/books\/\d+$/.test(path)) return reply(book(Number(path.split("/")[2]), isbn13));
    if (path === "/books") return reply({ items: [book(1), book(2)], total: 2, page: 1, page_size: 20, pages: 1 });
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}
const buyUrl = id => `https://bookshop.org/search?keywords=${encodeURIComponent(`Copy fixture ${id} Fixture Author`)}&affiliate=130585`;
const copyLink = page => page.getByRole("link", { name: /Find it at Bookshop\.org/ });

for (const signedIn of [false, true]) {
  test(`book page offers a sponsored Bookshop link ${signedIn ? "signed in" : "signed out"}`, async ({ page }) => {
    await mock(page, { signedIn });
    await page.goto(`${WITH_ID}/book/7`);
    await expect(page.getByRole("heading", { name: "Copy fixture 7" })).toBeVisible();
    const link = copyLink(page);
    await expect(link).toHaveAttribute("href", buyUrl(7));
    await expect(link).toHaveAttribute("target", "_blank");
    expect((await link.getAttribute("rel")).split(" ").sort()).toEqual(["noopener", "noreferrer", "sponsored"]);
    await expect(page.getByText("Bookvane may earn a small commission.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get a copy" })).toBeVisible();
  });
}

test("the Get a copy row still shows without an ISBN-13", async ({ page }) => {
  await mock(page, { isbn13: null });
  await page.goto(`${WITH_ID}/book/7`);
  await expect(copyLink(page)).toHaveAttribute("href", buyUrl(7));
});

test("the Get a copy row is hidden without an affiliate ID", async ({ page }) => {
  await mock(page);
  await page.goto(`${WITHOUT_ID}/book/7`);
  await expect(page.getByRole("heading", { name: "Copy fixture 7" })).toBeVisible();
  await expect(page.getByText("About this book")).toBeVisible();
  await expect(copyLink(page)).toHaveCount(0);
  await expect(page.getByText("Bookvane may earn a small commission.")).toHaveCount(0);
});

test("Want to read cards keep their link; Own, Reading, Finished and Discover have none", async ({ page }) => {
  await mock(page, { signedIn: true });
  await page.goto(`${WITH_ID}/my-books?status=want`);
  const buy = page.getByRole("link", { name: /Find on Bookshop/ });
  await expect(buy).toHaveCount(1);
  await expect(buy).toHaveAttribute("href", buyUrl(1));
  for (const facet of ["owned", "reading", "finished"]) {
    await page.goto(`${WITH_ID}/my-books?status=${facet}`);
    await expect(page.getByText(/Copy fixture \d/).first()).toBeVisible();
    await expect(page.locator('a[href*="bookshop.org"]')).toHaveCount(0);
  }
  await page.goto(`${WITH_ID}/browse`);
  await expect(page.getByText(/Copy fixture \d/).first()).toBeVisible();
  await expect(page.locator('a[href*="bookshop.org"]')).toHaveCount(0);
});

test("the privacy page discloses the Bookshop commission", async ({ page }) => {
  await mock(page);
  await page.goto(`${WITHOUT_ID}/privacy`);
  await expect(page.getByText("Some book links go to Bookshop.org; if you buy, Bookvane may earn a small commission at no cost to you.")).toBeVisible();
});

test("next-read cards offer a quiet sponsored Get a copy link with the disclosure", async ({ page }) => {
  await mock(page, { signedIn: true, nextRead: true });
  await page.goto(`${WITH_ID}/home`);
  const preview = page.getByRole("region", { name: "Choose your next read" });
  const link = preview.getByRole("link", { name: /Get a copy of Copy fixture 1.*opens Bookshop\.org in a new tab/ });
  await expect(link).toHaveAttribute("href", buyUrl(1));
  await expect(link).toHaveAttribute("target", "_blank");
  expect((await link.getAttribute("rel")).split(" ").sort()).toEqual(["noopener", "noreferrer", "sponsored"]);
  await expect(preview.getByText("Bookvane may earn a small commission.")).toBeVisible();
  await preview.getByRole("button", { name: "Choose next" }).click();
  const card = page.locator(".bv-next-read .bv-book-card").first();
  await expect(card.getByRole("link", { name: /Get a copy of Copy fixture 1.*opens Bookshop\.org in a new tab/ })).toHaveAttribute("href", buyUrl(1));
  await expect(card.getByText("Bookvane may earn a small commission.")).toBeVisible();
});

test("next-read shows no Get a copy link without an affiliate ID", async ({ page }) => {
  await mock(page, { signedIn: true, nextRead: true });
  await page.goto(`${WITHOUT_ID}/home`);
  await expect(page.getByRole("heading", { name: "Copy fixture 1" })).toBeVisible();
  await expect(page.locator('a[href*="bookshop.org"]')).toHaveCount(0);
  await expect(page.getByText("Bookvane may earn a small commission.")).toHaveCount(0);
});

test("Get a copy clicks send get_copy_click with their placement and nothing else", async ({ page }) => {
  await mock(page, { signedIn: true, nextRead: true });
  const clickBeacon = async (locator) => {
    await locator.evaluate(element => element.addEventListener("click", event => event.preventDefault()));
    const [request] = await Promise.all([page.waitForRequest(request => request.url().endsWith("/test-api/events")), locator.click()]);
    return JSON.parse(request.postData());
  };
  await page.goto(`${WITH_ID}/book/7`);
  expect(await clickBeacon(copyLink(page))).toEqual({ name: "get_copy_click", placement: "book_page" });
  await page.goto(`${WITH_ID}/my-books?status=want`);
  expect(await clickBeacon(page.getByRole("link", { name: /Find on Bookshop/ }))).toEqual({ name: "get_copy_click", placement: "want_card" });
  await page.goto(`${WITH_ID}/home`);
  expect(await clickBeacon(page.getByRole("region", { name: "Choose your next read" }).getByRole("link", { name: /Get a copy of/ }))).toEqual({ name: "get_copy_click", placement: "next_read" });
});
