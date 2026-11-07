import { test as base, expect } from "@playwright/test";

const stamp = "2026-10-01T00:00:00Z";
const book = id => ({ id, title: `M4 fixture ${id}`, authors: [], cover_image_url: null, page_count: 80 });
const entry = (id, privateBook = false) => ({ id, book_id: privateBook ? null : id, book: privateBook ? null : book(id),
  private_title: privateBook ? "Private queued reading" : null, private_author: null, is_owned: privateBook,
  is_wanted: id !== 1, version: 1, save_note: null, reading_state: id === 1 ? "reading" : null, created_at: stamp, updated_at: stamp });
const attempt = (id, state = "reading") => ({ id, state, started_on: null, ended_on: null, progress_unit: null,
  progress_value: null, total_pages: null, edition_id: null, edition_source_id: null, edition_format: null,
  note: null, reaction: null, created_at: stamp, updated_at: stamp });

const REGION = "Can’t decide?";
async function adjust(page) {
  const details = page.locator("details.bv-adjust");
  await expect(async () => { if (!(await details.evaluate(node => node.open))) await details.locator("summary").click(); await expect(details).toHaveJSProperty("open", true, { timeout: 1000 }); }).toPass();
}
async function openNew(page) {
  await page.goto("/home");
  await page.getByRole("button", { name: "Something new", exact: true }).click();
  const region = page.getByRole("region", { name: REGION });
  await expect(region.getByRole("button", { name: /^Start reading/ }).first()).toBeVisible();
  return region;
}

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entries: new Map([[1, entry(1)], [2, entry(2)], [3, entry(3, true)]]),
      attempts: new Map([[1, attempt("11111111-1111-4111-8111-111111111111")]]), authenticated: true, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
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
        const eligible = source === "catalogue" ? Array.from({ length: state.catalogueCount || 1 }, (_, index) => ({ key: `book:${4 + index}`, entry_id: null, version: null, book: book(4 + index), is_owned: false, is_wanted: false, revisit: false, reasons: [{ code: "catalogue" }] })) : [...state.entries.values()].filter(item => item.is_wanted && !["reading", "paused"].includes(state.attempts.get(item.id)?.state)).map(item => ({
          key: `${item.book ? "book" : "entry"}:${item.id}`, entry_id: item.id, version: item.version, book: item.book,
          private_title: item.private_title, private_author: item.private_author, is_owned: item.is_owned, is_wanted: true,
          revisit: Boolean(state.attempts.get(item.id)), reasons: [{ code: "want" }] }));
        const filtered = eligible.filter(item => (!url.searchParams.has("max_pages") || item.book?.page_count <= Number(url.searchParams.get("max_pages"))) &&
          (url.searchParams.get("owned_only") !== "true" || item.is_owned));
        const remaining = filtered.filter(item => !url.searchParams.getAll("exclude").includes(item.key));
        const payload = { source, session_id: url.searchParams.get("session_id"), rotation: Number(url.searchParams.get("rotation")),
          items: structuredClone(remaining.slice(0, 3)), eligible_count: filtered.length, remaining_count: remaining.length,
          interests: [{ id: 1, name: "fantasy", count: 1 }, { id: 2, name: "historical-fiction", count: 7778 }], known_page_count: filtered.filter(item => item.book).length };
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
      if (route.request().method() === "GET" && /^\/me\/(library|up-next|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library-imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      state.errors.push(`Unhandled ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("M4 finish: collapsing choices cannot hide a committed pending start and completion remains visible", async ({ page, app }) => {
  await page.goto("/my-books/1");
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Explore more choices", exact: true }).click();
  const choices = page.getByRole("region", { name: "Choose your next read" });
  const skip = choices.getByRole("button", { name: "Back to this reading", exact: true });
  await expect(skip).toBeEnabled();
  let release;
  app.holdCommittedStart = new Promise(done => { release = done; });
  try {
    await choices.getByRole("button", { name: "Start reading M4 fixture 2", exact: true }).click();
    await expect.poll(() => app.attempts.get(2)?.state).toBe("reading");
    await expect(skip).toBeDisabled();
    await expect(page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true })).toBeVisible();
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
  // The finish is acknowledged quietly; the same controller collapses back to one Want book.
  await expect(page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Choose your next read" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Explore more choices", exact: true }).click();
  await expect(page.getByRole("button", { name: "My Want to read books", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Choose your next read" }).getByRole("article")).toHaveCount(2);
  expect(app.requests.filter(r => r.path === "/books/1")).toHaveLength(1);
  expect(new Set(app.requests.filter(r => r.path === "/me/next-read").map(r => r.params.session_id)).size).toBe(1);
  expect(app.requests.filter(r => r.method === "PATCH" && r.body.state === "finished")).toHaveLength(1);
  await page.getByRole("button", { name: "Back to this reading", exact: true }).click();
  await expect(page.getByRole("region", { name: "Next after this" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true })).toBeVisible();
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
  const finished = page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true });
  await expect(finished).toBeFocused();
  await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
  expect(await page.locator(".bv-finish-moment").evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector(".bv-workspace-actions")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`v3-ui-finish-${theme}-${width}.png`), fullPage: true });
  }
  expect(app.requests.filter(item => item.method === "PATCH" && item.body.state === "finished")).toHaveLength(1);
});

test("M4 Home folds Next Read into Can't decide?; viewing and adjusting never writes", async ({ page, app }) => {
  const choices = await openNew(page);
  await expect(choices.getByRole("heading", { name: "M4 fixture 4", exact: true })).toBeVisible();
  await expect(choices.getByText("Books you don’t have yet", { exact: true })).toBeVisible();
  await expect(choices.getByText("Something new to explore.")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Choose your next read" })).toHaveCount(0);
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`Home Something new keeps the card layout without overflow; theme=${theme}`, async ({ page, app }) => {
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  app.catalogueCount = 3;
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const next = await openNew(page);
    await expect(next.getByRole("article")).toHaveCount(3);
    await expect(next.getByRole("button", { name: "Start reading M4 fixture 4", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`home-something-new-${theme}-${width}.png`), fullPage: true });
  }
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
});

test("Adjust is genre names and a length choice, with one Show books and one Reset", async ({ page, app }) => {
  const choices = await openNew(page);
  await adjust(page);
  const form = page.locator(".bv-adjust-form");
  await expect(form.getByRole("radio")).toHaveCount(1 + 2 + 4);
  await expect(form.getByText("Historical fiction", { exact: true })).toBeVisible();
  await expect(form.getByText("Fantasy", { exact: true })).toBeVisible();
  await expect(form).not.toContainText(/\d{2,}|historical-fiction|\(/);
  await expect(page.getByText("Include my Want to read")).toHaveCount(0);
  await expect(page.getByText("At most this many pages")).toHaveCount(0);
  await expect(form.getByRole("button")).toHaveText(["Show books", "Reset"]);
  await form.getByRole("radio", { name: "Fantasy" }).check({ force: true });
  await form.getByRole("radio", { name: "Short" }).check({ force: true });
  await form.getByRole("button", { name: "Show books", exact: true }).click();
  await expect.poll(() => app.requests.filter(item => item.path === "/me/next-read").at(-1).params).toMatchObject({ interest_id: "1", max_pages: "249", source: "catalogue" });
  await adjust(page);
  await expect(form.getByRole("radio", { name: "Fantasy" })).toBeChecked();
  await expect(form.getByRole("radio", { name: "Short" })).toBeChecked();
  await form.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => app.requests.filter(item => item.path === "/me/next-read").at(-1).params.interest_id).toBeUndefined();
  await adjust(page);
  await expect(form.getByRole("radio", { name: "Any" }).first()).toBeChecked();
  await expect(choices.getByRole("article")).toHaveCount(1);
});

test("Try again keeps the old cards, dimmed, and the page never shrinks while the new ones load", async ({ page, app }) => {
  app.catalogueCount = 6;
  const choices = await openNew(page);
  const height = () => page.locator("main").evaluate(node => node.getBoundingClientRect().height);
  const before = await height();
  let release;
  app.holdChoices = new Promise(resolve => { release = resolve; });
  await page.evaluate(() => { const main = document.querySelector("main"); window.__heights = []; window.__timer = setInterval(() => window.__heights.push(main.getBoundingClientRect().height), 25); });
  await choices.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".bv-next-panel")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".bv-picks--busy")).toHaveCount(1);
  await expect(choices.getByRole("article")).toHaveCount(3);
  await page.waitForTimeout(400);
  release();
  await expect(page.locator(".bv-next-panel")).not.toHaveAttribute("aria-busy", "true");
  await expect(choices.getByRole("heading", { name: "M4 fixture 7", exact: true })).toBeVisible();
  const heights = await page.evaluate(() => { clearInterval(window.__timer); return window.__heights; });
  expect(heights.length).toBeGreaterThan(8);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(before - 1);
  expect(Math.abs((await height()) - before)).toBeLessThan(40);
});

test("cards repeat no reason line and every Start button reads Start reading", async ({ page, app }) => {
  app.catalogueCount = 3;
  const choices = await openNew(page);
  await expect(choices.getByRole("button", { name: /^Start reading M4 fixture [456]$/ })).toHaveText(["Start reading", "Start reading", "Start reading"]);
  await expect(choices.getByText("Something new to explore.")).toHaveCount(0);
});

for (const malformed of [false, true]) test(`M4 ${malformed ? "malformed" : "failed"} choices do not undo a committed finish; the preview says so quietly`, async ({ page, app }) => {
  await page.goto("/my-books/1");
  app.choicesFail = !malformed; app.malformed = malformed;
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You finished M4 fixture 1.", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Next after this" })).toContainText("Your reading is unchanged");
  expect(app.attempts.get(1).state).toBe("finished");
  expect(app.requests.filter(item => item.method === "PATCH")).toHaveLength(1);
  await expect(page.getByRole("region", { name: "Choose your next read" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^You finished / })).toHaveCount(0);
});

test("M4 failed finish never opens next choices", async ({ page, app }) => {
  app.finishFails = true;
  await page.goto("/my-books/1");
  // The quiet workspace preview is valid before Finish. A rejected Finish
  // must neither refetch choices nor promote that preview to a finish flow.
  const preview = page.getByRole("region", { name: "Next after this", exact: true });
  await expect(preview.getByRole("link", { name: "Open your book", exact: true })).toBeVisible();
  const requestsBeforeFinish = app.requests.filter(item => item.path === "/me/next-read").length;
  expect(requestsBeforeFinish).toBe(1);
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(app.requests.filter(item => item.path === "/me/next-read")).toHaveLength(requestsBeforeFinish);
  await expect(page.getByRole("heading", { name: /^You finished / })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Choose your next read", exact: true })).toHaveCount(0);
  await expect(preview).toBeVisible();
  expect(app.attempts.get(1).state).toBe("reading");
});

test("M4 explicit start retries a lost response without duplicate attempts", async ({ page, app }) => {
  app.loseStartResponse = true;
  await openNew(page);
  const start = page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true });
  await start.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/my-books\/4$/);
  const puts = app.requests.filter(item => item.method === "PUT" && item.path.startsWith("/me/reading-attempts/"));
  expect(puts).toHaveLength(1);
  expect(puts[0].body.started_via).toBe("next_read");
});

test("M4 a book that changed under a choice cannot silently start a reread", async ({ page, app }) => {
  await openNew(page);
  await expect(page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true })).toBeVisible();
  app.entries.set(4, { ...entry(4), is_wanted: false, version: 9 });
  app.attempts.set(4, attempt("44444444-4444-4444-8444-444444444444", "finished"));
  await page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This book changed");
  expect(app.requests.filter(item => item.method === "PUT" && item.path.startsWith("/me/reading-attempts/"))).toHaveLength(0);
});

test("M4 read-only and older backends never expose a writable or unsupported next flow", async ({ page, app }) => {
  app.readOnly = true;
  await openNew(page);
  await expect(page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true })).toBeDisabled();
  await expect(page.getByText("You can view choices. Starting a reading is temporarily paused.", { exact: true })).toBeVisible();
  app.oldM3 = true;
  const before = app.requests.filter(item => item.path === "/me/next-read").length;
  await page.reload();
  await expect(page.getByRole("button", { name: "Something new", exact: true })).toHaveCount(0);
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  expect(app.requests.filter(item => item.path === "/me/next-read")).toHaveLength(before);
});

test("M4 different choices preserve filters and bounded session exclusions without changing shelves", async ({ page, app }) => {
  app.catalogueCount = 7;
  const choices = await openNew(page);
  await adjust(page);
  await page.locator(".bv-adjust-form").getByRole("radio", { name: "Short" }).check({ force: true });
  await page.locator(".bv-adjust-form").getByRole("button", { name: "Show books", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(3);
  const first = app.requests.filter(item => item.path === "/me/next-read").at(-1);
  await choices.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(choices.getByRole("heading", { name: "M4 fixture 7", exact: true })).toBeVisible();
  const rotated = app.requests.filter(item => item.path === "/me/next-read").at(-1);
  expect(rotated.params).toMatchObject({ max_pages: "249", session_id: first.params.session_id, rotation: "1" });
  expect(rotated.excludes).toEqual(["book:4", "book:5", "book:6"]);
  expect(app.requests.filter(item => ["PUT", "PATCH"].includes(item.method))).toHaveLength(0);
});

test("M4 explicit catalogue start uses the existing entry and attempt contracts without inventing ownership", async ({ page, app }) => {
  await openNew(page);
  await page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books\/4$/);
  expect(app.entries.get(4).is_owned).toBe(false);
  expect(app.entries.get(4).is_wanted).toBe(false);
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(2);
  expect(app.requests.filter(item => item.method === "PUT").at(-1).body).toMatchObject({ entry_id: 4, started_via: "next_read" });
});

test("M4 pending start blocks conflicting choice controls and keeps one command", async ({ page, app }) => {
  let release;
  app.catalogueCount = 2;
  app.holdWorkspace = new Promise(resolve => { release = resolve; });
  try {
    await openNew(page);
    const button = page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true });
    await button.click();
    await expect(button).toBeDisabled();
    await adjust(page);
    await expect(page.getByRole("button", { name: "Show books", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start reading M4 fixture 5", exact: true })).toBeDisabled();
    release();
    await expect(page).toHaveURL(/\/my-books\/4$/);
    expect(app.requests.filter(item => item.path.startsWith("/me/reading-attempts/"))).toHaveLength(1);
  } finally { release(); }
});

test("M4 late private choices cannot reappear after account departure", async ({ page, app }) => {
  let release;
  app.holdChoices = new Promise(resolve => { release = resolve; });
  try {
    await page.goto("/home");
    await page.getByRole("button", { name: "Something new", exact: true }).click();
    await expect.poll(() => app.requests.filter(item => item.path === "/me/next-read").length).toBe(1);
    app.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
    await expect(page).toHaveURL(/\/login/);
    release();
    await expect(page.getByText("Private queued reading", { exact: true })).toHaveCount(0);
    expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  } finally { release(); }
});

test.describe("Next Read start dates use the reader's local calendar day", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  // 23:59:30 on 22 Oct in Los Angeles is already 23 Oct in UTC.
  test("Start reading sends today's local date and a retry after midnight sends the same body", async ({ page, app }) => {
    await page.clock.setFixedTime(new Date("2026-10-22T23:59:30-07:00"));
    app.startFails = true;
    await openNew(page);
    const start = page.getByRole("button", { name: "Start reading M4 fixture 4", exact: true });
    await start.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.clock.setFixedTime(new Date("2026-10-23T00:00:30-07:00"));
    app.startFails = false;
    await start.click();
    await expect.poll(() => app.requests.filter(item => item.method === "PUT" && item.path.startsWith("/me/reading-attempts/")).length).toBe(2);
    const [first, second] = app.requests.filter(item => item.method === "PUT" && item.path.startsWith("/me/reading-attempts/"));
    expect(first.body).toMatchObject({ started_via: "next_read", started_on: "2026-10-22" });
    expect(second.path).toBe(first.path);
    expect(second.body).toEqual(first.body);
  });
});

// Design review: NEXT_SHOTS=1 writes Home with "Something new" and Adjust open to ../.bv-shots/home.
for (const theme of ["light", "dark"]) for (const width of [390, 1440]) test(`shot: Something new with Adjust open ${theme} ${width}`, async ({ page, app: _app }) => {
  test.skip(!process.env.NEXT_SHOTS, "design review only");
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  const choices = await openNew(page);
  await adjust(page);
  await expect(choices.getByRole("article").first()).toBeVisible();
  // The skip link is only ever visible on keyboard focus: off screen at rest, and nothing here leaves it focused.
  expect(await page.evaluate(() => ({ focused: document.activeElement?.classList.contains("bv-skip"), bottom: document.querySelector(".bv-skip").getBoundingClientRect().bottom }))).toMatchObject({ focused: false });
  expect(await page.evaluate(() => document.querySelector(".bv-skip").getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `../.bv-shots/home-polish/adjust-${width}-${theme}.png`, fullPage: true });
});
