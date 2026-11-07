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
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, query: url.searchParams, account: state.account });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/auth/login") { state.authenticated = true; state.account = "B"; return reply(200, {}); }
      if (path === "/me/reading-capabilities") {
        if (state.capabilityFails) return reply(503, {});
        return reply(200, { enabled: !state.legacy, writable: !state.readOnly, contract_version: 1,
          features: { reading_actions: Boolean(state.readingActions), library_import: Boolean(state.libraryImport) } });
      }
      if (path === "/me/books") return reply(200, []);
      if (path === "/books") {
        if (state.holdBooks) await state.holdBooks;
        if (!state.accountFixtures) return reply(200, { items: books, total: 30, page: 1, size: 30 });
        const account = state.authenticated ? state.account : null;
        const filtered = url.searchParams.has("shelf_status") || url.searchParams.has("exclude_owned");
        const held = account === "A" && state.holdCatalogue;
        const status = held ? (state.lateCatalogueStatus || 200) : 200;
        if (held) {
          state.heldStarted = true;
          await held;
        }
        const items = account === "A" ? [books[0]] : account === "B" ? (filtered ? [] : [books[1]]) : [];
        await reply(status, status === 200 ? { items, total: items.length, page: 1, size: 20 } : { detail: "Old request failed" });
        if (held) state.heldCompleted = true;
        return;
      }
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
        if (state.holdFlag) await state.holdFlag;
        if (state.flagFails) return reply(503, { detail: "Temporary failure" });
        const id = Number(path.split("/").at(-1));
        let entry = state.entries.get(id);
        if (state.conflictNext) { state.conflictNext = false; entry = { ...entry, version: entry.version + 1, is_wanted: false }; state.entries.set(id, entry); }
        if (entry && body.expected_version !== entry.version) return reply(409, { detail: { code: "entry_changed", message: "Your library changed on another page. Review its current state and try again.", current: entry } });
        entry = { ...(entry || row(id, false, false)), ...body, version: entry ? entry.version + 1 : 1 };
        state.entries.set(id, entry); return reply(200, entry);
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: state.entries.get(Number(workspace[1])), current_attempt: state.attempt || null, editions: [] });
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: state.attempt ? [state.attempt] : [], next_cursor: !url.searchParams.has("cursor") ? state.historyNextCursor || null : null });
      if (path.startsWith("/me/reading-attempts/") && method === "PUT") {
        if (state.startConflict) return reply(409, { detail: { message: "Your library changed on another page." } });
        const entry = state.entries.get(body.entry_id);
        if (body.expected_version !== entry.version) return reply(409, { detail: { message: "Your library changed on another page." } });
        entry.version += 1; entry.reading_state = "reading"; entry.is_wanted = false;
        state.attempt = { id: path.split("/").at(-1), state: "reading", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
        return reply(200, { entry, attempt: state.attempt });
      }
      if (path === "/me/library") {
        if (state.pageFails) return reply(503, {});
        const query = (url.searchParams.get("q") || "").toLowerCase(), facet = url.searchParams.get("facet");
        const sort = url.searchParams.get("sort") || "added", owned = url.searchParams.get("owned") === "true", limit = Number(url.searchParams.get("limit") || 25);
        const titleOf = entry => entry.book?.title || entry.private_title;
        let entries = [...state.entries.values()].sort((a, b) => b.id - a.id).filter(entry => titleOf(entry).toLowerCase().includes(query));
        if (owned) entries = entries.filter(entry => entry.is_owned);
        const subjects = url.searchParams.getAll("subject").map(Number);
        if (subjects.length) entries = entries.filter(entry => entry.book?.tags?.some(tag => subjects.includes(tag.id)));
        if (sort === "title") entries.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
        const counts = { all: entries.length, owned: entries.filter(entry => entry.is_owned).length, want: entries.filter(entry => entry.is_wanted).length, ...Object.fromEntries(["reading", "paused", "finished", "dnf"].map(state => [state, entries.filter(entry => entry.reading_state === state).length])) };
        if (facet === "owned") entries = entries.filter(entry => entry.is_owned);
        if (facet === "want") entries = entries.filter(entry => entry.is_wanted);
        if (["reading", "paused", "finished", "dnf"].includes(facet)) entries = entries.filter(entry => entry.reading_state === facet);
        const offset = Number(url.searchParams.get("cursor") || 0);
        if (state.badCursor && offset) { state.badCursor = false; return reply(422, { detail: { code: "invalid_cursor", message: "Invalid library cursor. Return to the first page." } }); }
        return reply(200, { items: entries.slice(offset, offset + limit), counts, total: counts[facet] ?? entries.length,
          next_cursor: entries.length > offset + limit ? String(offset + limit) : null, facets: state.facets || {},
          index: ["title", "author"].includes(sort) ? Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ#"].map(letter => [letter, entries.filter(entry => (/^[a-z]/i.test(titleOf(entry)) ? titleOf(entry)[0].toUpperCase() : "#") === letter).length])) : null });
      }
      if (route.request().method() === "GET" && /^\/me\/(home|library|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library-imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      if (path === "/me/up-next" || path === "/me/stats") return reply(404, { detail: "Not found" }); // Home's optional blocks: pins and the year at a glance
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

for (const failedSave of [false, true]) test(`M6 Start waits for a same-book Want save; failed save=${failedSave}`, async ({ page, app }) => {
  app.readingActions = true;
  app.entries.set(1, row(1, true, false));
  let release;
  app.holdFlag = new Promise(resolve => { release = resolve; });
  await page.goto("/book/1");
  await page.getByRole("button", { name: "Add Library fixture 01 to Want to read", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.path === "/me/library/books/1" && request.method === "PUT").length).toBe(1);
  await page.getByRole("link", { name: "Open or start your reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Opening your reading…", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.path.startsWith("/me/reading-attempts/"))).toHaveLength(0);
  app.flagFails = failedSave;
  release();
  if (failedSave) {
    await expect(page.getByRole("heading", { name: "We couldn’t confirm your reading started.", exact: true })).toBeVisible();
    expect(app.requests.filter(request => request.path.startsWith("/me/reading-attempts/"))).toHaveLength(0);
    app.flagFails = false;
    await page.getByRole("button", { name: "Try starting again", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/my-books\/1$/);
  expect(app.requests.filter(request => request.path.startsWith("/me/reading-attempts/") && request.method === "PUT")).toHaveLength(1);
  expect(app.entries.get(1).is_owned).toBe(true);
  expect(app.entries.get(1).is_wanted).toBe(false);
});

test("M6 genuine Start conflict has truthful copy and explicit idempotent retry", async ({ page, app }) => {
  app.readingActions = true;
  app.startConflict = true;
  await page.goto("/my-books/start/1");
  await expect(page.getByRole("heading", { name: "We couldn’t confirm your reading started.", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("while we were starting this reading");
  await expect(page.getByRole("alert")).not.toContainText("another page");
  const first = app.requests.find(request => request.path.startsWith("/me/reading-attempts/") && request.method === "PUT");
  expect(app.attempt).toBeUndefined();
  app.startConflict = false;
  await page.getByRole("button", { name: "Try starting again", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/1$/);
  const attempts = app.requests.filter(request => request.path.startsWith("/me/reading-attempts/") && request.method === "PUT");
  expect(attempts).toHaveLength(2);
  expect(attempts[1].path).toBe(first.path);
});

test("V3 discovery batches visible state and never loads the complete shelf", async ({ page, app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true })).toBeEnabled();
  expect(app.requests.filter(request => request.path === "/me/books")).toHaveLength(0);
  const lookups = app.requests.filter(request => request.path === "/me/library/lookup");
  expect(lookups).toHaveLength(1);
  expect(lookups[0].body.book_ids).toHaveLength(30);
});

test("snapshot cards wait for the live results before the saved-status lookup, so there is exactly one lookup", async ({ page, app }) => {
  let release;
  app.holdBooks = new Promise((resolve) => { release = resolve; });
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Books to explore" })).toBeVisible();
  await expect.poll(() => app.requests.some(request => request.path === "/me/reading-capabilities")).toBe(true);
  await page.evaluate(() => new Promise(done => setTimeout(done, 400))); // capabilities are in; the snapshot is still showing
  expect(app.requests.filter(request => request.path === "/me/library/lookup")).toHaveLength(0);
  release();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true })).toBeEnabled();
  const lookups = app.requests.filter(request => request.path === "/me/library/lookup");
  expect(lookups).toHaveLength(1);
  expect(lookups[0].body.book_ids).toHaveLength(30);
});

test("Own and Want coexist, removing one preserves the other and survives reload", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: "I own it: Add Library fixture 01 to Owned", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Owned", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Owned", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want to read", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(app.entries.get(1).is_owned).toBe(true);
  expect(app.entries.get(1).is_wanted).toBe(false);
  expect(app.requests.some(request => request.path.endsWith("/status"))).toBe(false);
});

test("failed and malformed lookups block writes and offer a real retry", async ({ page, app }) => {
  app.malformedLookup = true;
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: "I own it: Add Library fixture 01 to Owned", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Try saved status again" })).toBeVisible();
  app.malformedLookup = false;
  await page.getByRole("button", { name: "Try saved status again" }).click();
  await expect(page.getByRole("button", { name: "I own it: Add Library fixture 01 to Owned", exact: true })).toBeEnabled();
  expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
});

test("a stale update shows current state without overwriting it", async ({ page, app }) => {
  app.conflictNext = true;
  await page.goto("/book/1");
  await page.getByRole("button", { name: "I own it: Add Library fixture 01 to Owned", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed on another page");
  expect(app.entries.get(1).is_owned).toBe(false);
  await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want to read", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I own it: Add Library fixture 01 to Owned", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Owned", exact: true })).toBeVisible();
});

test("large library: Show more, search and Owned use bounded server queries", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.locator(".bv-book-card")).toHaveCount(24);
  await expect(page.getByText("Showing 24 of 30", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(30);
  await expect(page.getByText("Showing 30 of 30", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
  await page.getByLabel("Search title or author").fill("fixture 01");
  await page.getByLabel("Search title or author").press("Enter");
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await page.getByRole("switch", { name: "Owned only" }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await expect(page).toHaveURL(/owned=1/);
  expect(app.requests.filter(r => r.path === "/me/library" && r.query.get("limit") !== "1").every(r => r.query.get("limit") === "24")).toBe(true);
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
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Owned", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(app.requests.some(request => request.path.endsWith("/status") || request.method === "PUT")).toBe(false);
});

async function expireAndSignInAsB(page, app, returnTo, protectedPage = false) {
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  if (!protectedPage) await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  // Keep this entirely within the SPA: a full navigation would clear the
  // module-level request map and conceal the account-switching defect.
  if (returnTo) await page.evaluate(path => {
    window.history.replaceState(null, "", `/login?returnTo=${encodeURIComponent(path)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, returnTo);
  if (returnTo) await expect(page.getByRole("link", { name: "Create an account", exact: true })).toHaveAttribute("href", `/register?${new URLSearchParams({ returnTo })}`);
  await page.getByLabel("Email address", { exact: true }).fill("b@example.com");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("b@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("synthetic-password");
  const signedIn = page.waitForResponse(response => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await signedIn;
}

for (const legacy of [true, false]) {
  for (const filter of ["shelf_status=want", "shelf_status=owned", "exclude_owned=true"]) {
    for (const lateStatus of [200, 503, 401]) {
      test(`session isolation: ${legacy ? "V2" : "V3"}, ${filter}, late ${lateStatus}`, async ({ page, app }) => {
        Object.assign(app, { legacy, accountFixtures: true, account: "A", lateCatalogueStatus: lateStatus });
        let release;
        app.holdCatalogue = new Promise(resolve => { release = resolve; });
        try {
          await page.goto(`/browse?${filter}`);
          await expect.poll(() => app.heldStarted).toBe(true);
          await expireAndSignInAsB(page, app, `/browse?${filter}`);
          // B must finish its OWN request before A is allowed to complete.
          await expect.poll(() => app.requests.filter(r => r.path === "/books" && r.account === "B" && r.query.toString().includes(filter)).length).toBe(1);
          await expect(page.getByRole("heading", { name: "No books found.", exact: true })).toBeVisible();
          release();
          await expect.poll(() => app.heldCompleted).toBe(true);
          // Settle React callbacks from both a late success and a late failure.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await expect(page.getByRole("heading", { name: "No books found.", exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "Your profile", exact: true })).toBeVisible();
          await expect(page.locator(".bv-book-card")).toHaveCount(0);
          // A departed session's 401 must not rotate B's cookies or replay its
          // operation using B's identity, even for an otherwise safe read.
          expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(1);
          expect(app.requests.filter(r => r.path === "/books" && r.account === "B" && r.query.toString().includes(filter))).toHaveLength(1);
        } finally { release(); }
      });
    }
  }

  test(`Welcome isolates pending personalized results across ${legacy ? "V2" : "V3"} sessions`, async ({ page, app }) => {
    Object.assign(app, { legacy, accountFixtures: true, account: "A" });
    let release;
    app.holdCatalogue = new Promise(resolve => { release = resolve; });
    try {
      await page.goto("/");
      await expect.poll(() => app.heldStarted).toBe(true);
      await expireAndSignInAsB(page, app, "/");
      await expect.poll(() => app.requests.filter(r => r.path === "/books" && r.account === "B").length).toBe(1);
      await expect(page.locator(".bv-book-card")).toHaveCount(1);
      release();
      await expect.poll(() => app.heldCompleted).toBe(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator(".bv-book-card")).toContainText("Library fixture 02");
      await expect(page.locator(".bv-book-card")).not.toContainText("Library fixture 01");
    } finally { release(); }
  });
}

test("filter chips hand focus on, the badge reads aloud, and N of M shows on a fresh filtered load", async ({ page, app }) => {
  app.entries = new Map(books.slice(0, 6).map(book => [book.id, row(book.id, book.id % 2 === 0, true)]));
  await page.goto("/my-books?owned=1&status=want");
  await expect(page.getByText("3 of 6 books", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/my-books?owned=1&q=fixture");
  await page.getByRole("button", { name: "Remove filter: Owned" }).click();
  await expect(page.getByRole("button", { name: "Remove filter: “fixture”" })).toBeFocused();
  await page.getByRole("button", { name: "Remove filter: “fixture”" }).click();
  await expect(page.getByRole("heading", { name: "Your books" })).toBeFocused();
});

test("on a phone the Filters button says how many are active", async ({ page, app }) => {
  app.entries = new Map(books.slice(0, 3).map(book => [book.id, row(book.id)]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books?has=1&note=1");
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible();
});

test("coming back from a book restores how far Show more had got", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.goto("/my-books");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(30);
  await page.locator(".bv-book-card h3 a").nth(27).click();
  await page.goBack();
  await expect(page.locator(".bv-book-card")).toHaveCount(30);
  expect(app.requests.filter(r => r.path === "/me/library" && r.query.get("limit") !== "1").at(-1).query.get("limit")).toBe("30");
});

test("the Covers / List choice is remembered on this device", async ({ page, app }) => {
  app.entries = new Map(books.slice(0, 5).map(book => [book.id, row(book.id)]));
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.locator(".bv-library-row")).toHaveCount(5);
  await expect(page.locator(".bv-book-card")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("bookvane-library-view"))).toBe("list");
  await page.reload();
  await expect(page.locator(".bv-library-row")).toHaveCount(5);
  await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Covers" }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
});

test("the list view works with storage blocked", async ({ page, app }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); }; Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); }; });
  app.entries = new Map(books.slice(0, 3).map(book => [book.id, row(book.id)]));
  await page.goto("/my-books");
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.locator(".bv-library-row")).toHaveCount(3);
});

test("the A–Z index groups the list by letter and jumps, loading more pages when needed", async ({ page, app }) => {
  const letters = [..."ABCDEFGHIJKLMNOPRSTUVWY"], titles = [...letters.map(letter => `${letter} story`), "Aa extra", "Zebra tale", "Zen path", "Zoo day", "Zulu war", "Zinc age"];
  app.entries = new Map(titles.map((title, index) => { const id = index + 1; return [id, { ...row(id), book: { ...books[index], id, title } }]; }));
  await page.goto("/my-books?sort=title");
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.locator(".bv-library-row")).toHaveCount(24);
  const az = page.getByRole("navigation", { name: "Jump to a letter" });
  await expect(az.getByRole("button", { name: "Q, no books" })).toBeDisabled();
  await expect(az.getByRole("button", { name: "Jump to B, 1 book" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "A", exact: true })).toBeVisible();
  await expect(page.locator("#bv-letter-Z")).toHaveCount(0);
  await az.getByRole("button", { name: /^Jump to Z,/ }).click();
  await expect(page.locator(".bv-library-row")).toHaveCount(29);
  await expect(page.locator("#bv-letter-Z")).toBeFocused();
  await expect(page.locator(".bv-library-row")).toHaveCount(29);
  await page.goto("/my-books");
  await expect(page.getByRole("navigation", { name: "Jump to a letter" })).toHaveCount(0);
});

test("on a phone Sort is one 44px line and Paused/Stopped live in the filter sheet", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(books.slice(0, 4).map(book => [book.id, { ...row(book.id), reading_state: book.id === 1 ? "paused" : null }]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books?sort=title");
  const sort = page.getByRole("button", { name: "Sort: Title" });
  await expect(sort).toBeVisible();
  await expect(sort).toContainText("Title");
  expect((await sort.boundingBox()).height).toBe(44);
  const filters = page.getByRole("button", { name: /^Filters/ });
  const fb = await filters.boundingBox(), sb = await sort.boundingBox();
  expect(Math.abs(fb.y - sb.y)).toBeLessThan(2);
  await expect(page.getByText("More filters", { exact: true })).toHaveCount(0);
  await filters.click();
  await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Paused/ }).click();
  await expect(page).toHaveURL(/status=paused/);
});

test("a cursor the server rejects reloads the list from the start", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.goto("/my-books?status=want");
  await expect(page.locator(".bv-book-card")).toHaveCount(24);
  app.badCursor = true;
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "Show more", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(30);
});

test("an empty shelf says so once and offers the way back", async ({ page, app }) => {
  app.entries.set(1, row(1, true, false));
  await page.goto("/my-books?status=want");
  await expect(page.getByText("No books match these filters", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all books", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
});

test("shelves, Owned and sort combine, and the URL holds the view", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(books.slice(0, 6).map(book => [book.id, row(book.id, book.id % 2 === 0, true)]));
  await page.goto("/my-books");
  const shelf = page.getByRole("group", { name: "Shelf", exact: true });
  await expect(shelf.getByRole("button", { name: /^All/ })).toContainText("6");
  await shelf.getByRole("button", { name: /^Want to read/ }).click();
  await page.getByRole("switch", { name: "Owned only" }).click();
  await expect(page).toHaveURL(/status=want&owned=1/);
  await expect(page.locator(".bv-book-card")).toHaveCount(3);
  await expect(page.getByText("3 of 6 books", { exact: true })).toBeVisible();
  const last = app.requests.filter(r => r.path === "/me/library" && r.query.get("limit") !== "1").at(-1).query;
  expect(last.get("facet")).toBe("want");
  expect(last.get("owned")).toBe("true");
  await page.getByRole("button", { name: "Sort: Recently added" }).click();
  await page.getByRole("menuitemradio", { name: "Title" }).click();
  await expect(page).toHaveURL(/sort=title/);
  expect(app.requests.filter(r => r.path === "/me/library" && r.query.get("limit") !== "1").at(-1).query.get("sort")).toBe("title");
  await page.goBack();
  await expect(page).not.toHaveURL(/sort=title/);
  await expect(page.getByRole("button", { name: "Sort: Recently added" })).toBeVisible();
  await page.goto("/my-books?status=want&owned=1&sort=author");
  await expect(page.getByRole("button", { name: /Sort: Author/ })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Owned only" })).toHaveAttribute("aria-checked", "true");
  await expect(shelf.getByRole("button", { name: /^Want to read/ })).toHaveAttribute("aria-pressed", "true");
});

test("filters show live counts, narrow the list and come off as chips", async ({ page, app }) => {
  app.entries = new Map(books.slice(0, 6).map(book => [book.id, { ...row(book.id), book: { ...books[book.id - 1], tags: book.id <= 2 ? [{ id: 7, name: "Fantasy" }] : [] } }]));
  app.facets = { subject: [{ value: 7, label: "Fantasy", count: 2 }, { value: 8, label: "Poetry", count: 0 }], author: [], year_finished: [], length: [{ value: "short", label: "Short", count: 1 }, { value: "medium", label: "Medium", count: 0 }, { value: "long", label: "Long", count: 0 }], source_label: [] };
  await page.goto("/my-books");
  const panel = page.getByRole("complementary", { name: "Filters" });
  await expect(panel.getByRole("checkbox", { name: /Fantasy/ })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: /Poetry/ })).toBeDisabled();
  await panel.getByRole("checkbox", { name: /Fantasy/ }).check();
  await expect(page).toHaveURL(/subject=7/);
  await expect(page.locator(".bv-book-card")).toHaveCount(2);
  await expect(page.getByText("2 of 6 books", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove filter: Fantasy" }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(6);
  await expect(page).not.toHaveURL(/subject=/);
  await panel.getByRole("checkbox", { name: /Fantasy/ }).check();
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.getByRole("group", { name: "Active filters" })).toHaveCount(0);
});

test("on a phone the filters open in a sheet that shows the result count", async ({ page, app }) => {
  app.entries = new Map(books.slice(0, 6).map(book => [book.id, { ...row(book.id), book: { ...books[book.id - 1], tags: book.id <= 2 ? [{ id: 7, name: "Fantasy" }] : [] } }]));
  app.facets = { subject: [{ value: 7, label: "Fantasy", count: 2 }], author: [], year_finished: [], length: [], source_label: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.getByRole("complementary", { name: "Filters" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("checkbox", { name: /Fantasy/ }).check();
  await expect(sheet.getByRole("button", { name: "Show 2 books", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Show 2 books", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Filters/ })).toContainText("1");
  await expect(page.locator(".bv-book-card")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("independent review: mobile collection reaches books without a wall of controls", async ({ page, app }, testInfo) => {
  app.readingActions = true;
  app.libraryImport = true;
  app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(24);
  const top = await page.locator(".bv-book-card").first().evaluate(el => el.getBoundingClientRect().top + scrollY);
  console.log(`LIBRARY_GEOMETRY ${JSON.stringify({ width: 390, firstBookTop: top })}`);
  await testInfo.attach("library-first-book-position", { body: JSON.stringify({ width: 390, firstBookTop: top }), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("review-library-390.png"), fullPage: false });
  expect(top).toBeLessThan(420);
});

test("independent review: workspace returns to the searched filtered library page", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  await page.goto("/my-books?q=Library&status=want&label=Imported");
  await expect(page.locator(".bv-book-card")).toHaveCount(24);
  const original = page.url();
  await page.locator(".bv-book-card h3 a").first().click();
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  await expect(page.getByRole("button", { name: "Remove filter: Import: Imported" })).toBeVisible();
});

for (const theme of ["light", "dark"]) for (const width of [320, 390, 768, 1440]) {
  test(`independent review: library controls and missing covers ${theme} ${width}`, async ({ page, app }, testInfo) => {
    app.readingActions = true;
    app.libraryImport = true;
    app.entries = new Map(books.slice(0, 6).map(book => [book.id, { ...row(book.id, true, true), reading_state: "reading" }]));
    app.entries.set(7, { ...row(7), book: null, private_title: "My private reading", private_author: "Private author" });
    app.entries.set(8, { ...row(8), book: { ...books[7], cover_image_url: "/invalid-fixture-cover.png" } });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/my-books");
    await expect(page.locator(".bv-personal-book")).toHaveCount(8);
    await expect(page.locator(".bv-personal-book .bv-cover-fallback")).toHaveCount(8);
    await expect(page.getByRole("heading", { name: "My private reading", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Cover unavailable for My private reading", exact: true })).toBeVisible();
    // Missing artwork renders a typographic jacket: the title is on the cover, with a stable palette tint.
    for (const fallback of await page.locator(".bv-personal-book .bv-cover-fallback").all()) {
      await expect(fallback.locator("strong")).toBeVisible();
      await expect(fallback).toHaveClass(/bv-jacket--(sage|ivory|rust|forest|ink)/);
    }
    await expect(page.getByText("Cover unavailable", { exact: true })).toHaveCount(0);
    const controls = page.getByRole("group", { name: "Shelf", exact: true }).getByRole("button");
    const normalControlWidth = (await controls.first().boundingBox()).width;
    const normalSearchWidth = (await page.getByLabel("Search title or author").boundingBox()).width;
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    if (width <= 390) {
      const tops = await controls.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
      const firstTop = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top + scrollY);
      expect(firstTop).toBeLessThan(420);
      await testInfo.attach("geometry", { body: JSON.stringify({ theme, width, firstTop }), contentType: "application/json" });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}.png`), fullPage: false });
    // Actual computed text sizes are doubled once; allow more vertical wrapping.
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".bv-root *")].map(el => [el, getComputedStyle(el).fontSize]);
      for (const [el, size] of nodes) el.style.fontSize = `${parseFloat(size) * 2}px`;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel("Search title or author")).toBeVisible();
    if (width <= 390) {
      expect((await controls.first().boundingBox()).width).toBeGreaterThan(normalControlWidth);
      expect((await page.getByLabel("Search title or author").boundingBox()).width).toBeGreaterThanOrEqual(normalSearchWidth);
      const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
      const discover = nav.getByRole("link", { name: "Discover", exact: true });
      // A label never ellipsises or clips: at large text it may wrap to a second line and the nav grows.
      const label = await discover.locator("span").evaluate(node => {
        const style = getComputedStyle(node);
        return { overflow: style.textOverflow, clipped: node.scrollWidth > node.clientWidth + 1 };
      });
      expect(label.overflow).not.toBe("ellipsis");
      expect(label.clipped).toBe(false);
      const navTops = await nav.getByRole("link").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      expect(Math.max(...navTops) - Math.min(...navTops)).toBeLessThan(2);
      const box = await discover.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect.poll(async () => {
        const clearance = await page.locator(".bv-root").evaluate(node => parseFloat(getComputedStyle(node).paddingBottom));
        return clearance >= (await nav.boundingBox()).height;
      }).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}-enlarged.png`), fullPage: false });
    const importLink = page.getByRole("link", { name: "Import books", exact: true });
    await importLink.focus();
    await expect(importLink).toBeFocused();
  });
}

test("independent review: another account cannot recover old library navigation metadata", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.goto("/my-books?q=Library&status=want");
  await expect(page.locator(".bv-personal-book")).toHaveCount(24);
  await page.locator(".bv-personal-book h3 a").first().click();
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?q=Library&status=want");
  const oldState = await page.evaluate(() => ({ ...history.state, url: location.pathname }));
  await expireAndSignInAsB(page, app, oldState.url, true);
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  await page.evaluate(state => { const { url, ...entry } = state; history.replaceState(entry, "", url); dispatchEvent(new PopStateEvent("popstate", { state: entry })); }, oldState);
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books");
  const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
  expect(stored).not.toContain("libraryReturn");
  expect(stored).not.toContain("Library");
});

test("independent review: Show more reveals the new books on a phone", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.locator(".bv-personal-book")).toHaveCount(24);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(30);
  await expect(page.getByText("Showing 30 of 30", { exact: true })).toBeVisible();
});

test("independent review: workspace history pagination retains the collection return context", async ({ page, app }) => {
  app.readingActions = true;
  app.historyNextCursor = "older-reading";
  await page.goto("/my-books?status=want&q=Library");
  await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  await page.locator(".bv-personal-book h3 a").click();
  await page.getByText("Reading history", { exact: true }).click();
  await page.getByRole("button", { name: "Older readings", exact: true }).click();
  await expect(page).toHaveURL(/history_cursor=older-reading/);
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library");
});


test("independent review: twenty-thousand saved books retain bounded pages and readable counts", async ({ page, app }) => {
  app.readingActions = true;
  app.libraryImport = true;
  app.entries = new Map(Array.from({ length: 20000 }, (_, index) => {
    const id = index + 1;
    return [id, { ...row(1, true, true), id, book_id: id, book: { ...books[0], id, title: `Saved library book ${id}` } }];
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.locator(".bv-personal-book")).toHaveCount(24);
  await expect(page.getByRole("group", { name: "Shelf", exact: true }).getByRole("button", { name: /^All/ })).toContainText("20000");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(48);
  await page.getByLabel("Search title or author").fill("Saved library book 20000");
  await page.getByLabel("Search title or author").press("Enter");
  await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(app.requests.filter(r => r.path === "/me/library" && r.query.get("limit") !== "1")).toHaveLength(3);
  expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
});

test("an English title shows on My Books cards and the reading page; private books never show one", async ({ page, app }) => {
  app.readingActions = true;
  app.entries.set(1, { ...row(1), book: { ...books[0], title: "Ὀδύσσεια", english_title: "The Odyssey" } });
  app.entries.set(2, { ...row(2), book: { ...books[1], english_title: " LIBRARY fixture 02 " } });
  app.entries.set(3, { ...row(3), book: { ...books[2], english_title: "" } });
  app.entries.set(4, { ...row(4), book: { ...books[3], english_title: null } });
  app.entries.set(5, { ...row(5), book: null, book_id: null, private_title: "Private diary", private_author: "Me" });
  await page.goto("/my-books"); await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  await expect(page.locator(".bv-english-title")).toHaveCount(1);
  const card = page.locator(".bv-personal-book").filter({ hasText: "Ὀδύσσεια" });
  await expect(card.locator(".bv-english-title")).toHaveText("The Odyssey");
  await expect(card.locator(".bv-english-title")).toHaveAttribute("lang", "en");
  await expect(card.locator("h3 + .bv-english-title + .bv-author")).toHaveCount(1);
  books[0].published_year = -700; books[1].published_year = 1813;
  await page.goto("/my-books/1");
  await expect(page.locator("#bv-reading-book-title + .bv-english-title")).toHaveText("The Odyssey");
  await expect(page.getByText("Published 700 BCE")).toBeVisible();
  await expect(page.locator(".bv-english-title")).toHaveAttribute("lang", "en");
  for (const id of [2, 3, 4, 5]) {
    await page.goto(`/my-books/${id}`); await expect(page.locator("#bv-reading-book-title")).toBeVisible();
    await expect(page.locator(".bv-english-title")).toHaveCount(0);
    if (id === 2) await expect(page.getByText("Published 1813")).toBeVisible();
  }
  delete books[0].published_year; delete books[1].published_year;
});

// Screenshots for design review: MY_BOOKS_SHOTS=1 writes them to ../.bv-shots/my-books; skipped otherwise.
for (const theme of ["light", "dark"]) for (const [width, height, zoom] of [[390, 844, false], [1440, 900, false], [390, 844, true]]) {
  test(`my books screenshots ${theme} ${width}${zoom ? " 200%" : ""}`, async ({ page, app }) => {
    test.skip(!process.env.MY_BOOKS_SHOTS, "design review only");
    app.readingActions = true;
    app.libraryImport = true;
    app.entries = new Map(books.map(book => [book.id, { ...row(book.id, book.id % 3 === 0, true), reading_state: book.id % 5 === 0 ? "reading" : null, book: { ...books[book.id - 1], tags: book.id <= 12 ? [{ id: 7, name: "Fantasy" }] : [] } }]));
    app.facets = { subject: [{ value: 7, label: "Fantasy", count: 12 }, { value: 8, label: "Literary fiction", count: 9 }, { value: 9, label: "History", count: 5 }, { value: 10, label: "Poetry", count: 0 }],
      author: [{ value: "Isolated test author", label: "Isolated test author", count: 30 }], year_finished: [], length: [{ value: "short", label: "Short", count: 11 }, { value: "medium", label: "Medium", count: 12 }, { value: "long", label: "Long", count: 7 }],
      source_label: [{ value: "Goodreads: to-read", label: "Goodreads: to-read", count: 8 }] };
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/my-books?subject=7&owned=1");
    await expect(page.locator(".bv-book-card").first()).toBeVisible();
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const dir = "../.bv-shots/my-books";
    const name = `${dir}/library-${width}${zoom ? "-200" : ""}-${theme}.png`;
    await page.screenshot({ path: name, fullPage: true });
    if (!zoom) {
      const names = ["Americanah", "Beloved", "Circe", "Dune", "Emma", "Frankenstein", "Gilead", "Hamnet", "Invisible Man", "Jane Eyre", "Kindred", "Middlemarch", "Normal People", "Orlando", "Piranesi", "Rebecca", "Sula", "Tess", "Ulysses", "Villette", "Wolf Hall", "Zorba"];
      app.entries = new Map(app.entries.entries().map(([id, entry]) => [id, { ...entry, book: { ...entry.book, title: names[(id - 1) % names.length], authors: [{ id: 1, name: ["Chimamanda Adichie", "Toni Morrison", "Madeline Miller", "Frank Herbert"][id % 4] }] } }]));
      await page.goto("/my-books?sort=title");
      await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
      await expect(page.locator(".bv-library-row").first()).toBeVisible();
      await page.screenshot({ path: `${dir}/list-${width}-${theme}.png`, fullPage: false });
    }
    if (width < 900 && !zoom) {
      await page.getByRole("button", { name: /^Sort:/ }).click();
      await page.screenshot({ path: `${dir}/sort-open-${width}-${theme}.png` });
      await page.keyboard.press("Escape");
    }
    if (width < 900) {
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.screenshot({ path: `${dir}/sheet-${width}${zoom ? "-200" : ""}-${theme}.png` });
    }
  });
}
