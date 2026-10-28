import { test as base, expect } from "@playwright/test";

// Browser-only fixtures: every API request is intercepted. The build under test has no monitoring keys, so nothing
// of the monitoring or visit counting may run, and a page that breaks must still be recoverable.
const PRIVACY_LINE = "If something goes wrong, we receive an error report so we can fix it. We count visits anonymously, without cookies.";

const test = base.extend({
  app: [async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, breakHome: false, outside: [] };
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) { state.outside.push(url.origin); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1,
        features: { reading_actions: true, private_context: false, privacy_controls: false, reading_export: false, library_import: false, next_read: false } });
      if (path === "/me/books" || path === "/me/preferences") return reply(200, []);
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null });
      if (path === "/me/home") return state.breakHome
        ? reply(200, { current_reads: [{ entry: null, attempt: null }], reading_count: 1, paused_count: 0 })
        : reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/books") return reply(200, { items: [], total: 0, page: 1, size: 20 });
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  }, { auto: true }],
});

test("without keys there is no visit-counting script and nothing leaves the site", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("heading", { level: 1, name: "Find your next chapter." })).toBeVisible();
  expect(await page.locator("script[data-cf-beacon]").count()).toBe(0);
  expect(await page.locator('script[src*="cloudflareinsights"]').count()).toBe(0);
  expect(app.outside.filter(origin => /cloudflare|sentry/i.test(origin))).toEqual([]);
});

test("the privacy page says, in plain words, that errors are reported and visits are counted without cookies", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText(PRIVACY_LINE, { exact: true })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/sentry|cloudflare/i);
});

test("a page that breaks shows a recoverable message instead of a blank app, and navigating away clears it", async ({ page, app }) => {
  app.authenticated = true; app.breakHome = true;
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Something went wrong on this page.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Discover books", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("link", { name: "Discover books", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find your next chapter." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong on this page.", exact: true })).toHaveCount(0);
});
