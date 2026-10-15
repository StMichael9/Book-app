import { test as base, expect } from "@playwright/test";

// Browser fixtures only. No hosted API, real accounts or production catalogue.
const books = Array.from({ length: 30 }, (_, index) => ({ id: index + 1,
  title: `Library fixture ${String(index + 1).padStart(2, "0")}`,
  authors: [{ id: 1, name: "Isolated test author" }], tags: [] }));
const row = (id, owned = false, wanted = true) => ({ id, book_id: id, book: books[id - 1],
  is_owned: owned, is_wanted: wanted, version: 1, reading_state: null,
  private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entries: new Map([[1, row(1)]]), requests: [], errors: [], authenticated: true };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, query: url.searchParams });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/auth/login") { state.authenticated = true; return reply(200, {}); }
      if (path === "/me/reading-capabilities") {
        if (state.capabilityFails) return reply(503, {});
        return reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1 });
      }
      if (path === "/books") return reply(200, { items: books, total: 30, page: 1, size: 30 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, books[Number(path.split("/")[2]) - 1]);
      if (path === "/me/library/lookup") {
        if (state.holdLookup) await state.holdLookup;
        if (state.lookupFails) return reply(503, {});
        if (state.malformedLookup) return reply(200, { items: [] });
        return reply(200, { items: body.book_ids.map(id => { const entry = state.entries.get(id);
          return { book_id: id, entry_id: entry?.id ?? null, version: entry?.version ?? null,
            is_owned: entry?.is_owned ?? false, is_wanted: entry?.is_wanted ?? false, reading_state: null }; }) });
      }
      if (/^\/me\/library\/books\/\d+$/.test(path) && method === "PUT") {
        const id = Number(path.split("/").at(-1));
        let entry = state.entries.get(id);
        if (state.conflictNext) { state.conflictNext = false; entry = { ...entry, version: entry.version + 1, is_wanted: false }; state.entries.set(id, entry); }
        if (entry && body.expected_version !== entry.version) return reply(409, { detail: { code: "entry_changed", message: "Your library changed on another page. Review its current state and try again.", current: entry } });
        entry = { ...(entry || row(id, false, false)), ...body, version: entry ? entry.version + 1 : 1 };
        state.entries.set(id, entry); return reply(200, entry);
      }
      if (path === "/me/library") {
        if (state.pageFails) return reply(503, {});
        const query = (url.searchParams.get("q") || "").toLowerCase(), facet = url.searchParams.get("facet");
        let entries = [...state.entries.values()].sort((a, b) => b.id - a.id).filter(entry => entry.book.title.toLowerCase().includes(query));
        const counts = { all: entries.length, owned: entries.filter(entry => entry.is_owned).length, want: entries.filter(entry => entry.is_wanted).length };
        if (facet === "owned") entries = entries.filter(entry => entry.is_owned);
        if (facet === "want") entries = entries.filter(entry => entry.is_wanted);
        const offset = Number(url.searchParams.get("cursor") || 0);
        return reply(200, { items: entries.slice(offset, offset + 25), counts, total: entries.length,
          next_cursor: entries.length > offset + 25 ? String(offset + 25) : null });
      }
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("V3 discovery batches visible state and never loads the complete shelf", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toBeEnabled();
  expect(app.requests.filter(request => request.path === "/me/books")).toHaveLength(0);
  const lookups = app.requests.filter(request => request.path === "/me/library/lookup");
  expect(lookups).toHaveLength(1);
  expect(lookups[0].body.book_ids).toHaveLength(30);
});

test("Own and Want coexist, removing one preserves the other and survives reload", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(app.entries.get(1).is_owned).toBe(true);
  expect(app.entries.get(1).is_wanted).toBe(false);
  expect(app.requests.some(request => request.path.endsWith("/status"))).toBe(false);
});

test("failed and malformed lookups block writes and offer a real retry", async ({ page, app }) => {
  app.malformedLookup = true;
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Try saved status again" })).toBeVisible();
  app.malformedLookup = false;
  await page.getByRole("button", { name: "Try saved status again" }).click();
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true })).toBeEnabled();
  expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
});

test("a stale update shows current state without overwriting it", async ({ page, app }) => {
  app.conflictNext = true;
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed on another page");
  expect(app.entries.get(1).is_owned).toBe(false);
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toBeVisible();
});

test("large library pagination, search and both facets use bounded server queries", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await page.goBack();
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.goForward();
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.getByLabel("Search title or author").fill("fixture 01");
  await page.getByRole("search", { name: "Search your library" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.getByRole("group", { name: "Filter your library" }).getByRole("button", { name: /^Own/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  expect(app.requests.some(request => request.path === "/me/books")).toBe(false);
});

test("capability failure stays gated instead of falling back to unsafe legacy writes", async ({ page, app }) => {
  app.capabilityFails = true;
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "Your library couldn’t load." })).toBeVisible();
  expect(app.requests.filter(request => request.path === "/me/books")).toHaveLength(0);
  app.capabilityFails = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Search title or author")).toBeVisible();
});

test("pilot library stays usable on a phone in both themes", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.getByLabel("Search title or author")).toBeVisible();
  await expect(page.getByLabel("Search title or author")).toHaveCSS("border-top-width", "1px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-phone-final.png", fullPage: true });
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You", exact: true }).click();
  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "My Books", exact: true }).click();
  await expect(page.getByLabel("Search title or author")).toBeVisible();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-phone-dark.png", fullPage: true });
  expect(app.requests.some(request => request.path === "/me/books")).toBe(false);
});

test("disabling writes preserves the richer library in read-only mode", async ({ page, app }) => {
  app.readOnly = true;
  app.entries.set(1, row(1, true, true));
  await page.goto("/my-books");
  await expect(page.getByRole("status").filter({ hasText: "Your library is available to read. Changes are temporarily paused." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(app.requests.some(request => request.path.endsWith("/status") || request.method === "PUT")).toBe(false);
});
