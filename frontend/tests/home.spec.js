import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";
import { greyBehindCovers } from "./support/cover-bg.js";

// Browser fixtures only. Home: greeting, Reading now with the progress sheet, Up next (T41 pins are mocked from the
// contract), Can't decide? and the year at a glance.
const TITLES = ["Middlemarch", "Circe", "Kindred", "The Overstory", "Beloved", "Gilead", "Hamnet", "Orlando"];
const book = (id, title, pages = 300) => ({ id, title, authors: [{ id, name: `Author ${id}` }], tags: [], cover_image_url: null, page_count: pages, english_title: null });
const entry = (id, extra = {}) => ({ id: 100 + id, book_id: id, book: book(id, TITLES[id - 1], id <= 3 ? 200 : 400), is_owned: id % 2 === 1, is_wanted: id % 2 === 0, version: 1, reading_state: null,
  private_title: null, private_author: null, save_note: null, snippet: null, created_at: `2026-0${(id % 9) + 1}-01T00:00:00Z`, updated_at: "2026-10-01T00:00:00Z", ...extra });
const reading = (id, title, value, total) => ({ entry: { ...entry(id), id: 200 + id, book_id: 50 + id, book: book(50 + id, title, total), reading_state: "reading", version: 3 },
  attempt: { id: `attempt-${id}`, state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: value, total_pages: total } });

// Up next takes the first five books (four on a phone) and "Can't decide?" leaves those out, so a test that needs picks behind a pill uses a longer shelf.
// Books are owned when their id is odd, short (200 pages) up to id 3 unless `pages` says otherwise, and the first eight keep the fixture's titles.
const shelf = (count, pages = id => (id <= 3 ? 200 : 400)) => Array.from({ length: count }, (_, index) => entry(index + 1, { book: book(index + 1, TITLES[index] || `Title ${index + 1}`, pages(index + 1)) }));
const pin = (id, extra = {}) => ({ entry_id: 100 + id, book_id: id, title: TITLES[id - 1], authors: [`Author ${id}`], cover_url: null, owned: id % 2 === 1, want: id % 2 === 0, page_count: 300, ...extra });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { errors: [], requests: [], name: "Rae Fixture", currentReads: [reading(1, "Piranesi", 156, 245), reading(2, "The Fifth Season", 101, 468)],
      entries: TITLES.map((_, index) => entry(index + 1)), pins: null, lists: null, workspaceEntries: {}, readOnly: false, pinsStatus: 200, putStatus: 200, stats: null, facets: { length: [{ value: "short", label: "Short", count: 3 }], subject: [{ value: 7, label: "Fantasy", count: 4 }] }, hour: null };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path, method, body, query: url.searchParams });
      if (path === "/books") return reply(200, { items: TITLES.map((title, index) => book(index + 1, title)), total: 47248, page: 1, size: 20 });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/me/profile") return reply(200, { display_name: state.name, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1, features: { reading_actions: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: state.currentReads, reading_count: state.currentReads.length, paused_count: 0 });
      if (path === "/me/stats") return reply(200, state.stats || { year: 2026, books_finished: 23, pages_read: 7840, median_days: 11, biggest_month: 5, by_month: [2, 1, 3, 2, 4, 1, 3, 2, 1, 3, 1, 0], top_genres: [], shelf: { owned_unfinished: 4, want: 4, oldest_waiting: { entry_id: 108, book_id: 8, title: "Orlando", cover_url: null, saved_at: "2021-03-01T00:00:00Z" } } });
      if (path === "/me/up-next") {
        if (method === "PUT") {
          if (state.putStatus !== 200) return reply(state.putStatus, { detail: "Up next can hold 5 books." });
          state.pins = body.entry_ids.map(id => pin(id - 100));
          return reply(200, state.pins);
        }
        return state.pinsStatus === 200 ? reply(200, state.pins ?? []) : reply(state.pinsStatus, { detail: "Not found" });
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => { const found = state.entries.find(item => item.book_id === id); return { book_id: id, entry_id: found?.id ?? null, version: found?.version ?? null, is_owned: found?.is_owned ?? false, is_wanted: found?.is_wanted ?? false, reading_state: null }; }) });
      if (path === "/me/library") {
        if (state.delay) await new Promise(done => setTimeout(done, state.delay));
        const facet = url.searchParams.get("facet"), owned = url.searchParams.get("owned") === "true";
        const sort = url.searchParams.get("sort");
        if (sort === "added_oldest" && state.noOldestSort) return reply(422, { detail: "Unknown sort" });
        let items = [...state.entries].sort((a, b) => sort === "added_oldest" ? a.id - b.id : b.id - a.id);
        if (facet === "want") items = items.filter(item => item.is_wanted);
        if (owned) items = items.filter(item => item.is_owned);
        if (url.searchParams.get("length") === "short") items = items.filter(item => item.book.page_count < 250);
        return reply(200, { items, counts: { all: state.entries.length, owned: state.entries.filter(item => item.is_owned).length, want: state.entries.filter(item => item.is_wanted).length, reading: 2, paused: 0, finished: 0, dnf: 0 }, total: items.length, next_cursor: null, facets: state.facets, index: null });
      }
      if (path === "/me/lists" && method === "GET" && state.lists) return reply(200, state.lists.map(list => ({ id: list.id, name: list.name, description: null, is_public: false, book_count: list.books.length, covers: [], has_book: list.books.includes(Number(url.searchParams.get("book_id"))) })));
      const listBook = path.match(/^\/me\/lists\/(\d+)\/books(?:\/(\d+))?$/);
      if (listBook && state.lists) {
        const list = state.lists.find(item => item.id === Number(listBook[1]));
        if (method === "POST") list.books.push(body.book_id); else list.books = list.books.filter(id => id !== Number(listBook[2]));
        return reply(200, {});
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: state.workspaceEntries[workspace[1]] || entry(Number(workspace[1]) - 100), current_attempt: null, editions: [] });
      const attempt = path.match(/^\/me\/reading-attempts\/(.+)$/);
      if (attempt && method === "PUT") return reply(200, { entry: { ...entry(body.entry_id - 100), reading_state: "reading" }, attempt: { id: attempt[1], state: "reading", started_on: body.started_on } });
      if (attempt && method === "PATCH") {
        const read = state.currentReads.find(item => item.attempt.id === attempt[1]);
        read.attempt = { ...read.attempt, ...body }; delete read.attempt.expected_version;
        read.entry = { ...read.entry, version: read.entry.version + 1 };
        return reply(200, { entry: read.entry, attempt: read.attempt });
      }
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return reply(200, { ...book(Number(one[1]), TITLES[Number(one[1]) - 1]), description: null, published_year: 2000, isbn13: null });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

test("Home greets the reader and shows what they are reading", async ({ page, app }) => {
  await page.clock.install({ time: new Date("2026-11-06T19:30:00") });
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Good evening, Rae", level: 1 })).toBeVisible();
  await expect(page.getByText("You’re reading 2 books", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 156 of 245 · started 3 Nov", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page or % for Piranesi" })).toBeVisible();
  expect(app.errors).toEqual([]);
});

test("a reader with no name sees just Home", async ({ page, app }) => {
  app.name = null;
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("the progress box saves on Home and updates the card in place, with no dialog", async ({ page, app }) => {
  await page.goto("/home");
  const box = page.getByRole("textbox", { name: "Page or % for Piranesi" });
  await box.fill("172");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Page 172 of 245 · started 3 Nov", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved." }).first()).toHaveText("Saved. Page 172, 70%.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const save = app.requests.find(request => request.method === "PATCH");
  expect(save.body).toMatchObject({ progress_unit: "pages", progress_value: 172, expected_version: 3 });
});

test("the progress box rejects a page past the end", async ({ page, app }) => {
  await page.goto("/home");
  await page.getByRole("textbox", { name: "Page or % for Piranesi" }).fill("300");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Your copy has 245 pages.")).toBeVisible();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("without pins Up next is suggested from the shelf, with no Edit", async ({ page, app: _app }) => {
  await page.goto("/home");
  await expect(page.getByText("Suggested from your shelf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  const cards = page.locator(".bv-up-next .bv-next-card");
  await expect(cards).toHaveCount(5);
  // Owned books first (odd ids are owned), the oldest saved first.
  await expect(cards.first()).toContainText("Owned");
});

test("Up next falls back quietly when pinning isn't available yet", async ({ page, app }) => {
  app.pinsStatus = 404;
  await page.goto("/home");
  await expect(page.getByText("Suggested from your shelf", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test("pinned books lead Up next, and Edit reorders and unpins without dragging", async ({ page, app }) => {
  app.pins = [pin(1), pin(2), pin(3)];
  await page.goto("/home");
  await expect(page.getByText("Pinned by you · 3 of 5", { exact: true })).toBeVisible();
  await expect(page.locator(".bv-next-label", { hasText: "Pinned" })).toHaveCount(3);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Move Middlemarch down" }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT").at(-1)?.body).toEqual({ entry_ids: [102, 101, 103] });
  await page.getByRole("button", { name: "Unpin Kindred" }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT").at(-1)?.body).toEqual({ entry_ids: [102, 101] });
  await expect(page.getByRole("status").filter({ hasText: "Kindred unpinned" })).toHaveCount(1);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Pinned by you · 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
});

test("a pin change the server refuses leaves the list as it was and says so", async ({ page, app }) => {
  app.pins = [pin(1), pin(2)];
  app.putStatus = 422;
  await page.goto("/home");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Unpin Circe" }).click();
  await expect(page.getByRole("alert")).toContainText("Up next can hold 5 books");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Pinned by you · 2 of 5", { exact: true })).toBeVisible();
});

test("Start opens a reading from an Up next card", async ({ page, app }) => {
  app.pins = [pin(1)];
  await page.goto("/home");
  await page.locator(".bv-up-next").getByRole("button", { name: "Start reading Middlemarch" }).click();
  await expect.poll(() => app.requests.some(request => request.method === "PUT" && request.path.startsWith("/me/reading-attempts/"))).toBe(true);
  const create = app.requests.find(request => request.method === "PUT" && request.path.startsWith("/me/reading-attempts/"));
  expect(create.body).toMatchObject({ entry_id: 101, started_via: "next_read" });
});

test("Can't decide? never repeats a book Up next is showing, and costs no extra library request", async ({ page, app }) => {
  await page.goto("/home");
  const upNext = page.locator(".bv-up-next"), choose = page.locator(".bv-choose");
  await expect(upNext.getByRole("heading").first()).toBeVisible();
  await expect(choose.locator('a[href^="/my-books/"]').first()).toBeVisible();
  for (const title of TITLES) {
    const total = await upNext.getByRole("heading", { name: title, exact: true }).count() + await choose.getByRole("link", { name: title, exact: true }).count();
    expect(total, `${title} shown twice`).toBeLessThanOrEqual(1);
  }
  const asked = () => app.requests.filter(request => request.path === "/me/library").length, before = asked();
  await page.waitForTimeout(800);
  expect(asked()).toBe(before);
});

test("Can't decide? shows five at a time and Try again walks through the rest", async ({ page, app }) => {
  app.entries = shelf(24, () => 400);
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await expect(pills.getByRole("button", { name: "More Fantasy" })).toBeEnabled();
  await pills.getByRole("button", { name: "Something I own" }).click();
  const picks = page.locator(".bv-picks .bv-next-card");
  await expect(picks).toHaveCount(5);
  await expect(page.getByText("5 books you own and haven’t started", { exact: true })).toBeVisible();
  const first = await picks.allTextContents();
  await page.getByRole("button", { name: "Try again" }).click();
  const second = await picks.allTextContents();
  expect(second.some(text => first.includes(text))).toBe(false);
  expect(app.requests.some(request => request.path === "/me/library" && request.query.get("owned") === "true")).toBe(true);
});

test("Waiting longest leads with the oldest saved book from the reading-life figures", async ({ page, app }) => {
  await page.goto("/home");
  await page.getByRole("button", { name: "Waiting longest" }).click();
  await expect(page.locator(".bv-picks .bv-next-card").first()).toContainText("Orlando");
  expect(app.requests.some(request => request.path === "/me/library" && request.query.get("sort") === "added_oldest")).toBe(true);
});

test("Waiting longest falls back to the newest saved books read from the other end before the sort ships", async ({ page, app }) => {
  app.entries = shelf(14);
  app.noOldestSort = true;
  await page.goto("/home");
  await page.getByRole("button", { name: "Waiting longest" }).click();
  await expect(page.locator(".bv-picks .bv-next-card")).toHaveCount(5);
  expect(app.requests.some(request => request.path === "/me/library" && request.query.get("sort") === "added")).toBe(true);
  expect(app.errors).toEqual([]);
});

test("Something short asks the library for short books", async ({ page, app }) => {
  app.entries = shelf(14, id => (id >= 10 ? 200 : 400));
  await page.goto("/home");
  await page.getByRole("button", { name: "Something short" }).click();
  await expect(page.locator(".bv-picks .bv-next-card").first()).toBeVisible();
  expect(app.requests.some(request => request.path === "/me/library" && request.query.get("length") === "short")).toBe(true);
  await expect(page.getByText(/short books you own or want · under 250 pages/)).toBeVisible();
});

test("a pill with nothing behind it is hidden, and the panel hides when every pill is empty", async ({ page, app }) => {
  app.entries = shelf(14);
  app.facets = { length: [], subject: [] };
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Something I own" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Something short" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^More / })).toHaveCount(0);
  app.entries = [];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Can’t decide?" })).toHaveCount(0);
});

test("the year is one compact card: the count and the month shelf, all one link to the reading life", async ({ page, app: _app }) => {
  await page.goto("/home");
  const card = page.getByRole("link", { name: /^Your 2026:/ });
  await expect(card).toHaveAttribute("href", "/reading-life");
  await expect(card).toHaveAccessibleName("Your 2026: 23 books finished. Open your reading life");
  await expect(card).toContainText("23 books finished in 2026");
  await expect(card.locator(".bv-shelf")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Your reading life", exact: true })).toHaveCount(0);
  await expect(page.locator(".bv-figures")).toHaveCount(0);
  await expect(card).not.toContainText("7,840");
});

test("the year card is hidden until three books are finished this year: nothing at all under that", async ({ page, app }) => {
  for (const finished of [0, 1, 2]) {
    app.stats = { year: 2026, books_finished: finished, pages_read: 300 * finished, median_days: null, biggest_month: finished ? 1 : null, by_month: Array.from({ length: 12 }, (_, index) => (index === 0 ? finished : 0)), top_genres: [] };
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Up next" })).toBeVisible();
    await expect(page.locator(".bv-year-glance, .bv-year-card, .bv-shelf")).toHaveCount(0);
    await expect(page.getByText("Finish a book this year and it’ll show up here.")).toHaveCount(0);
  }
  app.stats = { year: 2026, books_finished: 3, pages_read: 900, median_days: 9, biggest_month: 1, by_month: Array.from({ length: 12 }, (_, index) => (index === 0 ? 3 : 0)), top_genres: [] };
  await page.goto("/home");
  await expect(page.getByRole("link", { name: /^Your 2026:/ })).toContainText("3 books finished in 2026");
});

test("Up next covers fill their frame: the image box equals the 2:3 frame for a cover that is about 2:3", async ({ page, app }) => {
  // The shared cover rule: about-2:3 artwork fills the frame, so there are no soft bars (off-ratio artwork is shown whole, see cover-edges.spec.js).
  for (const entry of app.entries) entry.book.cover_image_url = "/test-cover/near.svg";
  await page.route("**/test-cover/*", route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="470"><rect width="320" height="470" fill="#369"/></svg>' }));
  await page.goto("/home");
  const covers = page.locator(".bv-next-cover .bv-cover");
  await expect(covers.first()).toBeVisible();
  await expect(covers.first().locator("img")).toBeVisible();
  for (const frame of await covers.all()) {
    const image = frame.locator("img");
    expect(await image.count()).toBeGreaterThan(0);
    await expect(image).toHaveCSS("object-fit", "cover");
    const f = await frame.boundingBox(), i = await image.boundingBox();
    expect(Math.abs(f.width - i.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.height - i.height)).toBeLessThanOrEqual(1);
  }
});

test("on a phone Home shows the first book and a Show link for the rest", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expect(page.locator(".bv-now-card")).toHaveCount(1);
  await expect(page.getByText(/\+ 1 more you’re reading/)).toBeVisible();
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.locator(".bv-now-card")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Home on a phone: Up next and the picks are 2-column cover grids, the filter pills wrap, and nothing scrolls sideways.
for (const [width, zoom] of [[390, false], [320, false], [390, true]]) test(`on a ${width}px phone${zoom ? " at 200% text" : ""} Up next and the picks are 2-column grids with nothing sideways`, async ({ page, app }) => {
  app.pins = [pin(1), pin(2), pin(3), pin(4)];
  app.entries = shelf(12, id => (id >= 6 ? 200 : 400));
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/home");
  if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Something short" }).click();
  await expect(page.locator(".bv-picks .bv-next-card").first()).toBeVisible();
  const grids = await page.evaluate(() => [".bv-next-row", ".bv-picks"].map(selector => {
    const grid = document.querySelector(selector), box = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll(".bv-next-card")].map(card => { const r = card.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, overflow: card.scrollWidth > card.clientWidth + 1 }; });
    return { selector, columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length, overflowX: getComputedStyle(grid).overflowX, mask: getComputedStyle(grid).maskImage, scrolls: grid.scrollWidth > grid.clientWidth + 1, cards, inside: cards.every(c => c.left >= 0 && c.right <= innerWidth), sideways: cards.some(c => c.overflow), left: box.left };
  }));
  for (const grid of grids) {
    expect(grid.columns, grid.selector).toBe(2);
    expect(grid.overflowX, grid.selector).toBe("visible");
    expect(grid.mask, grid.selector).toBe("none");
    expect(grid.scrolls, grid.selector).toBe(false);
    expect(grid.inside, grid.selector).toBe(true);
    expect(grid.sideways, grid.selector).toBe(false);
    expect(new Set(grid.cards.map(c => Math.round(c.left))).size, grid.selector).toBe(2);
  }
  const pills = await page.evaluate(() => { const row = document.querySelector(".bv-pills"); return { wraps: getComputedStyle(row).flexWrap === "wrap", overflowX: getComputedStyle(row).overflowX, scrolls: row.scrollWidth > row.clientWidth + 1 }; });
  expect(pills).toEqual({ wraps: true, overflowX: "visible", scrolls: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Can't decide? shows four picks per try on a phone (two rows of two) and five on a desktop (one row of five).
test("on a phone Can't decide? shows four picks in two rows of two; on a desktop five", async ({ page, app }) => {
  app.entries = shelf(14, () => 200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  const picks = page.locator(".bv-picks .bv-next-card");
  await expect(picks).toHaveCount(4);
  const boxes = await picks.evaluateAll(cards => cards.map(card => { const r = card.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; }));
  expect(new Set(boxes.map(b => b.left)).size).toBe(2);
  expect(new Set(boxes.map(b => b.top)).size).toBe(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(picks).toHaveCount(5);
  const tops = await picks.evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});

// Home's book areas follow My Books: covers on the page, no boxes, full-width rows.
test("at 1440 Reading now is three box-free columns, Up next is five, and Can't decide? opens with five books", async ({ page, app }) => {
  app.currentReads = [reading(1, "Piranesi", 156, 245), reading(2, "The Fifth Season", 101, 468), { ...reading(3, "Ego is the Enemy", 0, 300), attempt: { id: "attempt-3", state: "reading", started_on: "2026-11-03", progress_unit: null, progress_value: null, total_pages: 300 } }];
  app.entries = Array.from({ length: 12 }, (_, index) => entry(index + 1, { book: book(index + 1, `Title ${index + 1}`, 200) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home");
  const cards = page.locator(".bv-now-card");
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(card).toHaveCSS("box-shadow", "none");
    await expect(card).toHaveCSS("border-top-left-radius", "0px");
  }
  const lefts = await cards.evaluateAll(list => list.map(card => Math.round(card.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(3);
  // Every book draws a meter, full width of its text column, and the page fields line up across the row.
  const meters = page.locator(".bv-now-card .bv-reading-meter");
  await expect(meters).toHaveCount(3);
  for (const meter of await meters.all()) expect(await meter.evaluate(node => getComputedStyle(node).maxWidth)).toBe("none");
  const fields = await page.locator(".bv-now-card .bv-progress-box").evaluateAll(list => list.map(box => Math.round(box.getBoundingClientRect().top)));
  expect(new Set(fields).size).toBe(1);
  // Title is the stronger line: Caslon and larger than the muted author.
  const sizes = await cards.first().evaluate(card => ({ title: parseFloat(getComputedStyle(card.querySelector("h3")).fontSize), author: parseFloat(getComputedStyle(card.querySelector(".bv-author")).fontSize) }));
  expect(sizes.title).toBeGreaterThan(sizes.author);
  // Up next: five equal columns, five suggestions, Start reading as wide as its words.
  const next = page.locator(".bv-up-next .bv-next-card");
  await expect(next).toHaveCount(5);
  const columns = await page.locator(".bv-next-row").evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" ").map(parseFloat));
  expect(columns).toHaveLength(5);
  expect(Math.max(...columns) - Math.min(...columns)).toBeLessThan(1);
  const button = await next.first().locator(".bv-button").boundingBox(), card = await next.first().boundingBox();
  expect(button.width).toBeLessThan(card.width - 20);
  expect(Math.abs(button.x - card.x)).toBeLessThan(2);
  // Can't decide? is already showing books, with the first filter pressed and no click.
  const picks = page.locator(".bv-picks .bv-next-card");
  await expect(picks).toHaveCount(5);
  await expect(page.getByRole("group", { name: "Help me choose" }).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
  const pickColumns = await page.locator(".bv-picks").evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" ").length);
  expect(pickColumns).toBe(5);
});

test("at 390 Up next and Can't decide? open with books in two columns; Start reading fills its column", async ({ page, app }) => {
  app.entries = Array.from({ length: 12 }, (_, index) => entry(index + 1, { book: book(index + 1, `Title ${index + 1}`, 200) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expect(page.locator(".bv-up-next .bv-next-card")).toHaveCount(4);
  await expect(page.locator(".bv-picks .bv-next-card")).toHaveCount(4);
  for (const selector of [".bv-next-row", ".bv-picks"]) expect(await page.locator(selector).evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" ").length), selector).toBe(2);
  const button = await page.locator(".bv-up-next .bv-next-card").first().locator(".bv-button").boundingBox(), card = await page.locator(".bv-up-next .bv-next-card").first().boundingBox();
  expect(Math.abs(button.width - card.width)).toBeLessThan(2);
});

test("a book's page offers Pin to Up next and Unpin", async ({ page, app }) => {
  app.pins = [];
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Pin to Up next" }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT").at(-1)?.body).toEqual({ entry_ids: [101] });
  await expect(page.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT").at(-1)?.body).toEqual({ entry_ids: [] });
});

test("the My Books book page adds the book to a list and takes it off again", async ({ page, app }) => {
  app.lists = [{ id: 7, name: "Holiday", books: [] }];
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
  const menu = page.getByRole("menu", { name: "More actions for Middlemarch" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Add to list", "Pin to Up next"]);
  await menu.getByRole("menuitem", { name: "Add to list" }).click();
  const panel = page.getByRole("group", { name: "Add Middlemarch to a list" });
  await panel.getByRole("checkbox", { name: "Holiday" }).check();
  await expect.poll(() => app.requests.filter(request => request.method === "POST" && request.path === "/me/lists/7/books").at(-1)?.body).toEqual({ book_id: 1 });
  await panel.getByRole("checkbox", { name: "Holiday" }).uncheck();
  await expect.poll(() => app.requests.filter(request => request.method === "DELETE" && request.path === "/me/lists/7/books/1").length).toBe(1);
});

test("the My Books book page pins the book to Up next and unpins it", async ({ page, app }) => {
  app.pins = [];
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
  await page.getByRole("menuitem", { name: "Pin to Up next" }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT" && request.path === "/me/up-next").at(-1)?.body).toEqual({ entry_ids: [101] });
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PUT" && request.path === "/me/up-next").at(-1)?.body).toEqual({ entry_ids: [] });
  await expect(page.getByRole("menuitem", { name: "Pin to Up next" })).toBeVisible();
});

test("a private book's menu has only the two shelf toggles", async ({ page, app }) => {
  app.pins = []; app.lists = [{ id: 7, name: "Holiday", books: [] }];
  app.workspaceEntries[150] = { ...app.entries[0], id: 150, book_id: null, book: null, private_title: "My zine", private_author: "A Friend", is_wanted: true, is_owned: false };
  await page.goto("/my-books/150");
  await expect(page.getByRole("heading", { name: "My zine", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "More actions for My zine" }).click();
  const menu = page.getByRole("menu", { name: "More actions for My zine" });
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText(["Want to read", "I own it"]);
  await expect(menu.getByRole("menuitem")).toHaveCount(0);
});

test("while changes are paused the My Books book page has no menu", async ({ page, app }) => {
  app.pins = []; app.lists = []; app.readOnly = true;
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "Middlemarch", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^More actions for/ })).toHaveCount(0);
});

test("Can't decide? keeps the genre's name as written, capitals included", async ({ page, app }) => {
  app.facets = { ...app.facets, subject: [{ value: 7, label: "art_music", count: 4 }] };
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await pills.getByRole("button", { name: "More Art & music", exact: true }).click();
  await expect(page.locator(".bv-choose-foot")).toContainText("Art & music you own or want");
  await expect(page.getByText(/art_music|art & music/)).toHaveCount(0);
});

test("a book's page has no pin button before pinning exists", async ({ page, app }) => {
  app.pinsStatus = 404;
  await page.goto("/book/1");
  await expect(page.getByRole("heading", { name: "Middlemarch", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pin to Up next/ })).toHaveCount(0);
});

// Screenshots for design review: HOME_SHOTS=1 writes them to ../.bv-shots/home; skipped otherwise.
for (const theme of ["light", "dark"]) for (const [width, height, zoom] of [[390, 844, false], [1440, 900, false], [390, 844, true]]) {
  test(`home screenshots ${theme} ${width}${zoom ? " 200%" : ""}`, async ({ page, app }) => {
    test.skip(!process.env.HOME_SHOTS, "design review only");
    app.pins = [pin(1), pin(2), pin(3), pin(4)];
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.clock.install({ time: new Date("2026-11-06T19:30:00") });
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Good evening, Rae", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Something short" }).click();
    await expect(page.locator(".bv-picks .bv-next-card").first()).toBeVisible();
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const dir = "../.bv-shots/home", tag = `${width}${zoom ? "-200" : ""}-${theme}`;
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: `${dir}/home-${tag}.png`, fullPage: true });
    await page.getByRole("button", { name: "Update progress for Piranesi" }).click();
    await expect(page.getByRole("dialog", { name: "Piranesi" })).toBeVisible();
    await page.screenshot({ path: `${dir}/progress-sheet-${tag}.png` });
    if (!zoom) {
      await page.keyboard.press("Escape");
      app.stats = { year: 2026, books_finished: 0, pages_read: 0, median_days: null, biggest_month: null, by_month: new Array(12).fill(0), top_genres: [] };
      app.pins = null;
      app.currentReads = [];
      await page.reload();
      await expect(page.getByText("When you finish a book, your year starts filling in here.")).toBeVisible();
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: `${dir}/home-empty-${tag}.png`, fullPage: true });
    }
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// The shelf request: every book, no filter. The pills ask for their own filtered pages.
const isShelfRequest = request => request.path === "/me/library" && request.query.get("facet") === "all" && !request.query.get("owned") && !request.query.get("length") && !request.query.get("subject");
const mainHeight = page => page.locator("main").evaluate(node => node.getBoundingClientRect().height);

test("switching a pill keeps the old cards, dimmed, and the page never shrinks while the new ones load", async ({ page, app }) => {
  app.entries = shelf(16);
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" }), picks = page.locator(".bv-picks .bv-next-card"), results = page.locator(".bv-results");
  await pills.getByRole("button", { name: "Something I own" }).click();
  await expect(picks).toHaveCount(4);
  const before = await mainHeight(page);
  app.delay = 1000;
  await page.evaluate(() => { const main = document.querySelector("main"); window.__heights = []; window.__timer = setInterval(() => window.__heights.push(main.getBoundingClientRect().height), 25); });
  await pills.getByRole("button", { name: "Waiting longest" }).click();
  await expect(results).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".bv-picks--busy")).toHaveCount(1);
  await expect(picks).toHaveCount(4);
  await expect(results).not.toHaveAttribute("aria-busy", "true", { timeout: 5000 });
  await expect(picks.first()).toContainText("Orlando");
  const heights = await page.evaluate(() => { clearInterval(window.__timer); return window.__heights; });
  expect(heights.length).toBeGreaterThan(10);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(before - 1);
  expect(Math.abs((await mainHeight(page)) - before)).toBeLessThan(40);
  expect(app.errors).toEqual([]);
});

test("a shelf pill asks the library a bounded number of times and then stops", async ({ page, app }) => {
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await expect(pills.getByRole("button", { name: "More Fantasy" })).toBeVisible();
  app.requests.length = 0;
  await pills.getByRole("button", { name: "More Fantasy" }).click();
  await expect(page.locator(".bv-picks .bv-next-card").first()).toBeVisible();
  const library = () => app.requests.filter(request => request.path === "/me/library").length;
  const settled = library();
  // "More Fantasy" reads Want to read and what you own: at most two requests per source.
  expect(settled).toBeLessThanOrEqual(4);
  await page.waitForTimeout(2000);
  expect(library()).toBe(settled);
});

test("Home asks the library for its books once, for a reader mid-book and for a quiet one", async ({ page, app }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Can’t decide?" })).toBeVisible();
  expect(app.requests.filter(isShelfRequest)).toHaveLength(1);
  app.requests.length = 0; app.currentReads = [];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Can’t decide?" })).toBeVisible();
  expect(app.requests.filter(isShelfRequest)).toHaveLength(1);
});

test("a cover that the image cache never answers switches to Open Library after 1.5 s, once", async ({ page, app }) => {
  app.currentReads[0].entry.book.cover_image_url = "https://covers.openlibrary.org/b/id/111-M.jpg";
  const hits = { cache: 0, direct: [] };
  await page.route("https://wsrv.nl/**", () => { hits.cache += 1; });
  await page.route("https://covers.openlibrary.org/**", route => { hits.direct.push(route.request().url()); return route.fulfill({ contentType: "image/png", body: PNG }); });
  await page.goto("/home");
  const image = page.locator('img[alt="Cover of Piranesi"]');
  await expect(image).toHaveAttribute("src", /covers\.openlibrary\.org\/b\/id\/111-M\.jpg/, { timeout: 5000 });
  expect(hits.cache).toBe(1);
  expect(hits.direct).toEqual(["https://covers.openlibrary.org/b/id/111-M.jpg"]);
  await expect(page.getByRole("img", { name: "Cover unavailable for Piranesi" })).toHaveCount(0);
});

test("a cover the image cache refuses falls back to Open Library at once, and a second failure shows the jacket", async ({ page, app }) => {
  app.currentReads[0].entry.book.cover_image_url = "https://covers.openlibrary.org/b/id/222-M.jpg";
  const hits = { direct: 0 };
  await page.route("https://wsrv.nl/**", route => route.fulfill({ status: 404, body: "" }));
  await page.route("https://covers.openlibrary.org/**", route => { hits.direct += 1; return route.fulfill({ status: 404, body: "" }); });
  await page.goto("/home");
  await expect(page.getByRole("img", { name: "Cover unavailable for Piranesi" })).toBeVisible();
  expect(hits.direct).toBe(1);
  await page.waitForTimeout(1800);
  expect(hits.direct).toBe(1);
});

test("Discover shows no catalogue total", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Books to explore" })).toBeVisible();
  await expect(page.getByText(/47,248/)).toHaveCount(0);
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  expect(app.errors).toEqual([]);
});

// Design review: HOME_POLISH_SHOTS=1 writes ../.bv-shots/home-polish.
for (const theme of ["light", "dark"]) for (const width of [390, 1440]) test(`shot: Home polish ${theme} ${width}`, async ({ page, app }) => {
  test.skip(!process.env.HOME_POLISH_SHOTS, "design review only");
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  const settle = async () => { await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); };
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await pills.getByRole("button", { name: "Something I own" }).click();
  await expect(page.locator(".bv-picks .bv-next-card")).toHaveCount(3);
  app.delay = 2500;
  await pills.getByRole("button", { name: "Waiting longest" }).click();
  await expect(page.locator(".bv-picks--busy")).toHaveCount(1);
  await settle();
  await page.screenshot({ path: `../.bv-shots/home-polish/home-mid-switch-${width}-${theme}.png`, fullPage: true });
  await expect(page.locator(".bv-results")).not.toHaveAttribute("aria-busy", "true", { timeout: 6000 });
  await settle();
  await page.screenshot({ path: `../.bv-shots/home-polish/home-after-${width}-${theme}.png`, fullPage: true });
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Books to explore" })).toBeVisible();
  await settle();
  await page.screenshot({ path: `../.bv-shots/home-polish/discover-head-${width}-${theme}.png`, clip: { x: 0, y: 0, width, height: 700 } });
});

test("Back on a book page returns to the page before it, and a direct link falls back to Discover", async ({ page, app: _app }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Piranesi", exact: true }).click();
  await page.getByText("About this book", { exact: true }).click();
  await page.getByRole("link", { name: "Full book details" }).click();
  await expect(page).toHaveURL(/\/book\/\d+/);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/\d+$/);
  await page.getByRole("link", { name: /Home/ }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/book/1");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
});

test("Back on a book page returns to Discover, and the shelf note is said once, out of sight", async ({ page, app: _app }) => {
  await page.goto("/browse");
  await expect(page.locator("article.bv-book-card").first()).toBeVisible();
  await expect(page.getByText("Want to read and Owned are separate. Changing one keeps the other.")).toHaveCount(1);
  await page.getByRole("link", { name: /^View / }).first().click();
  await expect(page.getByText("Open an existing reading, or start your first")).toHaveCount(0);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
});

test("on a small shelf a pill whose books are the same as an earlier pill's is dropped, and Home still asks the library once", async ({ page, app }) => {
  app.entries = app.entries.map(item => ({ ...item, is_owned: true, is_wanted: false, book: { ...item.book, page_count: 400 } }));
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await expect(pills.getByRole("button", { name: "Something I own" })).toBeVisible();
  await expect(pills.getByRole("button", { name: "Waiting longest" })).toHaveCount(0);
  expect(app.requests.filter(isShelfRequest)).toHaveLength(1);
});

test("a shelf whose books are all short folds Something I own and Waiting longest into Something short", async ({ page, app }) => {
  app.entries = app.entries.map(item => ({ ...item, is_owned: true, is_wanted: false, book: { ...item.book, page_count: 180 } }));
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  await expect(pills.getByRole("button", { name: "Something short" })).toBeVisible();
  await expect(pills.getByRole("button", { name: "Something I own" })).toHaveCount(0);
  await expect(pills.getByRole("button", { name: "Waiting longest" })).toHaveCount(0);
});

test("a shelf with differing results keeps every pill", async ({ page, app }) => {
  app.entries = shelf(14, id => (id >= 10 ? 200 : 400));
  await page.goto("/home");
  const pills = page.getByRole("group", { name: "Help me choose" });
  for (const name of ["Something short", "Something I own", "Waiting longest"]) await expect(pills.getByRole("button", { name })).toBeVisible();
});

// ---- T71 Part B: authors are links to /author/:id wherever an id is known --------------------------------------------------------------

test("Home: Reading now links each author to the author page, and the title still opens the reading", async ({ page, app: _app }) => {
  await page.goto("/home");
  const card = page.locator(".bv-now-card").first();
  await expect(card.getByRole("link", { name: "Author 51", exact: true })).toHaveAttribute("href", "/author/51");
  await expect(card.getByRole("link", { name: "Piranesi" })).toHaveAttribute("href", "/my-books/201");
  expect(await page.locator("a a").count()).toBe(0);
  await card.getByRole("link", { name: "Author 51", exact: true }).click();
  await expect(page).toHaveURL(/\/author\/51$/);
});

test("Home: Up next links a pin's authors by author_ids, and a pin without ids keeps plain text", async ({ page, app }) => {
  app.pins = [pin(1, { authors: ["Author 1", "Second Author"], author_ids: [1, 9] }), pin(2, { author_ids: [] }), pin(3, { authors: ["Author 3"] })];
  await page.goto("/home");
  const cards = page.locator(".bv-next-card");
  await expect(cards.first().locator(".bv-author")).toHaveText("Author 1, Second Author");
  await expect(cards.first().getByRole("link", { name: "Author 1", exact: true })).toHaveAttribute("href", "/author/1");
  await expect(cards.first().getByRole("link", { name: "Second Author", exact: true })).toHaveAttribute("href", "/author/9");
  await expect(cards.nth(1).getByRole("link", { name: "Author 2" })).toHaveCount(0);
  await expect(cards.nth(2).getByRole("link", { name: "Author 3" })).toHaveCount(0);
  expect(await page.locator("a a").count()).toBe(0);
});

test("Home: Can't decide? picks link their authors", async ({ page, app }) => {
  app.entries = shelf(12, () => 400);
  await page.goto("/home");
  await page.getByRole("group", { name: "Help me choose" }).getByRole("button", { name: "Something I own" }).click();
  const first = page.locator(".bv-picks .bv-next-card").first();
  await expect(first.getByRole("link", { name: /^Author \d+$/ })).toHaveAttribute("href", /^\/author\/\d+$/);
  expect(await page.locator("a a").count()).toBe(0);
});

test("My Books: covers and list link each author; the card click still opens the reading; the author click does not", async ({ page, app }) => {
  await page.goto("/my-books");
  const card = page.locator(".bv-personal-book").first();
  const link = card.getByRole("link", { name: /^Author \d+$/ });
  await expect(link).toHaveAttribute("href", /^\/author\/\d+$/);
  expect(await page.locator("a a").count()).toBe(0);
  await page.evaluate(() => localStorage.setItem("bookvane-library-view", "list"));
  await page.reload();
  const row = page.locator(".bv-library-row").first();
  await expect(row.getByRole("link", { name: /^Author \d+$/ })).toHaveAttribute("href", /^\/author\/\d+$/);
  expect(await page.locator("a a").count()).toBe(0);
  const opened = app.requests.filter(request => /^\/me\/library\/\d+\/reading$/.test(request.path)).length;
  await row.getByRole("link", { name: /^Author \d+$/ }).click();
  await expect(page).toHaveURL(/\/author\/\d+$/);
  expect(app.requests.filter(request => /^\/me\/library\/\d+\/reading$/.test(request.path)).length).toBe(opened);
});

// ---- No grey panel behind a cover: Home and My Books, in light and dark, loaded and still loading ----------------------------------------

const COVER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="470"><rect width="320" height="470" fill="#369"/></svg>';
for (const name of ["light", "dark"]) for (const slow of [false, true]) test(`Home and My Books have no panel behind any cover, ${slow ? "while loading" : "loaded"}; ${name}`, async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: name });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), name);
  for (const item of app.entries) item.book.cover_image_url = "/test-cover/near.svg";
  for (const item of app.currentReads) item.entry.book.cover_image_url = "/test-cover/near.svg";
  app.pins = [pin(1), pin(2)];
  await page.route("**/test-cover/*", async route => { if (slow) await new Promise(done => setTimeout(done, 4000)); return route.fulfill({ status: 200, contentType: "image/svg+xml", body: COVER_SVG }); });
  await page.goto("/home");
  await expect(page.locator(".bv-now-card .bv-cover").first()).toBeVisible();
  await expect(page.locator(slow ? ".bv-cover--loading" : ".bv-cover--ready").first()).toBeVisible();
  expect(await greyBehindCovers(page)).toEqual([]);
  for (const view of ["covers", "list"]) {
    await page.evaluate(value => localStorage.setItem("bookvane-library-view", value), view);
    await page.goto("/my-books");
    await expect(page.locator(".bv-cover").first()).toBeVisible();
    await expect(page.locator(slow ? ".bv-cover--loading" : ".bv-cover--ready").first()).toBeVisible();
    expect(await greyBehindCovers(page)).toEqual([]);
  }
});
