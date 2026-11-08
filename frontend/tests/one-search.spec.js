import { test as base, expect } from "@playwright/test";

// Browser fixtures only: the catalogue answer, the "more books" answer and the resolve call are mocked from the contract.
const ours = (id, title, author = `Author ${id}`) => ({ id, title, subtitle: null, authors: [{ id, name: author }], tags: [], cover_image_url: null, page_count: 300, published_year: 2000, english_title: null });
const work = (key, title, author, popularity = 10) => ({ work_key: key, title, authors: [author], cover_url: null, published_year: 1999, page_count: 250, popularity });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], ours: [ours(1, "Dune Messiah"), ours(2, "Children of Dune")], more: [work("/works/OL1W", "Dune", "Frank Herbert", 90), work("/works/OL2W", "Dune Messiah", "Author 1", 50), work("/works/OL3W", "God Emperor of Dune", "Frank Herbert", 70)],
      moreDelay: 700, moreStatus: 200, resolve: { status: 200, json: { id: 99 } }, resolveDelay: 0 };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      state.requests.push({ path, method, params: Object.fromEntries(url.searchParams), body: method === "POST" ? route.request().postDataJSON() : null, at: Date.now() });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(401, { detail: "Not signed in" });
      if (path === "/books") return reply(200, { items: state.ours, total: state.ours.length, page: 1, size: 20 });
      if (path === "/books/more") {
        await new Promise(done => setTimeout(done, state.moreDelay));
        return state.moreStatus === 200 ? reply(200, state.more) : reply(state.moreStatus, { detail: "boom" });
      }
      if (path === "/books/resolve") {
        await new Promise(done => setTimeout(done, state.resolveDelay));
        return reply(state.resolve.status, state.resolve.json);
      }
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return reply(200, { ...ours(Number(one[1]), "Resolved Book"), description: null });
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const titles = page => page.locator(".bv-book-grid .bv-book-card h3");

test("with no exact title among ours the list waits behind Searching…, then shows once, ranked: exact title first, then the rest", async ({ page, app }) => {
  await page.goto("/browse?book=Dune");
  await expect(page.getByText("Searching…")).toBeVisible();
  await expect(titles(page)).toHaveCount(0);
  await expect(titles(page)).toHaveText(["Dune", "Dune Messiah", "Children of Dune", "God Emperor of Dune"]);
  await expect(page.getByText("Searching…")).toHaveCount(0);
  expect(app.requests.filter(request => request.path === "/books/more")[0].params).toMatchObject({ book: "Dune" });
  // once shown, nothing is reordered
  await page.waitForTimeout(600);
  await expect(titles(page)).toHaveText(["Dune", "Dune Messiah", "Children of Dune", "God Emperor of Dune"]);
});

test("with an exact title among ours the list shows at once and the rest is added below it", async ({ page, app }) => {
  app.ours = [ours(5, "Dune"), ours(2, "Children of Dune")];
  app.moreDelay = 1000;
  await page.goto("/browse?book=Dune");
  await expect(titles(page)).toHaveText(["Dune", "Children of Dune"]);
  await expect(page.getByText("Searching…")).toHaveCount(0);
  await expect(titles(page)).toHaveText(["Dune", "Children of Dune", "Dune", "God Emperor of Dune", "Dune Messiah"]);
});

test("a late answer is ignored: ours show after the wait and nothing is added afterwards", async ({ page, app }) => {
  app.moreDelay = 3500;
  await page.goto("/browse?book=Dune");
  await expect(titles(page)).toHaveText(["Dune Messiah", "Children of Dune"], { timeout: 4000 });
  await page.waitForTimeout(2500);
  await expect(titles(page)).toHaveText(["Dune Messiah", "Children of Dune"]);
});

test("nothing in the page says where a book came from", async ({ page, app }) => {
  await page.goto("/browse?book=Dune");
  await expect(titles(page)).toHaveCount(4, { timeout: 8000 });
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/open library|openlibrary|more books|more matching|other sources|from elsewhere|external|extended|source/i);
  expect(await page.locator("[class*=source], [data-source]").count()).toBe(0);
  expect(app.errors).toEqual([]);
});

test("the page never gets shorter while the other results are on their way, and room is kept for one more row", async ({ page, app }) => {
  app.ours = [ours(5, "Dune"), ours(2, "Children of Dune")];
  app.moreDelay = 1300;
  await page.goto("/browse?book=Dune");
  await expect(titles(page)).toHaveCount(2);
  const natural = await page.locator(".bv-book-grid").evaluate(node => { const card = node.firstElementChild.getBoundingClientRect().height; return { card, box: node.getBoundingClientRect().height }; });
  expect(natural.box).toBeGreaterThan(natural.card * 1.8);
  await page.evaluate(() => { const main = document.querySelector("main"); window.__heights = [main.getBoundingClientRect().height]; window.__timer = setInterval(() => window.__heights.push(main.getBoundingClientRect().height), 30); });
  await page.waitForTimeout(600);
  await expect(titles(page)).toHaveCount(2);
  const heights = await page.evaluate(() => { clearInterval(window.__timer); return window.__heights; });
  expect(heights.length).toBeGreaterThan(10);
  heights.forEach((height, index) => { if (index) expect(height).toBeGreaterThanOrEqual(heights[index - 1] - 1); });
  await expect(titles(page)).toHaveCount(5, { timeout: 8000 });
});

test("picking one of the other results opens its book once, and a double tap sends one request", async ({ page, app }) => {
  app.resolveDelay = 600;
  await page.goto("/browse?book=Dune");
  const card = page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).dblclick();
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(/\/book\/99$/);
  expect(app.requests.filter(request => request.path === "/books/resolve")).toHaveLength(1);
  expect(app.requests.find(request => request.path === "/books/resolve").body).toEqual({ work_key: "/works/OL3W" });
});

test("a book that cannot be listed disappears quietly and is announced", async ({ page, app }) => {
  app.resolve = { status: 422, json: { detail: { code: "not_listable" } } };
  await page.goto("/browse?book=Dune");
  const card = page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" });
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText("That book isn’t available.")).toBeAttached();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(titles(page)).toHaveCount(3);
});

test("another failure to open a book says so on the card and can be tried again", async ({ page, app }) => {
  app.resolve = { status: 500, json: { detail: "boom" } };
  await page.goto("/browse?book=Dune");
  const card = page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" });
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(card.getByText("Couldn’t open that book. Try again.")).toBeVisible();
  app.resolve = { status: 200, json: { id: 77 } };
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/77$/);
});

test("when the other results fail, the page stays quiet and shows ours", async ({ page, app }) => {
  app.moreStatus = 500;
  await page.goto("/browse?book=Dune");
  await expect(titles(page)).toHaveText(["Dune Messiah", "Children of Dune"]);
  await page.waitForTimeout(1500);
  await expect(titles(page)).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/Searching…|unavailable|couldn’t/i)).toHaveCount(0);
});

test("with none of our own, Searching… shows until the other results answer, then they are the list", async ({ page, app }) => {
  app.ours = [];
  app.moreDelay = 1200;
  await page.goto("/browse?book=Dune");
  await expect(page.getByText("Searching…")).toBeVisible();
  await expect(page.getByText("No books found.")).toHaveCount(0);
  await expect(titles(page).first()).toHaveText("Dune");
  await expect(page.getByText("Searching…")).toHaveCount(0);
});

test("when both are empty the normal no-results line shows", async ({ page, app }) => {
  app.ours = []; app.more = []; app.moreDelay = 200;
  await page.goto("/browse?book=Nothing+At+All");
  await expect(page.getByText("No books found.")).toBeVisible();
});

test("?q= searches by title in both lists (sent as book=) and fills the search box", async ({ page, app }) => {
  await page.goto("/browse?q=herbert");
  await expect(page.locator("#bv-search-query")).toHaveValue("herbert");
  await expect(titles(page)).toHaveCount(4);
  for (const path of ["/books", "/books/more"]) {
    const request = app.requests.find(item => item.path === path);
    expect(request.params.book).toBe("herbert");
    expect(request.params.q).toBeUndefined();
  }
});

test("with no search, Discover and the landing page ask for the popular order", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(titles(page).first()).toBeVisible();
  expect(app.requests.filter(request => request.path === "/books").every(request => request.params.sort === "popular")).toBe(true);
  expect(app.requests.filter(request => request.path === "/books/more")).toHaveLength(0);
  app.requests.length = 0;
  await page.goto("/");
  await expect.poll(() => app.requests.some(request => request.path === "/books" && request.params.sort === "popular")).toBe(true);
});

test("a search sends no popular sort of its own; the server ranks it", async ({ page, app }) => {
  await page.goto("/browse?book=Dune");
  await expect(titles(page).first()).toBeVisible();
  expect(app.requests.find(request => request.path === "/books").params.sort).toBeUndefined();
});

for (const status of [401, 429, 503]) test(`a ${status} on opening a book is one quiet line on the card, never a sign-in`, async ({ page, app }) => {
  app.resolve = { status, json: { detail: status === 429 ? { code: "too_many_resolves" } : { code: "try_again" } } };
  await page.goto("/browse?book=Dune");
  const card = page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" });
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(card.getByText("Try again in a moment.")).toBeVisible();
  await expect(page).toHaveURL(/\/browse\?book=Dune$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a slow open says Opening… after 2 s, and not before", async ({ page, app }) => {
  app.resolveDelay = 3500;
  await page.goto("/browse?book=Dune");
  const card = page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" });
  await card.getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(card).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(1200);
  await expect(card.getByText("Opening…")).toHaveCount(0);
  await expect(card.getByText("Opening…")).toBeVisible({ timeout: 2000 });
  await expect(page).toHaveURL(/\/book\/99$/);
});

test("a signed-out reader taps a merged card: the book is resolved and its page opens", async ({ page, app }) => {
  await page.goto("/browse?book=Dune");
  await page.locator(".bv-work-card").filter({ hasText: "God Emperor of Dune" }).getByRole("button", { name: "God Emperor of Dune", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/99$/);
  expect(app.requests.filter(request => request.path === "/books/resolve")).toHaveLength(1);
  expect(app.requests.some(request => request.path === "/auth/login")).toBe(false);
});
