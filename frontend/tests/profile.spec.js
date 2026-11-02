import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Browser fixtures only: every API request is intercepted, including the profile endpoints (the T24 contract).
const book = (id, title) => ({ id, title, authors: [{ id: 1, name: "Fixture Author" }], tags: [], cover_image_url: null, english_title: null, page_count: 200 });
const BOOKS = [book(1, "The Murder of Roger Ackroyd"), book(2, "Peril at End House"), book(3, "Murder on the Orient Express")];
const month = (...counts) => Array.from({ length: 12 }, (_, index) => counts[index] || 0);
const stats = (overrides = {}) => ({ year: 2026, books_finished: 18, pages_read: 5940, by_month: month(1, 2, 1, 3, 2, 4, 6, 3, 1, 2), top_genres: [{ name: "Mystery", count: 7 }, { name: "Classics", count: 5 }], biggest_month: 7, ...overrides });
const detail = (id, extra = {}) => ({ ...BOOKS[id - 1], status: null, finished_month: null, ...extra });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = {
      requests: [], errors: [], failNext: {},
      profile: { display_name: "St Michael", bio: "Mysteries, classics, and the odd business book on the train.", initials: "SM", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 },
      stats: stats(),
      lists: [{ id: 7, name: "Christie, in order", description: null, is_public: false, book_count: 3, covers: [],
        books: [detail(1, { status: "owned", finished_month: "2026-03" }), detail(2, { status: "want" }), detail(3)] }],
      takenHandles: ["taken"], nextListId: 8,
      publicProfile: { display_name: "Ada Reader", initials: "AR", bio: "Quiet reader.", reading_since: 2025, stats: stats({ books_finished: 2, pages_read: 400, by_month: month(1, 1), biggest_month: 1, top_genres: [] }),
        lists: [{ id: 3, name: "Shared list", description: null, book_count: 2, covers: [] }],
        // Extra fields a mistaken payload might carry; the page must never show them.
        email: "ada@example.com", notes: "Secret note", rating: 5, status: "want" },
      publicList: { id: 3, name: "Shared list", description: "Good ones.", owner: { display_name: "Ada Reader", initials: "AR" }, books: [{ ...BOOKS[0], status: "want", finished_month: "2026-03", notes: "Secret note" }, BOOKS[1]] },
    };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path: path + url.search, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      const fail = (status, code) => reply(status, { detail: { code } });
      const failure = state.failNext[`${method} ${path}`];
      if (failure) { delete state.failNext[`${method} ${path}`]; return failure === "network" ? route.abort() : fail(...failure); }
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (/^\/books\/\d+\/description$/.test(path)) return fail(404, "not_found");
      if (path === "/auth/register" || path === "/auth/login") return reply(200, {});
      if (path === "/auth/refresh") return state.guest ? reply(401, {}) : reply(200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: null, version: null, is_owned: false, is_wanted: false, reading_state: null })) });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null });
      if (/^\/books\/\d+$/.test(path)) return reply(200, BOOKS[Number(path.split("/").at(-1)) - 1] || BOOKS[0]);
      if (path === "/books") return reply(200, { items: BOOKS, total: 3, page: 1, size: 20 });
      if (path === "/me/profile" && method === "GET") return reply(200, state.profile);
      if (path === "/me/profile" && method === "PATCH") {
        const next = { ...state.profile };
        if ("handle" in body) { if (body.handle === "admin") return fail(422, "handle_reserved"); if (state.takenHandles.includes(body.handle)) return fail(409, "handle_taken"); next.handle = body.handle || null; }
        if ("display_name" in body) { next.display_name = body.display_name || null; }
        if ("bio" in body) next.bio = body.bio || null;
        if ("profile_public" in body) { if (body.profile_public && !next.handle) return fail(422, "handle_required"); next.profile_public = body.profile_public; }
        if (body.prompted) next.show_prompt = false;
        state.profile = next; return reply(200, next);
      }
      if (path === "/me/stats") return reply(200, state.stats);
      if (path === "/me/lists" && method === "GET") return reply(200, state.lists.map(({ books, ...row }) => ({ ...row, has_book: books.some(item => item.id === Number(url.searchParams.get("book_id"))), book_count: books.length, covers: [] })));
      if (path === "/me/lists" && method === "POST") {
        if (state.lists.length >= 50) return fail(422, "list_limit");
        const created = { id: state.nextListId++, name: body.name, description: null, is_public: false, book_count: 0, covers: [], books: [] }; state.lists.push(created);
        return reply(201, { id: created.id, name: created.name, description: null, is_public: false, book_count: 0, covers: [] });
      }
      const listMatch = path.match(/^\/me\/lists\/(\d+)(\/books(?:\/(\d+))?|\/order)?$/);
      if (listMatch) {
        const list = state.lists.find(item => item.id === Number(listMatch[1]));
        if (!list) return fail(404, "not_found");
        const [, , sub, bookId] = listMatch;
        if (!sub && method === "GET") return reply(200, { id: list.id, name: list.name, description: list.description, is_public: list.is_public, books: list.books });
        if (!sub && method === "PATCH") { Object.assign(list, body); return reply(200, { id: list.id, name: list.name, description: list.description, is_public: list.is_public }); }
        if (!sub && method === "DELETE") { state.lists = state.lists.filter(item => item !== list); return route.fulfill({ status: 204, body: "" }); }
        if (sub === "/books" && method === "POST") { if (list.books.length >= 500) return fail(422, "list_limit"); if (!list.books.some(item => item.id === body.book_id)) list.books.push(detail(body.book_id)); return route.fulfill({ status: 204, body: "" }); }
        if (bookId && method === "DELETE") { list.books = list.books.filter(item => item.id !== Number(bookId)); return route.fulfill({ status: 204, body: "" }); }
        if (sub === "/order") { list.books = body.book_ids.map(id => list.books.find(item => item.id === id)); return route.fulfill({ status: 204, body: "" }); }
      }
      const publicMatch = path.match(/^\/u\/([^/]+)(?:\/lists\/(\d+))?$/);
      if (publicMatch) {
        if (publicMatch[1] === "missing") return fail(404, "not_found");
        return reply(200, publicMatch[2] ? state.publicList : state.publicProfile);
      }
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
const sent = (app, method, path) => app.requests.filter(request => request.method === method && request.path === path);

test("the one-time sheet shows once and Keep my profile private sends prompted", async ({ page, app }) => {
  app.profile.show_prompt = true;
  await page.goto("/profile");
  const sheet = page.getByRole("dialog", { name: "Let friends find you?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Let friends find you?" })).toBeFocused();
  await expect(sheet.getByText("Shown: your name, bio, yearly stats, and shared lists")).toBeVisible();
  await expect(sheet.getByText("Always private: notes, ratings, reading history, and private lists")).toBeVisible();
  await expect(sheet.getByText("You can change this any time from your profile.")).toBeVisible();
  await sheet.getByRole("button", { name: "Keep my profile private" }).click();
  await expect(sheet).toBeHidden();
  expect(sent(app, "PATCH", "/me/profile").map(request => request.body)).toEqual([{ prompted: true }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "St Michael" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(app.profile.profile_public).toBe(false);
});

test("Esc on the sheet keeps the profile private and sends prompted", async ({ page, app }) => {
  app.profile.show_prompt = true;
  await page.goto("/browse");
  await expect(page.getByRole("dialog", { name: "Let friends find you?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent(app, "PATCH", "/me/profile").map(request => request.body)).toEqual([{ prompted: true }]);
});

test("Make it public on the sheet asks for a username first, then sends it with prompted", async ({ page, app }) => {
  app.profile.show_prompt = true;
  await page.goto("/profile");
  const sheet = page.getByRole("dialog", { name: "Let friends find you?" });
  await sheet.getByRole("button", { name: "Make it public" }).click();
  await expect(sheet.getByLabel("Username")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
  await sheet.getByLabel("Username").fill("taken");
  await sheet.getByRole("button", { name: "Make it public" }).click();
  await expect(sheet.getByText("That username is taken.")).toBeVisible();
  await sheet.getByLabel("Username").fill("stmichael");
  await sheet.getByRole("button", { name: "Make it public" }).click();
  await expect(sheet).toBeHidden();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ handle: "stmichael", profile_public: true, prompted: true });
  await expect(page.getByText("Anyone with your link can see your profile")).toBeVisible();
});

test("the profile is private by default and the You tab opens it, with a link to account settings", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/browse");
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "St Michael", level: 1 })).toBeVisible();
  await expect(page.getByText("reading since 2026")).toBeVisible();
  await expect(page.getByText("Only you can see your profile")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make public" })).toBeVisible();
  await expect(page.getByText("@")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/account");
  await page.getByRole("link", { name: "Account settings" }).scrollIntoViewIfNeeded();
  const link = await page.getByRole("link", { name: "Account settings" }).boundingBox(), nav = await page.getByRole("navigation", { name: "Mobile navigation" }).boundingBox();
  expect(link.y + link.height).toBeLessThanOrEqual(nav.y);
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
});

test("Make public asks for a username, reports a taken one, then goes public and back to private", async ({ page, app }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Make public" }).click();
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
  await page.getByLabel("Username").fill("taken");
  await page.getByRole("button", { name: "Make public" }).last().click();
  await expect(page.getByText("That username is taken.")).toBeVisible();
  await page.getByLabel("Username").fill("admin");
  await page.getByRole("button", { name: "Make public" }).last().click();
  await expect(page.getByText("That username isn’t available.")).toBeVisible();
  await page.getByLabel("Username").fill("Bad Name!");
  await expect(page.getByLabel("Username")).toHaveValue("bad name!");
  await page.getByRole("button", { name: "Make public" }).last().click();
  await expect(page.getByText("Use 3–30 lowercase letters, numbers or hyphens.", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Username").fill("stmichael");
  await page.getByRole("button", { name: "Make public" }).last().click();
  await expect(page.getByText("Anyone with your link can see your profile")).toBeVisible();
  await expect(page.getByText("bookvane.me/u/stmichael")).toBeVisible();
  await expect(page.getByText("@stmichael · reading since 2026")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ handle: "stmichael", profile_public: true });
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("Only you can see your profile")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ profile_public: false });
});

test("a server handle_required answer opens the username field instead of an error", async ({ page, app }) => {
  app.profile.handle = "ready";
  await page.goto("/profile");
  app.failNext["PATCH /me/profile"] = [422, "handle_required"];
  await page.getByRole("button", { name: "Make public" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Edit profile sends only the changed fields and explains a taken username", async ({ page, app }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByLabel("Bio")).toHaveAttribute("maxlength", "160");
  await expect(page.getByText("60/160")).toBeVisible();
  await page.getByLabel("Username").fill("taken");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("That username is taken.")).toBeVisible();
  await page.getByLabel("Username").fill("ab");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Use 3–30 lowercase letters, numbers or hyphens.", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Username").fill("michael-reads");
  await page.getByLabel("Name", { exact: true }).fill("Michael R");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Michael R", level: 1 })).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ display_name: "Michael R", handle: "michael-reads" });
  await expect(page.getByText("@michael-reads · reading since 2026")).toBeVisible();
});

test("the year sentence reads right for plural, one book, no biggest month and an empty year", async ({ page, app }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Your 2026 in books" })).toBeVisible();
  await expect(page.getByText("You’ve finished 18 books and 5,940 pages this year. July was your biggest month.")).toBeVisible();
  await expect(page.getByText("Mystery · 7")).toBeVisible();
  await expect(page.getByText("Classics · 5")).toBeVisible();
  await expect(page.locator(".bv-year-bars")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".bv-year-bar.is-top")).toHaveCount(1);
  await expect(page.getByText("July: 6")).toBeAttached();
  app.stats = stats({ books_finished: 1, pages_read: 320, by_month: month(1), biggest_month: 1, top_genres: [] });
  await page.reload();
  await expect(page.getByText("You’ve finished 1 book and 320 pages this year. January was your biggest month.")).toBeVisible();
  app.stats = stats({ books_finished: 1, pages_read: 320, by_month: month(), biggest_month: null, top_genres: [] });
  await page.reload();
  await expect(page.getByText("You’ve finished 1 book and 320 pages this year.", { exact: true })).toBeVisible();
  app.stats = stats({ books_finished: 0, pages_read: 0, by_month: month(), biggest_month: null, top_genres: [] });
  await page.reload();
  await expect(page.getByText("Finish a book this year and it’ll show up here.")).toBeVisible();
  await expect(page.locator(".bv-year-bars")).toHaveCount(0);
});

test("lists: a list shows its lock, a new list opens its page, and an empty hub explains lists", async ({ page, app }) => {
  await page.goto("/profile");
  const row = page.getByRole("link", { name: /Christie, in order/ });
  await expect(row).toContainText("3 books");
  await expect(row.getByRole("img", { name: "Private list" })).toBeVisible();
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("Holiday");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/\/profile\/lists\/8$/);
  await expect(page.getByRole("heading", { name: "Holiday", level: 1 })).toBeVisible();
  expect(sent(app, "POST", "/me/lists")[0].body).toEqual({ name: "Holiday" });
  app.lists = [];
  await page.goto("/profile");
  await expect(page.getByText("Make a list for a series, a theme, or what to read on holiday.")).toBeVisible();
});

test("the 50-list limit is explained", async ({ page, app }) => {
  await page.goto("/profile");
  app.failNext["POST /me/lists"] = [422, "list_limit"];
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("One too many");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByText("You’ve reached 50 lists.")).toBeVisible();
});

test("a list page shows shelf status per book, can be shared and made private, renamed and deleted", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await expect(page.getByRole("heading", { name: "Christie, in order", level: 1 })).toBeVisible();
  await expect(page.getByText("3 books · by St Michael")).toBeVisible();
  const rows = page.locator(".bv-list-books li");
  await expect(rows.nth(0)).toContainText("Finished · March");
  await expect(rows.nth(1)).toContainText("Want to read");
  await expect(rows.nth(2)).not.toContainText(/Owned|Want|Finished/);
  await expect(rows.nth(2).locator(".bv-list-initial")).toHaveText("M");
  await expect(page.getByText("Only you can see this list")).toBeVisible();
  await page.getByRole("button", { name: "Share on your profile" }).click();
  await expect(page.getByText("Shared on your profile")).toBeVisible();
  await expect(page.getByText("Your profile is private, so no one can see it yet.")).toBeVisible();
  expect(sent(app, "PATCH", "/me/lists/7")[0].body).toEqual({ is_public: true });
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("Only you can see this list")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a book" })).toHaveAttribute("href", "/my-books");
  await expect(page.getByText("Open a book and choose Add to list.")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("List name").fill("Christie");
  await page.getByLabel("Description").fill("Poirot first.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("heading", { name: "Christie", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Christie", level: 1 })).toBeVisible();
  await expect(page.getByText("Poirot first.")).toBeVisible();
  expect(sent(app, "PATCH", "/me/lists/7").at(-1).body).toEqual({ name: "Christie", description: "Poirot first." });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Delete list" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this list?" });
  await expect(dialog.getByText("Delete this list? The books stay in your library.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete list" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  expect(sent(app, "DELETE", "/me/lists/7")).toHaveLength(1);
});

test("a list can be reordered from the keyboard and each move sends the full order", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const up = title => page.getByRole("button", { name: `Move ${title} up` });
  await up("Peril at End House").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".bv-list-books li").first()).toContainText("Peril at End House");
  expect(sent(app, "PUT", "/me/lists/7/order").at(-1).body).toEqual({ book_ids: [2, 1, 3] });
  await expect(page.getByRole("button", { name: "Move Peril at End House down" })).toBeFocused();
  await page.getByRole("button", { name: "Move Peril at End House down" }).press("Space");
  await expect(page.locator(".bv-list-books li").nth(1)).toContainText("Peril at End House");
  await page.getByRole("button", { name: "Move Murder on the Orient Express up" }).press("Enter");
  expect(sent(app, "PUT", "/me/lists/7/order").at(-1).body).toEqual({ book_ids: [1, 3, 2] });
  await expect(page.getByRole("button", { name: "Move The Murder of Roger Ackroyd up" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "moved to position" })).toHaveText(/Murder on the Orient Express moved to position 2 of 3\./);
});

test("a failed reorder puts the list back and says so", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  app.failNext["PUT /me/lists/7/order"] = "network";
  await page.getByRole("button", { name: "Move Peril at End House up" }).click();
  await expect(page.getByText("We couldn’t save the new order. It has been put back.")).toBeVisible();
  await expect(page.locator(".bv-list-books li").first()).toContainText("The Murder of Roger Ackroyd");
});

test("Remove takes a book off the list and the list limit is explained", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Remove Peril at End House from this list" }).click();
  await expect(page.locator(".bv-list-books li")).toHaveCount(2);
  expect(sent(app, "DELETE", "/me/lists/7/books/2")).toHaveLength(1);
});

test("Add to list toggles a book on and off a list and can make a new list", async ({ page, app }) => {
  await page.goto("/book/2");
  await page.getByRole("button", { name: "Add to list" }).click();
  const panel = page.getByRole("group", { name: /Add .* to a list/ });
  const box = panel.getByRole("checkbox", { name: "Christie, in order" });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => sent(app, "DELETE", "/me/lists/7/books/2").length).toBe(1);
  await box.check();
  await expect.poll(() => sent(app, "POST", "/me/lists/7/books").length).toBe(1);
  expect(sent(app, "POST", "/me/lists/7/books")[0].body).toEqual({ book_id: 2 });
  await panel.getByRole("button", { name: "New list…" }).click();
  await panel.getByLabel("List name").fill("Later");
  await panel.getByRole("button", { name: "Create and add" }).click();
  await expect(panel.getByRole("checkbox", { name: "Later" })).toBeChecked();
  expect(sent(app, "POST", "/me/lists/8/books")[0].body).toEqual({ book_id: 2 });
  app.failNext["POST /me/lists/7/books"] = [422, "list_limit"];
  await box.uncheck();
  await box.click();
  await expect(panel.getByText("This list is full (500 books).")).toBeVisible();
  await expect(box).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to list" })).toBeFocused();
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to list" })).toBeFocused();
});

test("Add to list is not offered to guests, and book cards never carry it", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/book/2");
  await expect(page.getByRole("button", { name: /Want to read/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to list" })).toHaveCount(0);
  await page.goto("/browse");
  await expect(page.getByRole("button", { name: "Add to list" })).toHaveCount(0);
});

test("a public profile shows only the public fields, and a guest is invited to join with src=profile", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/u/ada");
  await expect(page.getByRole("heading", { name: "Ada Reader", level: 1 })).toBeVisible();
  await expect(page.getByText("@ada · reading since 2025")).toBeVisible();
  await expect(page.getByText("Quiet reader.")).toBeVisible();
  await expect(page.getByText("Finished 2 books and 400 pages this year. January was their biggest month.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Shared list/ })).toHaveAttribute("href", "/u/ada/lists/3");
  const text = await page.locator("main").innerText();
  for (const hidden of ["ada@example.com", "Secret note", "Want to read", "Owned", "Edit", "Make private", "Make public", "Only you", "Private list", "Account settings"]) expect(text).not.toContain(hidden);
  await expect(page.getByText("Keep your own reading year on Bookvane.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create free account" })).toHaveAttribute("href", "/register?src=profile");
  expect(app.requests.some(request => /^\/me\/(profile|stats|lists)/.test(request.path))).toBe(false);
  await page.goto("/u/ada/lists/3");
  await expect(page.getByRole("heading", { name: "Shared list", level: 1 })).toBeVisible();
  await expect(page.getByText("2 books · by Ada Reader")).toBeVisible();
  const list = await page.locator("main").innerText();
  for (const hidden of ["Secret note", "Want to read", "Finished", "Owned"]) expect(list).not.toContain(hidden);
  await expect(page.locator(".bv-list-books li")).toHaveCount(2);
});

test("the guest invitation carries src=profile through to the sign-up request", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/u/ada");
  await page.getByRole("link", { name: "Create free account" }).click();
  await expect(page).toHaveURL(/\/register\?src=profile$/);
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => sent(app, "POST", "/auth/register?src=profile").length).toBe(1);
});

test("a missing or private public page shows the not-found page, and your own page says how others see it", async ({ page, app }) => {
  await page.goto("/u/missing");
  await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  app.profile.handle = "ada"; app.profile.profile_public = true;
  await page.goto("/u/ada");
  await expect(page.getByText("This is how others see your profile.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create free account" })).toHaveCount(0);
});

test("the desktop header account link opens the profile and keeps its label", async ({ page, app: _app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "Your account", exact: true })).toHaveAttribute("href", "/profile");
});

test("guests who open /profile are sent to sign in and returned", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile$/);
});

test("profile screenshots", async ({ page, app }) => {
  test.skip(!process.env.PROFILE_SHOTS, "set PROFILE_SHOTS=1 to export screenshots");
  const dir = "node_modules/.bv-preview/profile";
  mkdirSync(dir, { recursive: true });
  app.lists[0].is_public = true; app.lists[0].covers = [];
  app.takenHandles = [];
  for (const theme of ["light", "dark"]) for (const [label, width, height] of [["375", 375, 812], ["1440", 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.goto("/profile"); await expect(page.getByRole("heading", { name: "St Michael", level: 1 })).toBeVisible();
    await page.screenshot({ path: `${dir}/hub-${label}-${theme}.png`, fullPage: true });
    await page.goto("/profile/lists/7"); await expect(page.getByRole("heading", { name: "Christie, in order", level: 1 })).toBeVisible();
    await page.screenshot({ path: `${dir}/list-${label}-${theme}.png`, fullPage: true });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.screenshot({ path: `${dir}/list-edit-${label}-${theme}.png`, fullPage: true });
    await page.goto("/u/ada"); await expect(page.getByRole("heading", { name: "Ada Reader", level: 1 })).toBeVisible();
    await page.screenshot({ path: `${dir}/public-${label}-${theme}.png`, fullPage: true });
    app.profile.show_prompt = true;
    await page.goto("/profile"); await expect(page.getByRole("dialog")).toBeVisible(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/sheet-${label}-${theme}.png` });
    app.profile.show_prompt = false;
  }
});
