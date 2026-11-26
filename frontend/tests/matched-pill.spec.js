import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Matched pill: one-line fields are pills, text areas softer, and the field border holds 3:1 on every surface. Browser fixtures only (the findability fixture, trimmed).
const BOOK = { id: 1, title: "Middlemarch", authors: [{ id: 1, name: "George Eliot" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1871, page_count: 880 };
const entry = { id: 50, book_id: 1, book: BOOK, is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const CLUB = { id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", role: "owner", member_count: 8, current_book: { book_id: 1, title: "Middlemarch" } };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, entries: [], loans: [], libraryImport: true, readingExport: true, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (url.pathname.startsWith("/test-cover/")) return route.fulfill({ status: 404, body: "" });
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/auth/refresh") return reply(state.guest ? 401 : 200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: state.libraryImport, reading_export: state.readingExport } });
      if (path === "/me/library-imports") return reply(200, { items: [], active: null });
      if (path === "/me/home") return reply(200, { current_reads: state.currentReads || [], reading_count: (state.currentReads || []).length, paused_count: 0 });
      if (/^\/me\/reading-attempts\//.test(path) && method === "PATCH") return reply(200, { entry: state.currentReads[0].entry, attempt: { ...state.currentReads[0].attempt, ...body } });
      if (path === "/me/library") return reply(200, { items: state.entries, counts: { all: state.entries.length, owned: state.entries.length, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: state.entries.length, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/loans" && method === "GET") return reply(200, { items: state.loans });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026, email_tips: false });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/up-next") return reply(404, { detail: "Not found" });
      if (path === "/me/preferences") return reply(200, []);
      if (path === "/books") return reply(200, { items: [BOOK], total: 1, page: 1, size: 30 });
      if (path === "/books/more") return reply(200, []);
      if (/^\/books\/\d+$/.test(path)) return reply(200, BOOK);
      if (/^\/me\/library\/\d+\/reading$/.test(path)) return reply(200, { entry, current_attempt: null, editions: [] });
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (/^\/authors\/\d+\/books$/.test(path)) return reply(200, { items: [], total: 0, page: 1, size: 24, pages: 1 });
      if (path.startsWith("/autocomplete")) return reply(200, []);
      if (path === "/me/clubs" && method === "GET") return reply(200, { items: [CLUB] });
      if (path === "/clubs/5" && method === "GET") return reply(200, { id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", created_at: "2026-11-01T00:00:00Z", me: { role: "owner", share_progress: false }, member_count: 8, club_plus: false,
        cap: { free_limit: 25, full: false }, books: [{ id: 11, book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null, page_count: 880, status: "current", starts_on: "2026-11-14", ends_on: "2027-01-02", checkpoints: [] }] });
      if (path === "/clubs/5/members") return reply(200, { items: [{ user_id: "00000000-0000-4000-8000-000000000000", name: "Rae", initials: "R", role: "owner", joined_at: "2026-11-01T00:00:00Z", patron: false, me: true, shares_progress: false, progress: null }] });
      if (path === "/clubs/5/books/11/posts") return reply(200, { items: [], next_before: null });
      if (path.startsWith("/club-invites/")) return reply(404, { detail: "Not found" });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});


// WCAG contrast of the field's border against the nearest opaque background behind it.
const contrastOf = locator => locator.evaluate(node => {
  const parse = text => { const m = text.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const luminance = ({ r, g, b }) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let behind = null;
  for (let el = node.parentElement; el && !behind; el = el.parentElement) { const bg = parse(getComputedStyle(el).backgroundColor); if (bg.a === 1) behind = bg; }
  const border = parse(getComputedStyle(node).borderTopColor);
  const [x, y] = [luminance(border), luminance(behind)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
});

for (const theme of ["light", "dark"]) {
  test(`one-line fields are pills and text areas are softer; ${theme}`, async ({ page, app }) => {
    app.entries = [entry];
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    app.currentReads = [{ entry: { ...entry, id: 201, reading_state: "reading", version: 3 }, attempt: { id: "attempt-1", state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: 10, total_pages: 300 } }];
    await page.goto("/home");
    await page.getByRole("button", { name: /^Update progress/ }).click();
    const input = page.getByRole("dialog").getByRole("textbox");
    await expect(input).toBeVisible();
    expect(await input.evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThanOrEqual(22);
    expect(await page.evaluate(() => { const box = document.createElement("div"); box.className = "bv-field"; box.innerHTML = "<textarea></textarea>"; document.querySelector("main").append(box); return parseFloat(getComputedStyle(box.firstChild).borderTopLeftRadius); })).toBe(20);
  });

  test(`the field border is at least 3:1 on the page, sheets and soft fills; ${theme}`, async ({ page, app }) => {
    app.entries = [entry];
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    for (const path of ["/browse", "/my-books/import", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const found = await page.locator("main .bv-field input:visible, main .bv-import-page input[type=text]:visible, main .bv-discovery-extras :is(input, select):visible, main .bv-filter-dialog :is(input, select):visible").all();
      for (const field of found) expect(await contrastOf(field), `${path} ${await field.getAttribute("name")}`).toBeGreaterThanOrEqual(3);
    }
    // A field on each of the three surfaces, whatever the page has.
    await page.goto("/browse");
    for (const surface of ["--bv-paper", "--bv-sheet", "--bv-soft"]) {
      const ratio = await page.evaluate(name => {
        const holder = document.createElement("div"); holder.className = "bv-field"; holder.style.background = `var(${name})`; holder.innerHTML = "<input>";
        document.querySelector("main").append(holder);
        const parse = text => { const m = text.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2] }; };
        const lum = ({ r, g, b }) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const [x, y] = [lum(parse(getComputedStyle(holder.firstChild).borderTopColor)), lum(parse(getComputedStyle(holder).backgroundColor))].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      }, surface);
      expect(ratio, `${theme} ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
}

test("the progress sheet: Save sits inside the pill field, is a 44px target, and still saves", async ({ page, app }) => {
  app.currentReads = [{ entry: { ...entry, id: 201, reading_state: "reading", version: 3 }, attempt: { id: "attempt-1", state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: 10, total_pages: 300 } }];
  await page.goto("/home");
  await page.getByRole("button", { name: /^Update progress/ }).click();
  const input = page.getByRole("dialog").getByRole("textbox"), save = page.getByRole("dialog").getByRole("button", { name: "Save", exact: true });
  const [field, button] = [await input.boundingBox(), await save.boundingBox()];
  expect(button.x).toBeGreaterThanOrEqual(field.x); expect(button.x + button.width).toBeLessThanOrEqual(field.x + field.width + 0.5);
  expect(button.y).toBeGreaterThanOrEqual(field.y - 0.5); expect(button.y + button.height).toBeLessThanOrEqual(field.y + field.height + 0.5);
  expect(button.height).toBeGreaterThanOrEqual(44);
  await input.fill("50");
  await save.click();
  await expect.poll(() => app.requests.some(request => request.method === "PATCH" && request.body?.progress_value === 50)).toBe(true);
});
