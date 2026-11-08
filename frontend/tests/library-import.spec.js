import { createHash } from "node:crypto";
import { shootMatrix, shotsEnabled } from "./support/shots.js";
import { test as base, expect } from "@playwright/test";

// Synthetic browser/API fixtures exercise local file parsing, NOT native-export
// acceptance or live database behavior. Those have separate verification gates.
const root = "/me/library-imports";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { enabled: true, requests: [], rows: [], errors: [], run: null, batches: new Map() };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
      if (url.origin !== new URL(baseURL).origin) { state.errors.push("Unexpected external request"); return route.abort(); }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body, receivedAt: Date.now() });
      const reply = json => route.fulfill({ status: 200, json });
      if (path === "/auth/refresh") return reply({});
      if (path === "/me/reading-capabilities") return reply({ enabled: true, writable: true, contract_version: 1,
        features: { reading_actions: true, library_import: state.enabled } });
      if (path === "/me/library") return reply({ items: [], counts: { all: 0, own: 0, want: 0 }, total: 0, next_cursor: null });
      if (path === "/me/preferences") return reply([]);
      if (path === `${root}/inspect`) {
        const title = body.headers.indexOf("title"), author = body.headers.indexOf("author");
        return reply({ source: "generic", mapping: { title, ...(author >= 0 ? { author } : {}) }, ambiguous: {}, missing_identity: title < 0, ignored_columns: [] });
      }
      if (path === `${root}/forget-removed-markers`) return reply({ removed_markers: 2, removed_read_markers: 3 });
      if (path === root && method === "GET") return reply({ items: state.run ? [state.run] : [] });
      if (path === root && method === "POST") {
        if (state.failStart) return route.fulfill({ status: 500, json: { detail: "boom" } });
        if (state.conflictOnStart) { state.conflictOnStart = false; state.run = { id: "active-run", source: "goodreads", phase: "preview_ready", row_count: 20, revision: 2, manifest_hash: "m", summary: {}, expires_at: "2026-11-05T00:00:00Z" }; return route.fulfill({ status: 409, json: { detail: { code: "active_import_exists" } } }); }
        if (state.run?.id === body.id) return reply(state.run);
        state.run = { id: body.id, source: body.source === "paste" ? "paste" : "generic", scope: "default", phase: "uploading", row_count: 0, batch_count: 0,
          analyze_cursor: 0, group_cursor: 0, revision: 1, manifest_hash: null, summary: {},
          expires_at: "2026-10-23T00:00:00Z", report_expires_at: "2026-11-15T00:00:00Z", upload_config: { headers: body.headers, mapping: body.mapping || {}, status_map: {}, encoding: body.encoding || "UTF-8" } };
        return reply(state.run);
      }
      if (state.run && path === `${root}/${state.run.id}`) return reply(state.run);
      if (path.includes("/batches/")) {
        const ordinal = Number(path.split("/").at(-1)), batchHash = hash(body.rows);
        if (state.batches.has(ordinal)) {
          if (state.batches.get(ordinal) !== batchHash) return route.fulfill({ status: 409, json: { detail: { code: "batch_content_changed" } } });
          return reply({ batch_hash: batchHash, status: state.run });
        }
        state.batches.set(ordinal, batchHash);
        state.rows.push(...body.rows);
        state.run.row_count += body.rows.length; state.run.batch_count += 1;
        return reply({ batch_hash: batchHash, status: state.run });
      }
      if (path.endsWith("/finalize-upload")) {
        state.run.phase = "analyzing"; state.run.manifest_hash = body.manifest_hash;
        return reply(state.run);
      }
      if (path.endsWith("/advance") && state.analyzeSteps?.length) { Object.assign(state.run, state.analyzeSteps.shift()); return reply(state.run); }
      if (path.endsWith("/advance")) {
        state.run.phase = state.run.phase === "analyzing" ? "grouping" : state.run.phase === "grouping" ? "preview_ready" : "completed";
        if (state.run.phase === "preview_ready") state.run.summary = state.summary || {};
        if (state.run.phase === "completed") state.run.summary = { applied: { added_entries: state.rows.length, added_reads: 0 }, dispositions: state.completedDispositions || {} };
        return reply(state.run);
      }
      if (method === "PATCH" && /\/rows\/\d+$/.test(path)) { state.run.phase = "grouping"; state.run.revision += 1; return reply(state.run); }
      if (path.endsWith("/rows") && url.searchParams.get("only_review") === "true" && state.removedRows) return reply({ revision: state.run.revision, next_after: null, items: state.removedRows.map((candidates, index) => ({ ordinal: index + 2,
        source: { title: "Removed book", author: "Someone", context: {}, events: [], warnings: [] }, candidates, plan: { kind: "removed" }, disposition: "review" })) });
      if (path.endsWith("/rows") && url.searchParams.get("only_review") === "true" && state.customReview) return reply({ revision: state.run.revision, next_after: null, items: state.customReview });
      if (path.endsWith("/rows") && url.searchParams.get("only_review") === "true" && state.reviewRows) return reply({ revision: 1, next_after: null, items: [{ ordinal: 2,
        source: { title: "A hard one", author: "Someone", context: {}, events: [], warnings: [] }, candidates: [], plan: { kind: "private" }, disposition: "review" }] });
      if (path.endsWith("/rows")) return reply({ revision: 1, next_after: null, items: state.run.phase === "completed" ? [] : [{ ordinal: 1,
        source: { title: state.rows[0]?.[0], author: state.rows[0]?.[1], context: {}, events: [], warnings: [] }, candidates: [], plan: { kind: "private" }, disposition: "ready" }] });
      if (path.endsWith("/confirm")) { state.run.phase = "applying"; return reply(state.run); }
      if (path.endsWith("/cancel")) { state.run.phase = "cancelled"; return reply(state.run); }
      if (route.request().method() === "GET" && /^\/me\/(home|library|library\/\d+\/reading)$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } }); // account pages prefetched in the background, not part of this fixture
      if (/^\/me\/library-imports\/[^/]+\/enrichment$/.test(path) && state.enrichment) { state.enrichmentCalls = (state.enrichmentCalls || 0) + 1; return route.fulfill({ status: 200, json: state.enrichment.length > 1 ? state.enrichment.shift() : state.enrichment[0] }); }
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library-imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      state.errors.push(`Unhandled ${method} ${path}`);
      return route.fulfill({ status: 500, json: { detail: "Unhandled engineering fixture" } });
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("My Books entry and real local CSV parser preserve Unicode, quotes and embedded newlines", async ({ page, app }) => {
  await page.goto("/my-books");
  await page.getByRole("link", { name: "Import books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import from Goodreads or StoryGraph", exact: true })).toBeVisible();
  const content = '\uFEFFtitle,author,review\r\n"夜の本, Part 2",É. Auteur,"A review\nwith ""quotes"""\r\nAnother Book,Another Author,=1+1\r\n';
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "engineering.csv", mimeType: "text/csv", buffer: Buffer.from(content) });
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`v3-ui-import-review-${width}.png`), fullPage: true });
  }
  expect(app.rows).toEqual([["夜の本, Part 2", "É. Auteur", 'A review\nwith "quotes"'], ["Another Book", "Another Author", "=1+1"]]);
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 2 books.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pick what to read next →", exact: true })).toHaveAttribute("href", "/home");
  expect(app.requests.filter(request => request.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /import|csv|review/i.test(key)))).toEqual([]);
});

test("large TSV upload stays in 100-row batches with explicit confirmation", async ({ page, app }) => {
  await page.goto("/my-books/import");
  const content = "title\tauthor\n" + Array.from({ length: 1000 }, (_, index) => `Engineering ${index}\tAn Author`).join("\n");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "engineering.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(content) });
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible({ timeout: 20_000 });
  const batches = app.requests.filter(request => request.path.includes("/batches/"));
  expect(batches).toHaveLength(10);
  expect(batches.at(-1).receivedAt - batches[0].receivedAt).toBeGreaterThanOrEqual(4500);
  expect(batches.every(batch => batch.body.rows.length <= 100 && Buffer.byteLength(JSON.stringify(batch.body)) < 512 * 1024)).toBe(true);
  expect(app.rows).toHaveLength(1000);
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
});

test("paused file resumes after reload by verifying acknowledged batches without duplicating rows", async ({ page, app }) => {
  await page.goto("/my-books/import");
  const file = { name: "resumable.csv", mimeType: "text/csv", buffer: Buffer.from("title\n" + Array.from({ length: 1000 }, (_, index) => `Resume work ${index}`).join("\n")) };
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(file);
  await expect.poll(() => app.rows.length, { intervals: [25, 50, 100] }).toBeGreaterThanOrEqual(100);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel import", exact: true })).toBeEnabled();
  expect(app.run.phase).toBe("uploading");
  expect(app.rows.length).toBeLessThan(1000);
  const runId = app.run.id;
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(file);
  await page.getByRole("button", { name: "Resume upload", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible({ timeout: 20_000 });
  expect(app.run.id).toBe(runId);
  expect(app.rows).toHaveLength(1000);
  expect(app.run.batch_count).toBe(10);
  expect(app.requests.filter(request => request.path.endsWith("/batches/0"))).toHaveLength(2);
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
});

test("malformed CSV quoting cannot finalize an import", async ({ page, app }) => {
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "malformed.csv", mimeType: "text/csv", buffer: Buffer.from('title,author\n"Never closed,Some author\n') });
  await expect(page.getByRole("alert")).toBeVisible();
  expect(app.requests.some(request => request.path.endsWith("/finalize-upload") || request.path.endsWith("/confirm"))).toBe(false);
});

test("feature off keeps V2/V3 My Books and blocks the direct import route", async ({ page, app }) => {
  app.enabled = false;
  await page.goto("/my-books/import");
  await expect(page).toHaveURL(/\/my-books$/);
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import books", exact: true })).toHaveCount(0);
  expect(app.requests.filter(request => request.path.startsWith(root))).toHaveLength(0);
});

test("phone import stays within My Books navigation and fits the viewport", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books/import");
  await expect(page.getByRole("heading", { name: "Import from Goodreads or StoryGraph", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "My Books" })).toHaveClass(/bv-active/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(app.requests.filter(request => request.path === root && request.method === "POST")).toHaveLength(0);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m5-import-phone.png", fullPage: true });
});

test("resumed decision check does not present an ordinal as checked-row progress", async ({ page, app }) => {
  app.run = { id: "saved-recheck", source: "generic", phase: "grouping", row_count: 20000,
    group_cursor: 10001, rechecking: true, revision: 2, summary: {},
    expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Checking your updated decision", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Checking matches…");
  await expect(page.getByRole("status")).not.toContainText("10001");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
});

test("cancelled partial import still shows committed book and reading totals", async ({ page, app }) => {
  app.run = { id: "saved-cancelled", source: "generic", phase: "cancelled", row_count: 201,
    revision: 2, summary: { applied: { added_entries: 100, added_reads: 42 } },
    expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "View results", exact: true }).click();
  await expect(page.getByText("100 books were added before this stopped.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open My Books", exact: true })).toBeVisible();
  expect(app.requests.some(request => request.path.endsWith("/advance") || request.path.endsWith("/confirm"))).toBe(false);
});

const bannedWords = /unmatched|invalid|error|disposition|catalogue|book group|source rows|checkpoint|committed|staging|batch/i;
const csv = (rows = 2) => ({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(["title,author", ...Array.from({ length: rows }, (_, i) => `Book ${i + 1},Author ${i + 1}`)].join("\r\n") + "\r\n") });
const openReady = async (page, app) => {
  app.summary = { distinct_targets: 5, targets_by_kind: { catalogue: 2, private: 2, existing: 1 }, dispositions: { review: 1, invalid: 1 } };
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
};

test("the start screen is one calm path with Goodreads and StoryGraph cards and everything else folded away", async ({ page, app: _app }) => {
  await page.goto("/my-books/import");
  await expect(page.getByRole("heading", { name: "Import from Goodreads or StoryGraph", level: 1 })).toBeVisible();
  await expect(page.getByText("Bring your shelves, reading dates and notes. Everything stays private to you.")).toBeVisible();
  for (const name of ["Goodreads", "StoryGraph"]) await expect(page.locator(".bv-import-source").filter({ has: page.getByRole("heading", { name, exact: true }) }).locator("ol li")).not.toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open Goodreads Import and Export/ })).toHaveAttribute("href", "https://www.goodreads.com/review/import");
  await expect(page.getByRole("link", { name: /Open StoryGraph export/ })).toHaveAttribute("href", "https://app.thestorygraph.com/user-export");
  await expect(page.getByLabel("Choose your export file (.csv)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check my library" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import books" })).toHaveCount(0);
  for (const name of ["CSV / spreadsheet"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Bookvane CSV template" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download your data", exact: true })).toHaveAttribute("href", "/my-data");
  await expect(page.getByText("Up to 20,000 books.")).toBeVisible();
  await expect(page.getByText(/MiB|full backup/)).toHaveCount(0);
  for (const gone of ["Text encoding", "Paste a book list", "Advanced import privacy", "Other ways to import and options", "Forget removed import markers"]) await expect(page.getByText(gone, { exact: false })).toHaveCount(0);
  await expect(page.locator("#bv-main select, #bv-main textarea")).toHaveCount(0);
  expect((await page.locator("#bv-main").innerText()).match(bannedWords)).toBeNull();
});

test("one click adds everything: the preview summary comes from the run and confirm sends all three flags", async ({ page, app }) => {
  await openReady(page, app);
  const summary = page.locator(".bv-import-summary");
  await expect(summary).toContainText("5 books in your file");
  await expect(summary).toContainText("3 found on Bookvane");
  await expect(summary).toContainText("2 need a quick pick");
  await expect(page.getByText("Fields not imported")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm import" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Add (my books|everything)/ })).toHaveCount(1);
  await expect(page.locator(".bv-import-row")).toHaveCount(0);
  expect((await page.locator("#bv-main").innerText()).match(bannedWords)).toBeNull();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 2 books.", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.path.endsWith("/confirm")).map(request => request.body)).toEqual([expect.objectContaining({ accept_warnings: true, approve_private: true, skip_unresolved: true })]);
  await expect(page.getByRole("link", { name: "Pick what to read next →", exact: true })).toHaveAttribute("href", "/home");
  await expect(page.getByRole("link", { name: "Open My Books", exact: true })).toHaveAttribute("href", "/my-books");
  await expect(page.getByRole("button", { name: "Download your results (CSV)", exact: true })).toBeVisible();
  expect((await page.locator("#bv-main").innerText()).match(bannedWords)).toBeNull();
});

test("Review N books first opens the list with no option sentences, and Add my books is the one way to finish", async ({ page, app }) => {
  await openReady(page, app);
  app.reviewRows = true;
  await page.getByRole("button", { name: "Review 2 books first", exact: true }).click();
  await expect(page.locator(".bv-import-review .bv-import-row")).toHaveCount(1);
  await expect(page.locator(".bv-import-review").getByText("Needs a quick pick").first()).toBeVisible();
  await expect(page.locator(".bv-import-review input[type=checkbox]")).toHaveCount(0);
  await expect(page.getByText(/Keep unsupported dates|Skip anything that still needs|Add books I don’t have a match/)).toHaveCount(0);
  expect((await page.locator("#bv-main").innerText()).match(bannedWords)).toBeNull();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 2 books.", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.path.endsWith("/confirm"))).toHaveLength(1);
});

test("Review is hidden when nothing needs a pick, and the preview never shows the full row list", async ({ page, app }) => {
  app.summary = { distinct_targets: 2, targets_by_kind: { private: 2 }, dispositions: { review: 0, invalid: 0 } };
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review \d+ books? first/ })).toHaveCount(0);
  await expect(page.getByText(/quick pick/)).toHaveCount(0);
});

test("the working screen names the phase in plain words with N of M and a progress bar", async ({ page, app }) => {
  app.run = { id: "saved-analyze", source: "goodreads", phase: "analyzing", row_count: 200, analyze_cursor: 50, revision: 2, summary: {}, expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await expect(page.getByText(/You have an import.*waiting\./)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finding your books", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Found 50 of 200 books");
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("You can pause and come back later")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel import", exact: true })).toBeVisible();
});

test("the done screen says how many were left for review after one click, and how many were skipped after hand decisions", async ({ page, app }) => {
  app.completedDispositions = { skipped: 3 };
  await openReady(page, app);
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByText("3 left for you to review.")).toBeVisible();
  app.reviewRows = true;
  await page.getByRole("button", { name: "Start another import" }).click();
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review 2 books first", exact: true }).click();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByText("3 skipped.")).toBeVisible();
  await expect(page.getByText("left for you to review")).toHaveCount(0);
});

test("the preview and done screens use singular wording for one book", async ({ page, app }) => {
  app.summary = { distinct_targets: 1, targets_by_kind: { catalogue: 1, private: 1, existing: 1 }, dispositions: { review: 1, invalid: 0 } };
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "one.csv", mimeType: "text/csv", buffer: Buffer.from("title,author\r\nOnly Book,Someone\r\n") });
  const summary = page.locator(".bv-import-summary");
  await expect(summary).toContainText("1 book in your file");
  await expect(summary).toContainText("1 needs a quick pick");
  await expect(page.getByRole("button", { name: "Review 1 book first", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 1 book.", exact: true })).toBeVisible();
});

const waitingRun = { id: "waiting-run", source: "goodreads", phase: "preview_ready", row_count: 20, revision: 2, manifest_hash: "m", expires_at: "2026-11-05T00:00:00Z",
  summary: { distinct_targets: 20, targets_by_kind: { private: 20 }, dispositions: {} } };

test("an import waiting for review shows Continue and Start over instead of the file picker", async ({ page, app }) => {
  app.run = structuredClone(waitingRun);
  await page.goto("/my-books/import");
  await expect(page.getByText("ready to review.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Choose your export file", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  expect(app.requests.some(request => request.method === "POST" && request.path === root)).toBe(false);
});

test("Start over asks first, cancels the old run, and returns to the cards", async ({ page, app }) => {
  app.run = structuredClone(waitingRun);
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByText("Start over? Books already added stay in your library.")).toBeVisible();
  expect(app.requests.some(request => request.path.endsWith("/cancel"))).toBe(false);
  await page.getByRole("button", { name: "Yes, start over", exact: true }).click();
  await expect(page.getByLabel("Choose your export file", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Goodreads", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.path === `${root}/waiting-run/cancel`)).toHaveLength(1);
});

test("a 409 on start shows the waiting box, not an error", async ({ page, app }) => {
  app.conflictOnStart = true;
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from("title,author\r\nBook,Someone\r\n") });
  await expect(page.getByText("ready to review.", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
});

test("a server failure shows a plain message with Try again, never paused or checkpoint wording", async ({ page, app }) => {
  app.failStart = true;
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from("title,author\r\nBook,Someone\r\n") });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Something went wrong on our side. Your library hasn’t changed — try again.");
  expect((await page.locator("#bv-main").innerText()).match(/paused|checkpoint|committed|staging|batch/i)).toBeNull();
  app.failStart = false;
  await alert.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Choose your export file", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a file that is not UTF-8 is read as windows-1252 without asking", async ({ page, app }) => {
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles({ name: "latin.csv", mimeType: "text/csv", buffer: Buffer.from("title,author\r\nCaf\u00e9 Society,Zo\u00eb Author\r\n", "latin1") });
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  expect(app.rows).toEqual([["Caf\u00e9 Society", "Zo\u00eb Author"]]);
  expect(app.requests.find(request => request.method === "POST" && request.path === root).body.encoding).toBe("windows-1252");
});

const removedSummary = { distinct_targets: 3, targets_by_kind: { private: 2 }, dispositions: { review: 1, invalid: 0 } };
const openRemoved = async (page, app, candidates) => {
  app.summary = removedSummary; app.removedRows = [candidates];
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
  await expect(page.getByText("1 book you removed earlier is in this file")).toBeVisible();
  await expect(page.getByRole("button", { name: /Review \d+ books? first/ })).toHaveCount(0);
  await expect(page.getByText(/need a quick pick|needs a quick pick/)).toHaveCount(0);
};

test("books you removed earlier are skipped by default, with nothing extra sent", async ({ page, app }) => {
  await openRemoved(page, app, [{ book_id: 42, title: "Old", authors: ["A"] }]);
  await expect(page.getByLabel("Skip them")).toBeChecked();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Brought home/ })).toBeVisible();
  expect(app.requests.some(request => request.method === "PATCH")).toBe(false);
  expect(app.requests.find(request => request.path.endsWith("/confirm")).body).toEqual(expect.objectContaining({ skip_unresolved: true }));
});

test("Add them back matches each removed book to its top candidate before confirming", async ({ page, app }) => {
  await openRemoved(page, app, [{ book_id: 42, title: "Old", authors: ["A"] }]);
  await page.getByLabel("Add them back").check();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Brought home/ })).toBeVisible();
  const order = app.requests.map(request => `${request.method} ${request.path.split("/").slice(-1)[0]}`);
  const patch = app.requests.find(request => request.method === "PATCH");
  expect(patch.body).toEqual(expect.objectContaining({ action: "match", book_id: 42 }));
  expect(order.indexOf("PATCH 2")).toBeLessThan(order.indexOf("POST confirm"));
});

test("a removed book with no match on Bookvane says it could not be added back and sends no decision", async ({ page, app }) => {
  await openRemoved(page, app, []);
  await page.getByLabel("Add them back").check();
  await expect(page.getByText("1 couldn’t be added back.")).toBeVisible();
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Brought home/ })).toBeVisible();
  expect(app.requests.some(request => request.method === "PATCH")).toBe(false);
});

test("after an import the done screen counts down the books still being looked up, refreshes the library on upgrades and stops at zero", async ({ page, app }) => {
  app.enrichment = [{ pending: 3, upgraded: 0 }, { pending: 1, upgraded: 2 }, { pending: 0, upgraded: 3 }];
  await openReady(page, app);
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 2 books.", exact: true })).toBeVisible();
  const line = page.locator("[role=status][aria-live=polite]").filter({ hasText: "Finding covers" });
  await expect(line).toHaveText("Finding covers and descriptions for 3 books…");
  const revision = async () => Number(await page.locator(".bv-root").getAttribute("data-library-revision"));
  const base = await revision();
  await expect(line).toHaveText("Finding covers and descriptions for 1 book…", { timeout: 12000 });
  expect(await revision()).toBe(base + 1);
  await expect(page.locator("[role=status][aria-live=polite]").filter({ hasText: "Finding covers" })).toHaveCount(0, { timeout: 12000 });
  expect(await revision()).toBe(base + 2);
  const calls = () => app.requests.filter(request => request.path.endsWith("/enrichment")).length;
  expect(calls()).toBe(3);
  await page.waitForTimeout(6000);
  expect(calls()).toBe(3);
});

test("a failing progress check stops quietly and shows nothing", async ({ page, app }) => {
  await openReady(page, app);
  await page.getByRole("button", { name: "Add my books", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brought home 2 books.", exact: true })).toBeVisible();
  await page.waitForTimeout(6000);
  expect(app.requests.filter(request => request.path.endsWith("/enrichment"))).toHaveLength(1);
  await expect(page.getByText("Finding covers")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("enrichment screenshots", async ({ page, app }) => {
  test.skip(!process.env.BOOK_SHOTS, "set BOOK_SHOTS=1 to export screenshots");
  const dir = "node_modules/.bv-preview/descriptions";
  app.enrichment = [{ pending: 12, upgraded: 0 }];
  for (const theme of ["light", "dark"]) for (const [label, width, height] of [["375", 375, 812], ["1440", 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    app.run = null; app.rows = [];
    await openReady(page, app);
    await page.getByRole("button", { name: "Add my books", exact: true }).click();
    await expect(page.getByText("Finding covers and descriptions for 12 books…")).toBeVisible();
    await page.screenshot({ path: `${dir}/import-${label}-${theme}.png` });
  }
});

test("foundations screenshots: import start", async ({ page, app: _app }) => {
  test.skip(!shotsEnabled(), "set FOUNDATIONS_SHOTS=before or after to export screenshots");
  await shootMatrix(page, "import-start", async () => { await page.goto("/my-books/import"); await expect(page.locator("h1")).toBeVisible(); });
});

test("the count advances with each analysis step, then reads Checking matches, and never sits at 0", async ({ page, app }) => {
  app.analyzeSteps = [{ phase: "analyzing", row_count: 250, analyze_cursor: 100 }, { phase: "analyzing", row_count: 250, analyze_cursor: 200 }, { phase: "analyzing", row_count: 250, analyze_cursor: 250 }, { phase: "grouping" }];
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  const status = page.getByRole("status");
  await expect(status).toContainText("Found 100 of 250 books");
  await expect(status).toContainText("Found 200 of 250 books");
  await expect(status).toContainText("Checking matches…");
  await expect(page.getByText(/Found 0 of/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready to add your books", exact: true })).toBeVisible();
});

test("before the first answer there is a looking-up line and an indeterminate bar, not a 0", async ({ page, app }) => {
  app.run = { id: "saved-fresh", source: "goodreads", phase: "analyzing", row_count: 200, analyze_cursor: 0, revision: 2, summary: {}, expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Looking up your books…")).toBeVisible();
  await expect(page.getByText(/Found 0 of|0 of 200/)).toHaveCount(0);
});

for (const [targets, kinds, review] of [[5, { catalogue: 2, private: 2, existing: 1 }, 2], [5, { catalogue: 5 }, 0], [3, { private: 3 }, 1], [1, { catalogue: 1, private: 1, existing: 1 }, 1]]) {
  test(`the summary counts add up to the books in the file: ${targets} books, ${JSON.stringify(kinds)}, ${review} to pick`, async ({ page, app }) => {
    app.summary = { distinct_targets: targets, targets_by_kind: kinds, dispositions: { review, invalid: 0 } };
    await page.goto("/my-books/import");
    await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
    const summary = page.locator(".bv-import-summary");
    await expect(summary).toContainText(`${targets} ${targets === 1 ? "book" : "books"} in your file`);
    const numbers = (await summary.locator("li").allInnerTexts()).map(text => Number(text.match(/^\d+/)?.[0]));
    expect(numbers.slice(1).reduce((sum, value) => sum + value, 0)).toBe(targets);
  });
}

test("a clash names the values, and the choices are in plain words", async ({ page, app }) => {
  app.customReview = [{ ordinal: 2, source: { title: "Middlemarch", author: "George Eliot", context: {}, warnings: [], events: [{ state: "finished", started_on: "2025-11-01", ended_on: "2025-12-20" }] },
    candidates: [], plan: { kind: "existing" }, disposition: "review", existing_events: [{ state: "finished", ended_on: "2026-01-03" }] }];
  app.run = { id: "saved-clash", source: "goodreads", phase: "preview_ready", row_count: 3, revision: 2, manifest_hash: "m", summary: { distinct_targets: 3, targets_by_kind: { catalogue: 2, existing: 1 }, dispositions: { review: 1, invalid: 0 } }, expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review 1 book first", exact: true }).click();
  const row = page.locator(".bv-import-row");
  await expect(row.getByText("Your file says finished 20 Dec 2025; Bookvane has 3 Jan 2026.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Use my Goodreads dates", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Keep what’s in Bookvane", exact: true })).toBeVisible();
  await expect(page.getByText("Some values need a look")).toHaveCount(0);
});

test("two books tie: each is listed with cover, title, author and year, and one tap picks it", async ({ page, app }) => {
  app.customReview = [{ ordinal: 2, source: { title: "Dune", author: "Frank Herbert", context: {}, warnings: [], events: [] },
    candidates: [{ book_id: 11, title: "Dune", authors: ["Frank Herbert"], published_year: 1965 }, { book_id: 12, title: "Dune", authors: ["Frank Herbert"], published_year: 1984 }], plan: { kind: "private" }, disposition: "review" }];
  app.run = { id: "saved-tie", source: "goodreads", phase: "preview_ready", row_count: 3, revision: 2, manifest_hash: "m", summary: { distinct_targets: 3, targets_by_kind: { catalogue: 2, private: 1 }, dispositions: { review: 1, invalid: 0 } }, expires_at: "2026-10-23T00:00:00Z" };
  await page.goto("/my-books/import");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review 1 book first", exact: true }).click();
  const options = page.locator(".bv-import-candidate");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("Dune");
  await expect(options.first()).toContainText("Frank Herbert");
  await expect(options.first()).toContainText("1965");
  await expect(options.nth(1)).toContainText("1984");
  await expect(options.first().locator(".bv-cover, img, svg").first()).toBeVisible();
  await options.nth(1).click();
  await expect.poll(() => app.requests.find(request => request.method === "PATCH")?.body).toMatchObject({ action: "match", book_id: 12 });
});

test("with no rows to pick there is one button; with one there is a Review 1 book first beside it", async ({ page, app }) => {
  app.summary = { distinct_targets: 4, targets_by_kind: { catalogue: 4 }, dispositions: { review: 0, invalid: 0 } };
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("button", { name: "Add my books", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  app.run = null; app.rows = []; app.batches = new Map();
  app.summary = { distinct_targets: 4, targets_by_kind: { catalogue: 3, private: 1 }, dispositions: { review: 1, invalid: 0 } };
  await page.getByRole("button", { name: "Start another import" }).click().catch(() => {});
  await page.goto("/my-books/import");
  await page.getByLabel("Choose your export file", { exact: false }).setInputFiles(csv());
  await expect(page.getByRole("button", { name: "Review 1 book first", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add my books", exact: true })).toBeVisible();
});
