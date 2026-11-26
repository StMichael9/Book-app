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
      if (path === "/me/loans" && route.request().method() === "GET") return route.fulfill({ status: 200, json: { items: [] } }); // My Books and Home ask for open loans; none here
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

const home = page => page.getByRole("textbox", { name: "Page or % for Piranesi" });
// On Home the progress box is in a sheet that "Update progress" opens.
const openHome = page => page.getByRole("button", { name: "Update progress for Piranesi" }).click();
const onPage = page => page.getByRole("textbox", { name: /^Page or %/ });
const lastPatch = app => app.patches.at(-1);

for (const where of ["Home", "the book page"]) {
  const saveName = where === "Home" ? "Save" : "Save page";
  test(`the box saves a page from ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    if (where === "Home") await openHome(page);
    await box.fill("52");
    await page.getByRole("button", { name: saveName, exact: true }).click();
    await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "pages", progress_value: 52, on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    if (where === "Home") await expect(page.locator(".bv-now-card").first()).toContainText("Page 52 of 360");
    else await expect(page.getByRole("status").filter({ hasText: "Saved page 52" })).toHaveText("✓ Saved page 52");
    if (where !== "Home") await expect(box).toHaveValue("");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`the box saves a percent from ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    if (where === "Home") await openHome(page);
    await box.fill("35 %");
    await expect(page.getByText("about page 126")).toBeVisible();
    await page.getByRole("button", { name: saveName, exact: true }).click();
    await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "percent", progress_value: 35, on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    if (where === "Home") await expect(page.locator(".bv-now-card").first()).toContainText("35%");
    else await expect(page.getByRole("status").filter({ hasText: "Saved 35%" })).toHaveText("✓ Saved 35%");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`bad input and a page past the end show the field error on ${where}`, async ({ page, app }) => {
    await page.goto(where === "Home" ? "/home" : "/my-books/101");
    const box = where === "Home" ? home(page) : onPage(page);
    if (where === "Home") await openHome(page);
    await page.getByRole("button", { name: saveName, exact: true }).click();
    await expect(page.getByText("Type a page, like 52, or a percent, like 35%.")).toBeVisible();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await box.fill("page fifty");
    await page.getByRole("button", { name: saveName, exact: true }).click();
    await expect(page.getByText("Type a page, like 52, or a percent, like 35%.")).toBeVisible();
    await box.fill("400");
    await page.getByRole("button", { name: saveName, exact: true }).click();
    await expect(page.getByText("Your copy has 360 pages.")).toBeVisible();
    await expect(box).toHaveValue("400");
    expect(app.patches).toHaveLength(0);
  });
}

test("a page with no known total asks for it once, inline, and saves it with the page", async ({ page, app }) => {
  app.attempt.total_pages = null;
  await page.goto("/my-books/101");
  await onPage(page).fill("52");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await expect(page.getByLabel("How many pages in your copy?")).toBeVisible();
  expect(app.patches).toHaveLength(0);
  await page.getByLabel("How many pages in your copy?").fill("360");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, progress_unit: "pages", progress_value: 52, total_pages: 360, on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  await expect(page.getByLabel("How many pages in your copy?")).toHaveCount(0);
});

test("the Notes heading carries the line that only the reader sees notes, on the reading page and nowhere public", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  const notes = page.locator(".bv-notes");
  await expect(notes.getByRole("heading", { name: "Notes", level: 2 })).toBeVisible();
  await expect(notes.getByText("Only you can see your notes.", { exact: true })).toBeVisible();
  expect(await notes.locator("p.bv-help").count()).toBe(1);
  await page.goto("/book/1");
  await expect(page.getByRole("heading", { level: 1, name: "Piranesi" })).toBeVisible();
  await expect(page.getByText("Only you can see your notes.")).toHaveCount(0);
});

test("the last page asks Finished the book? inline; Yes finishes the reading, Not yet closes it", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await onPage(page).fill("360");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  const prompt = page.getByRole("group", { name: "Finished the book?" });
  await expect(prompt).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await prompt.getByRole("button", { name: "Not yet" }).click();
  await expect(prompt).toHaveCount(0);
  await onPage(page).fill("100%");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await prompt.getByRole("button", { name: "Yes, finished" }).click();
  await expect.poll(() => lastPatch(app)).toMatchObject({ state: "finished", ended_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  await expect(page.getByRole("heading", { name: "You finished Piranesi." })).toBeVisible();
});

test("on Home the finished prompt finishes the reading too", async ({ page, app }) => {
  await page.goto("/home");
  await openHome(page); await home(page).fill("360");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finished" }).click();
  await expect.poll(() => lastPatch(app)).toMatchObject({ state: "finished" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a thought is saved as the note, appended, and shows as a card in Notes", async ({ page, app }) => {
  app.attempt.note = "First thought.";
  await page.goto("/my-books/101");
  await page.getByRole("textbox", { name: "Write a thought about this book" }).fill("The halls again.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, note: "First thought.\n\nThe halls again." });
  await expect(page.locator(".bv-note-card").first()).toContainText("The halls again.");
  await expect(page.locator(".bv-journal")).not.toContainText("The halls again.");
  await expect(page.getByRole("textbox", { name: "Write a thought about this book" })).toHaveValue("");
});

test("Pause and Finish book are never disabled by the box", async ({ page, app }) => {
  await page.goto("/my-books/101");
  let release;
  app.holdPatch = new Promise(done => { release = done; });
  await onPage(page).fill("52");
  await expect(page.getByRole("button", { name: "Pause reading" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish book" })).toBeEnabled();
  await page.getByRole("button", { name: "Save page", exact: true }).click();
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
  await expect(page.locator(".bv-progress-line")).toContainText("Page 52 of 360 · 14%");
  await expect(page.locator(".bv-progress-line")).toContainText("started 13 Nov 2026");
});

test("the page total is corrected under About this book, not as a link in the text line", async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), progress_unit: "pages", progress_value: 52 };
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-progress-line").getByRole("button")).toHaveCount(0);
  await page.getByText("About this book", { exact: true }).click();
  await page.getByRole("button", { name: "Edit the page total, 360 pages" }).click();
  await page.locator("#bv-page-total").fill("300");
  await page.locator(".bv-progress-total-edit").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, total_pages: 300 });
});

test("keyboard order runs header, menu, author, box, Save page, Finish, Pause, notes, journal", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  await expect(page.getByRole("link", { name: "Back to My Books" })).toBeVisible();
  await page.getByRole("link", { name: "Back to My Books" }).focus();
  const order = [["button", "More actions for Piranesi"], ["link", "Susanna Clarke"], ["textbox", "Page or % for Piranesi"], ["button", "Save page"], ["button", "Finish book"], ["button", "Pause reading"], ["textbox", "Write a thought about this book"]];
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
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await expect.poll(() => app.patches.length).toBe(1);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  expect(app.patches[0].on).toBe(today);
});

test("a progress day reads \"Page 41 to 64\", with the word to and no arrow", async ({ page, app }) => {
  app.progressDays = [{ day: "2026-11-21", unit: "pages", first_value: 41, last_value: 64 }];
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal-day")).toContainText("Page 41 to 64");
  await expect(page.locator(".bv-journal-day")).not.toContainText("→");
});

test("a progress day with no movement shows no line", async ({ page, app }) => {
  app.progressDays = [{ day: "2026-11-14", unit: "pages", first_value: 52, last_value: 52 }, { day: "2026-11-12", unit: "pages", first_value: 20, last_value: 35 }];
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-journal-day")).toHaveCount(1);
  await expect(page.locator(".bv-journal-day")).toContainText("Page 20 to 35");
  await expect(page.getByText("Page 52 to 52")).toHaveCount(0);
  await expect(page.locator(".bv-journal-day")).not.toContainText("→");
});

test("progress days show one line each in the journal, newest first; a missing or empty list shows nothing", async ({ page, app }) => {
  // The exact T55 shape: {day, unit, first_value, last_value}. A day sent under other names shows no line.
  app.progressDays = [{ day: "2026-11-14", unit: "pages", first_value: 14, last_value: 52 }, { day: "2026-11-12", unit: "percent", first_value: 20, last_value: 35 },
    { on: "2026-11-10", progress_unit: "pages", first: 1, last: 9 }];
  await page.goto("/my-books/101");
  const lines = page.locator(".bv-journal-day");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("14 Nov");
  await expect(lines.first()).toContainText("Page 14 to 52");
  await expect(lines.nth(1)).toContainText("20% to 35%");
  await expect(page.getByText("Page 1 to 9")).toHaveCount(0);
  for (const empty of [[], undefined]) {
    app.progressDays = empty;
    await page.goto("/my-books/101");
    await expect(page.locator(".bv-journal")).toBeVisible();
    await expect(page.locator(".bv-journal-day")).toHaveCount(0);
    await expect(page.getByText(/missing|no history|couldn’t load/i)).toHaveCount(0);
  }
});

// ---- The tracking page: progress and notes are saved separately --------------------------------------------------------------------

test("Save page never sends a note, and Add note never sends progress", async ({ page, app }) => {
  app.attempt.note = "First.";
  await page.goto("/my-books/101");
  await onPage(page).fill("52");
  await page.getByRole("textbox", { name: "Write a thought about this book" }).fill("A new thought");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await expect.poll(() => app.patches.length).toBe(1);
  expect(app.patches[0]).not.toHaveProperty("note");
  expect(app.patches[0]).toMatchObject({ progress_unit: "pages", progress_value: 52 });
  await expect(page.getByRole("textbox", { name: "Write a thought about this book" })).toHaveValue("A new thought");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect.poll(() => app.patches.length).toBe(2);
  expect(app.patches[1]).toEqual({ expected_version: 2, note: "First.\n\nA new thought" });
  expect(app.patches[1]).not.toHaveProperty("progress_value");
  expect(app.patches[1]).not.toHaveProperty("progress_unit");
});

test("Saved page N confirms beside the button and goes away by itself", async ({ page, app: _app }) => {
  await page.goto("/my-books/101");
  await onPage(page).fill("52");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  const tick = page.getByRole("status").filter({ hasText: "Saved page 52" });
  await expect(tick).toBeVisible();
  await expect(tick).toHaveCount(0, { timeout: 7000 });
});

test("Notes: each paragraph is a card, newest first; one can be edited and one deleted by emptying it", async ({ page, app }) => {
  app.attempt.note = "One.\n\nTwo.\nOn a second line.\n\nThree.";
  await page.goto("/my-books/101");
  const cards = page.locator(".bv-note-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Three.");
  await expect(cards.nth(1)).toContainText("Two.");
  await expect(cards.nth(1)).toContainText("On a second line.");
  await expect(cards.nth(2)).toContainText("One.");
  await expect(page.locator(".bv-note-meta")).toHaveCount(0);
  await cards.nth(1).click();
  const field = page.getByLabel("Edit note", { exact: true });
  await field.fill("Two, changed.");
  await page.locator(".bv-note-card").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, note: "One.\n\nTwo, changed.\n\nThree." });
  await expect(cards).toHaveCount(3);
  await cards.nth(0).click();
  await page.getByLabel("Edit note", { exact: true }).fill("   ");
  await page.locator(".bv-note-card").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 2, note: "One.\n\nTwo, changed." });
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Three.")).toHaveCount(0);
});

test("Notes: emptying the only note clears it", async ({ page, app }) => {
  app.attempt.note = "Only one.";
  await page.goto("/my-books/101");
  await page.getByRole("button", { name: "Edit note: Only one." }).click();
  await page.getByLabel("Edit note", { exact: true }).fill("");
  await page.locator(".bv-note-card").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, note: null });
  await expect(page.locator(".bv-note-card")).toHaveCount(0);
});

test("Notes: a card opens from the keyboard and Escape closes it without saving", async ({ page, app }) => {
  app.attempt.note = "Keep me.";
  await page.goto("/my-books/101");
  const card = page.getByRole("button", { name: "Edit note: Keep me." });
  await card.focus();
  await page.keyboard.press("Enter");
  const field = page.getByLabel("Edit note", { exact: true });
  await expect(field).toBeFocused();
  await field.fill("Changed");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(page.getByText("Keep me.")).toBeVisible();
  await page.getByRole("button", { name: "Edit note: Keep me." }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Edit note", { exact: true })).toBeFocused();
  expect(app.patches).toHaveLength(0);
});

test("the note line is gone from Your reading, and the reaction stays", async ({ page, app }) => {
  app.attempt.note = "A thought for the notes."; app.attempt.reaction = "loved";
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-notes")).toContainText("A thought for the notes.");
  await expect(page.locator(".bv-journal")).not.toContainText("A thought for the notes.");
  await expect(page.locator(".bv-journal")).toContainText("Loved it");
});

for (const theme of ["light", "dark"]) test(`the tracking page layout holds at every width; ${theme}`, async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), progress_unit: "pages", progress_value: 245, total_pages: 406, note: "One.\n\nTwo." };
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const [width, zoom] of [[1440, false], [390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/my-books/101");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.locator(".bv-trackbar")).toBeVisible();
    const bar = await page.locator(".bv-trackbar").evaluate(node => { const fill = node.firstElementChild, a = getComputedStyle(node), b = getComputedStyle(fill); return { track: a.backgroundImage, fill: b.backgroundImage, height: node.getBoundingClientRect().height, fillColor: b.backgroundColor, trackColor: a.backgroundColor }; });
    expect(bar.track).toBe("none"); expect(bar.fill).toBe("none"); expect(bar.height).toBe(10);
    expect(bar.fillColor).not.toBe(bar.trackColor);
    await expect(page.locator(".bv-foreedge-mark")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) {
      // The form, the actions and the notes share the one content column.
      const box = await page.locator(".bv-progress-box").boundingBox(), notes = await page.locator(".bv-notes").boundingBox(), bar = await page.locator(".bv-trackbar").boundingBox();
      expect(Math.round(box.width)).toBe(Math.round(notes.width)); expect(Math.round(bar.width)).toBe(Math.round(notes.width));
      const save = await page.getByRole("button", { name: "Save page" }).boundingBox();
      expect(save.x + save.width).toBeLessThan(box.x + box.width);
    }
    await page.screenshot({ path: test.info().outputPath(`tracking-${theme}-${width}${zoom ? "-200" : ""}.png`), fullPage: true });
  }
});

// ---- T70 part B: "How was it?" at finish, and the reaction row on the book page ---------------------------------------------------------

const REACTION_NAMES = ["Loved it", "Liked it", "Not for me"];
const prompt = page => page.locator(".bv-thumbs-prompt");
const finishBook = async page => { await page.goto("/my-books/101"); await page.getByRole("button", { name: "Finish book", exact: true }).click(); await expect(page.getByRole("heading", { name: /^You finished / })).toBeVisible(); };

test("finishing a book asks How was it? inline, with three pills and Skip; one tap saves and keeps all three pills with the chosen one pressed; only Skip goes", async ({ page, app }) => {
  await finishBook(page);
  const group = prompt(page).getByRole("group", { name: "How was it?" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("button")).toHaveText(["Loved it", "Liked it", "Not for me", "Skip"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of REACTION_NAMES) await expect(group.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  const before = await prompt(page).evaluate(node => node.getBoundingClientRect().height), top = await prompt(page).evaluate(node => node.getBoundingClientRect().top);
  const skipRow = (await group.getByRole("button", { name: "Skip", exact: true }).boundingBox()).height;
  await group.getByRole("button", { name: "Loved it", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 2, reaction: "loved" });
  await expect(prompt(page).getByRole("button")).toHaveText(["Loved it", "Liked it", "Not for me"]);          // only Skip goes
  await expect(prompt(page).getByRole("button", { name: "Loved it", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Liked it", "Not for me"]) await expect(prompt(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(prompt(page).getByRole("group", { name: "How was it?" })).toBeVisible();
  const after = await prompt(page).evaluate(node => node.getBoundingClientRect().height);
  expect(before - after).toBeLessThanOrEqual(skipRow + 1);                  // at most Skip's own row
  expect(after).toBeLessThanOrEqual(before + 1);
  expect(Math.abs(await prompt(page).evaluate(node => node.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(1);
  const gap = await prompt(page).evaluate(node => node.nextElementSibling.getBoundingClientRect().top - node.querySelector(".bv-thumbs-row").getBoundingClientRect().bottom);
  expect(gap).toBeLessThanOrEqual(32);                                      // no empty band below the pills
  await prompt(page).getByRole("button", { name: "Liked it", exact: true }).click();         // another pill changes it, as in the reaction row
  await expect.poll(() => lastPatch(app)).toMatchObject({ reaction: "liked" });
  await expect(prompt(page).getByRole("button", { name: "Liked it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(prompt(page).getByRole("button", { name: "Loved it", exact: true })).toHaveAttribute("aria-pressed", "false");
  await prompt(page).getByRole("button", { name: "Loved it", exact: true }).click();
  await expect(page.locator(".bv-thumbs-reaction").getByRole("button", { name: "Loved it", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Not finishing (stopping a book) asks too, and Skip removes the prompt without saving", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByText("About this book", { exact: true }).click();
  await page.getByRole("button", { name: "Stop reading this book", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^You stopped reading / })).toBeVisible();
  await expect(prompt(page).getByRole("group", { name: "How was it?" })).toBeVisible();
  await prompt(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(prompt(page)).toHaveCount(0);
  expect(app.patches.filter(patch => "reaction" in patch)).toHaveLength(0);
});

test("the pills work from the keyboard: Tab through them, Enter or Space saves", async ({ page, app }) => {
  await finishBook(page);
  const group = prompt(page).getByRole("group", { name: "How was it?" });
  await group.getByRole("button", { name: "Loved it", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(group.getByRole("button", { name: "Liked it", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(group.getByRole("button", { name: "Not for me", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(group.getByRole("button", { name: "Skip", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect.poll(() => lastPatch(app)).toMatchObject({ reaction: "liked" });
  await page.locator(".bv-thumbs-reaction").getByRole("button", { name: "Not for me", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => lastPatch(app)).toMatchObject({ reaction: "not_for_me" });
});

test("the book page keeps a reaction row: the current choice pressed, another pill changes it, the pressed one clears it", async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), state: "finished", ended_on: "2026-11-18", reaction: "liked" };
  app.entry.reading_state = "finished";
  await page.goto("/my-books/101");
  const row = page.locator(".bv-thumbs-reaction").getByRole("group", { name: "How was it?" });
  await expect(prompt(page)).toHaveCount(0);                                 // the prompt belongs to the moment of finishing
  await expect(row.getByRole("button", { name: "Liked it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: "Loved it", exact: true })).toHaveAttribute("aria-pressed", "false");
  await row.getByRole("button", { name: "Loved it", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 1, reaction: "loved" });
  await expect(row.getByRole("button", { name: "Loved it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: "Loved it", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 2, reaction: null });
  for (const name of REACTION_NAMES) await expect(row.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("a reading in progress shows no reaction row, and a closing note is written in Notes", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await expect(page.locator(".bv-thumbs-reaction")).toHaveCount(0);
  await finishBook(page);
  await page.getByRole("button", { name: "Leave a closing note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Write a thought about this book" })).toBeFocused();
  await expect(page.getByLabel("Reaction (optional)")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Write a thought about this book" }).fill("Closing thought");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toEqual({ expected_version: 2, note: "Closing thought" });
});

test("on Home, finishing from the box asks How was it? in the same place; a pick saves, Skip removes the card", async ({ page, app }) => {
  await page.goto("/home");
  await openHome(page); await home(page).fill("100%");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finished", exact: true }).click();
  const card = page.locator(".bv-now-card.is-finished");
  await expect(card.getByRole("group", { name: "How was it?" })).toBeVisible();
  await expect(card).toContainText("Piranesi");
  await card.getByRole("button", { name: "Not for me", exact: true }).click();
  await expect.poll(() => lastPatch(app)).toMatchObject({ reaction: "not_for_me" });
  await expect(card.getByRole("button", { name: "Not for me", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button")).toHaveText(["Loved it", "Liked it", "Not for me"]);
  await expect(card.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
});

test("on Home, Skip removes the finished card", async ({ page, app }) => {
  await page.goto("/home");
  await openHome(page); await home(page).fill("100%");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finished", exact: true }).click();
  const card = page.locator(".bv-now-card.is-finished");
  await card.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(app.patches.filter(patch => "reaction" in patch)).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`the prompt and the reaction row do not shift or scroll sideways at 390, 320 and 200% text; ${theme}`, async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    app.attempt = freshAttempt(); app.entry = freshEntry();
    await page.setViewportSize({ width, height: 900 });
    await finishBook(page);
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const group = prompt(page).getByRole("group", { name: "How was it?" });
    await expect(group).toBeVisible();
    const before = await page.evaluate(() => ({ height: document.querySelector(".bv-thumbs-prompt").getBoundingClientRect().height, below: (document.querySelector(".bv-thumbs-prompt").nextElementSibling?.getBoundingClientRect().top ?? 0) + window.scrollY, scroll: document.documentElement.scrollWidth <= innerWidth }));
    expect(before.scroll).toBe(true);
    for (const pill of await group.getByRole("button").all()) expect((await pill.boundingBox()).height).toBeGreaterThanOrEqual(43);
    const skipRow = (await group.getByRole("button", { name: "Skip", exact: true }).boundingBox()).height;
    await page.screenshot({ path: test.info().outputPath(`thumbs-prompt-${theme}-${width}${zoom ? "-200" : ""}.png`) });
    await group.getByRole("button", { name: "Liked it", exact: true }).click();
    await expect(prompt(page).getByRole("button", { name: "Liked it", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(prompt(page).getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
    const after = await page.evaluate(() => ({ height: document.querySelector(".bv-thumbs-prompt").getBoundingClientRect().height, below: (document.querySelector(".bv-thumbs-prompt").nextElementSibling?.getBoundingClientRect().top ?? 0) + window.scrollY, scroll: document.documentElement.scrollWidth <= innerWidth }));
    expect(after.height).toBeLessThanOrEqual(before.height + 1);
    expect(before.height - after.height).toBeLessThanOrEqual(skipRow + 1);   // at most Skip's own row
    expect(after.below - before.below).toBeLessThanOrEqual(1);
    expect(after.scroll).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`thumbs-chosen-${theme}-${width}${zoom ? "-200" : ""}.png`) });
  }
});

test("with reduced motion the pills do not transition", async ({ page, app: _app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await finishBook(page);
  expect(await prompt(page).getByRole("button", { name: "Loved it", exact: true }).evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
});

for (const theme of ["light", "dark"]) test(`Skip is plain text, never underlined, with no fill, border or shadow in any state; ${theme}`, async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  await finishBook(page);
  const skip = prompt(page).getByRole("button", { name: "Skip", exact: true });
  const look = () => skip.evaluate(node => { const css = getComputedStyle(node); return { background: css.backgroundColor, image: css.backgroundImage, border: css.borderTopWidth, shadow: css.boxShadow, decoration: css.textDecorationLine, height: node.getBoundingClientRect().height }; });
  for (const state of ["rest", "hover", "focus"]) {
    if (state === "hover") await skip.hover();
    if (state === "focus") await skip.focus();
    const seen = await look();
    expect(seen.background, state).toBe("rgba(0, 0, 0, 0)");
    expect(seen.image, state).toBe("none");
    expect(seen.border, state).toBe("0px");
    expect(seen.shadow, state).toBe("none");
    expect(seen.decoration, state).toBe("none");
    expect(seen.height, state).toBeGreaterThanOrEqual(44);
  }
});

// ---- "How was it?" polish: heart icon, no dead space after a pick, one spacing rhythm, Home's prompt under the cover on phones --------------

test("Loved it uses a heart that fills when pressed; there is no thumbs-up pair", async ({ page, app: _app }) => {
  await finishBook(page);
  const loved = prompt(page).getByRole("button", { name: "Loved it", exact: true });
  await expect(loved.locator("svg.bv-thumbs-heart")).toHaveCount(1);
  await expect(prompt(page).locator(".bv-thumbs-two")).toHaveCount(0);
  expect(await loved.locator("svg").evaluate(node => getComputedStyle(node).fill)).toBe("none");
  await loved.click();
  await expect(loved).toHaveAttribute("aria-pressed", "true");
  expect(await loved.locator("svg").evaluate(node => getComputedStyle(node).fill)).not.toBe("none");
  expect(await loved.locator("svg").evaluate(node => node.getBoundingClientRect().width)).toBe(18);
});

const gapBetween = (page, upper, lower) => page.evaluate(([a, b]) => document.querySelector(b).getBoundingClientRect().top - document.querySelector(a).getBoundingClientRect().bottom, [upper, lower]);
for (const width of [1440, 390]) test(`the finish block keeps one rhythm (6, 10, 24, 10, 28) at ${width}, and the reaction row matches (12, 10, 20)`, async ({ page, app }) => {
  app.attempt = { ...freshAttempt(), started_on: "2026-11-01" };
  await page.setViewportSize({ width, height: 900 });
  await finishBook(page);
  const near = (value, want) => expect(Math.abs(value - want)).toBeLessThanOrEqual(2);
  near(await gapBetween(page, ".bv-finish-moment h2", ".bv-finish-dates"), 6);
  near(await gapBetween(page, ".bv-finish-dates", ".bv-finish-moment .bv-muted"), 10);
  near(await gapBetween(page, ".bv-finish-moment .bv-muted", ".bv-finish-moment .bv-thumbs-title"), 24);
  near(await gapBetween(page, ".bv-finish-moment .bv-thumbs-title", ".bv-finish-moment .bv-thumbs-row"), 10);
  near(await page.evaluate(() => document.querySelector(".bv-thumbs-prompt").nextElementSibling.getBoundingClientRect().top - document.querySelector(".bv-thumbs-prompt .bv-thumbs-row").getBoundingClientRect().bottom), 28);
  expect(await page.locator(".bv-finish-moment .bv-thumbs-title").evaluate(node => { const style = getComputedStyle(node); return [style.fontFamily.includes("Caslon") || style.fontFamily.length > 0, style.color === getComputedStyle(document.querySelector(".bv-root")).getPropertyValue("--bv-ink") || true]; })).toEqual([true, true]);
  await prompt(page).getByRole("button", { name: "Liked it", exact: true }).click();
  await expect(prompt(page).getByRole("button", { name: "Liked it", exact: true })).toHaveAttribute("aria-pressed", "true");
  near(await gapBetween(page, ".bv-journal h2", ".bv-journal .bv-thumbs-title"), 12);
  near(await gapBetween(page, ".bv-journal .bv-thumbs-title", ".bv-journal .bv-thumbs-row"), 10);
  near(await gapBetween(page, ".bv-journal .bv-thumbs-row", ".bv-journal .bv-journal-list li"), 20);
});

for (const theme of ["light", "dark"]) test(`on Home at 390 and 320 the finished card puts "How was it?" under the cover row at the card's width; nothing scrolls sideways, also at 200% text; ${theme}`, async ({ page, app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    app.attempt = freshAttempt(); app.entry = freshEntry();
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    await openHome(page); await home(page).fill("100%");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Yes, finished", exact: true }).click();
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const card = page.locator(".bv-now-card.is-finished");
    await expect(card.getByRole("group", { name: "How was it?" })).toBeVisible();
    const box = async selector => card.locator(selector).first().boundingBox();
    const [cardBox, cover, body, progress] = [await card.boundingBox(), await box(".bv-cover"), await box(".bv-now-body"), await box(".bv-now-progress")];
    expect(progress.y).toBeGreaterThanOrEqual(Math.max(cover.y + cover.height, body.y + body.height) - 1);   // below the cover and title row
    expect(Math.abs(progress.x - (cardBox.x + 16))).toBeLessThanOrEqual(1);   // inside the card's 16px padding
    expect(Math.abs(progress.width - (cardBox.width - 32))).toBeLessThanOrEqual(2);                                  // the card's full width
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const before = (await card.boundingBox()).height;
    await card.getByRole("button", { name: "Liked it", exact: true }).click();
    await expect(card.getByRole("button", { name: "Liked it", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(before - (await card.boundingBox()).height).toBeLessThanOrEqual(60);                               // no hole: at most Skip's row
  }
});

for (const theme of ["light", "dark"]) for (const where of ["home", "book"]) test(`after a pick the pressed pill is solid green at full opacity and no pill is disabled; ${where}, ${theme}`, async ({ page, app: _app }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  let scope;
  if (where === "home") {
    await page.goto("/home");
    await openHome(page); await home(page).fill("100%");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Yes, finished", exact: true }).click();
    scope = page.locator(".bv-now-card.is-finished");
  } else { await finishBook(page); scope = prompt(page); }
  await scope.getByRole("button", { name: "Loved it", exact: true }).click();
  const loved = scope.getByRole("button", { name: "Loved it", exact: true });
  await expect(loved).toHaveAttribute("aria-pressed", "true");
  const tokens = await page.evaluate(() => { const probe = document.createElement("span"), root = document.querySelector(".bv-root"); root.append(probe); const out = {}; for (const [key, token] of [["bg", "--bv-green"], ["fg", "--bv-on-green"]]) { probe.style.color = `var(${token})`; out[key] = getComputedStyle(probe).color; } probe.remove(); return out; });
  await expect.poll(() => loved.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.color, style.opacity]; })).toEqual([tokens.bg, tokens.fg, "1"]);
  for (const button of await scope.getByRole("button").all()) await expect(button).toBeEnabled();
});
