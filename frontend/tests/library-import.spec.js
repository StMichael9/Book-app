import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

// Synthetic browser/API fixtures exercise local file parsing, NOT native-export
// acceptance or live database behavior. Those have separate verification gates.
const root = "/me/library-imports";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const test = base.extend({
  app: async ({ page, baseURL }, use) => {
    const state = { enabled: true, requests: [], rows: [], errors: [], run: null };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
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
      if (path === root && method === "GET") return reply({ items: state.run ? [state.run] : [] });
      if (path === root && method === "POST") {
        state.run = { id: body.id, source: body.source === "paste" ? "paste" : "generic", scope: "default", phase: "uploading", row_count: 0, batch_count: 0,
          analyze_cursor: 0, group_cursor: 0, revision: 1, manifest_hash: null, summary: {},
          expires_at: "2026-10-23T00:00:00Z", report_expires_at: "2026-11-15T00:00:00Z", upload_config: { headers: body.headers, mapping: body.mapping || {}, status_map: {} } };
        return reply(state.run);
      }
      if (state.run && path === `${root}/${state.run.id}`) return reply(state.run);
      if (path.includes("/batches/")) {
        state.rows.push(...body.rows);
        state.run.row_count += body.rows.length; state.run.batch_count += 1;
        return reply({ batch_hash: hash(body.rows), status: state.run });
      }
      if (path.endsWith("/finalize-upload")) {
        state.run.phase = "analyzing"; state.run.manifest_hash = body.manifest_hash;
        return reply(state.run);
      }
      if (path.endsWith("/advance")) {
        state.run.phase = state.run.phase === "analyzing" ? "grouping" : state.run.phase === "grouping" ? "preview_ready" : "completed";
        if (state.run.phase === "completed") state.run.summary = { applied: { added_entries: state.rows.length, added_reads: 0 } };
        return reply(state.run);
      }
      if (path.endsWith("/rows")) return reply({ revision: 1, next_after: null, items: state.run.phase === "completed" ? [] : [{ ordinal: 1,
        source: { title: state.rows[0]?.[0], author: state.rows[0]?.[1], context: {}, events: [], warnings: [] }, candidates: [], plan: { kind: "private" }, disposition: "ready" }] });
      if (path.endsWith("/confirm")) { state.run.phase = "applying"; return reply(state.run); }
      if (path.endsWith("/cancel")) { state.run.phase = "cancelled"; return reply(state.run); }
      state.errors.push(`Unhandled ${method} ${path}`);
      return route.fulfill({ status: 500, json: { detail: "Unhandled engineering fixture" } });
    });
    await use(state);
    expect(state.errors).toEqual([]);
  },
});

test("My Books entry and real local CSV parser preserve Unicode, quotes and embedded newlines", async ({ page, app }) => {
  await page.goto("/my-books");
  await page.getByRole("link", { name: "Bring Your Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring Your Library", exact: true })).toBeVisible();
  const content = '\uFEFFtitle,author,review\r\n"夜の本, Part 2",É. Auteur,"A review\nwith ""quotes"""\r\nAnother Book,Another Author,=1+1\r\n';
  await page.getByLabel("Library file", { exact: false }).setInputFiles({ name: "engineering.csv", mimeType: "text/csv", buffer: Buffer.from(content) });
  await page.getByRole("button", { name: "Check my library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your library", exact: true })).toBeVisible();
  expect(app.rows).toEqual([["夜の本, Part 2", "É. Auteur", 'A review\nwith "quotes"'], ["Another Book", "Another Author", "=1+1"]]);
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
  await page.getByLabel("Approve unmatched books as private entries.").check();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your library is here", exact: true })).toBeVisible();
  expect(app.requests.filter(request => request.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /import|csv|review/i.test(key)))).toEqual([]);
});

test("pasted list shares the preview engine and does not invent history", async ({ page, app }) => {
  await page.goto("/my-books/import");
  await page.getByLabel("One title, title — author, or ISBN per line").fill("A-B\nA Title — An Author\n9781250313195");
  await page.getByRole("button", { name: "Check this list" }).click();
  await expect(page.getByRole("heading", { name: "Review your library", exact: true })).toBeVisible();
  expect(app.rows).toEqual([["A-B", "", ""], ["A Title", "An Author", ""], ["", "", "9781250313195"]]);
  expect(app.run.source).toBe("paste");
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
});

test("large TSV upload stays in 100-row batches with explicit confirmation", async ({ page, app }) => {
  await page.goto("/my-books/import");
  const content = "title\tauthor\n" + Array.from({ length: 1000 }, (_, index) => `Engineering ${index}\tAn Author`).join("\n");
  await page.getByLabel("Library file", { exact: false }).setInputFiles({ name: "engineering.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(content) });
  await page.getByRole("button", { name: "Check my library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your library", exact: true })).toBeVisible();
  const batches = app.requests.filter(request => request.path.includes("/batches/"));
  expect(batches).toHaveLength(10);
  expect(batches.at(-1).receivedAt - batches[0].receivedAt).toBeGreaterThanOrEqual(4500);
  expect(batches.every(batch => batch.body.rows.length <= 100 && Buffer.byteLength(JSON.stringify(batch.body)) < 512 * 1024)).toBe(true);
  expect(app.rows).toHaveLength(1000);
  expect(app.requests.some(request => request.path.endsWith("/confirm"))).toBe(false);
});

test("malformed CSV quoting cannot finalize an import", async ({ page, app }) => {
  await page.goto("/my-books/import");
  await page.getByLabel("Library file", { exact: false }).setInputFiles({ name: "malformed.csv", mimeType: "text/csv", buffer: Buffer.from('title,author\n"Never closed,Some author\n') });
  const start = page.getByRole("button", { name: "Check my library", exact: true });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(app.requests.some(request => request.path.endsWith("/finalize-upload") || request.path.endsWith("/confirm"))).toBe(false);
});

test("feature off keeps V2/V3 My Books and blocks the direct import route", async ({ page, app }) => {
  app.enabled = false;
  await page.goto("/my-books/import");
  await expect(page).toHaveURL(/\/my-books$/);
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bring Your Library", exact: true })).toHaveCount(0);
  expect(app.requests.filter(request => request.path.startsWith(root))).toHaveLength(0);
});

test("phone import stays within My Books navigation and fits the viewport", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-books/import");
  await expect(page.getByRole("heading", { name: "Bring Your Library", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "My Books" })).toHaveClass(/bv-active/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(app.requests.filter(request => request.path === root && request.method === "POST")).toHaveLength(0);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m5-import-phone.png", fullPage: true });
});
