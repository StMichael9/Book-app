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
      if (path === "/me/reading-capabilities") {
        if (state.oldBackend) return reply(404, {});
        return reply(200, { enabled: !state.disabled, writable: !state.readOnly, contract_version: 1,
          features: { reading_actions: true, private_context: Boolean(state.privateContext), privacy_controls: Boolean(state.dataControls), reading_export: Boolean(state.dataControls) } });
      }
      if (path === "/me/books") return reply(200, []);
      if (path === "/me/reading-export") {
        if (state.holdExport) await state.holdExport;
        if (state.exportFails) return reply(503, { detail: "Temporary failure" });
        return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: state.exportTruncated ? '{"type":"metadata"}\n' : '{"type":"metadata","format_version":1}\n{"type":"complete","format_version":1,"counts":{"entry":2,"reading":1,"preference":0}}\n' });
      }
      if (path === "/me/home") return reply(200, { current_reads: state.currentReads || [], reading_count: state.currentReads?.length || 0, paused_count: state.pausedCount || 0 });
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

test("UI refactor catalogue and private library titles open personal workspaces", async ({ page, app }) => {
  app.entries.set(103, makeEntry(103, "paused", true));
  await page.goto("/my-books");
  await expect(page.getByRole("link", { name: "Reading fixture 101", exact: true })).toHaveAttribute("href", "/my-books/101");
  await expect(page.getByRole("link", { name: "Private fixture 103", exact: true })).toHaveAttribute("href", "/my-books/103");
  await expect(page.getByRole("link", { name: "About this book: Reading fixture 101", exact: true })).toHaveAttribute("href", "/book/101");
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

test("M3 confirmed removal distinguishes a reading from the whole book; failure and Cancel preserve data", async ({ page, app }) => {
  app.dataControls = true;
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Reading fixture 101");
  await expect(dialog).toContainText("Start date unknown");
  await expect(dialog).toContainText("other readings will stay");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(app.requests.filter(request => request.method === "DELETE")).toHaveLength(0);
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  app.removeFails = true;
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("couldn’t confirm the removal");
  expect(app.attempt).not.toBeNull();
  app.removeFails = false;
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "A new beginning", exact: true })).toBeVisible();
  expect(app.entries.get(101).is_owned).toBe(true);
  await openDisclosure(page, "Your data, your choice");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await expect(dialog).toContainText("every reading, note and reaction");
  await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
  expect(app.entries.has(101)).toBe(true);
  await openDisclosure(page, "Your data, your choice");
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
  await openDisclosure(page, "Your data, your choice");
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
  await openDisclosure(page, "Your data, your choice");
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
    await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
    await page.getByLabel("Percent complete", { exact: true }).fill("25");
    await page.getByLabel("Started on (optional)", { exact: true }).fill("2026-09-10");
    let release;
    app.holdWorkspace = new Promise(resolve => { release = resolve; });
    try {
      const before = app.requests.filter(request => request.path.endsWith("/reading")).length;
      await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: flag, exact: true }).click();
      await expect.poll(() => app.requests.filter(request => request.path.endsWith("/reading")).length).toBeGreaterThan(before);
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2026-09-10");
      release(); app.holdWorkspace = null;
      await expect(page.getByRole("heading", { name: "Reading fixture 101", exact: true })).toBeVisible();
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Your draft is still here");
      expect(app.requests.filter(request => request.path.includes("/reading-attempts/")).at(-1).body.expected_version).toBe(2);
      expect(app.attempt.progress_value).toBe(40);
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
      await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2026-09-10");
      await expect(page.getByRole("button", { name: "Finish book", exact: true })).toBeDisabled();
      await expect(page.getByText("Closing discards unsaved edits", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Close editor and reload", exact: true }).click();
      await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
      await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("40");
      await page.getByLabel("Percent complete", { exact: true }).fill("25");
      await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
      await expect(page.getByText("25%", { exact: true })).toBeVisible();
      expect(app.attempt.progress_value).toBe(25);
    } finally { release(); }
  });

  test(`${flag} failure preserves the draft and still permits a version-safe save`, async ({ page, app }) => {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
    await page.getByLabel("Percent complete", { exact: true }).fill("25");
    await page.getByLabel("Started on (optional)", { exact: true }).fill("2026-09-10");
    app.flagFails = true;
    await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: flag, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
    await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
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
  await page.getByRole("link", { name: "Your reading home", exact: true }).click();
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

test("drafts clear on route or account departure, not on workspace refresh", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await page.getByLabel("Percent complete", { exact: true }).fill("25");
  await page.evaluate(() => { history.pushState(null, "", "/my-books/102"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("heading", { name: "Reading fixture 102", exact: true })).toBeVisible();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveCount(0);
  await page.goBack();
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("40");
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveCount(0);
  expect(app.attempt.progress_value).toBe(40);
});

test("M3 private memory retains failed drafts, renders plain text and can be cleared", async ({ page, app }) => {
  app.privateContext = true;
  await page.goto("/my-books/101");
  await openDisclosure(page, "Only for you");
  await page.getByRole("button", { name: "Add note and reaction (optional)", exact: true }).click();
  const field = page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true });
  const note = '<img src=x onerror="window.noteExecuted=true">\nMy private memory 読書';
  await expect(field).toHaveAttribute("maxlength", "2000");
  await field.fill(note);
  await page.getByLabel("Reaction (optional)", { exact: true }).selectOption("liked");
  app.contextFails = true;
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(field).toHaveValue(note);
  app.contextFails = false;
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.locator(".bv-private-text")).toHaveText(note);
  await expect(page.getByText("Liked it", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.noteExecuted)).toBeUndefined();
  await expect(page.locator(".bv-private-text img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".bv-private-text")).toHaveText(note);
  await page.getByRole("button", { name: "View or edit reading memory", exact: true }).click();
  await field.fill("");
  await page.getByLabel("Reaction (optional)", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await openDisclosure(page, "Only for you");
  await expect(page.getByRole("button", { name: "Add note and reaction (optional)", exact: true })).toBeVisible();
  expect(app.attempt.note).toBeNull(); expect(app.attempt.reaction).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("My private memory");
});

test("M3 save reason is independent from reading memory and flags", async ({ page, app }) => {
  app.privateContext = true;
  app.attempt.note = "A separate reading memory";
  await page.goto("/my-books/101");
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
  await openDisclosure(page, "Only for you");
  await page.getByRole("button", { name: "Add note and reaction (optional)", exact: true }).click();
  const field = page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true });
  await field.fill("Unsaved reader context");
  await page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true }).click();
  await expect(page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("Unsaved reader context");
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(field).toHaveValue("Unsaved reader context");
  expect(app.requests.filter(request => request.method === "PATCH" && request.path.includes("reading-attempts")).at(-1).body.expected_version).toBe(2);
  expect(app.attempt.note).toBeUndefined();
});

test("M3 read-only history can show private memory without allowing saves", async ({ page, app }) => {
  app.privateContext = true; app.readOnly = true; app.attempt.note = "Preserved private memory";
  await page.goto("/my-books/101");
  await expect(page.getByText("Preserved private memory", { exact: true })).toBeVisible();
  await page.locator(".bv-reading-history").getByRole("button", { name: "View reading memory", exact: true }).click();
  await expect(page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true })).toHaveValue("Preserved private memory");
  await expect(page.getByRole("button", { name: "Save reading memory", exact: true })).toBeDisabled();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("M3 historical memory and correction identify the selected record and receive keyboard focus once", async ({ page, app }) => {
  app.privateContext = true;
  app.historicalAttempt = { ...app.attempt, id: "22222222-2222-4222-8222-222222222222", state: "finished",
    started_on: "2025-01-02", ended_on: "2025-02-03", note: "Earlier reading memory" };
  await page.goto("/my-books/101");
  const older = page.locator(".bv-reading-history li").last();
  const memory = older.getByRole("button", { name: "Note and reaction", exact: true });
  await memory.focus(); await memory.press("Enter");
  const identity = page.locator(".bv-reading-draft").getByRole("heading", { name: "Selected reading", exact: true });
  await expect(identity).toBeFocused();
  await expect(page.locator(".bv-reading-draft")).toContainText("Finished · 2025-01-02 → 2025-02-03");
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const field = page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true });
  await expect(field).toHaveValue("Earlier reading memory");
  await field.fill("Unsaved earlier memory");
  const want = page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true });
  await want.click();
  await expect(want).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("Unsaved earlier memory");
  await expect(identity).not.toBeFocused();
  await page.getByRole("button", { name: "Close editor and reload", exact: true }).click();
  await older.getByRole("button", { name: "Correct this reading", exact: true }).click();
  await expect(identity).toBeFocused();
  await expect(page.locator(".bv-reading-draft")).toContainText("Finished · 2025-01-02 → 2025-02-03");
  await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveValue("2025-01-02");
});

test("M3 empty read-only memory advertises viewing rather than adding context", async ({ page, app }) => {
  app.privateContext = true; app.readOnly = true;
  await page.goto("/my-books/101");
  await expect(page.getByRole("button", { name: "Add note and reaction (optional)", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View reading memory", exact: true }).first().click();
  await expect(page.getByText("No note or reaction is saved for this reading. Changes are temporarily paused.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save reading memory", exact: true })).toBeDisabled();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("M3 stopped reading deletion uses the familiar state label", async ({ page, app }) => {
  app.dataControls = true; app.attempt.state = "dnf"; app.entries.get(101).reading_state = "dnf";
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Stopped · Start date unknown");
  await expect(page.getByRole("dialog")).not.toContainText("dnf");
});

test("M3 late context response cannot reopen a departed account's draft", async ({ page, app }) => {
  app.privateContext = true;
  let release;
  app.holdMemory = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/my-books/101");
    await openDisclosure(page, "Only for you");
    await page.getByRole("button", { name: "Add note and reaction (optional)", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "GET" && request.path.includes("reading-attempts")).length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    release();
    await expect(page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true })).toHaveCount(0);
  } finally { release(); }
});
