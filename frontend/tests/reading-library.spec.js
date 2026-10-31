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
        let entries = [...state.entries.values()].sort((a, b) => b.id - a.id).filter(entry => (entry.book?.title || entry.private_title).toLowerCase().includes(query));
        const counts = { all: entries.length, owned: entries.filter(entry => entry.is_owned).length, want: entries.filter(entry => entry.is_wanted).length, ...Object.fromEntries(["reading", "paused", "finished", "dnf"].map(state => [state, entries.filter(entry => entry.reading_state === state).length])) };
        if (facet === "owned") entries = entries.filter(entry => entry.is_owned);
        if (facet === "want") entries = entries.filter(entry => entry.is_wanted);
        const offset = Number(url.searchParams.get("cursor") || 0);
        return reply(200, { items: entries.slice(offset, offset + 25), counts, total: entries.length,
          next_cursor: entries.length > offset + 25 ? String(offset + 25) : null });
      }
      if (route.request().method() === "GET" && /^\/me\/(home|library|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
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
  await page.getByText("More filters", { exact: true }).click();
  await page.getByRole("group", { name: "More library filters" }).getByRole("button", { name: /^Own/ }).click();
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
          await expect(page.getByRole("link", { name: "Your account", exact: true })).toBeVisible();
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

for (const theme of ["light", "dark"]) {
  test(`empty later library page retains recovery after mutation (${theme})`, async ({ page, app }) => {
    app.entries = new Map(books.slice(0, 26).map(book => [book.id, row(book.id)]));
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my-books?status=want");
    await expect(page.locator(".bv-book-card")).toHaveCount(25);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.locator(".bv-book-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
    // Capture from the top so off-viewport fixed elements are not included at
    // the prior scroll offset by a full-document browser screenshot.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `../backend/.v3-test-runtime/m1-empty-page-${theme}.png`, fullPage: true });
    expect([...app.entries.values()].filter(entry => entry.is_wanted)).toHaveLength(25);
    await page.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(page.locator(".bv-book-card")).toHaveCount(25);
    // Previous navigates to an explicit known page, rather than browser Back.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Return to first page", exact: true }).click();
    await expect(page.locator(".bv-book-card")).toHaveCount(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`direct empty cursor recovers in read-only mode (${theme})`, async ({ page, app }) => {
    app.readOnly = true;
    app.entries = new Map(books.slice(0, 25).map(book => [book.id, row(book.id)]));
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my-books?status=want&cursor=25");
    await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Return to first page", exact: true }).click();
    await expect(page.locator(".bv-book-card")).toHaveCount(25);
    await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want to read", exact: true })).toBeDisabled();
    expect(app.requests.filter(r => r.method === "PUT" || r.method === "PATCH")).toHaveLength(0);
  });
}

test("an empty first-page facet does not claim the entire library is empty", async ({ page, app }) => {
  app.entries.set(1, row(1, true, false));
  await page.goto("/my-books?status=want");
  await expect(page.getByRole("heading", { name: "No saved books match this view.", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filter your library" }).getByRole("button", { name: /^All/ }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
});

test("a concurrent change on page three preserves history and first-page recovery", async ({ page, app }) => {
  app.entries = new Map(Array.from({ length: 51 }, (_, index) => {
    const id = index + 1;
    return [id, { ...row(id), book: { ...books[0], id, title: `Library fixture ${id}` } }];
  }));
  await page.goto("/my-books?status=want");
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=25/);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(1);
  // Another browser changes this view while the reader returns to page two.
  await page.goBack();
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  app.entries.set(1, { ...app.entries.get(1), is_wanted: false, version: 2 });
  await page.goForward();
  await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=25/);
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
});


test("independent review: mobile collection reaches books without a wall of controls", async ({ page, app }, testInfo) => {
  app.readingActions = true;
  app.libraryImport = true;
  app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
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
  await expect(page.locator(".bv-book-card")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  const original = page.url();
  await page.locator(".bv-book-card h3 a").first().click();
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await expect(page).toHaveURL(original);
  await expect(page.locator(".bv-book-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
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
    const controls = page.getByRole("group", { name: "Filter your library", exact: true }).getByRole("button");
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
      expect((await page.getByLabel("Search title or author").boundingBox()).width).toBeGreaterThan(normalSearchWidth);
      const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
      const discover = nav.getByRole("link", { name: "Discover", exact: true });
      // One-row navigation: a label never wraps or splits; at extreme sizes it may shorten with an ellipsis.
      const label = await discover.locator("span").evaluate(node => {
        const style = getComputedStyle(node);
        return { whiteSpace: style.whiteSpace, height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 };
      });
      expect(label.whiteSpace).toBe("nowrap");
      expect(label.height).toBeLessThan(label.lineHeight * 1.5);
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
    const importLink = page.getByRole("link", { name: "Bring your library", exact: true });
    await importLink.focus();
    await expect(importLink).toBeFocused();
  });
}

test("independent review: known previous page survives book return and browser navigation", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(Array.from({ length: 76 }, (_, index) => {
    const id = index + 1;
    return [id, { ...row(1), id, book_id: id, book: { ...books[0], id, title: `Saved book ${id}` } }];
  }));
  await page.goto("/my-books?status=want");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cursor=${25 * (i + 1)}`));
  }
  await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  await page.locator(".bv-personal-book h3 a").first().click();
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&cursor=50");
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page).toHaveURL(/status=want&cursor=25$/);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page).toHaveURL(/my-books\?status=want$/);
  await page.goBack();
  await expect(page).toHaveURL(/cursor=25$/);
  await page.goForward();
  await expect(page).not.toHaveURL(/cursor=/);
  await page.getByLabel("Search title or author").fill("Saved book 76");
  await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
});

for (const direct of [false, true]) test(`independent review: ${direct ? "direct" : "refreshed"} later page has truthful bounded recovery`, async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  if (direct) await page.goto("/my-books?status=want&q=Library&label=Keep&cursor=25");
  else {
    await page.goto("/my-books?status=want&q=Library&label=Keep");
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.locator(".bv-personal-book")).toHaveCount(5);
    await page.reload();
  }
  await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page).toHaveURL(/label=Keep/);
  await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  await expect(page.getByRole("button", { name: /^Want/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  expect(app.requests.filter(r => r.path === "/me/library").every(r => !r.query.has("limit"))).toBe(true);
});

test("independent review: another account cannot recover old library navigation metadata", async ({ page, app }) => {
  app.readingActions = true;
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.goto("/my-books?q=Library&status=want");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  await page.locator(".bv-personal-book h3 a").first().click();
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library&cursor=25");
  const oldState = await page.evaluate(() => ({ ...history.state, url: location.pathname }));
  await expireAndSignInAsB(page, app, oldState.url, true);
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  await page.evaluate(state => { const { url, ...entry } = state; history.replaceState(entry, "", url); dispatchEvent(new PopStateEvent("popstate", { state: entry })); }, oldState);
  await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books");
  const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
  expect(stored).not.toContain("libraryReturn");
  expect(stored).not.toContain("Library");
});


test("independent review: paging from the bottom reveals the new page instead of its footer", async ({ page, app }) => {
  app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books");
  await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeFocused();
  const top = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(420);
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
  await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  await expect(page.getByRole("group", { name: "Filter your library", exact: true }).getByRole("button", { name: /^All/ })).toContainText("20000");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=25$/);
  await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  await page.getByLabel("Search title or author").fill("Saved library book 20000");
  await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  await expect(page).not.toHaveURL(/cursor=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(app.requests.filter(r => r.path === "/me/library")).toHaveLength(3);
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
