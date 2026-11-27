import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Browser fixtures only: every API request is intercepted, including /admin/overview and /admin/metrics (the T24 contract).
const OVERVIEW = { readers: { total: 1234, new_7d: 21, new_30d: 88, weekly_active: 143 }, clubs: { total: 12, active_30d: 7 }, open_loans: 5, imports_completed_30d: 19,
  subscriptions: { active: { patron: 3, club_plus: 2 }, mrr_minor_units: { usd: 123400 } } };
const metrics = days => ({ days, since: "2026-10-01", counts: [], totals: { scan_opened: 40, scan_added: 55, scan_timeout: 6, scan_non_isbn: 2, scan_typed: 4, scan_engine_native: 20, scan_engine_wasm: 9, scan_snap_isbn: 3, scan_snap_cover: 1, scan_library_code: 8 },
  channels: { by_day: [], totals: [{ ref: "tt", visits: 900, signups: 45, conversion: 0.05 }, { ref: "", visits: 300, signups: 12, conversion: 0.04 }, { ref: "share", visits: 120, signups: 9, conversion: 0.075 }] },
  scans: { opened: 40 * (days / 30), added: 55, books_per_scan: 1.4, by_day: [] },
  weekly_active_readers: [], week_one_return: [], imports: [{ day: "2026-11-01", started: 4, completed: 3 }, { day: "2026-11-02", started: 2, completed: 2 }],
  catalogue: { coverage: { benchmark: 200, found: 190, percent: 95 }, searches: { runs: 500, empty: 20, empty_percent: 4 }, lookups: {}, gate_rejections: {}, imports: { rows: 800, matched: 700, match_percent: 87.5 },
    books: { total: 50000, no_cover: 238, no_genre: 3 }, database_mb: 301.5, limits: { database_max_mb: 700 }, alerts: [] },
  billing: { active_subscriptions: { patron: 3, club_plus: 2 }, past_due: 0, cancelling: 0, mrr_minor_units: { usd: 123400 } },
  new_accounts: 40 * (days / 30), new_accounts_with_3_saves_in_7_days: 10 });

const test = base.extend({
  app: [async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], role: "admin", overviewStatus: null, metricsFailOnce: false, delay: 0 };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      state.requests.push({ path: path + url.search, method });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/auth/refresh") return state.role === "guest" ? reply(401, {}) : reply(200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/books") return reply(200, { items: [], total: 0, page: 1, size: 20 });
      if (path === "/genres") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Admin", bio: null, initials: "A", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/admin/overview") {
        if (state.delay) await new Promise(done => setTimeout(done, state.delay));
        if (state.role !== "admin") return reply(403, { detail: "Not allowed" });
        return state.overviewStatus ? reply(state.overviewStatus, { detail: "down" }) : reply(200, OVERVIEW);
      }
      if (path === "/admin/metrics") {
        if (state.metricsFailOnce) { state.metricsFailOnce = false; return reply(500, { detail: "down" }); }
        return reply(200, metrics(Number(url.searchParams.get("days"))));
      }
      if (path === "/me/clubs") return route.fulfill({ status: 200, json: { items: [] } });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  }, { auto: true }],
});
const asked = app => app.requests.filter(request => request.path.startsWith("/admin/metrics")).map(request => request.path);

test("an admin sees the Overview tiles first, then the period switch over the metrics sections", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  const tile = label => page.locator(".bv-admin-tile").filter({ has: page.getByText(label, { exact: true }) });
  await expect(page.getByRole("heading", { name: "Overview", level: 2 })).toBeVisible();
  for (const [label, value] of [["Readers", "1,234"], ["New this week", "21"], ["New this month", "88"], ["Active this week", "143"], ["Clubs", "12"], ["Active clubs (30 days)", "7"], ["Books on loan", "5"], ["Imports (30 days)", "19"], ["Paying subscriptions", "5"]])
    await expect(tile(label).locator("dd")).toHaveText(value);
  await expect(tile("Monthly revenue").first().locator("dd")).toHaveText("$1,234.00");
  // Overview, then the switch, then the sections (document order).
  const order = await page.locator("main h2, .bv-admin-period").evaluateAll(nodes => nodes.map(node => node.matches(".bv-admin-period") ? "switch" : node.textContent));
  expect(order).toEqual(["Overview", "switch", "Readers", "Where readers come from", "Scanning", "Imports", "Catalogue", "Money"]);
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
});

test("the default period is 30 days and the switch asks for 7 and 90", async ({ page, app }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  expect(asked(app)).toEqual(["/admin/metrics?days=30"]);
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => asked(app)).toEqual(["/admin/metrics?days=30", "/admin/metrics?days=7"]);
  await page.getByRole("button", { name: "90 days" }).click();
  await expect.poll(() => asked(app).at(-1)).toBe("/admin/metrics?days=90");
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  expect(app.requests.filter(request => request.path === "/admin/overview")).toHaveLength(1); // the Overview does not change with the period
});

test("readers, sources, scanning, imports, catalogue and money show the numbers", async ({ page }) => {
  await page.goto("/admin");
  const section = name => page.locator(".bv-admin-section").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(page.locator(".bv-admin-section").filter({ hasText: "New accounts" }).locator("dd")).toHaveText(["40", "10", "25%"]);
  const rows = page.locator(".bv-admin-table").first().locator("tbody tr");
  await expect(rows).toHaveCount(11);
  await expect(rows.nth(0)).toHaveText("TikTok90045");
  await expect(rows.nth(7)).toHaveText("Shares1209");
  await expect(rows.nth(10)).toHaveText("Direct30012"); // unknown or missing sources count as Direct
  await expect(page.getByRole("columnheader")).toHaveText(["Source", "Visits", "Sign-ups"]);
  const scanning = section("Scanning");
  for (const [label, value] of [["Scans opened", "40"], ["Books added by scan", "55"], ["Gave up after 8 seconds", "6"], ["Barcode wasn’t an ISBN", "2"], ["Typed the ISBN instead", "4"], ["Read by the phone’s own reader", "20"],
    ["Read by the built-in reader", "9"], ["Snapped an ISBN", "3"], ["Snapped a cover", "1"], ["Library sticker seen", "8"]])
    await expect(scanning.locator(".bv-admin-tile").filter({ has: page.getByText(label, { exact: true }) }).locator("dd")).toHaveText(value);
  await expect(section("Imports").locator("dd")).toHaveText(["6", "800"]);
  await expect(section("Catalogue").getByRole("row", { name: /books\.no_cover/ })).toContainText("238");
  await expect(section("Money").locator("dd")).toHaveText(["3", "2", "$1,234.00"]);
});

test("a missing scan event shows 0", async ({ page }) => {
  await page.route("**/test-api/admin/metrics*", route => route.fulfill({ status: 200, json: { ...metrics(30), totals: {}, scans: undefined } }));
  await page.goto("/admin");
  const scanning = page.locator(".bv-admin-section").filter({ has: page.getByRole("heading", { name: "Scanning", exact: true }) });
  await expect(scanning.locator("dd")).toHaveText(Array(10).fill("0"));
});

test("anyone who is not an admin gets the not-found page; there is no nav entry and the page is noindex", async ({ page, app }) => {
  app.role = "reader";
  await page.goto("/admin");
  await expect(page.getByText("This page isn’t on the shelf.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  expect(asked(app)).toEqual([]);
  await page.goto("/privacy");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /admin/i })).toHaveCount(0);
});

test("a signed-out visitor gets the not-found page", async ({ page, app }) => {
  app.role = "guest";
  await page.goto("/admin");
  await expect(page.getByText("This page isn’t on the shelf.")).toBeVisible();
  expect(app.requests.some(request => request.path.startsWith("/admin"))).toBe(false);
});

test("an admin sees no Admin link in the navigation and the page is noindex", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("link", { name: /^admin$/i })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("loading shows skeletons, a failed Overview offers Try again, and a failed period can be retried", async ({ page, app }) => {
  app.delay = 600; app.overviewStatus = 500;
  await page.goto("/admin");
  await expect(page.locator(".bv-admin-waiting").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  await expect(page.getByText("We couldn’t load this just now.")).toBeVisible();
  app.overviewStatus = null; app.delay = 0; app.metricsFailOnce = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Paying subscriptions")).toBeVisible();
  await expect(page.getByText("We couldn’t load this just now.")).toBeVisible(); // the metrics failed once
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
});

test("admin screenshots", async ({ page }) => {
  test.skip(!process.env.BV_SHOTS_DIR, "set BV_SHOTS_DIR to export screenshots");
  const dir = process.env.BV_SHOTS_DIR; mkdirSync(dir, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    for (const [width, height] of [[390, 844], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/admin"); await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/admin-${width}-${theme}.png`, fullPage: true });
    }
  }
});
