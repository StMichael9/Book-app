import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Browser fixtures only. Settings → Your data → Delete account. DELETE /me takes {"confirm":"delete"}: 204 clears both cookies,
// 422 is a wrong body, 429 is too many tries, 401 is signed out.
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { signedIn: true, deleteStatus: 204, deletes: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(state.signedIn ? 200 : 401, state.signedIn ? {} : { detail: "Not signed in" });
      if (path === "/me" && method === "DELETE") {
        state.deletes.push(request.postDataJSON());
        if (state.deleteStatus === 204) { state.signedIn = false; return route.fulfill({ status: 204, body: "" }); }
        return reply(state.deleteStatus, { detail: "Not allowed" });
      }
      if (path === "/me/reading-capabilities") return state.signedIn ? reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1, features: { reading_actions: true, reading_export: true } }) : reply(404, { detail: "Not found" });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null, facets: {}, index: {} });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/loans") return reply(200, { items: [] });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026, email_tips: false });
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/up-next") return reply(404, { detail: "Not found" });
      if (path === "/books") return reply(200, { items: [], total: 0, page: 1, size: 20 });
      if (path === "/books/more") return reply(200, []);
      if (path.startsWith("/autocomplete")) return reply(200, []);
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const WORDS = "This deletes your books, notes, lists, club posts, loans and profile. It can’t be undone. Download your data first if you want a copy.";
const sheet = page => page.getByRole("dialog", { name: "Delete your account?" });
const open = async page => { await page.goto("/settings"); await page.getByRole("button", { name: "Delete account", exact: true }).click(); };

test("Settings has Delete account in Your data, and the sheet opens with exactly the approved words", async ({ page, app }) => {
  await page.goto("/settings");
  const data = page.getByRole("region", { name: "Your data" });
  await expect(data).toContainText("Download your books and notes, or delete your account.");
  await data.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText(WORDS);
  await expect(sheet(page).getByRole("link", { name: "Download your data" })).toHaveAttribute("href", "/my-data");
  await expect(sheet(page).getByRole("button", { name: "Delete my account", exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  expect(app.deletes).toEqual([]);
});

test("Cancel closes the sheet, sends nothing and gives focus back to the button", async ({ page, app }) => {
  await open(page);
  await sheet(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();
  expect(app.deletes).toEqual([]);
  await expect(page).toHaveURL(/\/settings$/);
});

test("confirming sends DELETE /me with the confirm word, signs the reader out and lands on /", async ({ page, app }) => {
  await open(page);
  await sheet(page).getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(app.deletes).toEqual([{ confirm: "delete" }]);
  expect(app.signedIn).toBe(false);
  await expect(page.getByRole("link", { name: /Sign in|Log in/i }).first()).toBeVisible();
  expect(app.errors).toEqual([]);
});

for (const status of [422, 429]) test(`a ${status} shows the save error and leaves the sheet open to try again`, async ({ page, app }) => {
  app.deleteStatus = status;
  await open(page);
  await sheet(page).getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Your account couldn’t be deleted. Please try again.");
  await expect(sheet(page)).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  expect(app.signedIn).toBe(true);
  app.deleteStatus = 204;
  await sheet(page).getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(app.deletes).toEqual([{ confirm: "delete" }, { confirm: "delete" }]);
});

test("a network error shows the same error and leaves the sheet open", async ({ page, app }) => {
  await open(page);
  await page.route("**/test-api/me", route => route.request().method() === "DELETE" ? route.abort("failed") : route.fallback());
  await sheet(page).getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Your account couldn’t be deleted. Please try again.");
  await expect(sheet(page)).toBeVisible();
  expect(app.signedIn).toBe(true);
});

test("while changes are paused there is no Delete account", async ({ page, app }) => {
  app.readOnly = true;
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Your data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
});
