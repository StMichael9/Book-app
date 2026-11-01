import { test as base, expect } from "@playwright/test";

// Browser fixtures only: every API request is intercepted.
const books = Array.from({ length: 14 }, (_, index) => ({ id: index + 1, title: index === 0 ? "Ὀδύσσεια" : `Home fixture ${String(index + 1).padStart(2, "0")}`,
  authors: [{ id: 1, name: "Fixture Author" }], tags: [], cover_image_url: index === 0 ? null : `/test-cover/${index}.jpg`, english_title: null }));
const row = (id, flags = {}) => ({ id, book_id: id, book: books[id - 1], is_owned: false, is_wanted: false, version: 1, reading_state: null,
  private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...flags });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entries: new Map(), libraryImport: false, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (url.pathname.startsWith("/test-cover/")) return route.fulfill({ status: 404, body: "" });
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: state.libraryImport } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, books[Number(path.split("/").at(-1)) - 1]);
      if (path === "/books") return reply(200, { items: books, total: books.length, page: 1, size: 30 });
      if (path === "/me/library") {
        const items = [...state.entries.values()];
        return reply(200, { items, counts: { all: items.length, owned: 0, want: items.length, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: items.length, next_cursor: null });
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: state.entries.get(Number(workspace[1])), current_attempt: null, editions: [] });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => { const entry = state.entries.get(id);
        return { book_id: id, entry_id: entry?.id ?? null, version: entry?.version ?? null, is_owned: entry?.is_owned ?? false, is_wanted: entry?.is_wanted ?? false, reading_state: null }; }) });
      if (/^\/me\/library\/books\/\d+$/.test(path) && method === "PUT") {
        const id = Number(path.split("/").at(-1)), entry = state.entries.get(id);
        const saved = { ...(entry || row(id)), ...body, version: entry ? entry.version + 1 : 1 }; state.entries.set(id, saved); return reply(200, saved);
      }
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library\/imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("an account with no books gets a first-run Home with a few books to pick, in first-impression order", async ({ page, app }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Welcome. Let’s fill your first shelf.", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Pick a few books", exact: true })).toBeVisible();
  const cards = page.locator(".bv-first-run .bv-book-card");
  await expect(cards).toHaveCount(10);
  await expect(cards.first().getByRole("heading")).not.toHaveText("Ὀδύσσεια");
  await expect(page.getByRole("link", { name: "Tell us what you like (optional)" })).toHaveAttribute("href", "/preferences");
  const pickTop = (await page.getByRole("heading", { name: "Pick a few books", exact: true }).boundingBox()).y;
  expect((await page.getByRole("link", { name: "Tell us what you like (optional)" }).boundingBox()).y).toBeLessThan(pickTop);
  await expect(page.getByRole("link", { name: /Import from Goodreads or StoryGraph/ })).toHaveCount(0);
  expect(app.requests.some(request => request.path.startsWith("/me/library/books/"))).toBe(false);
});

test("the import path shows only when library import is on", async ({ page, app }) => {
  app.libraryImport = true;
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Import from Goodreads or StoryGraph", exact: true })).toHaveAttribute("href", "/my-books/import");
  expect((await page.getByRole("link", { name: "Import from Goodreads or StoryGraph", exact: true }).boundingBox()).y).toBeLessThan((await page.getByRole("heading", { name: "Pick a few books", exact: true }).boundingBox()).y);
});

test("after three saves the page says the shelf is started and offers My Books", async ({ page, app }) => {
  await page.goto("/home");
  const started = page.getByText("Your shelf is started.", { exact: true });
  for (const id of [2, 3]) {
    await page.getByRole("button", { name: `Add Home fixture ${String(id).padStart(2, "0")} to Want to read` }).click();
    await expect(page.getByRole("button", { name: `Remove Home fixture ${String(id).padStart(2, "0")} from Want to read` })).toBeVisible();
  }
  await expect(started).toHaveCount(0);
  await page.getByRole("button", { name: "Add Home fixture 04 to Owned" }).click();
  await expect(started).toBeVisible();
  expect((await started.boundingBox()).y).toBeGreaterThan((await page.locator(".bv-first-run .bv-book-card").last().boundingBox()).y);
  await expect(page.locator(".bv-first-run-done")).toHaveAttribute("role", "status");
  await expect(page.getByRole("heading", { name: "Welcome. Let’s fill your first shelf.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open My Books", exact: true })).toHaveAttribute("href", "/my-books");
  expect(app.entries.size).toBe(3);
});

test("an account that already has books keeps the usual Home", async ({ page, app }) => {
  app.entries.set(2, row(2, { is_wanted: true }));
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome. Let’s fill your first shelf." })).toHaveCount(0);
});
