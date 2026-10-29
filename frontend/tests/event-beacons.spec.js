import { test as base, expect } from "@playwright/test";

// Browser fixtures only: every API request is intercepted, including the /events beacons.
const book = { id: 1, title: "Beacon fixture", authors: [{ id: 1, name: "Fixture Author" }], tags: [], description: "A fixture.", published_year: 2001, page_count: 200, cover_image_url: null, english_title: null };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { events: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") { state.events.push({ type: route.request().headers()["content-type"], body: JSON.parse(route.request().postData()) }); return route.fulfill({ status: 204, body: "" }); }
      if (path === "/auth/refresh") return reply(401, {});
      if (path === "/auth/register" || path === "/auth/login") return reply(200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: false });
      if (path === "/books") return reply(200, { items: url.searchParams.get("book") ? [] : [book], total: url.searchParams.get("book") ? 0 : 1, page: 1, size: 20 });
      if (path === "/books/1") return reply(200, book);
      if (path.startsWith("/autocomplete")) return reply(200, []);
      return reply(200, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
const names = app => app.events.map(event => event.body.name);

test("registering sends register_started once, with the source and nothing else", async ({ page, app }) => {
  await page.goto("/register?src=landing");
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => names(app)).toEqual(["register_started"]);
  expect(app.events[0].body).toEqual({ name: "register_started", src: "landing" });
  expect(app.events[0].type).toContain("text/plain");
});

test("the guest save dialog and an empty guest search each send their event once", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Beacon fixture to Want to read" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => names(app)).toEqual(["save_prompt_shown"]);
  await page.goto("/browse?book=Project+Hail+Mary");
  await expect(page.locator(".bv-guest-noresults")).toBeVisible();
  await expect.poll(() => names(app)).toEqual(["save_prompt_shown", "guest_search_empty"]);
  await page.waitForTimeout(300);
  expect(names(app)).toHaveLength(2);
});

test("sharing sends share_click, and a book opened from a shared link sends share_visit", async ({ page, app }) => {
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Share book image" })).toBeVisible();
  await page.evaluate(() => { navigator.canShare = undefined; });
  await page.getByRole("button", { name: "Share book image" }).click();
  await expect.poll(() => names(app)).toContain("share_click");
  await page.goto("/book/1?src=share");
  await expect.poll(() => app.events.filter(event => event.body.name === "share_visit")).toEqual([{ type: expect.stringContaining("text/plain"), body: { name: "share_visit", src: "share" } }]);
});

test("a missing or throwing sendBeacon never breaks the page", async ({ page, app }) => {
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "sendBeacon", { value: undefined, configurable: true }); });
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Beacon fixture to Want to read" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(app.events).toEqual([]);
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "sendBeacon", { value() { throw new Error("blocked"); }, configurable: true }); });
  await page.reload();
  await page.getByRole("button", { name: "Add Beacon fixture to Want to read" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
