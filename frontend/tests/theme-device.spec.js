import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// Theme: Match device (the default), Light or Dark. Only a choice the reader makes is stored. Browser-only fixtures.
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return state.authenticated ? reply(200, {}) : reply(401, { detail: "Session expired" });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      if (path === "/books") return reply(200, { items: [], total: 0, page: 1, size: 20 });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null, facets: {}, index: null });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (["/me/lists", "/me/up-next", "/me/preferences"].includes(path)) return reply(200, []);
      state.errors.push(`Unhandled ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const stored = page => page.evaluate(() => localStorage.getItem("bookvane-theme"));
// Seeds storage on the first load only, so a reload behaves like a later visit.
const seed = (page, values) => page.addInitScript(items => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
}, values);
// A signed-in reader: the account check answers, and the browser remembers a signed-in visit.
const signedIn = async (page, app, values = {}) => { app.authenticated = true; await seed(page, { "bookvane:session-hint:v1": "1", ...values }); };

test("with nothing stored the page follows the device and switches live, and nothing is saved", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/browse");
  await expect(page.locator("#bv-main")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "light");
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("shelfbound-theme"))).toBeNull();
});

test("the theme is right before the app mounts, with no flash", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  let release;
  const held = new Promise(done => { release = done; });
  await page.route("**/assets/*.js", async route => { await held; return route.continue(); });
  try {
    await page.goto("/browse", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.getElementById("root").childElementCount)).toBe(0);
    expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute("content"))).toBe("#16130f");
  } finally { release(); }
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
});

test("a signed-in reader's saved Dark shows before the app mounts, even on a light device", async ({ page, app }) => {
  await signedIn(page, app, { "bookvane-theme": "dark", "bookvane-theme-migrated": "1" });
  await page.emulateMedia({ colorScheme: "light" });
  let release;
  const held = new Promise(done => { release = done; });
  await page.route("**/assets/*.js", async route => { await held; return route.continue(); });
  try {
    await page.goto("/browse", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally { release(); }
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
});

test("Settings shows Match device, Light and Dark; choosing Dark persists across a reload on a light device", async ({ page, app }) => {
  await signedIn(page, app);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const group = page.getByRole("radiogroup", { name: "Theme" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: "Match device" })).toBeChecked();
  await group.getByRole("radio", { name: "Dark" }).check({ force: true });
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  expect(await stored(page)).toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();
  // The device changing does not move a chosen theme.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("choosing Match device clears the stored choice and follows the device again", async ({ page, app }) => {
  await signedIn(page, app, { "bookvane-theme": "dark", "bookvane-theme-migrated": "1" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Match device" }).check({ force: true });
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "light");
  expect(await stored(page)).toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await stored(page)).toBeNull();
});

test("the three choices work by keyboard, with the current one selected", async ({ page, app }) => {
  await signedIn(page, app);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const group = page.getByRole("radiogroup", { name: "Theme" });
  await group.getByRole("radio", { name: "Match device" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  expect(await stored(page)).toBe("dark");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(group.getByRole("radio", { name: "Match device" })).toBeChecked();
  expect(await stored(page)).toBeNull();
});

test("a guest always matches the device, whatever an earlier visit saved", async ({ page, app: _app }) => {
  await seed(page, { "bookvane-theme": "dark", "bookvane-theme-migrated": "1" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/browse");
  await expect(page.locator("#bv-main")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "light");
});

for (const scenario of [
  { name: "a saved value equal to the device is dropped (Match device)", saved: "dark", device: "dark", expectStored: null, shown: "dark" },
  { name: "a saved value that differs from the device is kept as a choice", saved: "dark", device: "light", expectStored: "dark", shown: "dark" },
  { name: "a legacy value is migrated by the same rule", legacy: "light", device: "dark", expectStored: "light", shown: "light" },
  { name: "an invalid value is cleared", saved: "blue", device: "light", expectStored: null, shown: "light" },
]) {
  test(`one-time migration: ${scenario.name}`, async ({ page, app }) => {
    await signedIn(page, app, { ...(scenario.saved ? { "bookvane-theme": scenario.saved } : {}), ...(scenario.legacy ? { "shelfbound-theme": scenario.legacy } : {}) });
    await page.emulateMedia({ colorScheme: scenario.device });
    await page.goto("/browse");
    await expect(page.locator("#bv-main")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", scenario.shown);
    expect(await stored(page)).toBe(scenario.expectStored);
    expect(await page.evaluate(() => localStorage.getItem("bookvane-theme-migrated"))).toBe("1");
    expect(await page.evaluate(() => localStorage.getItem("shelfbound-theme"))).toBeNull();
    // It runs once: a reload does not run it again.
    await page.reload();
    expect(await stored(page)).toBe(scenario.expectStored);
  });
}

test("the browser colour follows the shown theme", async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/browse");
  await expect(page.locator("#bv-main")).toBeVisible();
  const color = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute("content"));
  expect(await color()).toBe("#f3eee3");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(color).toBe("#16130f");
});
