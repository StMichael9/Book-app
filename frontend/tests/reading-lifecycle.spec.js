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
      const body = ["PATCH", "PUT", "POST"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/me/reading-capabilities") {
        if (state.oldBackend) return reply(404, {});
        return reply(200, { enabled: !state.disabled, writable: !state.readOnly, contract_version: 1,
          features: { reading_actions: true, private_context: Boolean(state.privateContext) } });
      }
      if (path === "/me/books") return reply(200, []);
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
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
        return reply(200, { entry: state.entries.get(id), current_attempt: id === 101 ? state.attempt : null, editions: [] });
      }
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: path.includes("/101/") ? [state.attempt] : [], next_cursor: null });
      const patch = path.match(/^\/me\/library\/(\d+)$/);
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
  await page.getByRole("button", { name: "Note and reaction", exact: true }).click();
  await expect(page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true })).toHaveValue("Preserved private memory");
  await expect(page.getByRole("button", { name: "Save reading memory", exact: true })).toBeDisabled();
  expect(app.requests.filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("M3 late context response cannot reopen a departed account's draft", async ({ page, app }) => {
  app.privateContext = true;
  let release;
  app.holdMemory = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/my-books/101");
    await page.getByRole("button", { name: "Add note and reaction (optional)", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "GET" && request.path.includes("reading-attempts")).length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    release();
    await expect(page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true })).toHaveCount(0);
  } finally { release(); }
});
