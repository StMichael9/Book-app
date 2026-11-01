import { test as base, expect } from "@playwright/test";

// Browser fixtures only, built on the T27 contract: list entries carry `snippet` and `save_note`, and the library-entry PATCH
// accepts `save_note` and (for private entries) `private_description`, both guarded by `expected_version`.
const books = [1, 2, 3, 4].map(id => ({ id, title: ["Quiet Harbour", "Second Light", "The Long Way", "Ashes of Spring"][id - 1], authors: [{ id: 1, name: "Fixture Author" }], tags: [], cover_image_url: null, english_title: null, description: `About book ${id}.`, page_count: 200 }));
const entry = (id, extra = {}) => ({ id: 100 + id, book_id: id, book: books[id - 1], is_owned: false, is_wanted: true, version: 1, reading_state: null, save_note: null, snippet: null,
  private_title: null, private_author: null, private_description: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...extra });
const privateEntry = (extra = {}) => ({ id: 300, book_id: null, book: null, is_owned: true, is_wanted: false, version: 1, reading_state: null, save_note: null, snippet: null,
  private_title: "My Private Book", private_author: "Someone", private_description: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...extra });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entries: new Map(), requests: [], errors: [], readingActions: false, down: false, failPatch: 0, saveNoteOnPut: null };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/me/profile") return reply(200, { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/lists") return state.down ? reply(503, { detail: "down" }) : reply(200, []);
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: state.readingActions, private_context: state.readingActions } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, books[Number(path.split("/").at(-1)) - 1]);
      if (path === "/books") return reply(200, { items: books, total: books.length, page: 1, size: 30 });
      if (path === "/me/library") {
        const items = [...state.entries.values()];
        return reply(200, { items, counts: { all: items.length, owned: 0, want: items.length, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: items.length, next_cursor: null });
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => { const saved = state.entries.get(id);
        return { book_id: id, entry_id: saved?.id ?? null, version: saved?.version ?? null, is_owned: saved?.is_owned ?? false, is_wanted: saved?.is_wanted ?? false, reading_state: null }; }) });
      const flag = path.match(/^\/me\/library\/books\/(\d+)$/);
      if (flag && method === "PUT") {
        const id = Number(flag[1]), saved = state.entries.get(id) || entry(id, { is_wanted: false, version: 0 });
        const next = { ...saved, ...body, version: saved.version + 1, ...(state.saveNoteOnPut ? { save_note: state.saveNoteOnPut } : {}) }; delete next.expected_version;
        state.entries.set(id, next); return reply(200, next);
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) { const found = [...state.entries.values()].find(item => item.id === Number(workspace[1])); return found ? reply(200, { entry: found, current_attempt: null, editions: [] }) : reply(404, {}); }
      const patch = path.match(/^\/me\/library\/(\d+)$/);
      if (patch && method === "PATCH") {
        if (state.failPatch > 0) { state.failPatch -= 1; return reply(500, { detail: "nope" }); }
        const found = [...state.entries.values()].find(item => item.id === Number(patch[1]));
        if (body.expected_version !== found.version) return reply(409, { detail: "This book changed somewhere else. Load the saved version." });
        const next = { ...found, ...body, version: found.version + 1 }; delete next.expected_version;
        state.entries.set(found.book_id ?? found.id, next); return reply(200, next);
      }
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
const patches = app => app.requests.filter(request => request.method === "PATCH");

test("a My Books card shows the reader's own reason in italics, else the description's start, else nothing", async ({ page, app }) => {
  app.entries.set(1, entry(1, { save_note: "Because a friend swore by it", snippet: "A quiet town and a long winter…" }));
  app.entries.set(2, entry(2, { snippet: "Two sisters inherit a lighthouse…" }));
  app.entries.set(3, entry(3));
  await page.goto("/my-books");
  const cards = page.locator(".bv-personal-book");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator(".bv-card-line")).toHaveText("Because a friend swore by it");
  await expect(cards.nth(0).locator(".bv-card-line")).toHaveClass(/bv-card-line--reason/);
  await expect(cards.nth(0).locator(".bv-card-line")).toHaveCSS("font-style", "italic");
  await expect(cards.nth(1).locator(".bv-card-line")).toHaveText("Two sisters inherit a lighthouse…");
  await expect(cards.nth(1).locator(".bv-card-line")).not.toHaveClass(/bv-card-line--reason/);
  await expect(cards.nth(2).locator(".bv-card-line")).toHaveCount(0);
  // Two lines at most, and no extra tab stop: the title link is the only link that opens the book.
  expect(await cards.nth(0).locator(".bv-card-line").evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe("2");
  await expect(cards.nth(0).locator("a")).toHaveCount(2);
  await expect(cards.nth(0).getByRole("link", { name: "Quiet Harbour", exact: true })).toHaveAccessibleDescription("Because a friend swore by it");
  await cards.nth(1).locator(".bv-card-line").click();
  await expect(page).toHaveURL(/\/book\/2$/);
});

test("a long card line is held to two lines", async ({ page, app }) => {
  app.entries.set(1, entry(1, { snippet: "word ".repeat(80).trim() }));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/my-books");
  const line = page.locator(".bv-card-line");
  const [height, lineHeight] = await line.evaluate(node => [node.getBoundingClientRect().height, parseFloat(getComputedStyle(node).lineHeight)]);
  expect(height).toBeLessThanOrEqual(lineHeight * 2 + 1);
});

test("Want to read asks why once, saves the reason, and does not come back after a reload", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  const field = page.getByLabel("Why this one? (only you see this)");
  await expect(field).toBeFocused();
  await field.fill("Recommended by Sam");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeFocused();
  expect(patches(app).at(-1).body).toEqual({ expected_version: 1, save_note: "Recommended by Sam" });
  expect(app.entries.get(1).is_wanted).toBe(true);
  // Remove it, add it again, reload and add again: the same book is never asked twice.
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  // The reason shows on the My Books card after a reload.
  app.entries.get(1).snippet = "About book 1.";
  await page.goto("/my-books");
  await expect(page.locator(".bv-card-line")).toHaveText("Recommended by Sam");
});

test("Skip and Esc end the prompt for good and return focus to the Want button", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toBeFocused();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeFocused();
  await page.goto("/book/2");
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeFocused();
  expect(patches(app)).toHaveLength(0);
});

test("the prompt is not offered for Owned, for a book that already has a reason, on cards, or for guests", async ({ page, app }) => {
  await page.goto("/book/1");
  await page.getByRole("button", { name: /I own it|Own/ }).first().click();
  await expect(page.getByRole("button", { name: /Owned/ }).first()).toBeVisible();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  app.saveNoteOnPut = "Already have a reason";
  await page.goto("/book/2");
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  await expect(page.getByRole("button", { name: /Remove Second Light from Want to read/ })).toBeVisible();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  app.saveNoteOnPut = null;
  await page.goto("/browse");
  await page.getByRole("button", { name: /Want/ }).first().click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
});

test("a failed reason save says so and the book stays saved", async ({ page, app }) => {
  await page.goto("/book/3");
  await page.getByRole("button", { name: /Want to read/ }).first().click();
  app.failPatch = 1;
  await page.getByLabel("Why this one? (only you see this)").fill("Maybe later");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("We couldn’t save that. Try again.")).toBeVisible();
  expect(app.entries.get(3).is_wanted).toBe(true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Why this one? (only you see this)")).toHaveCount(0);
  expect(patches(app).at(-1).body.save_note).toBe("Maybe later");
});

test("the reading page opens 'Why I saved this book' when there is a note, and keeps the quiet button when there is not", async ({ page, app }) => {
  app.readingActions = true;
  app.entries.set(1, entry(1, { save_note: "Because a friend swore by it" }));
  app.entries.set(2, entry(2));
  await page.goto("/my-books/101");
  const reason = page.locator(".bv-save-reason");
  await expect(reason).toHaveAttribute("open", "");
  await expect(reason.getByText("Because a friend swore by it")).toBeVisible();
  await page.goto("/my-books/102");
  await expect(page.locator(".bv-save-reason")).not.toHaveAttribute("open", "");
  await page.locator(".bv-save-reason summary").click();
  await expect(page.getByRole("button", { name: "Add save reason (optional)" })).toBeVisible();
});

test("a private book without a description shows no description line, and one with a description shows it", async ({ page, app }) => {
  app.readingActions = true;
  app.entries.set(300, privateEntry());
  app.entries.set(301, privateEntry({ id: 301, private_title: "Filled In", private_description: "Filled in by the server." }));
  await page.goto("/my-books/300");
  await expect(page.getByRole("heading", { name: "My Private Book", level: 1 })).toBeVisible();
  await expect(page.getByText("No description")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "About this book" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /description/i })).toHaveCount(0);
  await page.goto("/my-books/301");
  await expect(page.getByText("Filled in by the server.")).toBeVisible();
  await expect(page.getByRole("button", { name: /description/i })).toHaveCount(0);
  expect(patches(app)).toHaveLength(0);
});

test("while the outage banner shows, Want and Own are disabled with a visible hint", async ({ page, app }) => {
  await page.goto("/book/1");
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeEnabled();
  app.down = true;
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText("Bookvane is having trouble on our end.")).toBeVisible();
  const want = page.getByRole("button", { name: /Want to read/ }).first(), own = page.getByRole("button", { name: /I own it|Own/ }).first();
  await expect(want).toBeDisabled();
  await expect(own).toBeDisabled();
  await expect(page.getByText("Saving is paused for now", { exact: true })).toBeVisible();
  await expect(want).toHaveAccessibleDescription("Saving is paused for now");
  app.down = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(want).toBeEnabled();
});

test("the profile sheet marks what is shown with an icon, not a text tick", async ({ page, app }) => {
  void app;
  await page.route("**/test-api/me/profile", route => route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: true, reading_since: 2026 } }));
  await page.goto("/browse");
  const sheet = page.getByRole("dialog", { name: "Let friends find you?" });
  await expect(sheet.locator("svg.lucide-check")).toHaveAttribute("aria-hidden", "true");
  await expect(sheet).not.toContainText("✓");
});

test("description screenshots", async ({ page, app }) => {
  test.skip(!process.env.BOOK_SHOTS, "set BOOK_SHOTS=1 to export screenshots");
  const dir = "node_modules/.bv-preview/descriptions";
  app.readingActions = true;
  app.entries.set(1, entry(1, { save_note: "Because a friend swore by it, and the cover looked lovely on the shelf at the shop" }));
  app.entries.set(2, entry(2, { snippet: "Two sisters inherit a lighthouse and a secret that the whole village would rather keep buried under the winter snow." }));
  app.entries.set(3, entry(3));
  app.entries.set(300, privateEntry({ private_description: "A memoir lent to me by my aunt." }));
  for (const theme of ["light", "dark"]) for (const [label, width, height] of [["375", 375, 812], ["1440", 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.goto("/my-books"); await expect(page.locator(".bv-personal-book").first()).toBeVisible();
    await page.screenshot({ path: `${dir}/cards-${label}-${theme}.png`, fullPage: true });
    await page.goto("/book/4"); await page.evaluate(() => localStorage.removeItem("bookvane:why-asked:v1"));
    await page.getByRole("button", { name: /Want to read/ }).first().click();
    await expect(page.getByLabel("Why this one? (only you see this)")).toBeFocused();
    await page.getByLabel("Why this one? (only you see this)").fill("Heard it on a podcast");
    await page.screenshot({ path: `${dir}/prompt-${label}-${theme}.png` });
    await page.getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: /Remove Ashes of Spring from Want to read/ }).click();
    await page.goto("/my-books/300"); await expect(page.getByText("A memoir lent to me by my aunt.")).toBeVisible();
    await page.screenshot({ path: `${dir}/private-${label}-${theme}.png`, fullPage: true });
  }
});
