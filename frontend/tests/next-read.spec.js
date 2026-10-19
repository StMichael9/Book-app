import { test as base, expect } from "@playwright/test";

const stamp = "2026-10-01T00:00:00Z";
const book = id => ({ id, title: `M4 fixture ${id}`, authors: [], cover_image_url: null, page_count: 80 });
const entry = (id, privateBook = false) => ({ id, book_id: privateBook ? null : id, book: privateBook ? null : book(id),
  private_title: privateBook ? "Private queued reading" : null, private_author: null, is_owned: privateBook,
  is_wanted: id !== 1, version: 1, save_note: null, reading_state: id === 1 ? "reading" : null, created_at: stamp, updated_at: stamp });
const attempt = (id, state = "reading") => ({ id, state, started_on: null, ended_on: null, progress_unit: null,
  progress_value: null, total_pages: null, edition_id: null, edition_source_id: null, edition_format: null,
  note: null, reaction: null, created_at: stamp, updated_at: stamp });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entries: new Map([[1, entry(1)], [2, entry(2)], [3, entry(3, true)]]),
      attempts: new Map([[1, attempt("11111111-1111-4111-8111-111111111111")]]), authenticated: true, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice(9), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, params: Object.fromEntries(url.searchParams), excludes: url.searchParams.getAll("exclude") });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(state.authenticated ? 200 : 401, {});
      if (path === "/auth/login") { state.authenticated = true; return reply(200, {}); }
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: !state.readOnly,
        contract_version: 1, features: { reading_actions: true, next_read: !state.oldM3 } });
      if (/^\/books\/\d+$/.test(path)) return reply(200, { ...book(Number(path.split("/").at(-1))), description: "Existing catalogue details.", tags: [] });
      if (path === "/me/home") return reply(200, { current_reads: [...state.attempts].filter(([, item]) => item.state === "reading").map(([id, item]) => ({ entry: state.entries.get(id), attempt: item })), reading_count: state.attempts.size, paused_count: 0 });
      if (path === "/me/next-read") {
        if (state.choicesFail) return reply(503, {});
        if (state.malformed) return reply(200, { items: "not an array" });
        const source = url.searchParams.get("source");
        const eligible = source === "catalogue" ? [{ key: "book:4", entry_id: null, version: null, book: book(4), is_owned: false, is_wanted: false, revisit: false, reasons: [{ code: "catalogue" }] }] : [...state.entries.values()].filter(item => item.is_wanted && !["reading", "paused"].includes(state.attempts.get(item.id)?.state)).map(item => ({
          key: `${item.book ? "book" : "entry"}:${item.id}`, entry_id: item.id, version: item.version, book: item.book,
          private_title: item.private_title, private_author: item.private_author, is_owned: item.is_owned, is_wanted: true,
          revisit: Boolean(state.attempts.get(item.id)), reasons: [{ code: "want" }] }));
        const filtered = eligible.filter(item => (!url.searchParams.has("max_pages") || item.book?.page_count <= Number(url.searchParams.get("max_pages"))) &&
          (url.searchParams.get("owned_only") !== "true" || item.is_owned));
        const remaining = filtered.filter(item => !url.searchParams.getAll("exclude").includes(item.key));
        const payload = { source, session_id: url.searchParams.get("session_id"), rotation: Number(url.searchParams.get("rotation")),
          items: structuredClone(remaining.slice(0, 3)), eligible_count: filtered.length, remaining_count: remaining.length,
          interests: [{ id: 1, name: "fantasy", count: 1 }], known_page_count: filtered.filter(item => item.book).length };
        if (state.holdChoices) await state.holdChoices;
        return reply(200, payload);
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: state.entries.get(id)?.id ?? null,
        is_owned: state.entries.get(id)?.is_owned ?? false, is_wanted: state.entries.get(id)?.is_wanted ?? false, version: state.entries.get(id)?.version ?? null })) });
      const ensure = path.match(/^\/me\/library\/books\/(\d+)$/);
      if (ensure && method === "PUT") {
        const saved = { ...entry(Number(ensure[1])), is_wanted: body.is_wanted };
        state.entries.set(saved.id, saved); return reply(200, saved);
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) {
        if (state.holdWorkspace) await state.holdWorkspace;
        const id = Number(workspace[1]);
        return reply(200, { entry: state.entries.get(id), current_attempt: state.attempts.get(id) || null, editions: [] });
      }
      const history = path.match(/^\/me\/library\/(\d+)\/attempts$/);
      if (history) return reply(200, { items: state.attempts.has(Number(history[1])) ? [state.attempts.get(Number(history[1]))] : [], next_cursor: null });
      const reading = path.match(/^\/me\/reading-attempts\/([^/]+)$/);
      if (reading && method === "PATCH") {
        if (state.finishFails) return reply(503, {});
        const found = [...state.attempts].find(([, item]) => item.id === reading[1]);
        Object.assign(found[1], { state: body.state }); state.entries.get(found[0]).version += 1;
        return reply(200, { entry: state.entries.get(found[0]), attempt: found[1] });
      }
      if (reading && method === "PUT") {
        if (state.startFails) return reply(503, {});
        const saved = state.entries.get(body.entry_id);
        saved.version += 1; saved.is_wanted = false;
        const created = attempt(reading[1]); state.attempts.set(saved.id, created);
        if (state.holdCommittedStart) await state.holdCommittedStart;
        if (state.loseStartResponse) { state.loseStartResponse = false; return route.abort("failed"); }
        return reply(200, { entry: saved, attempt: created });
      }
      state.errors.push(`Unhandled ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("M4 finish skip cannot hide a committed pending start and completion remains visible", async ({ page, app }) => {
  await page.goto("/my-books/1");
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  const choices = page.getByRole("region", { name: "Choose your next read" });
  const skip = choices.getByRole("button", { name: "Not now", exact: true });
  await expect(skip).toBeEnabled();
  let release;
  app.holdCommittedStart = new Promise(done => { release = done; });
  try {
    await choices.getByRole("button", { name: "Start reading M4 fixture 2", exact: true }).click();
    await expect.poll(() => app.attempts.get(2)?.state).toBe("reading");
    await expect(skip).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toBeVisible();
    release();
    await expect(page).toHaveURL(/\/my-books\/2$/);
    await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
    expect(app.requests.filter(item => item.method === "PUT" && item.path.includes("reading-attempts"))).toHaveLength(1);
  } finally { release(); }
});

test("editorial workspace preview shares choices and a new finish returns to Want without a duplicate module", async ({ page, app }) => {
  await page.goto("/my-books/1");
  await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
  const before = app.requests.filter(r => r.path === "/me/next-read").length;
  await page.getByRole("button", { name: "Explore more choices", exact: true }).click();
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(2);
  expect(app.requests.filter(r => r.path === "/me/next-read")).toHaveLength(before);
  await page.getByRole("button", { name: "Explore something new", exact: true }).click();
  await expect(page.getByRole("heading", { name: "M4 fixture 4", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Next after this" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "My Want books", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(2);
  expect(app.requests.filter(r => r.path === "/books/1")).toHaveLength(1);
  expect(app.requests.filter(r => r.method === "PATCH" && r.body.state === "finished")).toHaveLength(1);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("region", { name: "Next after this" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeFocused();
});

test("editorial workspace excludes its current book and returning from catalogue restores a truthful Want preview", async ({ page, app }) => {
  app.entries.get(1).is_wanted = true; app.attempts.delete(1);
  await page.goto("/my-books/1");
  const preview = page.getByRole("region", { name: "Next after this" });
  await expect(preview.getByRole("heading", { name: "M4 fixture 2", exact: true })).toBeVisible();
  expect(app.requests.find(r => r.path === "/me/next-read").excludes).toEqual(["book:1"]);
  await page.getByRole("button", { name: "Explore more choices", exact: true }).click();
  await page.getByRole("button", { name: "Explore something new", exact: true }).click();
  await expect(page.getByRole("heading", { name: "M4 fixture 4", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to this reading", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "M4 fixture 2", exact: true })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "M4 fixture 4", exact: true })).toHaveCount(0);
  expect(app.requests.filter(r => r.path === "/me/next-read").at(-1).params.source).toBe("want");
  expect(app.requests.filter(r => ["PUT", "PATCH"].includes(r.method))).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`UI refactor finish choices precede secondary workspace actions; theme=${theme}`, async ({ page, app }) => {
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books/1");
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  const finished = page.getByRole("heading", { name: "Reading saved.", exact: true });
  await expect(finished).toBeFocused();
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(2);
  expect(await page.locator(".bv-finish-choices").evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector(".bv-workspace-actions")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`v3-ui-finish-${theme}-${width}.png`), fullPage: true });
  }
  expect(app.requests.filter(item => item.method === "PATCH" && item.body.state === "finished")).toHaveLength(1);
});

test("M4 Home is shelf-first, short and private; viewing and switching modes never writes", async ({ page, app }) => {
  await page.goto("/home");
  const choices = page.getByRole("region", { name: "Choose your next read" });
  await expect(choices.getByRole("article")).toHaveCount(2);
  await expect(choices.getByRole("heading", { name: "Private queued reading", exact: true })).toBeVisible();
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
  await choices.getByRole("button", { name: "Explore something new", exact: true }).click();
  await expect(choices.getByRole("heading", { name: "M4 fixture 4", exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: "Explore something new", exact: true })).toHaveAttribute("aria-pressed", "true");
  await choices.getByRole("button", { name: "My Want books", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(2);
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`Home reading desk and compact next choices remain distinct from the collection; theme=${theme}`, async ({ page, app }) => {
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    const desk = page.getByRole("region", { name: "Your current reading", exact: true });
    const next = page.getByRole("region", { name: "Choose your next read", exact: true });
    await expect(desk.getByRole("link", { name: "Continue your reading: M4 fixture 1" })).toBeVisible();
    await expect(next.getByRole("article")).toHaveCount(2);
    await expect(next.getByRole("button", { name: "Start reading Private queued reading", exact: true })).toBeEnabled();
    const currentBox = await desk.boundingBox(), nextBox = await next.boundingBox();
    if (width === 1440) expect(nextBox.x).toBeGreaterThan(currentBox.x + currentBox.width);
    else expect(nextBox.y).toBeGreaterThan(currentBox.y + currentBox.height);
    await expect(page.locator(".bv-book-grid")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`home-with-choices-${theme}-${width}.png`), fullPage: true });
  }
  const continueReading = page.getByRole("link", { name: "Continue your reading: M4 fixture 1", exact: true });
  await continueReading.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/my-books\/1$/);
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
});

test("M4 controls preserve intent across sources, explain unknown metadata and clear unsaved fields", async ({ page, app }) => {
  await page.goto("/home");
  await page.getByText("Refine choices (optional)", { exact: true }).click();
  await page.getByLabel("At most this many pages (optional)", { exact: true }).fill("100");
  await page.getByLabel("Subject (optional)", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Update choices", exact: true }).click();
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Explore something new", exact: true }).click();
  await expect(page.getByRole("heading", { name: "M4 fixture 4", exact: true })).toBeVisible();
  expect(app.requests.filter(item => item.path === "/me/next-read").at(-1).params).toMatchObject({ max_pages: "100", interest_id: "1" });
  await page.getByText("Refine choices (optional)", { exact: true }).click();
  await expect(page.getByLabel("At most this many pages (optional)", { exact: true })).toHaveValue("100");
  await page.getByRole("button", { name: "Clear filters and start over", exact: true }).click();
  await expect.poll(() => app.requests.filter(item => item.path === "/me/next-read").at(-1).params.max_pages).toBeUndefined();
  await page.getByText("Refine choices (optional)", { exact: true }).click();
  await page.getByLabel("At most this many pages (optional)", { exact: true }).fill("222");
  await page.getByRole("button", { name: "Clear filters and start over", exact: true }).click();
  await expect(page.getByLabel("At most this many pages (optional)", { exact: true })).toHaveValue("");
});

for (const malformed of [false, true]) test(`M4 ${malformed ? "malformed" : "failed"} choices do not undo a committed finish; skip is quiet`, async ({ page, app }) => {
  await page.goto("/my-books/1");
  app.choicesFail = !malformed; app.malformed = malformed;
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("any saved finish are unchanged");
  expect(app.attempts.get(1).state).toBe("finished");
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(1);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("region", { name: "Choose your next read" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toHaveCount(0);
});

test("M4 failed finish never opens next choices", async ({ page, app }) => {
  app.finishFails = true;
  await page.goto("/my-books/1");
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(app.requests.filter(item => item.path === "/me/next-read")).toHaveLength(0);
  expect(app.attempts.get(1).state).toBe("reading");
});

test("M4 explicit private start retries a lost response without duplicate attempts", async ({ page, app }) => {
  app.loseStartResponse = true;
  await page.goto("/home");
  const start = page.getByRole("button", { name: "Start reading Private queued reading", exact: true });
  await start.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/my-books\/3$/);
  expect(app.requests.filter(item => item.method === "PUT" && item.path.startsWith("/me/reading-attempts/"))).toHaveLength(1);
  expect(app.attempts.size).toBe(2);
  expect(app.requests.find(item => item.method === "PUT").body.started_via).toBe("next_read");
});

test("M4 stale choice cannot silently create a reread", async ({ page, app }) => {
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Start reading M4 fixture 2", exact: true })).toBeVisible();
  app.entries.get(2).version = 9; app.entries.get(2).is_wanted = false;
  app.attempts.set(2, attempt("22222222-2222-4222-8222-222222222222", "finished"));
  await page.getByRole("button", { name: "Start reading M4 fixture 2", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This book changed");
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(0);
});

test("M4 read-only and older backends never expose a writable or unsupported next flow", async ({ page, app }) => {
  app.readOnly = true;
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Start reading M4 fixture 2", exact: true })).toBeDisabled();
  await expect(page.getByText("You can view choices. Starting a reading is temporarily paused.", { exact: true })).toBeVisible();
  app.oldM3 = true;
  const before = app.requests.filter(item => item.path === "/me/next-read").length;
  await page.reload();
  await expect(page.getByRole("region", { name: "Choose your next read" })).toHaveCount(0);
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  expect(app.requests.filter(item => item.path === "/me/next-read")).toHaveLength(before);
});

test("M4 different choices preserve filters and bounded session exclusions without changing shelves", async ({ page, app }) => {
  for (const id of [4, 5, 6]) app.entries.set(id, { ...entry(id), is_owned: true });
  await page.goto("/home");
  const choices = page.getByRole("region", { name: "Choose your next read" });
  await choices.getByText("Refine choices (optional)", { exact: true }).click();
  await page.getByLabel("Only books I marked Own", { exact: true }).check();
  await choices.getByRole("button", { name: "Update choices", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(3);
  const first = app.requests.filter(item => item.path === "/me/next-read").at(-1);
  await choices.getByRole("button", { name: "Show different choices", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(1);
  const rotated = app.requests.filter(item => item.path === "/me/next-read").at(-1);
  expect(rotated.params).toMatchObject({ owned_only: "true", session_id: first.params.session_id, rotation: "1" });
  expect(rotated.excludes).toEqual(["entry:3", "book:4", "book:5"]);
  await choices.getByRole("button", { name: "Start choices over", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(3);
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
  expect([...app.entries.values()].filter(item => item.id !== 1).every(item => item.is_wanted)).toBe(true);
});

test("M4 explicit catalogue start uses the existing entry and attempt contracts without inventing ownership", async ({ page, app }) => {
  await page.goto("/home");
  await page.getByRole("button", { name: "Explore something new", exact: true }).click();
  await page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/4$/);
  expect(app.entries.get(4).is_owned).toBe(false);
  expect(app.entries.get(4).is_wanted).toBe(false);
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(2);
  expect(app.requests.filter(item => item.method === "PUT").at(-1).body).toMatchObject({ entry_id: 4, started_via: "next_read" });
});

test("M4 pending start blocks conflicting choice controls and keeps one command", async ({ page, app }) => {
  let release;
  app.holdWorkspace = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/home");
    const button = page.getByRole("button", { name: "Start reading M4 fixture 2", exact: true });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(page.getByRole("button", { name: "Explore something new", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start reading Private queued reading", exact: true })).toBeDisabled();
    release();
    await expect(page).toHaveURL(/\/my-books\/2$/);
    expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(1);
  } finally { release(); }
});

test("M4 late private choices cannot reappear after account departure", async ({ page, app }) => {
  let release;
  app.holdChoices = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/home");
    await expect.poll(() => app.requests.filter(item => item.path === "/me/next-read").length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page).toHaveURL(/\/login/);
    release();
    await expect(page.getByText("Private queued reading", { exact: true })).toHaveCount(0);
    expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  } finally { release(); }
});
