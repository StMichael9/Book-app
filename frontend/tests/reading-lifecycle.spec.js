import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";
import { shootMatrix, shotsEnabled } from "./support/shots.js";

// M2 UI regressions use in-memory API fixtures only, never a real database.
const stamp = "2026-10-01T00:00:00Z";
const attemptId = "11111111-1111-4111-8111-111111111111";
const makeEntry = (id, state = "reading", privateBook = false) => ({
  id, book_id: privateBook ? null : id,
  book: privateBook ? null : { id, title: `Reading fixture ${id}`, authors: [], tags: [] },
  private_title: privateBook ? `Private fixture ${id}` : null, private_author: null,
  reading_state: state, is_owned: true, is_wanted: false, version: 2, save_note: null,
  created_at: stamp, updated_at: stamp,
});

// The fold opens only if it is closed, so a test can ask for it more than once.
async function openFold(page) {
  const fold = page.locator(".bv-reading-fold");
  if (!(await fold.evaluate(node => node.open))) await fold.locator(":scope > summary").click();
}

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = {
      entries: new Map([[101, makeEntry(101)], [102, makeEntry(102, null)]]),
      attempt: { id: attemptId, state: "reading", started_on: null, ended_on: null,
        progress_unit: "percent", progress_value: 40, total_pages: 200,
        edition_id: null, edition_source_id: null, edition_format: null, created_at: stamp, updated_at: stamp },
      requests: [], errors: [], authenticated: true, createdAttempts: new Map(),
    };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["PATCH", "PUT", "POST", "DELETE"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/auth/login") { state.authenticated = true; return reply(200, {}); }
      if (path === "/auth/logout") { state.authenticated = false; return reply(200, {}); }
      if (path === "/me/reading-capabilities") {
        if (state.oldBackend) return reply(404, {});
        return reply(200, { enabled: !state.disabled, writable: !state.readOnly, contract_version: 1,
          features: { reading_actions: true, private_context: Boolean(state.privateContext), privacy_controls: Boolean(state.dataControls), reading_export: Boolean(state.dataControls), library_export: Boolean(state.libraryExport), library_import: Boolean(state.libraryImport), next_read: Boolean(state.nextRead) } });
      }
      if (path === "/me/books") return reply(200, []);
      if (path === "/me/library/export.csv") {
        if (state.libraryCsvFails) return reply(503, { detail: "Temporary failure" });
        return route.fulfill({ status: 200, contentType: "text/csv", headers: { "Content-Disposition": 'attachment; filename="bookvane-library-v1.csv"' }, body: "title,author,want_to_read,owned\nReading fixture 101,,false,true\n" });
      }
      if (path === "/me/reading-export") {
        if (state.holdExport) await state.holdExport;
        if (state.exportFails) return reply(503, { detail: "Temporary failure" });
        return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: state.exportTruncated ? '{"type":"metadata"}\n' : '{"type":"metadata","format_version":1}\n{"type":"complete","format_version":1,"counts":{"entry":2,"reading":1,"preference":0}}\n' });
      }
      if (/^\/books\/\d+$/.test(path)) {
        if (state.holdBookDetails) await state.holdBookDetails;
        if (state.bookDetailsFail) return reply(503, {});
        const id = Number(path.split("/").at(-1));
        return reply(200, { id, title: `Reading fixture ${id}`, authors: [], tags: [{ id: 1, name: "classics", type: "genre" }],
          description: "An existing catalogue description. ".repeat(30), published_year: 2000, page_count: 999 });
      }
      if (path === "/me/next-read") {
        if (state.holdNext) await state.holdNext;
        if (state.nextFail) return reply(503, {});
        const eligible = [...state.entries.values()].filter(item => item.is_wanted && !["reading", "paused"].includes(item.reading_state));
        const remaining = eligible.filter(item => !url.searchParams.getAll("exclude").includes(`${item.book ? "book" : "entry"}:${item.id}`));
        return reply(200, { items: remaining.slice(0, 3).map(item => ({ key: `${item.book ? "book" : "entry"}:${item.id}`, entry_id: item.id,
          version: item.version, book: item.book, private_title: item.private_title, private_author: item.private_author, reasons: [{ code: "want" }] })),
          eligible_count: eligible.length, remaining_count: remaining.length, interests: [], known_page_count: 0 });
      }
      if (path === "/me/home") return reply(200, { current_reads: state.currentReads || [], reading_count: state.readingCount ?? state.currentReads?.length ?? 0, paused_count: state.pausedCount || 0 });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => {
        const entry = state.entries.get(id);
        return { book_id: id, entry_id: entry?.id ?? null, is_owned: entry?.is_owned ?? false,
          is_wanted: entry?.is_wanted ?? false, version: entry?.version ?? null, reading_state: entry?.reading_state ?? null };
      }) });
      if (path === "/me/library") {
        const entries = [...state.entries.values()];
        const counts = { all: entries.length, owned: entries.filter(entry => entry.is_owned).length,
          want: entries.filter(entry => entry.is_wanted).length };
        for (const status of ["reading", "paused", "finished", "dnf"]) counts[status] = entries.filter(entry => entry.reading_state === status).length;
        const facet = url.searchParams.get("facet") || "all";
        const items = entries.filter(entry => facet === "all" || (facet === "owned" ? entry.is_owned : facet === "want" ? entry.is_wanted : entry.reading_state === facet));
        return reply(200, { items, counts, total: counts[facet] || 0, next_cursor: null });
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) {
        if (state.holdWorkspace) await state.holdWorkspace;
        const id = Number(workspace[1]);
        if (!state.entries.has(id)) return reply(404, { detail: "Library entry not found" });
        return reply(200, { entry: state.entries.get(id), current_attempt: state.createdAttempts.get(id) ?? (id === 101 ? state.attempt : null), editions: [] });
      }
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: path.includes("/101/") && state.attempt ? [state.attempt, ...(state.historicalAttempt ? [state.historicalAttempt] : [])] : [], next_cursor: null });
      if (state.historicalAttempt && path === `/me/reading-attempts/${state.historicalAttempt.id}` && method === "GET") {
        if (state.holdMemory) await state.holdMemory;
        return reply(200, { entry: state.entries.get(101), attempt: state.historicalAttempt });
      }
      if (state.historicalAttempt && path === `/me/reading-attempts/${state.historicalAttempt.id}` && method === "DELETE") {
        if (state.removeFails) return reply(503, { detail: "Temporary failure" });
        const entry = state.entries.get(101);
        if (body.expected_version !== entry.version) return reply(409, { detail: "Your library changed. Reload before trying again." });
        state.historicalAttempt = null; entry.version += 1;
        return reply(200, entry);
      }
      const patch = path.match(/^\/me\/library\/(\d+)$/);
      if ((patch || path === `/me/reading-attempts/${attemptId}`) && method === "DELETE") {
        if (state.removalMissingRoute) return reply(404, { detail: "Not found" });
        if (state.removeFails) return reply(503, { detail: "Temporary failure" });
        if (state.holdRemoval) await state.holdRemoval;
        const id = patch ? Number(patch[1]) : 101;
        const entry = state.entries.get(id);
        if (!entry) return reply(404, { detail: "Library entry not found" });
        if (body.expected_version !== entry.version) return reply(409, { detail: "Your library changed. Reload before trying again." });
        if (patch) {
          state.entries.delete(id);
          if (state.loseRemovalResponse) { state.loseRemovalResponse = false; return route.abort("failed"); }
          return route.fulfill({ status: 204 });
        }
        state.attempt = null; entry.version += 1; entry.reading_state = null;
        return reply(200, entry);
      }
      if (patch && method === "PATCH") {
        if (state.flagFails) return reply(503, { detail: "Temporary failure" });
        const current = state.entries.get(Number(patch[1]));
        if (body.expected_version !== current.version) return reply(409, { detail: "Your library changed. Reload before trying again." });
        Object.assign(current, body, { version: current.version + 1 });
        return reply(200, current);
      }
      if (path === `/me/reading-attempts/${attemptId}` && method === "PATCH") {
        if (state.holdSave) await state.holdSave;
        if (state.contextFails) return reply(503, { detail: "Temporary failure" });
        const current = state.entries.get(101);
        if (body.expected_version !== current.version) return reply(409, { detail: "Your library changed. Reload before trying again." });
        const { expected_version: _version, ...changes } = body;
        Object.assign(state.attempt, changes);
        current.version += 1;
        return reply(200, { entry: current, attempt: state.attempt });
      }
      if (path === `/me/reading-attempts/${attemptId}` && method === "GET") {
        if (state.holdMemory) await state.holdMemory;
        return reply(200, { entry: state.entries.get(101), attempt: state.attempt });
      }
      const created = path.match(/^\/me\/reading-attempts\/([0-9a-f-]{36})$/);
      if (created && method === "PUT") {
        if (state.createFailOnce) { state.createFailOnce = false; return reply(503, { detail: "Temporary failure" }); }
        const saved = state.entries.get(body.entry_id);
        saved.version += 1; saved.reading_state = body.state || "reading";
        const made = { id: created[1], state: body.state || "reading", started_on: body.started_on ?? null, ended_on: body.ended_on ?? null,
          progress_unit: null, progress_value: null, total_pages: null, edition_id: null, edition_source_id: null, edition_format: null, created_at: stamp, updated_at: stamp };
        state.createdAttempts.set(saved.id, made);
        return reply(200, { entry: saved, attempt: made });
      }
      if (route.request().method() === "GET" && /^\/me\/(home|library|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library-imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      if (path === "/me/up-next" || path === "/me/stats") return reply(404, { detail: "Not found" }); // Home's optional blocks: pins and the year at a glance
      state.errors.push(`Unhandled request ${method} ${path}`);
      return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("UI refactor current reading leads Home on desktop and phone", async ({ page, app }) => {
  app.currentReads = [{ entry: app.entries.get(101), attempt: app.attempt }];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await page.goto("/home");
    const current = page.getByRole("textbox", { name: "Page or % for Reading fixture 101" });
    await expect(current).toBeVisible();
    expect((await current.boundingBox()).y).toBeLessThan(width === 390 ? 650 : 750);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`v3-ui-home-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "Reading fixture 101", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/101$/);
  expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
});

test("UI refactor paused Home has a truthful empty-current state", async ({ page, app }) => {
  app.pausedCount = 2;
  await page.goto("/home");
  await expect(page.getByText("A book can wait for you.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open paused books", exact: true })).toHaveAttribute("href", "/my-books?status=paused");
  await expect(page.getByText("Progress is optional.", { exact: true })).toHaveCount(0);
});

for (const theme of ["light", "dark"]) test(`Home and My Books have distinct tasks and layouts; theme=${theme}`, async ({ page, app }) => {
  app.libraryImport = true;
  app.entries.set(103, makeEntry(103, "reading", true));
  app.currentReads = [
    { entry: app.entries.get(101), attempt: app.attempt },
    { entry: app.entries.get(103), attempt: { ...app.attempt, progress_unit: "pages", progress_value: 12, total_pages: null } },
    { entry: app.entries.get(102), attempt: { ...app.attempt, progress_value: null } },
  ];
  app.readingCount = 8; app.pausedCount = 2;
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    const desk = page.getByRole("region", { name: "Reading now", exact: true });
    const wide = width > 700;
    await expect(desk.getByRole("article")).toHaveCount(wide ? 3 : 1);
    await expect(desk.getByRole("progressbar", { name: "Reading progress for Reading fixture 101" })).toHaveAttribute("value", "40");
    await expect(desk.getByRole("progressbar")).toHaveCount(1);
    if (wide) await expect(desk.getByText("Page 12", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "See all current reads (8)", exact: true })).toHaveAttribute("href", "/my-books?status=reading");
    await expect(page.getByRole("search", { name: "Search your library" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Shelf" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import books", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add a book", exact: true })).toHaveCount(0);
    const first = desk.getByRole("link", { name: "Reading fixture 101", exact: true });
    await expect(first).toBeVisible();
    expect((await first.boundingBox()).y).toBeLessThan(750);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`reading-desk-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("navigation", { name: /Main navigation|Mobile navigation/ }).filter({ visible: true }).getByRole("link", { name: "My Books", exact: true }).click();
    await expect(page.getByRole("search", { name: "Search your library" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Shelf", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import books", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a book", exact: true })).toBeVisible();
    await expect(page.locator(".bv-current-book")).toHaveCount(0);
    await expect(page.locator(".bv-personal-book")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`collection-${theme}-${width}.png`), fullPage: true });
  }
  expect(app.requests.filter(request => ["PUT", "PATCH", "DELETE"].includes(request.method))).toHaveLength(0);
});

test("UI refactor catalogue and private library titles open personal workspaces", async ({ page, app }) => {
  app.entries.set(103, makeEntry(103, "paused", true));
  await page.goto("/my-books");
  await expect(page.getByRole("link", { name: "Reading fixture 101", exact: true })).toHaveAttribute("href", "/my-books/101");
  await expect(page.getByRole("link", { name: "Private fixture 103", exact: true })).toHaveAttribute("href", "/my-books/103");
  await expect(page.getByRole("link", { name: "About this book: Reading fixture 101", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Reading fixture 101", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
});

test("UI current-state facets keep past readings inside the book without overlap badges", async ({ page, app }) => {
  await page.goto("/my-books?status=finished");
  await expect(page.getByText("Earlier readings are kept in each book’s Reading history.", { exact: true })).toBeVisible();
  await expect(page.getByText("No books match these filters", { exact: true })).toBeVisible();
  await expect(page.locator(".bv-personal-book")).toHaveCount(0);
  await page.getByRole("button", { name: /^Reading/ }).click();
  await expect(page.locator(".bv-personal-book-state").first()).toContainText("Reading");
  await expect(page.getByText(/Finished before|Stopped before|also appear in Reading/)).toHaveCount(0);
  expect(app.requests.filter(request => request.path === "/me/library").at(-1).body).toBeNull();
});




test("editorial workspace private books never request public metadata", async ({ page, app }) => {
  app.entries.set(101, makeEntry(101, "reading", true));
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "Private fixture 101", exact: true })).toBeVisible();
  await expect(page.getByText("No description", { exact: false })).toHaveCount(0);
  expect(app.requests.filter(r => r.path.startsWith("/books/"))).toHaveLength(0);
});






for (const status of [404, 503]) for (const moved of [false, true]) test(`editorial workspace retry preserves deliberate focus; ${status}; moved=${moved}`, async ({ page, app }) => {
  await page.route("**/test-api/me/library/101/reading", route => route.fulfill({ status, json: {} }), { times: 1 });
  // Held from the start so the background prefetch of this workspace cannot fill the cache before the retry.
  let release;
  app.holdWorkspace = new Promise(done => { release = done; });
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "This reading couldn’t load.", exact: true })).toBeVisible();
  try {
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Loading your reading…", exact: true })).toBeFocused();
    const back = page.getByRole("link", { name: "Back to My Books", exact: true });
    if (moved) await back.focus();
    release();
    const title = page.getByRole("heading", { name: "Reading fixture 101", exact: true });
    await expect(title).toBeVisible();
    await expect(moved ? back : title).toBeFocused();
  } finally { release(); }
});

for (const moveFocus of [false, true]) test(`editorial workspace delayed identity respects keyboard focus; moved=${moveFocus}`, async ({ page, app }) => {
  let release;
  app.holdWorkspace = new Promise(done => { release = done; });
  try {
    await page.goto("/my-books");
    const link = page.getByRole("link", { name: "Reading fixture 101", exact: true });
    await link.focus(); await page.keyboard.press("Enter");
    // Opened from My Books, the book's own title is drawn at once and takes the focus while the reading loads.
    await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeFocused();
    const back = page.getByRole("link", { name: "Back to My Books", exact: true });
    if (moveFocus) await back.focus();
    release();
    const title = page.getByRole("heading", { name: "Reading fixture 101", exact: true });
    await expect(title).toBeVisible();
    if (moveFocus) await expect(back).toBeFocused(); else await expect(title).toBeFocused();
  } finally { release(); }
});


test("M3 confirmed removal distinguishes a reading from the whole book; failure and Cancel preserve data", async ({ page, app }) => {
  app.dataControls = true;
  await page.goto("/my-books/101");
  await openFold(page);
  await page.getByRole("button", { name: "Delete this reading", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Reading fixture 101");
  await expect(dialog).toContainText("Start date unknown");
  await expect(dialog).toContainText("other readings will stay");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(app.requests.filter(request => request.method === "DELETE")).toHaveLength(0);
  await openFold(page);
  await page.getByRole("button", { name: "Delete this reading", exact: true }).click();
  app.removeFails = true;
  await dialog.getByRole("button", { name: "Delete this reading", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("couldn’t confirm the removal");
  expect(app.attempt).not.toBeNull();
  app.removeFails = false;
  await dialog.getByRole("button", { name: "Delete this reading", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Not started", exact: true })).toBeVisible();
  expect(app.entries.get(101).is_owned).toBe(true);
  await openFold(page);
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  await expect(dialog).toContainText("every reading, note and reaction");
  await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
  expect(app.entries.has(101)).toBe(true);
  await openFold(page);
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.entries.has(101)).toBe(false);
  const requests = app.requests.filter(request => request.method === "DELETE");
  expect(requests.at(-1).body).toEqual({ expected_version: 3, confirmed: true });
});

test("M3 stale confirmation refuses deletion and keeps the captured version", async ({ page, app }) => {
  app.dataControls = true;
  await page.goto("/my-books/101");
  await openFold(page);
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  app.entries.get(101).version = 3;
  await page.getByRole("dialog").getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Your library changed");
  expect(app.entries.has(101)).toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: "Forget book and history", exact: true }).click();
  expect(app.requests.filter(request => request.method === "DELETE").map(request => request.body.expected_version)).toEqual([2, 2]);
});

test("M3 forget retry checks actual absence rather than trusting any DELETE 404", async ({ page, app }) => {
  app.dataControls = true; app.removalMissingRoute = true;
  await page.goto("/my-books/101");
  await openFold(page);
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(app.entries.has(101)).toBe(true);
  await expect(page).toHaveURL(/\/my-books\/101$/);
  app.removalMissingRoute = false; app.loseRemovalResponse = true;
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("couldn’t confirm");
  await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.entries.has(101)).toBe(false);
});

test("M3 Download my data rejects failures and truncated exports, then starts a complete private download in read-only mode", async ({ page, app }) => {
  app.dataControls = true; app.readOnly = true; app.exportFails = true;
  await page.goto("/settings");
  await page.getByRole("link", { name: "Your reading data", exact: true }).click();
  const button = page.getByRole("button", { name: "Download complete copy (JSON)", exact: true });
  let count = 0;
  page.on("download", () => { count += 1; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("download couldn’t complete");
  app.exportFails = false; app.exportTruncated = true;
  await button.click();
  await expect(page.getByRole("alert")).toContainText("interrupted");
  expect(count).toBe(0);
  app.exportTruncated = false;
  const completed = page.waitForEvent("download");
  await button.click();
  expect((await completed).suggestedFilename()).toBe("bookvane-reading-data.jsonl");
  await expect(page.getByRole("status").filter({ hasText: "Download started" })).toBeVisible();
  expect(count).toBe(1);
});

test("M3 late download never leaves a departed account", async ({ page, app }) => {
  app.dataControls = true;
  let release;
  app.holdExport = new Promise(resolve => { release = resolve; });
  let count = 0;
  page.on("download", () => { count += 1; });
  await page.goto("/my-data");
  await page.getByRole("button", { name: "Download complete copy (JSON)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preparing download…", exact: true })).toBeDisabled();
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page).toHaveURL(/\/login/);
  release();
  await expect.poll(() => app.requests.filter(request => request.path === "/me/reading-export").length).toBe(1);
  await page.waitForTimeout(100);
  expect(count).toBe(0);
});


for (const theme of ["light", "dark"]) {
  test(`library cards display supplied active/latest states for public/private entries in ${theme}`, async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    app.entries = new Map([makeEntry(101, "reading"), makeEntry(102, "paused"), makeEntry(103, "finished"),
      makeEntry(104, "dnf", true), makeEntry(105, null)].map(entry => [entry.id, entry]));
    await page.goto("/my-books");
    const cards = page.locator(".bv-book-grid > *");
    await expect(cards).toHaveCount(5);
    for (const [index, label] of [[0, "Reading"], [1, "Paused"], [2, "Finished"], [3, "Stopped"]]) {
      await expect(cards.nth(index).getByText(label, { exact: true })).toBeVisible();
    }
    await expect(cards.nth(4).getByText(/^(Reading|Paused|Finished|Stopped)$/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(app.requests.some(request => request.path.endsWith("/attempts"))).toBe(false);
  });
}

test("read-only creation explains disabled controls and is not advertised upstream", async ({ page, app }) => {
  app.readOnly = true;
  await page.goto("/my-books/private");
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Changes are temporarily paused." })).toBeVisible();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a book", exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: /Main navigation|Mobile navigation/ }).filter({ visible: true }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes are temporarily paused." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a book", exact: true })).toHaveCount(0);
  expect(app.requests.some(request => ["PUT", "PATCH", "POST"].includes(request.method) && request.path !== "/auth/refresh")).toBe(false);
});

for (const mode of ["disabled", "oldBackend"]) {
  test(`${mode} backend keeps private creation gated to the existing V2 experience`, async ({ page, app }) => {
    app[mode] = true;
    await page.goto("/my-books/private");
    await expect(page).toHaveURL(/\/my-books$/);
    await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
    expect(app.requests.some(request => request.path.startsWith("/me/library") && request.path !== "/me/library/lookup")).toBe(false);
  });
}








test("M3 stopped reading deletion uses the familiar state label", async ({ page, app }) => {
  app.dataControls = true; app.attempt.state = "dnf"; app.entries.get(101).reading_state = "dnf";
  await page.goto("/my-books/101");
  await openFold(page);
  await page.getByRole("button", { name: "Delete this reading", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Stopped · Start date unknown");
  await expect(page.getByRole("dialog")).not.toContainText("dnf");
});















// 23:59:30 on 22 Oct in Los Angeles is already 23 Oct in UTC, so a UTC date would be a day ahead.
const beforeLocalMidnight = new Date("2026-10-22T23:59:30-07:00"), afterLocalMidnight = new Date("2026-10-23T00:00:30-07:00");
const liveWrites = app => app.requests.filter(item => ["PUT", "PATCH"].includes(item.method) && item.path.startsWith("/me/reading-attempts/"));

test.describe("live reading dates use the reader's local calendar day", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(beforeLocalMidnight); });

  test("Start reading on the workspace sends today's local date", async ({ page, app }) => {
    await page.goto("/my-books/102");
    await page.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ entry_id: 102, state: "reading", started_on: "2026-10-22" });
    expect(liveWrites(app)[0].body).not.toHaveProperty("ended_on");
  });

  test("a retried start after midnight reuses the first date so the body is identical", async ({ page, app }) => {
    app.createFailOnce = true;
    await page.goto("/my-books/102");
    await page.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.clock.setFixedTime(afterLocalMidnight);
    await page.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(2);
    const [first, second] = liveWrites(app);
    expect(first.path).toBe(second.path);
    expect(second.body).toEqual(first.body);
    expect(second.body.started_on).toBe("2026-10-22");
  });

  test("Discover start sends today's local date", async ({ page, app }) => {
    await page.goto("/my-books/start/102");
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ entry_id: 102, started_via: "discovery", started_on: "2026-10-22" });
  });

  test("Read it again stamps only the new attempt with today's date", async ({ page, app }) => {
    Object.assign(app.attempt, { state: "finished", started_on: "2026-09-01", ended_on: "2026-10-01" });
    app.entries.get(101).reading_state = "finished";
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Read it again", exact: true }).click();
    await page.getByRole("button", { name: "Start a new reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0]).toMatchObject({ method: "PUT", body: { entry_id: 101, state: "reading", started_on: "2026-10-22" } });
    expect(app.attempt).toMatchObject({ started_on: "2026-09-01", ended_on: "2026-10-01" });
  });

  test("Finish and Stop send today's local date as the end date and leave the start alone", async ({ page, app }) => {
    app.attempt.started_on = "2026-10-01";
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Finish book", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ state: "finished", ended_on: "2026-10-22" });
    expect(liveWrites(app)[0].body).not.toHaveProperty("started_on");
    Object.assign(app.attempt, { state: "reading", ended_on: null }); app.entries.get(101).reading_state = "reading";
    await page.goto("/my-books/101");
    await openFold(page);
    await page.getByRole("button", { name: "Stop reading this book", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(2);
    expect(liveWrites(app)[1].body).toMatchObject({ state: "dnf", ended_on: "2026-10-22" });
    expect(liveWrites(app)[1].body).not.toHaveProperty("started_on");
  });

  test("Finish on a reader-entered future start date ends on that start date", async ({ page, app }) => {
    app.attempt.started_on = "2026-12-01";
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Finish book", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ state: "finished", ended_on: "2026-12-01" });
  });

  test("Pause and Resume send no dates", async ({ page, app }) => {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Pause reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    await page.getByRole("button", { name: "Resume reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(2);
    expect(liveWrites(app).map(item => item.body.state)).toEqual(["paused", "reading"]);
    for (const { body } of liveWrites(app)) { expect(body).not.toHaveProperty("started_on"); expect(body).not.toHaveProperty("ended_on"); }
  });

  test("Mark as reading on a finished record sends no dates", async ({ page, app }) => {
    Object.assign(app.attempt, { state: "finished", started_on: "2026-09-01", ended_on: "2026-10-01" });
    app.entries.get(101).reading_state = "finished";
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Mark as reading", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ state: "reading" });
    expect(liveWrites(app)[0].body).not.toHaveProperty("started_on");
    expect(liveWrites(app)[0].body).not.toHaveProperty("ended_on");
  });

  test("Log an earlier read keeps dates unknown", async ({ page, app }) => {
    await page.goto("/my-books/102");
    await openFold(page);
    await page.getByRole("button", { name: "Log an earlier read I finished", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ entry_id: 102, state: "finished" });
    expect(liveWrites(app)[0].body).not.toHaveProperty("started_on");
    expect(liveWrites(app)[0].body).not.toHaveProperty("ended_on");
  });

  test("Log an earlier read I stopped keeps dates unknown", async ({ page, app }) => {
    await page.goto("/my-books/102");
    await openFold(page);
    await page.getByRole("button", { name: "Log an earlier read I stopped", exact: true }).click();
    await expect.poll(() => liveWrites(app).length).toBe(1);
    expect(liveWrites(app)[0].body).toMatchObject({ entry_id: 102, state: "dnf" });
    expect(liveWrites(app)[0].body).not.toHaveProperty("started_on");
    expect(liveWrites(app)[0].body).not.toHaveProperty("ended_on");
  });
});

test("4c library CSV downloads from My Data with import switched off, and failures are explained", async ({ page, app }) => {
  // Only library_export is on: no import pilot, no reading export or privacy controls.
  app.libraryExport = true; app.libraryImport = false; app.dataControls = false; app.libraryCsvFails = true;
  await page.goto("/settings");
  await page.getByRole("link", { name: "Your reading data", exact: true }).click();
  await expect(page).toHaveURL(/\/my-data$/);
  await expect(page.getByRole("heading", { name: "Library spreadsheet (CSV)", exact: true })).toBeVisible();
  await expect(page.getByText("Opens in Excel, Numbers or Google Sheets.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download complete copy (JSON)", exact: true })).toHaveCount(0);
  const button = page.getByRole("button", { name: "Download library (CSV)", exact: true });
  let count = 0;
  page.on("download", () => { count += 1; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("spreadsheet couldn’t download");
  expect(count).toBe(0);
  app.libraryCsvFails = false;
  const completed = page.waitForEvent("download");
  await button.click();
  expect((await completed).suggestedFilename()).toBe("bookvane-library-v1.csv");
  await expect(page.getByRole("status").filter({ hasText: "Spreadsheet download started" })).toBeVisible();
  expect(app.requests.filter(request => request.path === "/me/library/export.csv")).toHaveLength(2);
  expect(app.requests.filter(request => request.path.startsWith("/me/library-imports"))).toHaveLength(0);
});

// Readers never see where book data comes from; the privacy page is the one deliberate disclosure.
test("reader screens never name data sources", async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true; app.dataControls = true; app.libraryExport = true;
  const banned = /shared catalogue|catalogue lists|catalogue details|Open Library|openlibrary|Turso|external catalogue/i;
  for (const path of ["/home", "/my-books", "/my-books/101", "/my-data"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.locator("main details:not([open]) > summary").evaluateAll(nodes => nodes.forEach(node => node.click()));
    expect(await page.locator("main").innerText(), path).not.toMatch(banned);
  }
});

test("foundations screenshots: My Books, workspace, home", async ({ page, app }) => {
  test.skip(!shotsEnabled(), "set FOUNDATIONS_SHOTS=before or after to export screenshots");
  app.entries.set(103, makeEntry(103, "paused", true));
  app.currentReads = [{ entry: app.entries.get(101), attempt: app.attempt }];
  await shootMatrix(page, "my-books", async () => { await page.goto("/my-books"); await expect(page.getByRole("link", { name: "Reading fixture 101", exact: true })).toBeVisible(); });
  await shootMatrix(page, "workspace", async () => { await page.goto("/my-books/101"); await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible(); });
  await shootMatrix(page, "home", async () => { await page.goto("/home"); await expect(page.getByRole("link", { name: "Continue your reading: Reading fixture 101", exact: true })).toBeVisible(); });
});

// The reading page, Direction D: what is kept from the old workspace tests, in the new layout. The page's box, finished prompt,
// journal and menu are covered in reading-page-d.spec.js.
const pageBox = page => page.getByRole("textbox", { name: /^Page or %/ });

for (const theme of ["light", "dark"]) test(`the reading page is book-first and fits every width; ${theme}`, async ({ page, app }) => {
  app.dataControls = true;
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/my-books/101");
    await expect(page.getByRole("heading", { name: "Reading fixture 101", level: 1 })).toBeVisible();
    await expect(pageBox(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause reading", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your reading", exact: true })).toBeVisible();
    await expect(page.locator(".bv-progress-line")).toContainText("40%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`reading-page-${theme}-${width}.png`), fullPage: true });
  }
  expect(app.requests.filter(r => ["PUT", "PATCH", "DELETE"].includes(r.method))).toHaveLength(0);
});

test("the reading page stays usable when book details fail, and a typed value survives the retry", async ({ page, app }) => {
  app.bookDetailsFail = true;
  await page.goto("/my-books/101");
  await pageBox(page).fill("25%");
  await openFold(page);
  await expect(page.getByRole("button", { name: "Try book details again", exact: true })).toBeVisible();
  app.bookDetailsFail = false;
  await page.getByRole("button", { name: "Try book details again", exact: true }).click();
  await expect(page.getByText("Published 2000 · About 999 pages · your copy may differ", { exact: true })).toBeVisible();
  await expect(pageBox(page)).toHaveValue("25%");
});

test("a paused reading offers Resume then Finish, in that keyboard order", async ({ page, app }) => {
  app.attempt.state = "paused"; app.entries.get(101).reading_state = "paused";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Resume reading", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).focus();
  for (const [role, name] of [["button", "More actions for Reading fixture 101"], ["button", "Edit the page total, 200 pages"], ["textbox", "Page or % for Reading fixture 101"], ["button", "Save"], ["textbox", "Add a thought"], ["button", "Resume reading"], ["button", "Finish book"]]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole(role, { name, exact: true })).toBeFocused();
  }
});

test("while changes are paused the page can be read, and nothing on it writes", async ({ page, app }) => {
  app.readOnly = true; app.attempt.note = "A kept thought.";
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "Reading fixture 101", level: 1 })).toBeVisible();
  await expect(pageBox(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pause reading" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish book" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^More actions for/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit:/ })).toHaveCount(0);
  await expect(page.locator(".bv-journal")).toContainText("A kept thought.");
  expect(app.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
});

test("a failed shelf toggle in the menu shows an error and leaves the shelf as it was", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "More actions for Reading fixture 101" }).click();
  const want = page.getByRole("menuitemcheckbox", { name: "Want to read" });
  app.flagFails = true;
  await want.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(want).toHaveAttribute("aria-checked", "false");
  app.flagFails = false;
  await want.click();
  await expect(want).toHaveAttribute("aria-checked", "true");
  expect(app.requests.filter(r => r.method === "PATCH" && r.path === "/me/library/101").at(-1).body).toMatchObject({ is_wanted: true, expected_version: 2 });
});

test("a thought renders as plain text, edits in place from the journal and keeps a failed draft", async ({ page, app }) => {
  const thought = '<img src=x onerror="window.noteExecuted=true"> My memory 読書';
  await page.goto("/my-books/101");
  await page.getByRole("textbox", { name: "Add a thought" }).fill(thought);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".bv-journal")).toContainText(thought);
  expect(await page.evaluate(() => window.noteExecuted)).toBeUndefined();
  expect(app.attempt.note).toBe(thought);
  await page.getByRole("button", { name: /^Edit: <img/ }).click();
  const field = page.getByLabel("Note (optional)", { exact: true });
  await expect(field).toHaveValue(thought);
  await field.fill("A changed thought");
  app.contextFails = true;
  await page.locator(".bv-journal").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(field).toHaveValue("A changed thought");
  app.contextFails = false;
  await page.locator(".bv-journal").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".bv-journal")).toContainText("A changed thought");
  expect(app.attempt.note).toBe("A changed thought");
});

test("the save reason is a journal line and edits in place, apart from the reading's note", async ({ page, app }) => {
  app.attempt.note = "A separate reading note";
  app.entries.get(101).save_note = "A friend's tip";
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal")).toContainText("Saved it: A friend's tip");
  await expect(page.locator(".bv-journal")).toContainText("A separate reading note");
  await page.getByRole("button", { name: /^Edit: Saved it:/ }).click();
  const field = page.getByLabel("Save reason (optional)", { exact: true });
  await expect(field).toHaveAttribute("maxlength", "500");
  await field.fill("A librarian's tip");
  await page.locator(".bv-journal").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".bv-journal")).toContainText("Saved it: A librarian's tip");
  expect(app.requests.filter(r => r.method === "PATCH" && r.path === "/me/library/101").at(-1).body).toMatchObject({ save_note: "A librarian's tip", expected_version: 2 });
  expect(app.attempt.note).toBe("A separate reading note");
});

test("an earlier reading opens in place from the journal and can be deleted from there", async ({ page, app }) => {
  app.dataControls = true;
  app.historicalAttempt = { ...app.attempt, id: "22222222-2222-4222-8222-222222222222", state: "finished", started_on: "2025-01-02", ended_on: "2025-02-03", note: "Earlier reading memory" };
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal")).toContainText("Read before: 2025, finished");
  await page.getByRole("button", { name: /^Edit: Read before: 2025/ }).click();
  await expect(page.getByRole("heading", { name: "Selected reading", exact: true })).toBeVisible();
  await page.locator(".bv-journal").getByRole("button", { name: "Delete this reading", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Finished");
  await page.keyboard.press("Escape");
  expect(app.requests.filter(r => r.method === "DELETE")).toHaveLength(0);
});

// Ported from the old workspace tests, for the new page.
const departed = async (page, app) => {
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
};

test("a late workspace response cannot render after the account has left", async ({ page, app }) => {
  let release;
  app.holdWorkspace = new Promise(done => { release = done; });
  try {
    await page.goto("/my-books/101");
    await expect.poll(() => app.requests.filter(r => r.path === "/me/library/101/reading").length).toBe(1);
    await departed(page, app);
    release();
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toHaveCount(0);
    await expect(pageBox(page)).toHaveCount(0);
  } finally { release(); }
});

test("a different login on the same entry starts with an empty box and thought, never the last reader's text", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await pageBox(page).fill("33%");
  await page.getByRole("textbox", { name: "Add a thought" }).fill("Account A only");
  await departed(page, app);
  await page.getByLabel("Email address", { exact: true }).fill("account-b@example.test");
  await page.getByLabel("Password", { exact: true }).fill("SyntheticPassword123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(pageBox(page)).toBeVisible();
  await expect(pageBox(page)).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Add a thought" })).toHaveValue("");
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(0);
});

test("Remove from My Books: a failure keeps the page, and a confirmed removal leaves cleanly", async ({ page, app }) => {
  app.dataControls = true; app.removeFails = true;
  await page.goto("/my-books/101");
  await openFold(page);
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  await page.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/101$/);
  await expect(page.getByRole("heading", { name: "Reading fixture 101", level: 1 })).toBeVisible();
  expect(app.entries.has(101)).toBe(true);
  app.removeFails = false;
  await page.getByRole("button", { name: "Remove from My Books", exact: true }).click();
  await page.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.entries.has(101)).toBe(false);
  await expect(page.getByRole("heading", { name: "Reading fixture 101", level: 1 })).toHaveCount(0);
});

test("Delete one reading: only that reading goes, the current one and its box stay", async ({ page, app }) => {
  app.dataControls = true;
  app.historicalAttempt = { ...app.attempt, id: "22222222-2222-4222-8222-222222222222", state: "finished", started_on: "2025-01-02", ended_on: "2025-02-03", note: "Earlier reading memory" };
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal")).toContainText("Read before: 2025, finished");
  await page.getByRole("button", { name: /^Edit: Read before: 2025/ }).click();
  await page.locator(".bv-journal").getByRole("button", { name: "Delete this reading", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete this reading", exact: true }).click();
  await expect.poll(() => app.requests.filter(r => r.method === "DELETE").map(r => r.path)).toEqual(["/me/reading-attempts/22222222-2222-4222-8222-222222222222"]);
  await expect(page.locator(".bv-journal")).not.toContainText("Read before");
  await expect(pageBox(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  expect(app.attempt.state).toBe("reading");
  expect(app.historicalAttempt).toBeNull();
});

test("a pending progress save stays visible, and a saved one does not wait for the refetch", async ({ page, app }) => {
  let releaseSave, releaseWorkspace;
  app.holdSave = new Promise(done => { releaseSave = done; });
  try {
    await page.goto("/my-books/101");
    await pageBox(page).fill("50%");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // While the save is pending nothing is hidden or lost, and Pause and Finish stay available.
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(pageBox(page)).toHaveValue("50%");
    await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeEnabled();
    expect(app.attempt.progress_value).toBe(40);
    app.holdWorkspace = new Promise(done => { releaseWorkspace = done; });
    releaseSave();
    await expect(page.getByText("Saved. 50%, about page 100.", { exact: true })).toBeVisible();
    await expect(pageBox(page)).toHaveValue("");
    expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(1);
    releaseWorkspace();
    await expect(page.locator(".bv-progress-line")).toContainText("50%");
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("50%");
  } finally { releaseSave(); releaseWorkspace?.(); }
});

test("Finish moves focus to the finish moment and it stays there", async ({ page, app }) => {
  app.attempt.note = "A thought to edit";
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: /^Edit: A thought to edit/ }).click();
  // Hold animation frames so an older editor-close callback becomes runnable only after Finish: the valid adverse ordering.
  await page.evaluate(() => {
    window.closeFrames = [];
    window.nativeFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.closeFrames.push(callback); return window.closeFrames.length; };
  });
  try {
    await page.locator(".bv-journal").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Finish book", exact: true }).click();
    const saved = page.getByRole("heading", { name: /^You finished / });
    await expect(saved).toBeFocused();
    await page.evaluate(() => { for (const callback of window.closeFrames.splice(0)) callback(performance.now()); });
    await expect(saved).toBeFocused();
    await page.waitForTimeout(400);
    await expect(saved).toBeFocused();
    expect(app.requests.filter(item => item.method === "PATCH" && item.body.state === "finished")).toHaveLength(1);
  } finally { await page.evaluate(() => { window.requestAnimationFrame = window.nativeFrame; }); }
});

test("Yes, finished from the box also moves focus to the finish moment", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  await pageBox(page).fill("100%");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finished", exact: true }).click();
  const saved = page.getByRole("heading", { name: /^You finished / });
  await expect(saved).toBeFocused();
  await page.waitForTimeout(400);
  await expect(saved).toBeFocused();
});
