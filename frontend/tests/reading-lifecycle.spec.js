import { test as base, expect } from "@playwright/test";

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

async function openDisclosure(page, label) {
  if (label === "My note") { await expect(page.getByRole("region", { name: label, exact: true })).toBeVisible(); label = "Why I saved this book"; }
  const section = page.locator("details").filter({ has: page.getByText(label, { exact: true }) });
  await expect(section.locator(":scope > summary")).toBeVisible();
  if (!(await section.evaluate(node => node.open))) await section.locator(":scope > summary").click();
}

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = {
      entries: new Map([[101, makeEntry(101)], [102, makeEntry(102, null)]]),
      attempt: { id: attemptId, state: "reading", started_on: null, ended_on: null,
        progress_unit: "percent", progress_value: 40, total_pages: 200,
        edition_id: null, edition_source_id: null, edition_format: null, created_at: stamp, updated_at: stamp },
      requests: [], errors: [], authenticated: true,
    };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
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
          features: { reading_actions: true, private_context: Boolean(state.privateContext), privacy_controls: Boolean(state.dataControls), reading_export: Boolean(state.dataControls), library_import: Boolean(state.libraryImport), next_read: Boolean(state.nextRead) } });
      }
      if (path === "/me/books") return reply(200, []);
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
        return reply(200, { items: entries, counts, total: entries.length, next_cursor: null });
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) {
        if (state.holdWorkspace) await state.holdWorkspace;
        const id = Number(workspace[1]);
        if (!state.entries.has(id)) return reply(404, { detail: "Library entry not found" });
        return reply(200, { entry: state.entries.get(id), current_attempt: id === 101 ? state.attempt : null, editions: [] });
      }
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: path.includes("/101/") && state.attempt ? [state.attempt, ...(state.historicalAttempt ? [state.historicalAttempt] : [])] : [], next_cursor: null });
      if (state.historicalAttempt && path === `/me/reading-attempts/${state.historicalAttempt.id}` && method === "GET") {
        if (state.holdMemory) await state.holdMemory;
        return reply(200, { entry: state.entries.get(101), attempt: state.historicalAttempt });
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
      state.errors.push(`Unhandled request ${method} ${path}`);
      return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("UI refactor current reading leads Home on desktop and phone", async ({ page, app }) => {
  app.currentReads = [{ entry: app.entries.get(101), attempt: app.attempt }];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await page.goto("/home");
    const current = page.getByRole("link", { name: "Continue your reading: Reading fixture 101", exact: true });
    await expect(current).toBeVisible();
    expect((await current.boundingBox()).y).toBeLessThan(width === 390 ? 650 : 750);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`v3-ui-home-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "Continue your reading: Reading fixture 101", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/101$/);
  expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
});

test("UI refactor paused Home has a truthful empty-current state", async ({ page, app }) => {
  app.pausedCount = 2;
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "A book can wait for you.", exact: true })).toBeVisible();
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
    const desk = page.getByRole("region", { name: "Your current reading", exact: true });
    await expect(desk.getByRole("article")).toHaveCount(3);
    await expect(desk.getByRole("progressbar", { name: "Reading progress for Reading fixture 101" })).toHaveAttribute("value", "40");
    await expect(desk.getByRole("progressbar")).toHaveCount(1);
    await expect(desk.getByText("Page 12", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "See all current reads (8)", exact: true })).toHaveAttribute("href", "/my-books?status=reading");
    await expect(page.getByRole("link", { name: "Paused books (2)", exact: true })).toHaveAttribute("href", "/my-books?status=paused");
    await expect(page.getByRole("search", { name: "Search your library" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Filter your library" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Bring Your Library", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add a missing book", exact: true })).toHaveCount(0);
    const first = desk.getByRole("link", { name: "Continue your reading: Reading fixture 101", exact: true });
    await expect(first).toBeVisible();
    expect((await first.boundingBox()).y).toBeLessThan(750);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`reading-desk-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("navigation", { name: /Main navigation|Mobile navigation/ }).filter({ visible: true }).getByRole("link", { name: "My Books", exact: true }).click();
    await expect(page.getByRole("search", { name: "Search your library" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Filter your library", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bring Your Library", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a missing book", exact: true })).toBeVisible();
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

test("UI refactor historical facet explains active rereads without changing the query", async ({ page, app }) => {
  await page.goto("/my-books?status=finished");
  await expect(page.getByText("Books with a finished reading. Each card shows its current or latest recorded reading state.", { exact: true })).toBeVisible();
  await expect(page.locator(".bv-personal-book-state").first()).toContainText("Reading");
  expect(app.requests.filter(request => request.path === "/me/library").at(-1).body).toBeNull();
});

for (const theme of ["light", "dark"]) test(`editorial workspace is book-first without an extra navbar; ${theme}`, async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true;
  app.entries.set(201, { ...makeEntry(201, null), is_wanted: true });
  app.entries.set(203, { ...makeEntry(203, null, true), is_wanted: true });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const before = app.requests.length;
    await page.goto("/my-books/101");
    await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update progress", exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Reading progress", exact: true })).toHaveAttribute("max", "100");
    await expect(page.getByText("Published 2000 · Catalogue: 999 pages · your copy may differ", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "On this book" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeVisible();
    expect(app.requests.slice(before).filter(r => r.path.endsWith("/attempts"))).toHaveLength(0);
    expect(app.requests.slice(before).filter(r => r.path === "/books/101")).toHaveLength(1);
    expect(app.requests.slice(before).filter(r => r.path === "/me/next-read")).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) expect((await page.locator(".bv-editorial-workspace").boundingBox()).width).toBe(1240);
    await page.screenshot({ path: test.info().outputPath(`editorial-workspace-${theme}-${width}.png`), fullPage: true });
  }
  const before = app.requests.filter(r => r.path === "/me/next-read").length;
  await page.getByRole("button", { name: "Explore more choices", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What would you like to read next?", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Next after this" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(2);
  expect(app.requests.filter(r => r.path === "/me/next-read")).toHaveLength(before);
  await page.getByRole("button", { name: "Back to this reading", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore more choices", exact: true })).toBeFocused();
  expect(app.requests.filter(r => ["PUT", "PATCH"].includes(r.method))).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`editorial workspace phone text enlargement and keyboard order; ${theme}`, async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true;
  const entry = makeEntry(101, "reading", true);
  entry.private_title = "A long reading title — 読書の記憶 ".repeat(9);
  entry.private_author = "A reader with a long author name ".repeat(7);
  app.entries.set(101, entry);
  app.entries.set(201, { ...makeEntry(201, null), is_wanted: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.goto("/my-books/101");
  await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
  const stop = page.getByRole("button", { name: "Stop reading", exact: true });
  await stop.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".bv-save-reason > summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".bv-workspace-history > summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".bv-workspace-manage > summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("region", { name: "Next after this" }).getByRole("link", { name: "Open your book", exact: true })).toBeFocused();
  // Exercise a user text override without resizing or inventing metadata.
  await page.locator(".bv-editorial-workspace").evaluate(root => {
    const sizes = [...root.querySelectorAll("h1,h2,h3,p,button,a,summary")].map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
    for (const [node, size] of sizes) node.style.fontSize = `${size * 2}px`;
  });
  const overflow = await page.locator(".bv-editorial-workspace *").evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().right > innerWidth + 1).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
  expect(app.requests.filter(r => ["PUT", "PATCH", "DELETE"].includes(r.method))).toHaveLength(0);
});

test("editorial workspace history is lazy and reopening uses the loaded page", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Update progress", exact: true })).toBeVisible();
  expect(app.requests.filter(r => r.path.endsWith("/attempts"))).toHaveLength(0);
  await openDisclosure(page, "Reading history");
  await expect(page.locator(".bv-reading-history li")).toHaveCount(1);
  const summary = page.locator(".bv-workspace-history > summary");
  await summary.click(); await summary.click();
  await expect(page.locator(".bv-reading-history li")).toBeVisible();
  expect(app.requests.filter(r => r.path.endsWith("/attempts"))).toHaveLength(1);
  expect(app.requests.filter(r => r.path.includes("reading-attempts"))).toHaveLength(0);
});

test("editorial workspace private books never request public metadata", async ({ page, app }) => {
  app.entries.set(101, makeEntry(101, "reading", true));
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "Private fixture 101", exact: true })).toBeVisible();
  await expect(page.getByText("No description is available for this private book.", { exact: false })).toBeVisible();
  expect(app.requests.filter(r => r.path.startsWith("/books/"))).toHaveLength(0);
});

test("editorial workspace keeps reading usable when book details fail", async ({ page, app }) => {
  app.bookDetailsFail = true;
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Try book details again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  const field = page.getByLabel("Percent complete", { exact: true }); await field.fill("25");
  app.bookDetailsFail = false;
  await page.getByRole("button", { name: "Try book details again", exact: true }).click();
  await expect(page.getByText("Published 2000 · Catalogue: 999 pages · your copy may differ", { exact: true })).toBeVisible();
  await expect(field).toHaveValue("25");
  expect(app.requests.filter(r => r.path === "/books/101")).toHaveLength(2);
  expect(app.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
});

test("editorial workspace late metadata preserves a dirty version-captured editor", async ({ page, app }) => {
  let release;
  app.holdBookDetails = new Promise(done => { release = done; });
  try {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Update progress", exact: true }).click();
    const field = page.getByLabel("Percent complete", { exact: true }); await field.fill("25");
    await openDisclosure(page, "Manage this book");
    const want = page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true });
    await want.click(); await expect(want).toHaveAttribute("aria-pressed", "true");
    await expect(field).toHaveValue("25"); await field.focus();
    release();
    await expect(page.getByText("Published 2000 · Catalogue: 999 pages · your copy may differ", { exact: true })).toBeVisible();
    await expect(field).toBeFocused();
    await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Your draft is still here");
    await expect(field).toHaveValue("25"); expect(app.attempt.progress_value).toBe(40);
    expect(app.requests.filter(r => r.path === "/books/101")).toHaveLength(1);
    expect(app.requests.find(r => r.path.includes("reading-attempts") && r.method === "PATCH").body.expected_version).toBe(2);
  } finally { release(); }
});

test("editorial workspace progress uses the saved copy and keeps missing values honest", async ({ page, app }) => {
  for (const [unit, value, total, text, max] of [[null, null, 200, "Not tracking progress", null], ["pages", 55, null, "Page 55", null], ["pages", 55, 200, "Page 55 of 200", "200"], ["percent", 0, null, "0%", "100"]]) {
    Object.assign(app.attempt, { progress_unit: unit, progress_value: value, total_pages: total });
    await page.goto("/my-books/101");
    await expect(page.getByRole("region", { name: "My reading", exact: true }).getByText(text, { exact: true })).toBeVisible();
    const meter = page.getByRole("progressbar", { name: "Reading progress", exact: true });
    if (max) await expect(meter).toHaveAttribute("max", max); else await expect(meter).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  }
});

test("editorial workspace paused actions put Resume first visually and by keyboard", async ({ page, app }) => {
  app.attempt.state = "paused"; app.entries.get(101).reading_state = "paused";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Resume reading", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).focus();
  for (const label of ["Own", "Want", "Resume reading", "Finish book", "Stop reading", "Update progress"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: label, exact: true })).toBeFocused();
  }
  const resume = await page.getByRole("button", { name: "Resume reading", exact: true }).boundingBox();
  const progress = await page.getByRole("button", { name: "Update progress", exact: true }).boundingBox();
  expect(resume.y).toBeLessThan(progress.y);
  expect(app.requests.filter(r => ["PATCH", "PUT"].includes(r.method))).toHaveLength(0);
});

test("editorial workspace read-only progress is a view with no writable controls", async ({ page, app }) => {
  app.readOnly = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "View progress and dates", exact: true }).click();
  await expect(page.getByLabel("Percent complete", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save progress", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Finish book", exact: true })).toHaveCount(0);
  expect(app.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
});

for (const status of [404, 503]) for (const moved of [false, true]) test(`editorial workspace retry preserves deliberate focus; ${status}; moved=${moved}`, async ({ page, app }) => {
  await page.route("**/test-api/me/library/101/reading", route => route.fulfill({ status, json: {} }), { times: 1 });
  await page.goto("/my-books/101");
  await expect(page.getByRole("heading", { name: "This reading couldn’t load.", exact: true })).toBeVisible();
  let release;
  app.holdWorkspace = new Promise(done => { release = done; });
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
    await expect(page.getByRole("heading", { name: "Loading your reading…", exact: true })).toBeFocused();
    const back = page.getByRole("link", { name: "Back to My Books", exact: true });
    if (moveFocus) await back.focus();
    release();
    const title = page.getByRole("heading", { name: "Reading fixture 101", exact: true });
    await expect(title).toBeVisible();
    if (moveFocus) await expect(back).toBeFocused(); else await expect(title).toBeFocused();
  } finally { release(); }
});

test("editorial workspace late private preview cannot render after account departure", async ({ page, app }) => {
  app.nextRead = true;
  app.entries.set(203, { ...makeEntry(203, null, true), is_wanted: true });
  let release;
  app.holdNext = new Promise(done => { release = done; });
  try {
    await page.goto("/my-books/101");
    await expect.poll(() => app.requests.filter(r => r.path === "/me/next-read").length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page).toHaveURL(/\/login/);
    release();
    await expect(page.getByText("Private fixture 203", { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("M3 confirmed removal distinguishes a reading from the whole book; failure and Cancel preserve data", async ({ page, app }) => {
  app.dataControls = true;
  await page.goto("/my-books/101");
  await openDisclosure(page, "Reading history");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Reading fixture 101");
  await expect(dialog).toContainText("Start date unknown");
  await expect(dialog).toContainText("other readings will stay");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(app.requests.filter(request => request.method === "DELETE")).toHaveLength(0);
  await openDisclosure(page, "Reading history");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  app.removeFails = true;
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("couldn’t confirm the removal");
  expect(app.attempt).not.toBeNull();
  app.removeFails = false;
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Not started", exact: true })).toBeVisible();
  expect(app.entries.get(101).is_owned).toBe(true);
  await openDisclosure(page, "Manage this book");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await expect(dialog).toContainText("every reading, note and reaction");
  await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
  expect(app.entries.has(101)).toBe(true);
  await openDisclosure(page, "Manage this book");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.entries.has(101)).toBe(false);
  const requests = app.requests.filter(request => request.method === "DELETE");
  expect(requests.at(-1).body).toEqual({ expected_version: 3, confirmed: true });
});

test("M3 stale confirmation refuses deletion and keeps the captured version", async ({ page, app }) => {
  app.dataControls = true;
  await page.goto("/my-books/101");
  await openDisclosure(page, "Manage this book");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
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
  await openDisclosure(page, "Manage this book");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
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
  await page.goto("/account");
  await page.getByRole("link", { name: "Manage my data", exact: true }).click();
  const button = page.getByRole("button", { name: "Download my data", exact: true });
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
  await page.getByRole("button", { name: "Download my data", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preparing download…", exact: true })).toBeDisabled();
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page).toHaveURL(/\/login/);
  release();
  await expect.poll(() => app.requests.filter(request => request.path === "/me/reading-export").length).toBe(1);
  await page.waitForTimeout(100);
  expect(count).toBe(0);
});

for (const flag of ["Own", "Want"]) {
  test(`${flag} success preserves progress/date drafts across refresh without silently rebasing`, async ({ page, app }) => {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: /^(Update progress|Correct progress or dates|View progress and dates)$/ }).click();
    await openDisclosure(page, "Format, copy & dates");
    await page.getByLabel("Percent complete", { exact: true }).fill("25");
    await page.getByLabel("Started on (optional)", { exact: true }).fill("2026-09-10");
    let release;
    app.holdWorkspace = new Promise(resolve => { release = resolve; });
    try {
      const before = app.requests.filter(request => request.path.endsWith("/reading")).length;
      await openDisclosure(page, "Manage this book");
      await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: flag, exact: true }).click();
      await expect.poll(() => app.requests.filter(request => request.path.endsWith("/reading")).length).toBeGreaterThan(before);
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2026-09-10");
      release(); app.holdWorkspace = null;
      await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible();
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await page.getByRole("button", { name: "Save progress", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Your draft is still here");
      expect(app.requests.filter(request => request.path.includes("/reading-attempts/")).at(-1).body.expected_version).toBe(2);
      expect(app.attempt.progress_value).toBe(40);
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2026-09-10");
      await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Load saved version", exact: true }).click();
      await page.getByRole("button", { name: /^(Update progress|Correct progress or dates|View progress and dates)$/ }).click();
      await openDisclosure(page, "Format, copy & dates");
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("40");
      await page.getByLabel("Percent complete", { exact: true }).fill("25");
      await page.getByRole("button", { name: "Save progress", exact: true }).click();
      await expect(page.getByText("25%", { exact: true })).toBeVisible();
      expect(app.attempt.progress_value).toBe(25);
    } finally { release(); }
  });

  test(`${flag} failure preserves the draft and still permits a version-safe save`, async ({ page, app }) => {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: /^(Update progress|Correct progress or dates|View progress and dates)$/ }).click();
    await openDisclosure(page, "Format, copy & dates");
    await page.getByLabel("Percent complete", { exact: true }).fill("25");
    await page.getByLabel("Started on (optional)", { exact: true }).fill("2026-09-10");
    app.flagFails = true;
    await openDisclosure(page, "Manage this book");
    await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: flag, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
    await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await expect(page.getByText("25%", { exact: true })).toBeVisible();
    expect(app.attempt.started_on).toBe("2026-09-10");
    expect(app.entries.get(101).version).toBe(3);
  });
}

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
  await expect(page.getByRole("link", { name: "Add a missing book", exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: /Main navigation|Mobile navigation/ }).filter({ visible: true }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes are temporarily paused." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a missing book", exact: true })).toHaveCount(0);
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

test("drafts survive internal route/back navigation and clear on account departure", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: /^(Update progress|Correct progress or dates|View progress and dates)$/ }).click();
  await openDisclosure(page, "Format, copy & dates");
  await page.getByLabel("Percent complete", { exact: true }).fill("25");
  await page.evaluate(() => { history.pushState(null, "", "/my-books/102"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("heading", { name: "Reading fixture 102", exact: true })).toBeVisible();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveCount(0);
  await page.goBack();
  await page.getByRole("button", { name: /^(Update progress|Correct progress or dates|View progress and dates)$/ }).click();
  await openDisclosure(page, "Format, copy & dates");
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveCount(0);
  expect(app.attempt.progress_value).toBe(40);
});

test("M3 private memory retains failed drafts, renders plain text and can be cleared", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await openDisclosure(page, "My note");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  const field = page.getByLabel("Note (optional)", { exact: true });
  const note = '<img src=x onerror="window.noteExecuted=true">\nMy private memory 読書';
  await expect(field).toHaveAttribute("maxlength", "2000");
  await field.fill(note);
  await openDisclosure(page, "Reaction (optional)");
  await page.getByLabel("Reaction (optional)", { exact: true }).selectOption("liked");
  app.contextFails = true;
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(field).toHaveValue(note);
  app.contextFails = false;
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".bv-workspace-memory .bv-private-text")).toHaveText(note);
  await expect(page.getByText("Liked it", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.noteExecuted)).toBeUndefined();
  await expect(page.locator(".bv-workspace-memory .bv-private-text img")).toHaveCount(0);
  await page.reload();
  await openDisclosure(page, "My note");
  await expect(page.locator(".bv-workspace-memory .bv-private-text")).toHaveText(note);
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await field.fill("");
  await openDisclosure(page, "Reaction (optional)");
  await page.getByLabel("Reaction (optional)", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await openDisclosure(page, "My note");
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeVisible();
  expect(app.attempt.note).toBeNull(); expect(app.attempt.reaction).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("My private memory");
});

test("M3 save reason is independent from reading memory and flags", async ({ page, app }) => {
  app.privateContext = true;
  app.attempt.note = "A separate reading memory";
  await page.goto("/my-books/101");
  await openDisclosure(page, "My note");
  await page.getByRole("button", { name: "Add save reason (optional)", exact: true }).click();
  const field = page.getByLabel("Save reason (optional)", { exact: true });
  await expect(field).toHaveAttribute("maxlength", "500");
  await field.fill("A friend's recommendation");
  await page.getByRole("button", { name: "Save reason", exact: true }).click();
  await expect(page.getByText("A friend's recommendation", { exact: true })).toBeVisible();
  expect(app.attempt.note).toBe("A separate reading memory");
  expect(app.entries.get(101).is_owned).toBe(true);
  expect(app.entries.get(101).is_wanted).toBe(false);
});

test("M3 stale memory draft survives flag updates without rebasing", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await openDisclosure(page, "My note");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  const field = page.getByLabel("Note (optional)", { exact: true });
  await field.fill("Unsaved reader context");
  await openDisclosure(page, "Manage this book");
  await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true }).click();
  await openDisclosure(page, "Manage this book");
  await expect(page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("Unsaved reader context");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(field).toHaveValue("Unsaved reader context");
  expect(app.requests.filter(request => request.method === "PATCH" && request.path.includes("reading-attempts")).at(-1).body.expected_version).toBe(2);
  expect(app.attempt.note).toBeUndefined();
});

test("M3 read-only history can show private memory without allowing saves", async ({ page, app }) => {
  app.privateContext = true; app.readOnly = true; app.attempt.note = "Preserved private memory";
  await page.goto("/my-books/101");
  await openDisclosure(page, "My note");
  await expect(page.getByText("Preserved private memory", { exact: true })).toBeVisible();
  await openDisclosure(page, "Reading history");
  await page.locator(".bv-reading-history").getByRole("button", { name: "View reading memory", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Preserved private memory");
  await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("M3 historical memory and correction identify the selected record and receive keyboard focus once", async ({ page, app }) => {
  app.privateContext = true;
  app.historicalAttempt = { ...app.attempt, id: "22222222-2222-4222-8222-222222222222", state: "finished",
    started_on: "2025-01-02", ended_on: "2025-02-03", note: "Earlier reading memory" };
  await page.goto("/my-books/101");
  await openDisclosure(page, "Reading history");
  const older = page.locator(".bv-reading-history li").last();
  const memory = older.getByRole("button", { name: "Note and reaction", exact: true });
  await memory.focus(); await memory.press("Enter");
  const identity = page.locator(".bv-reading-draft").getByRole("heading", { name: "Selected reading", exact: true });
  await expect(identity).toBeFocused();
  await expect(page.locator(".bv-reading-draft")).toContainText("Finished · 2025-01-02 → 2025-02-03");
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const field = page.getByLabel("Note (optional)", { exact: true });
  await expect(field).toHaveValue("Earlier reading memory");
  await field.fill("Unsaved earlier memory");
  await openDisclosure(page, "Manage this book");
  const want = page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true });
  await want.click();
  await expect(want).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("Unsaved earlier memory");
  await expect(identity).not.toBeFocused();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await older.getByRole("button", { name: "Correct this reading", exact: true }).click();
  await expect(identity).toBeFocused();
  await expect(page.locator(".bv-reading-draft")).toContainText("Finished · 2025-01-02 → 2025-02-03");
  await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2025-01-02");
});

test("M3 empty read-only memory advertises viewing rather than adding context", async ({ page, app }) => {
  app.privateContext = true; app.readOnly = true;
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toHaveCount(0);
  await openDisclosure(page, "My note");
  await page.getByRole("button", { name: "View note", exact: true }).first().click();
  await expect(page.getByText("No note or reaction is saved for this reading. Changes are temporarily paused.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("M3 stopped reading deletion uses the familiar state label", async ({ page, app }) => {
  app.dataControls = true; app.attempt.state = "dnf"; app.entries.get(101).reading_state = "dnf";
  await page.goto("/my-books/101");
  await openDisclosure(page, "Reading history");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Stopped · Start date unknown");
  await expect(page.getByRole("dialog")).not.toContainText("dnf");
});

test("M3 late context response cannot reopen a departed account's draft", async ({ page, app }) => {
  app.privateContext = true;
  app.historicalAttempt = { ...app.attempt, id: "22222222-2222-4222-8222-222222222222", state: "finished", note: "Historical private note" };
  let release;
  app.holdMemory = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/my-books/101");
    await openDisclosure(page, "Reading history");
    await page.locator(".bv-reading-history li").last().getByRole("button", { name: "Note and reaction", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "GET" && request.path.includes("reading-attempts")).length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    release();
    await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveCount(0);
  } finally { release(); }
});

for (const theme of ["light", "dark"]) test(`zero-friction active reader journey and responsive evidence; ${theme}`, async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true;
  app.entries.set(201, { ...makeEntry(201, null), is_wanted: true });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/my-books");
    const cards = page.locator(".bv-personal-book");
    await expect(cards).toHaveCount(3);
    await expect(cards.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open your reading:/ })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Filter your library", exact: true }).getByRole("button")).toHaveCount(4);
    await page.screenshot({ path: test.info().outputPath(`simplified-library-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Reading fixture 101", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update progress", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`simplified-workspace-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Update progress", exact: true }).click();
    const settings = page.locator(".bv-progress-settings");
    await expect(settings).not.toHaveAttribute("open");
    await expect(page.getByLabel("Track by", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Total pages (optional)", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Started on (optional)", { exact: true })).toBeHidden();
    const field = page.getByLabel("Percent complete", { exact: true });
    await field.fill("55");
    await page.screenshot({ path: test.info().outputPath(`quick-progress-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await expect(page.getByText("55%", { exact: true })).toBeVisible();
    expect(app.attempt.state).toBe("reading");
    expect(app.attempt.started_on).toBeNull(); expect(app.attempt.total_pages).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  const note = page.getByLabel("Note (optional)", { exact: true });
  await note.fill("Keep this thought — 読書");
  await expect(page.getByRole("region", { name: "My note", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toHaveCount(0);
  for (const captureWidth of [390, 1440]) {
    await page.setViewportSize({ width: captureWidth, height: 900 });
    await page.getByRole("button", { name: "Save note", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`note-editor-${theme}-${captureWidth}.png`) });
  }
  await expect(page.getByLabel("Reaction (optional)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Keep this thought — 読書", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "My note", exact: true })).toBeVisible();
  expect(app.attempt.reaction ?? null).toBeNull();
  await page.getByRole("button", { name: "Pause reading", exact: true }).click();
  await page.getByRole("button", { name: "Resume reading", exact: true }).click();
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toBeFocused();
  expect(app.attempt.state).toBe("finished");
  expect(app.attempt.note).toBe("Keep this thought — 読書");
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeFocused();
  await test.info().attach("developer-simulated-task-counts", { body: JSON.stringify({ libraryOpen: { navigations: 1 }, configuredProgress: { buttonActivations: 2, valueEdits: 1 }, note: { buttonActivations: 2, textEdits: 1 }, pause: 1, resume: 1, finish: 1, skip: 1, realParticipants: 0 }), contentType: "application/json" });
});

test("session draft survives internal navigation without prompts or writes", async ({ page, app }) => {
  app.privateContext = true;
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Unsaved private note");
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  await page.getByRole("link", { name: "Reading fixture 101", exact: true }).click();
  await page.getByRole("button", { name: "Continue draft", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Unsaved private note");
  expect(dialogs).toBe(0);
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(0);
  expect(app.attempt.note ?? null).toBeNull();
});

test("zero-friction first progress setup and zero/full values never invent dates, totals or a finish", async ({ page, app }) => {
  Object.assign(app.attempt, { progress_unit: null, progress_value: null, total_pages: null });
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  await expect(page.getByLabel("Track by", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Started on (optional)", { exact: true })).toBeHidden();
  await page.getByLabel("Track by", { exact: true }).selectOption("pages");
  await page.getByLabel("Current page", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await expect(page.getByText("Page 0", { exact: true })).toBeVisible();
  expect(app.attempt.total_pages).toBeNull(); expect(app.attempt.started_on).toBeNull();
  for (const value of ["0", "100"]) {
    await page.getByRole("button", { name: "Update progress", exact: true }).click();
    await openDisclosure(page, "Format, copy & dates");
    await page.getByLabel("Track by", { exact: true }).selectOption("percent");
    await page.getByLabel("Percent complete", { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await expect(page.getByText(`${value}%`, { exact: true })).toBeVisible();
    expect(app.attempt.state).toBe("reading");
    expect(app.attempt.total_pages).toBeNull(); expect(app.attempt.started_on).toBeNull();
  }
});

test("zero-friction note-only edits preserve an unopened reaction and read-only copy stays truthful", async ({ page, app }) => {
  app.privateContext = true; app.attempt.reaction = "loved";
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Only my note changes");
  await expect(page.getByLabel("Reaction (optional)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Only my note changes", { exact: true })).toBeVisible();
  expect(app.attempt.reaction).toBe("loved");
  app.attempt.note = null; app.readOnly = true;
  await page.reload();
  const memory = page.getByRole("region", { name: "My note", exact: true });
  await expect(memory.getByText("Loved it", { exact: true })).toBeVisible();
  await expect(memory.getByText(/No note or reaction is saved/)).toHaveCount(0);
  await expect(memory.getByRole("button", { name: "View note", exact: true })).toBeVisible();
});

test("zero-friction manage disclosure remains open after each independent flag acknowledgement", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await openDisclosure(page, "Manage this book");
  const flags = page.getByRole("group", { name: "Your book flags", exact: true });
  await flags.getByRole("button", { name: "Want", exact: true }).click();
  await expect(flags.getByRole("button", { name: "Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  await flags.getByRole("button", { name: "Own", exact: true }).click();
  await expect(flags.getByRole("button", { name: "Own", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(app.entries.get(101).is_wanted).toBe(true); expect(app.entries.get(101).is_owned).toBe(false);
  expect(app.attempt.state).toBe("reading");
});

test("zero-friction dirty progress can cancel native reload without losing its value", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  const field = page.getByLabel("Percent complete", { exact: true });
  await field.fill("29");
  const dialogReady = page.waitForEvent("dialog");
  // Trigger the native reload without Playwright waiting for a load event
  // that intentionally never occurs when the user cancels beforeunload.
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await dialogReady;
  expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); await reload;
  await expect(field).toHaveValue("29"); expect(app.attempt.progress_value).toBe(40);
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("minimalist Close retains a note without requests, dialogs, scroll or lost focus", async ({ page, app }) => {
  app.privateContext = true;
  const dialogs = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  const field = page.getByLabel("Note (optional)", { exact: true });
  await field.fill("A quiet thought 読書");
  const before = app.requests.length;
  const close = page.getByRole("button", { name: "Close", exact: true });
  await close.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await close.click();
  await expect(page.getByRole("button", { name: "Continue draft", exact: true })).toBeFocused();
  expect(app.requests.length).toBe(before);
  expect(dialogs).toEqual([]);
  // Collapsing content may clamp scroll to the new document end, but must not
  // trigger a page navigation or deliberately scroll to the bottom/top.
  expect(Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThan(420);
  await page.getByRole("button", { name: "Continue draft", exact: true }).click();
  await expect(field).toHaveValue("A quiet thought 読書");
  expect(app.requests.length).toBe(before);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain("A quiet thought");
});

test("minimalist progress and note drafts remain separate across books and internal navigation", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  await page.getByLabel("Percent complete", { exact: true }).fill("23");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Not my progress");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await page.getByRole("link", { name: "Reading fixture 102", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue draft", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  await page.getByRole("link", { name: "Reading fixture 101", exact: true }).click();
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("23");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Continue draft", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Not my progress");
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(0);
});

test("minimalist closed drafts warn only on document exit and clear after accepted refresh", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Temporary only");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const exit = page.waitForEvent("dialog");
  const refresh = page.evaluate(() => window.location.reload());
  const dialog = await exit;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept(); await refresh.catch(() => {});
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("");
  expect(app.attempt.note ?? null).toBeNull();
});

test("minimalist logout and a different login discard drafts even with identical entry IDs", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Account A only");
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill("account-b@example.test");
  await page.getByLabel("Password", { exact: true }).fill("SyntheticPassword123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("");
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(0);
});

test("minimalist closed stale note keeps its version and requires explicit saved-version recovery", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Retain original version");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true }).click();
  await page.getByRole("button", { name: "Continue draft", exact: true }).click();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  expect(app.requests.filter(item => item.method === "PATCH" && item.path.includes("reading-attempts")).at(-1).body.expected_version).toBe(2);
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Retain original version");
  await page.getByRole("button", { name: "Load saved version", exact: true }).click();
  await expect.poll(() => page.locator(".bv-workspace-memory").evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("");
  expect(app.attempt.note ?? null).toBeNull();
});

for (const theme of ["light", "dark"]) test(`minimalist point-of-use editors, enlarged text and reduced motion; ${theme}`, async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true;
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/my-books/101");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Update progress", exact: true }).click();
    await expect(page.locator(".bv-workspace-progress .bv-reading-draft")).toBeVisible();
    if (width >= 768) {
      const book = await page.locator(".bv-workspace-book").boundingBox();
      const note = await page.locator(".bv-workspace-memory").boundingBox();
      expect(note.y - (book.y + book.height)).toBeLessThan(80);
      const reading = await page.locator(".bv-workspace-reading").boundingBox();
      const next = await page.getByRole("region", { name: "Next after this", exact: true }).boundingBox();
      expect(next.y).toBeGreaterThanOrEqual(reading.y + reading.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`polish-progress-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Add a note", exact: true }).click();
    await expect(page.locator(".bv-workspace-memory .bv-reading-draft")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCSS("transition-duration", "0s");
    await page.screenshot({ path: test.info().outputPath(`polish-note-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll(".bv-root :is(input,textarea,select,button,a,p,label,small,h1,h2,h3,summary)")]
      .map(node => [node, parseFloat(getComputedStyle(node).fontSize) * 2]);
    for (const [node, size] of sizes) node.style.fontSize = `${size}px`;
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("minimalist pending save cannot be hidden and acknowledged success does not wait for a refetch", async ({ page, app }) => {
  app.privateContext = true;
  let releaseSave, releaseWorkspace;
  app.holdSave = new Promise(resolve => { releaseSave = resolve; });
  try {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Add a note", exact: true }).click();
    await page.getByLabel("Note (optional)", { exact: true }).fill("Explicit save only");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Explicit save only");
    expect(app.attempt.note ?? null).toBeNull();
    app.holdWorkspace = new Promise(resolve => { releaseWorkspace = resolve; });
    releaseSave();
    await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
    expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(1);
    releaseWorkspace();
    await expect(page.locator(".bv-workspace-memory .bv-private-text")).toHaveText("Explicit save only");
    await expect(page.getByRole("button", { name: "Edit note", exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("Explicit save only");
  } finally { releaseSave(); releaseWorkspace?.(); }
});

async function reloadWithoutDraftWarning(page) {
  let warned = false;
  page.once("dialog", async dialog => { warned = true; await dialog.accept(); });
  await page.reload();
  await expect(page.locator("h1")).toBeVisible();
  expect(warned).toBe(false);
}

test("minimalist failed forget keeps the draft; confirmed forget clears it without an orphan exit warning", async ({ page, app }) => {
  app.privateContext = true; app.dataControls = true; app.removeFails = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Retain unless removal is confirmed");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openDisclosure(page, "Manage this book");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await page.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await page.getByRole("button", { name: "Continue draft", exact: true }).click();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveValue("Retain unless removal is confirmed");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  app.removeFails = false;
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved drafts for this book will be removed too.");
  await page.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.entries.has(101)).toBe(false);
  await reloadWithoutDraftWarning(page);
});

test("minimalist deleting one reading clears its drafts and retains the book's separate save-reason draft", async ({ page, app }) => {
  app.privateContext = true; app.dataControls = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Update progress", exact: true }).click();
  await page.getByLabel("Percent complete", { exact: true }).fill("26");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note (optional)", { exact: true }).fill("Only this reading");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openDisclosure(page, "Why I saved this book");
  await page.getByRole("button", { name: "Add save reason (optional)", exact: true }).click();
  await page.getByLabel("Save reason (optional)", { exact: true }).fill("Keep this separate book-level thought");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openDisclosure(page, "Reading history");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  await page.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await page.getByRole("button", { name: "Continue save-reason draft", exact: true }).click();
  await expect(page.getByLabel("Save reason (optional)", { exact: true })).toHaveValue("Keep this separate book-level thought");
  await page.getByRole("button", { name: "Save reason", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await page.getByRole("button", { name: "Load saved version", exact: true }).click();
  await expect(page.locator(".bv-reading-draft")).toHaveCount(0);
  await reloadWithoutDraftWarning(page);
});

test("minimalist Finish keeps its focus even when an older editor-close frame runs afterwards", async ({ page, app }) => {
  app.privateContext = true; app.nextRead = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  // Hold actual frame callbacks to exercise a valid adverse ordering: Close
  // commits, Finish completes, then the older Close callback becomes runnable.
  await page.evaluate(() => {
    window.closeFrames = [];
    window.nativeFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.closeFrames.push(callback); return window.closeFrames.length; };
  });
  try {
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Finish book", exact: true }).click();
    const saved = page.getByRole("heading", { name: "Reading saved.", exact: true });
    await expect(saved).toBeFocused();
    await page.evaluate(() => { for (const callback of window.closeFrames.splice(0)) callback(performance.now()); });
    await expect(saved).toBeFocused();
    expect(app.requests.filter(item => item.method === "PATCH" && item.body.state === "finished")).toHaveLength(1);
  } finally { await page.evaluate(() => { window.requestAnimationFrame = window.nativeFrame; }); }
});

test("minimalist note save preserves focus deliberately moved outside its pending editor", async ({ page, app }) => {
  app.privateContext = true;
  let release;
  app.holdSave = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Add a note", exact: true }).click();
    await page.getByLabel("Note (optional)", { exact: true }).fill("Save without taking focus");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    const back = page.getByRole("link", { name: "Back to My Books", exact: true });
    await back.focus(); release();
    await expect(page.locator(".bv-workspace-memory .bv-private-text")).toHaveText("Save without taking focus");
    await expect(back).toBeFocused();
  } finally { release(); }
});
