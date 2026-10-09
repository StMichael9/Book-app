import { test as base, expect } from "@playwright/test";

const books = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  title: `Touch navigation fixture ${index + 1}`,
  authors: [{ id: 1, name: "Local test author" }],
  tags: [{ id: 1, name: "fantasy" }],
  description: "A long local description for checking detail navigation. ".repeat(60),
}));

const test = base.extend({
  app: [async ({ page, baseURL }, use) => {
    const state = { realCover: false, detailDelay: 0, errors: [] };
    page.on("pageerror", (error) => state.errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) {
        state.errors.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      }
      if (url.pathname === "/touch-test-cover.svg") return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#557766"/></svg>',
      });
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const catalogue = books.map((book) => ({ ...book,
        cover_image_url: state.realCover ? `${baseURL}/touch-test-cover.svg` : null,
      }));
      if (path === "/auth/refresh") return route.fulfill({ status: 401, json: { detail: "Signed out" } });
      if (path === "/books") return route.fulfill({ json: { items: catalogue, total: 20, page: 1, size: 20 } });
      if (/^\/books\/\d+$/.test(path)) {
        if (state.detailDelay) await new Promise((resolve) => setTimeout(resolve, state.detailDelay));
        return route.fulfill({ json: catalogue[Number(path.split("/")[2]) - 1] });
      }
      state.errors.push(`Unhandled test API request: ${path}`);
      return route.fulfill({ status: 500, json: {} });
    });
    await use(state);
    expect(state.errors).toEqual([]);
  }, { auto: true }],
});

test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

for (const scenario of [
  { id: 1, target: "cover", realCover: true, delay: 0 },
  { id: 1, target: "title", realCover: false, delay: 0 },
  { id: 12, target: "cover", realCover: false, delay: 1000 },
  { id: 12, target: "title", realCover: true, delay: 1000 },
]) {
  test(`first touch opens book ${scenario.id} via ${scenario.target} with ${scenario.realCover ? "real" : "missing"} cover`, async ({ page, app }) => {
    app.realCover = scenario.realCover;
    app.detailDelay = scenario.delay;
    await page.goto("/browse");
    await expect(page.getByRole("link", { name: "Join free", exact: true })).toBeVisible();
    const title = books[scenario.id - 1].title;
    const link = page.getByRole("link", {
      name: scenario.target === "cover" ? `View ${title}` : title, exact: true,
    });
    await link.scrollIntoViewIfNeeded();
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/book/${scenario.id}$`));
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
  });
}

test("keyboard skip link focuses main without jumping to the catalogue bottom", async ({ page }) => {
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "View Touch navigation fixture 1", exact: true })).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#bv-main")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Find your next chapter.", exact: true })).toBeInViewport();
});

test("keyboard shelf actions remain visible above the fixed mobile navigation", async ({ page }) => {
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "Join free", exact: true })).toBeVisible();
  const title = page.getByRole("link", { name: "Touch navigation fixture 12", exact: true });
  await title.focus();
  await page.keyboard.press("Tab");
  const want = page.getByRole("button", { name: "Add Touch navigation fixture 12 to Want", exact: true });
  await expect(want).toBeFocused();
  await expect.poll(() => want.evaluate((element) => {
    const nav = document.querySelector(".bv-mobile-nav");
    return element.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top;
  })).toBe(true);
});
