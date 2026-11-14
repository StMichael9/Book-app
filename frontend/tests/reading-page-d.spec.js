import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The reading page and Home's Reading now cards, Direction D: one "Page or %" box, an inline finished prompt, a journal and one fold.
// Browser-only fixtures; every API call is mocked from the contract.
const book = { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 272, english_title: null };
const freshAttempt = () => ({ id: "a1", state: "reading", started_on: "2026-11-13", ended_on: null, progress_unit: null, progress_value: null, total_pages: 360, note: null, reaction: null, updated_at: "2026-11-13T10:00:00Z" });
const freshEntry = () => ({ id: 101, book_id: 1, book, is_owned: true, is_wanted: false, version: 1, reading_state: "reading", private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z" });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entry: freshEntry(), attempt: freshAttempt(), history: [], patches: [], requests: [], progressDays: undefined, readOnly: false, holdPatch: null, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: state.attempt.state === "reading" ? [{ entry: state.entry, attempt: state.attempt }] : [], reading_count: state.attempt.state === "reading" ? 1 : 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [state.entry], counts: { all: 1, owned: 1, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: 101, version: state.entry.version, is_owned: state.entry.is_owned, is_wanted: state.entry.is_wanted, reading_state: state.entry.reading_state })) });
      if (path === "/me/stats" || path === "/me/up-next") return reply(path === "/me/stats" ? 200 : 200, path === "/me/stats" ? { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } : []);
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/library/101/reading") return reply(200, { entry: state.entry, current_attempt: state.attempt, editions: [], ...(state.progressDays !== undefined ? { progress_days: state.progressDays } : {}) });
      if (path === "/me/library/101/attempts") return reply(200, { items: state.history, next_cursor: null });
      if (path === "/me/reading-attempts/a1" && method === "PATCH") {
        state.patches.push(body);
        if (state.holdPatch) await state.holdPatch;
        const { expected_version: _version, ...changes } = body;
        state.attempt = { ...state.attempt, ...changes, updated_at: "2026-11-13T12:00:00Z" };
        state.entry = { ...state.entry, version: state.entry.version + 1, reading_state: state.attempt.state };
        return reply(200, { entry: state.entry, attempt: state.attempt });
      }
      if (path === "/me/library/101" && method === "PATCH") {
        const { expected_version: _version, ...changes } = body;
        state.entry = { ...state.entry, ...changes, version: state.entry.version + 1 };
        return reply(200, state.entry);
      }
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/books/1") return reply(200, { ...book, description: "A house of endless halls.", published_year: 2020, isbn13: null });
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const home = page => page.getByRole("textbox", { name: "Page or % for Piranesi" });
const onPage = page => page.getByRole("textbox", { name: /^Page or %/ });
const lastPatch = app => app.patches.at(-1);

for (const where of ["Home", "the book page"]) {
  test(`the box saves a page from ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    await box.fill("52");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "pages", progress_value: 52, on: expect.stringMatching(/^d{4}-d{2}-d{2}$/) });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toHaveText("Saved. Page 52, 14%.");
    await expect(box).toHaveValue("");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`the box saves a percent from ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    await box.fill("35 %");
    await expect(page.getByText("about page 126")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "percent", progress_value: 35, on: expect.stringMatching(/^d{4}-d{2}-d{2}$/) });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toHaveText("Saved. 35%, about page 126.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`bad input and a page past the end show the field error on ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Type a page, like 52, or a percent, like 35%.")).toBeVisible();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await box.fill("page fifty");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Type a page, like 52, or a percent, like 35%.")).toBeVisible();
    await box.fill("400");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Your copy has 360 pages.")).toBeVisible();
    await expect(box).toHaveValue("400");
    expect(app.patches).toHaveLength(0);
  });
}

test("a page with no known total asks for it once, inline, and saves it with the page", async ({ page, app }) => {
  app.attempt.total_pages = null;
  await page.goto("/my-books/101");
  await onPage(page).fill("52");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("How many pages in your copy?")).toBeVisible();
  expect(app.patches).toHaveLength(0);
  await page.getByLabel("How many pages in your copy?").fill("360");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "pages", progress_value: 52, total_pages: 360, on: expect.stringMatching(/^d{4}-d{2}-d{2}$/) });
  await expect(page.getByLabel("How many pages in your copy?")).toHaveCount(0);
});

test("the last page asks Finished the book? inline; Yes finishes the reading, Not yet closes it", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await onPage(page).fill("360");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const prompt = page.getByRole("group", { name: "Finished the book?" });
  await expect(prompt).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await prompt.getByRole("button", { name: "Not yet" }).click();
  await expect(prompt).toHaveCount(0);
  await onPage(page).fill("100%");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await prompt.getByRole("button", { name: "Yes, finished" }).click();
  await expect.poll(() => lastPatch(app)).toMatchObject({ state: "finished", ended_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  await expect(page.getByRole("heading", { name: "You finished Piranesi." })).toBeVisible();
});

test("on Home the finished prompt finishes the reading too", async ({ page, app }) => {
  await page.goto("/home");
  await home(page).fill("360");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finished" }).click();
  await expect.poll(() => lastPatch(app)).toMatchObject({ state: "finished" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a thought is saved as the note, appended, and shows in the journal", async ({ page, app }) => {
  app.attempt.note = "First thought.";
  await page.goto("/my-books/101");
  await page.getByRole("textbox", { name: "Add a thought" }).fill("The halls again.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, note: "First thought.\n\nThe halls again." });
  await expect(page.locator(".bv-journal")).toContainText("The halls again.");
  await expect(page.getByRole("textbox", { name: "Add a thought" })).toHaveValue("");
});

test("Pause and Finish book are never disabled by the box", async ({ page, app }) => {
  await page.goto("/my-books/101");
  let release;
  app.holdPatch = new Promise(done => { release = done; });
  await onPage(page).fill("52");
  await expect(page.getByRole("button", { name: "Pause reading" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish book" })).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => app.patches.length).toBe(1);
  await expect(page.getByRole("button", { name: "Pause reading" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish book" })).toBeEnabled();
  release();
});

test("the ••• menu holds Want to read, I own it, Add to list and Pin to Up next", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "More actions for Piranesi" }).click();
  const menu = page.getByRole("menu", { name: "More actions for Piranesi" });
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText(["Want to read", "I own it"]);
  await expect(menu.getByRole("menuitemcheckbox", { name: "I own it" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem")).toHaveText(["Add to list", "Pin to Up next"]);
});

test("the page shows no ISO date, never says private, and shows one date format", async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), progress_unit: "pages", progress_value: 52, note: "A thought." };
  app.history = [{ ...freshAttempt(), id: "old", state: "finished", started_on: "2024-02-01", ended_on: "2024-03-09" }];
  app.entry.save_note = "A friend's tip.";
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal")).toContainText("Read before: 2024, finished");
  const text = await page.locator("#bv-main").innerText();
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(text).not.toMatch(/private/i);
  await expect(page.locator(".bv-progress-line")).toHaveText("Page 52 of 360 · 14% · started 13 Nov 2026");
});

test("the text line's page total edits in place", async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), progress_unit: "pages", progress_value: 52 };
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Edit the page total, 360 pages" }).click();
  await page.locator("#bv-page-total").fill("300");
  await page.locator(".bv-progress-total-edit").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, total_pages: 300 });
});

test("keyboard order runs header, menu, box, Save, thought, Pause, Finish, journal", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  await expect(page.getByRole("link", { name: "Back to My Books" })).toBeVisible();
  await page.getByRole("link", { name: "Back to My Books" }).focus();
  const order = [["button", "More actions for Piranesi"], ["textbox", "Page or % for Piranesi"], ["button", "Save"], ["textbox", "Add a thought"], ["button", "Pause reading"], ["button", "Finish book"]];
  for (const [role, name] of order) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole(role, { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".bv-journal")))).toBe(true);
});

test("the save sends the reader's local day as `on`", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await onPage(page).fill("52");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => app.patches.length).toBe(1);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  expect(app.patches[0].on).toBe(today);
});

test("progress days show one line each in the journal, newest first; a missing or empty list shows nothing", async ({ page, app }) => {
  // The exact T55 shape: {day, unit, first_value, last_value}. A day sent under other names shows no line.
  app.progressDays = [{ day: "2026-11-14", unit: "pages", first_value: 14, last_value: 52 }, { day: "2026-11-12", unit: "percent", first_value: 20, last_value: 35 },
    { on: "2026-11-10", progress_unit: "pages", first: 1, last: 9 }];
  await page.goto("/my-books/101");
  const lines = page.locator(".bv-journal-day");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("14 Nov");
  await expect(lines.first()).toContainText("Page 14 → 52");
  await expect(lines.nth(1)).toContainText("20% → 35%");
  await expect(page.getByText("Page 1 → 9")).toHaveCount(0);
  for (const empty of [[], undefined]) {
    app.progressDays = empty;
    await page.goto("/my-books/101");
    await expect(page.locator(".bv-journal")).toBeVisible();
    await expect(page.locator(".bv-journal-day")).toHaveCount(0);
    await expect(page.getByText(/missing|no history|couldn’t load/i)).toHaveCount(0);
  }
});
