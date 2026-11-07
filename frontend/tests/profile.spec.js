import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Browser fixtures only: every API request is intercepted, including the profile endpoints (the T24 contract).
const book = (id, title) => ({ id, title, authors: [{ id: 1, name: "Fixture Author" }], tags: [], cover_image_url: null, english_title: null, page_count: 200 });
const BOOKS = [book(1, "The Murder of Roger Ackroyd"), book(2, "Peril at End House"), book(3, "Murder on the Orient Express")];
const ICONS = ["book-open", "coffee", "cat", "feather", "moon", "leaf", "lamp", "glasses", "bird", "mountain", "sun", "library"];
const COLOURS = ["green", "rust", "ink", "mustard", "plum", "sage"];
const month = (...counts) => Array.from({ length: 12 }, (_, index) => counts[index] || 0);
const stats = (overrides = {}) => ({ year: 2026, books_finished: 18, pages_read: 5940, by_month: month(1, 2, 1, 3, 2, 4, 6, 3, 1, 2), top_genres: [{ name: "Mystery", count: 7 }, { name: "Classics", count: 5 }], biggest_month: 7, ...overrides });
const detail = (id, extra = {}) => ({ ...BOOKS[id - 1], status: null, finished_month: null, ...extra });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = {
      requests: [], errors: [], failNext: {},
      profile: { display_name: "St Michael", bio: "Mysteries, classics, and the odd business book on the train.", initials: "SM", avatar_icon: null, avatar_color: null, handle: null, profile_public: false, show_prompt: false, reading_since: 2026 },
      stats: stats(),
      lists: [{ id: 7, name: "Christie, in order", description: null, is_public: false, book_count: 3, covers: [],
        books: [detail(1, { status: "owned", finished_month: "2026-03" }), detail(2, { status: "want" }), detail(3)] }],
      takenHandles: ["taken"], nextListId: 8,
      publicProfile: { display_name: "Ada Reader", initials: "AR", avatar_icon: "feather", avatar_color: "plum", bio: "Quiet reader.", reading_since: 2025, stats: stats({ books_finished: 2, pages_read: 400, by_month: month(1, 1), biggest_month: 1, top_genres: [] }),
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
      if (path === "/auth/logout") { state.guest = true; return reply(200, {}); }
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
        for (const [field, allowed] of [["avatar_icon", ICONS], ["avatar_color", COLOURS]]) if (field in body) { if (body[field] && !allowed.includes(body[field])) return fail(422, "invalid_avatar"); next[field] = body[field] || null; }
        if ("profile_public" in body) { if (body.profile_public && !next.handle) return fail(422, "handle_required"); next.profile_public = body.profile_public; }
        if (body.prompted) next.show_prompt = false;
        state.profile = next; return reply(200, next);
      }
      if (path === "/me/stats") return reply(200, state.stats);
      if (path === "/me/lists" && method === "GET") return reply(200, state.lists.map(({ books, ...row }) => ({ ...row, has_book: books.some(item => item.id === Number(url.searchParams.get("book_id"))), book_count: books.length, covers: [], previews: books.slice(0, 4).map(item => ({ id: item.id, cover_image_url: item.cover_image_url })) })));
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

test("closing the sheet is a final answer even when saving it fails: it stays closed on the next page and after a reload", async ({ page, app }) => {
  app.profile.show_prompt = true;
  await page.route("**/test-api/me/profile", route => route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { detail: "down" } }) : route.fallback());
  await page.goto("/browse");
  await expect(page.getByRole("dialog", { name: "Let friends find you?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Profile" }).first().click();
  await expect(page.getByRole("heading", { name: "St Michael" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "St Michael" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("Make public opens a confirm sheet that asks for a username, reports taken ones, then goes public and back to private", async ({ page, app }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Make public" }).click();
  const sheet = page.getByRole("dialog", { name: "Make your profile public?" });
  await expect(sheet.getByText("Shown: your name, bio, yearly stats, and shared lists")).toBeVisible();
  await expect(sheet.getByText("Always private: notes, ratings, reading history, and private lists")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
  await sheet.getByLabel("Username").fill("taken");
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(sheet.getByText("That username is taken.")).toBeVisible();
  await sheet.getByLabel("Username").fill("admin");
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(sheet.getByText("That username isn’t available.")).toBeVisible();
  await sheet.getByLabel("Username").fill("Bad Name!");
  await expect(sheet.getByLabel("Username")).toHaveValue("bad name!");
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(sheet.getByText("Use 3–30 lowercase letters, numbers or hyphens.", { exact: true }).first()).toBeVisible();
  await sheet.getByLabel("Username").fill("stmichael");
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Anyone with your link can see your profile")).toBeVisible();
  await expect(page.getByText("bookvane.me/u/stmichael")).toBeVisible();
  await expect(page.getByText("@stmichael · reading since 2026")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ handle: "stmichael", profile_public: true });
  await expect(page.getByRole("status").filter({ hasText: "Your profile is now public." })).toBeAttached();
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("Only you can see your profile")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ profile_public: false });
  await expect(page.getByRole("status").filter({ hasText: "Your profile is now private." })).toBeAttached();
});

test("the Make public sheet needs no username once one is set, Cancel and Esc send nothing, and focus returns to the button", async ({ page, app }) => {
  app.profile.handle = "ready";
  await page.goto("/profile");
  const open = page.getByRole("button", { name: "Make public" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Make your profile public?" });
  await expect(sheet.getByLabel("Username")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
  await open.click();
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(page.getByText("Anyone with your link can see your profile")).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ profile_public: true });
});

test("a server handle_required answer opens the username field in the Make public sheet instead of an error", async ({ page, app }) => {
  app.profile.handle = "ready";
  await page.goto("/profile");
  app.failNext["PATCH /me/profile"] = [422, "handle_required"];
  await page.getByRole("button", { name: "Make public" }).click();
  const sheet = page.getByRole("dialog", { name: "Make your profile public?" });
  await sheet.getByRole("button", { name: "Make public" }).click();
  await expect(sheet.getByLabel("Username")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Edit profile is a sheet that sends only the changed fields and explains a taken username", async ({ page, app }) => {
  await page.goto("/profile");
  const open = page.getByRole("button", { name: "Edit profile" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Edit profile" });
  await expect(sheet.getByLabel("Bio")).toHaveAttribute("maxlength", "160");
  await expect(sheet.getByText("60/160")).toBeVisible();
  await sheet.getByLabel("Username").fill("taken");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.getByText("That username is taken.")).toBeVisible();
  await sheet.getByLabel("Username").fill("ab");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.getByText("Use 3–30 lowercase letters, numbers or hyphens.", { exact: true }).first()).toBeVisible();
  await sheet.getByLabel("Username").fill("michael-reads");
  await sheet.getByLabel("Name", { exact: true }).fill("Michael R");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "Michael R", level: 1 })).toBeVisible();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ display_name: "Michael R", handle: "michael-reads" });
  await expect(page.getByText("@michael-reads · reading since 2026")).toBeVisible();
  await expect(open).toBeFocused();
});

test("Esc and Cancel on the Edit profile sheet discard changes and send nothing", async ({ page, app }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Edit profile" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit profile" });
  await sheet.getByLabel("Name", { exact: true }).fill("Someone Else");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "St Michael", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue("St Michael");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
});

test("the avatar picker previews the choice, sends the icon and colour, and the header and You tab show it", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/profile");
  const header = page.locator(".bv-header-avatar"), tab = page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You" });
  await expect(header).toHaveAttribute("aria-label", "Your profile");
  await expect(header.locator(".bv-avatar")).toHaveCSS("width", "32px");
  await expect(tab.locator(".bv-avatar")).toHaveCSS("width", "22px");
  await expect(header.locator(".bv-avatar")).toHaveCSS("background-color", "rgb(40, 81, 63)");
  await expect(page.locator(".bv-profile-head .bv-avatar")).toHaveCSS("width", "96px");
  await page.getByRole("button", { name: "Edit profile" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit profile" });
  await expect(sheet.getByRole("group", { name: "Icon" }).getByRole("radio")).toHaveCount(12);
  await expect(sheet.getByRole("group", { name: "Colour" }).getByRole("radio")).toHaveCount(6);
  await expect(sheet.getByRole("radio", { name: "Green" })).toBeChecked();
  await expect(sheet.locator(".bv-picker-preview .bv-avatar")).toHaveCSS("width", "96px");
  await sheet.getByRole("radio", { name: "Feather" }).check({ force: true });
  await sheet.getByRole("radio", { name: "Plum" }).check({ force: true });
  await expect(sheet.locator(".bv-picker-preview .bv-avatar")).toHaveCSS("background-color", "rgb(107, 63, 94)");
  expect(sent(app, "PATCH", "/me/profile")).toHaveLength(0);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(sent(app, "PATCH", "/me/profile").at(-1).body).toEqual({ avatar_icon: "feather", avatar_color: "plum" });
  for (const avatar of [header.locator(".bv-avatar"), tab.locator(".bv-avatar"), page.locator(".bv-profile-head .bv-avatar")]) {
    await expect(avatar).toHaveCSS("background-color", "rgb(107, 63, 94)");
    await expect(avatar.locator("svg")).toHaveCount(1);
  }
  // The glyph is about 44% of the diameter: 30 px in the 68 px avatar, 14 in the 32 px header, 10 in the 22 px tab.
  const glyphWidth = avatar => avatar.locator("svg").evaluate(node => Math.round(node.getBoundingClientRect().width));
  expect([await glyphWidth(page.locator(".bv-profile-head .bv-avatar")), await glyphWidth(header.locator(".bv-avatar")), await glyphWidth(tab.locator(".bv-avatar"))]).toEqual([42, 14, 10]);
  await header.click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("with no avatar chosen the avatar shows the reader's initials on green", async ({ page, app: _app }) => {
  await page.goto("/profile");
  await expect(page.locator(".bv-profile-head .bv-avatar")).toHaveText("SM");
  await expect(page.locator(".bv-profile-head .bv-avatar")).toHaveCSS("background-color", "rgb(40, 81, 63)");
});

test("the You tab is active on /profile, a list and /account, and never on a public page", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const tab = page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You" });
  for (const path of ["/profile", "/profile/lists/7", "/account"]) {
    await page.goto(path);
    await expect(tab).toHaveAttribute("aria-current", "page");
  }
  await page.goto("/u/ada");
  await expect(page.getByRole("heading", { name: "Ada Reader", level: 1 })).toBeVisible();
  await expect(tab).not.toHaveAttribute("aria-current", "page");
  expect(app.errors).toEqual([]);
});

test("the year sentence reads right for plural, one book, no biggest month and an empty year", async ({ page, app }) => {
  await page.goto("/profile?tab=year");
  await expect(page.getByRole("heading", { name: "Your 2026", exact: true })).toBeVisible();
  await expect(page.getByText("You’ve finished 18 books and 5,940 pages this year. July was your biggest month.")).toBeVisible();
  await expect(page.getByText("Mostly Mystery (7) · Classics (5)")).toBeVisible();
  await expect(page.locator(".bv-year-genres li, .bv-year-chips")).toHaveCount(0);
  await expect(page.locator(".bv-shelf")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".bv-shelf-months .is-top")).toHaveText("J");
  await expect(page.locator(".bv-shelf-months .is-top")).toHaveCount(1);
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
  await expect(page.locator(".bv-shelf")).toHaveCount(1);
  await expect(page.locator(".bv-shelf-spine")).toHaveCount(0);
  await expect(page.locator(".bv-shelf-months")).toBeVisible();
  expect((await page.locator(".bv-shelf").boundingBox()).height).toBeLessThan(12);
  const empty = await page.locator(".bv-profile-year").boundingBox();
  expect(empty.height).toBeLessThan(150);
});

test("the year shelf draws a spine per finished book up to what fits, shows +N for the rest, is stable between visits and never overflows", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  app.stats = stats({ books_finished: 22, by_month: month(1, 2, 0, 3, 0, 0, 12, 4) });
  await page.goto("/profile?tab=year");
  await expect(page.locator(".bv-shelf-month").nth(6).locator(".bv-shelf-spine").first()).toBeVisible();
  const shelf = () => page.locator(".bv-shelf-month").evaluateAll(months => months.map(item => ({ spines: item.querySelectorAll(".bv-shelf-spine").length, more: item.querySelector(".bv-shelf-more")?.textContent || "" })));
  const counts = await shelf();
  expect(counts.slice(0, 4).map(item => item.spines)).toEqual([1, 2, 0, 3]);
  expect(counts.slice(0, 6).map(item => item.more)).toEqual(["", "", "", "", "", ""]);
  const july = counts[6], fits = july.spines;
  expect(fits).toBeGreaterThanOrEqual(3); expect(fits).toBeLessThan(12);
  expect(july.more).toBe(`+${12 - fits}`);
  expect(counts[7].spines + (counts[7].more ? Number(counts[7].more.slice(1)) : 0)).toBe(4);
  const widths = await page.locator(".bv-shelf-spine").evaluateAll(spines => spines.map(spine => spine.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(3.9);
  const heights = await page.locator(".bv-shelf-spine").evaluateAll(spines => spines.map(spine => Number.parseInt(spine.style.height, 10)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(78); expect(Math.max(...heights)).toBeLessThanOrEqual(100);
  await expect(page.getByText("July: 12")).toBeAttached();
  const styles = () => page.locator(".bv-shelf-spine").evaluateAll(spines => spines.map(spine => `${spine.style.height}|${spine.style.background}`));
  const first = await styles();
  await page.reload();
  await expect(page.locator(".bv-shelf-month").nth(6).locator(".bv-shelf-spine").first()).toBeVisible();
  expect(await styles()).toEqual(first);
  const box = await page.locator(".bv-shelf").boundingBox();
  for (const spine of await page.locator(".bv-shelf-spine").all()) { const rect = await spine.boundingBox(); expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 0.5); }
  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await shelf();
  expect(wide[6].spines).toBeGreaterThan(fits);
  const wideWidths = await page.locator(".bv-shelf-spine").evaluateAll(spines => spines.map(spine => spine.getBoundingClientRect().width));
  expect(Math.min(...wideWidths)).toBeGreaterThanOrEqual(7.9);
});

test("lists: cards show the name, count and privacy, a new list opens its page, and an empty hub explains lists", async ({ page, app }) => {
  await page.goto("/profile?tab=lists");
  const card = page.getByRole("link", { name: /Christie, in order/ });
  await expect(card).toContainText("3 books");
  await expect(card).toContainText("private");
  await expect(page.locator(".bv-list-cards")).toHaveCSS("grid-template-columns", /px .*px/);
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

test("list artwork shows spine blocks for coverless books, an outlined spine for an empty list, and never a letter tile or a blank tile", async ({ page, app }) => {
  app.lists.push({ id: 9, name: "Brand new", description: null, is_public: true, book_count: 0, covers: [], books: [] });
  await page.goto("/profile?tab=lists");
  const art = page.getByRole("link", { name: /Christie, in order/ }).locator(".bv-art");
  await expect(art.locator(".bv-art-slot")).toHaveCount(3);
  await expect(art.locator(".bv-art-spine")).toHaveCount(3);
  const empty = page.getByRole("link", { name: /Brand new/ }).locator(".bv-art--empty");
  await expect(empty).toBeVisible();
  await expect(empty.locator("i")).toHaveCSS("border-top-color", /rgb\(\d+, \d+, \d+\)/);
  await expect(empty).toHaveCSS("border-bottom-width", "3px");
  for (const text of await page.locator(".bv-art").allInnerTexts()) expect(text.trim()).toBe("");
  await page.goto("/profile/lists/7");
  await expect(page.locator(".bv-art--tall .bv-art-slot")).toHaveCount(3);
  await expect(page.locator(".bv-art--tall")).toHaveCSS("height", "96px");
  await expect(page.locator(".bv-list-books .bv-list-cover .bv-art-spine")).toHaveCount(3);
  await expect(page.locator(".bv-list-initial")).toHaveCount(0);
  // Never blank: every coverless row paints an opaque bookcloth, in both themes.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.querySelector(".bv-root").setAttribute("data-theme", value), theme);
    const paints = await page.locator(".bv-list-cover .bv-art-spine").evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return [style.backgroundColor, node.getBoundingClientRect().width, node.getBoundingClientRect().height]; }));
    for (const [colour, width, height] of paints) { expect(colour).toMatch(/^rgb\(/); expect(width).toBeGreaterThanOrEqual(40); expect(height).toBeGreaterThanOrEqual(60); }
  }
});

test("a book wears the same cloth on the hub card, the list header and its row", async ({ page, app: _app }) => {
  await page.goto("/profile?tab=lists");
  const cloth = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor);
  const card = page.getByRole("link", { name: /Christie, in order/ }).locator(".bv-art-spine");
  const fromCard = [await cloth(card.nth(0)), await cloth(card.nth(1)), await cloth(card.nth(2))];
  await page.goto("/profile/lists/7");
  const header = page.locator(".bv-art--tall .bv-art-spine"), rows = page.locator(".bv-list-cover .bv-art-spine");
  for (let index = 0; index < 3; index += 1) {
    expect(await cloth(header.nth(index))).toBe(fromCard[index]);
    expect(await cloth(rows.nth(index))).toBe(fromCard[index]);
  }
});

test("list cards are two across, one under 340px, and the lists heading and New list stay whole at large text", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/profile?tab=lists");
  const columns = () => page.locator(".bv-list-cards").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  await expect(page.locator(".bv-list-card")).toHaveCount(1);
  expect(await columns()).toBe(2);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await columns()).toBe(2);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await columns()).toBe(1);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await columns()).toBe(1);
  const button = await page.getByRole("button", { name: "New list" }).boundingBox();
  const line = await page.getByRole("button", { name: "New list" }).evaluate(node => parseFloat(getComputedStyle(node).lineHeight) || node.getBoundingClientRect().height);
  expect(button.height).toBeLessThan(line * 2.2);
});

test("at 200% text the mobile nav labels never ellipsise, clip or break inside a word", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/profile");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  const labels = await nav.locator("a span").evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return { overflow: style.textOverflow, wrap: style.overflowWrap, clipped: node.scrollWidth > node.clientWidth + 1, text: node.textContent }; }));
  for (const label of labels) { expect(label.overflow).not.toBe("ellipsis"); expect(label.wrap).toBe("normal"); expect(label.clipped, label.text).toBe(false); }
  expect(labels.map(label => label.text)).toContain("Discover");
  // Each word sits whole on one line: the label's rendered width never exceeds its link, and the nav itself doesn't scroll sideways.
  expect(await nav.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("every spine shows up to what fits, in light, dark and 200% text", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const by = [1, 2, 1, 3, 2, 4, 9, 3, 1, 2];
  app.stats = stats({ books_finished: 28, by_month: month(...by) });
  for (const theme of ["light", "dark"]) for (const zoom of [false, true]) {
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.goto("/profile?tab=year");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await expect(page.locator(".bv-shelf-month").nth(6).locator(".bv-shelf-spine").first()).toBeVisible();
    const months = await page.locator(".bv-shelf-month").evaluateAll(nodes => nodes.map(node => ({ spines: node.querySelectorAll(".bv-shelf-spine").length, more: node.querySelector(".bv-shelf-more")?.textContent || "" })));
    const label = `${theme}${zoom ? " 200%" : ""}`;
    // Months with up to three books always show every spine; a crowded month shows what fits (at least three) plus +N for the rest.
    by.forEach((count, index) => {
      if (count <= 3) { expect(months[index].spines, `${label}: month ${index + 1}`).toBe(count); expect(months[index].more).toBe(""); }
      else { expect(months[index].spines, `${label}: month ${index + 1}`).toBeGreaterThanOrEqual(3); expect(months[index].spines + Number(months[index].more.slice(1) || 0)).toBe(count); }
    });
    expect(months[6].spines, label).toBeGreaterThan(1);
    expect(months.slice(10).map(item => item.spines)).toEqual([0, 0]);
  }
});

test("signed-out visitors see the plain person icon on the You tab, never an avatar", async ({ page, app }) => {
  app.guest = true;
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/browse");
  const tab = page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You" });
  await expect(tab).toBeVisible();
  await expect(tab.locator(".bv-avatar")).toHaveCount(0);
  await expect(tab.locator("svg")).toHaveCount(1);
  await expect(page.locator(".bv-header-avatar")).toHaveCount(0);
});

test("the tabs are a real tablist: arrows, Home and End move between them, only the selected tab is in the tab order, and ?tab= holds the state", async ({ page, app: _app }) => {
  await page.goto("/profile");
  const list = page.getByRole("tablist", { name: "Profile sections" });
  const tabs = list.getByRole("tab");
  await expect(tabs).toHaveText(["Overview", "Lists", "Year"]);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "bv-tab-overview");
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Lists" })).toBeFocused();
  await expect(page).toHaveURL(/\/profile\?tab=lists$/);
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Year" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?tab=year$/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  await expect(page).toHaveURL(/\/profile$/);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Year" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  // Clicking pushes history, so Back returns to the earlier tab; a linked tab opens directly; an unknown value is the Overview.
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(page.getByRole("heading", { name: "Your lists" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/profile?tab=year");
  await expect(page.getByRole("tab", { name: "Year" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/profile?tab=nonsense");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
});

test("the Overview shows three big figures and up to three list rows, with See all lists only when there are more", async ({ page, app }) => {
  await page.goto("/profile");
  const figures = page.locator(".bv-figures");
  await expect(page.getByRole("heading", { name: "Your 2026 so far" })).toBeVisible();
  await expect(figures).toContainText("books finished18");
  await expect(figures).toContainText("pages5,940");
  await expect(figures).toContainText("biggest monthJul");
  await expect(page.locator(".bv-list-row")).toHaveCount(1);
  await expect(page.locator(".bv-list-row").first()).toContainText("3 books");
  await expect(page.getByRole("button", { name: "See all lists" })).toHaveCount(0);
  for (const id of [11, 12, 13]) app.lists.push({ id, name: `Extra ${id}`, description: null, is_public: false, book_count: 0, covers: [], books: [] });
  await page.reload();
  await expect(page.locator(".bv-list-row")).toHaveCount(3);
  await page.getByRole("button", { name: "See all lists" }).click();
  await expect(page).toHaveURL(/\?tab=lists$/);
  await expect(page.locator(".bv-list-card")).toHaveCount(4);
});

test("an empty year shows one line on the Overview with no zeros, and the Year tab shows a short baseline instead of a tall shelf", async ({ page, app }) => {
  app.stats = stats({ books_finished: 0, pages_read: 0, by_month: month(), biggest_month: null, top_genres: [] });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Your 2026 so far" })).toBeVisible();
  await expect(page.getByText("It starts with your first finished book.")).toBeVisible();
  await expect(page.locator(".bv-figures")).toHaveCount(0);
  await expect(page.locator(".bv-profile-year")).not.toContainText(/(?<!\d)0(?!\d)/);
  await page.getByRole("tab", { name: "Year" }).click();
  await expect(page.getByText("Finish a book this year and it’ll show up here.")).toBeVisible();
  expect((await page.locator(".bv-shelf").boundingBox()).height).toBeLessThan(12);
  expect((await page.locator(".bv-profile-year").boundingBox()).height).toBeLessThan(150);
});

test("the tabs never wrap at 320px or at 200% text, and the header is centred", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/profile");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const tabs = await page.getByRole("tab").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { wraps: box.height > parseFloat(getComputedStyle(node).lineHeight) * 2.2, white: getComputedStyle(node).whiteSpace }; }));
  for (const tab of tabs) { expect(tab.white).toBe("nowrap"); expect(tab.wraps).toBe(false); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  const avatar = await page.locator(".bv-profile-head .bv-avatar").boundingBox(), tablist = await page.getByRole("tablist").boundingBox();
  expect(Math.abs(avatar.x + avatar.width / 2 - 640)).toBeLessThan(2);
  expect(Math.abs(tablist.x + tablist.width / 2 - 640)).toBeLessThan(2);
  expect(tablist.width).toBeLessThanOrEqual(721);
});

test("the Account rows stay at the bottom on every tab", async ({ page, app: _app }) => {
  for (const path of ["/profile", "/profile?tab=lists", "/profile?tab=year"]) {
    await page.goto(path);
    await expect(page.getByRole("region", { name: "Account" }).getByRole("button", { name: "Sign out" })).toBeVisible();
    const order = await page.locator(".bv-profile > *").evaluateAll(nodes => nodes.map(node => node.className));
    expect(order.at(-1)).toContain("bv-profile-account");
  }
});

test("the public page has the same header and tabs, third-person figures, public lists only and the guest line last", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/u/ada");
  await expect(page.getByRole("tab")).toHaveText(["Overview", "Lists", "Year"]);
  await expect(page.getByRole("heading", { name: "2026 so far" })).toBeVisible();
  await expect(page.locator(".bv-visibility")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit profile" })).toHaveCount(0);
  await expect(page.locator(".bv-list-row")).toHaveCount(1);
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(page).toHaveURL(/\/u\/ada\?tab=lists$/);
  await expect(page.locator(".bv-list-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "Year" }).click();
  await expect(page.getByText("Finished 2 books and 400 pages this year. January was their biggest month.")).toBeVisible();
  const last = await page.locator(".bv-profile > *").evaluateAll(nodes => nodes.at(-1).className);
  expect(last).toContain("bv-profile-join");
  app.publicProfile.stats = stats({ books_finished: 0, pages_read: 0, by_month: month(), biggest_month: null, top_genres: [] });
  await page.goto("/u/ada");
  await expect(page.getByText("It starts with their first finished book.")).toBeVisible();
});

test("the selected tab is lifted above the track in dark and light, with readable text, and the three tabs are equal segments", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const channels = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => colour.startsWith("color(") ? value * 255 : value);
  const luminance = colour => { const [r, g, b] = channels(colour).map(value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.goto("/profile");
    const selected = page.getByRole("tab", { name: "Overview" }), track = page.getByRole("tablist");
    const [tab, rail, text] = await Promise.all([selected.evaluate(node => getComputedStyle(node).backgroundColor), track.evaluate(node => getComputedStyle(node).backgroundColor), selected.evaluate(node => getComputedStyle(node).color)]);
    expect(luminance(tab), theme).toBeGreaterThan(luminance(rail));
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio(luminance(text), luminance(tab))).toBeGreaterThanOrEqual(4.5);
  }
  const widths = await page.getByRole("tab").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  for (const tab of await page.getByRole("tab").all()) expect((await tab.boundingBox()).height).toBeLessThan(80);
});

test("the Overview has one rule above the account rows, list names use the card title style, and the pill has equal 16px padding", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/profile");
  const row = page.locator(".bv-list-row").last();
  await expect(row).toHaveCSS("border-bottom-width", "0px");
  const name = row.locator("strong");
  await expect(name).toHaveCSS("font-size", "17px");
  await expect(name).toHaveCSS("font-family", /Bookvane Lora/);
  const pill = page.locator(".bv-visibility");
  await expect(pill).toHaveCSS("padding-left", "16px");
  await expect(pill).toHaveCSS("padding-right", "16px");
  const gap = (await page.locator(".bv-profile-account").boundingBox()).y - (await row.boundingBox()).y - (await row.boundingBox()).height;
  expect(gap).toBeLessThan(60);
});

test("a tab switch settles the incoming panel in 160ms, never on the first paint, and not under reduced motion", async ({ page, app: _app }) => {
  for (const path of ["/profile", "/profile?tab=year"]) {
    await page.goto(path);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tabpanel")).toHaveCSS("animation-name", "none");
  }
  await page.goto("/profile");
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(page.getByRole("tabpanel")).toHaveCSS("animation-duration", "0.16s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: "Year" }).click();
  await expect(page.getByRole("tabpanel")).toHaveCSS("animation-duration", "0s");
});

test("the gap between the header and the tabs is the same on the owner page and the public page", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/profile");
  const edit = await page.getByRole("button", { name: "Edit profile" }).boundingBox(), ownerTabs = await page.getByRole("tablist").boundingBox();
  const owner = ownerTabs.y - (edit.y + edit.height - 12);
  app.guest = true;
  await page.goto("/u/ada");
  const bio = await page.locator(".bv-profile-bio").boundingBox(), publicTabs = await page.getByRole("tablist").boundingBox();
  const publicGap = publicTabs.y - (bio.y + bio.height);
  expect(Math.abs(owner - publicGap)).toBeLessThanOrEqual(4);
});

test("the privacy pill is centred: a two-row pill on phones with Make public on its own line, one line on desktop", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/profile");
  const pill = page.locator(".bv-visibility");
  const box = await pill.boundingBox();
  expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
  expect(box.width).toBeLessThanOrEqual(350);
  // At phone widths the label stays on one line and Make public sits on its own line under it.
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const label = await pill.locator("span").boundingBox(), action = await pill.getByRole("button", { name: "Make public" }).boundingBox();
    expect(label.height).toBeLessThan(30);
    expect(action.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setViewportSize({ width: 320, height: 800 });
  const narrow = await pill.boundingBox(), button = await pill.getByRole("button", { name: "Make public" }).boundingBox();
  expect(narrow.x).toBeGreaterThanOrEqual(0); expect(narrow.x + narrow.width).toBeLessThanOrEqual(320);
  expect(button.x).toBeGreaterThanOrEqual(narrow.x); expect(button.x + button.width).toBeLessThanOrEqual(narrow.x + narrow.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await pill.boundingBox(), wideText = await pill.locator("span").boundingBox(), wideButton = await pill.getByRole("button", { name: "Make public" }).boundingBox();
  expect(Math.abs(wide.x + wide.width / 2 - 640)).toBeLessThan(2);
  expect(Math.abs((wideButton.y + wideButton.height / 2) - (wideText.y + wideText.height / 2))).toBeLessThan(12);
});

test("Sign out is the second ruled row under Account settings, and tertiary links sit on the 20px gutter", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "St Michael", level: 1 })).toBeVisible();
  const link = page.getByRole("link", { name: "Account settings" }), out = page.getByRole("button", { name: "Sign out" });
  await expect(out).toBeVisible();
  const [linkBox, outBox] = [await link.boundingBox(), await out.boundingBox()];
  expect(outBox.y).toBeGreaterThan(linkBox.y + linkBox.height - 2);
  expect(outBox.height).toBeGreaterThanOrEqual(44);
  expect(Math.round(outBox.x)).toBe(20); expect(Math.round(linkBox.x)).toBe(20);
  await expect(out).toHaveCSS("border-bottom-width", "1px");
  await expect(out.locator("svg")).toHaveCount(0);
  const edit = await page.getByRole("button", { name: "Edit profile" }).boundingBox();
  expect(Math.abs(edit.x + edit.width / 2 - 187.5)).toBeLessThan(2);
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  expect(Math.round((await page.getByRole("button", { name: "Rename or delete" }).boundingBox()).x)).toBe(20);
});

test("on a wide screen the header, tabs and panels share one 720px column with the same left edge, the shelf is 140px tall and the list artwork 120px", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/profile?tab=year");
  expect(Math.round((await page.locator(".bv-profile").boundingBox()).width)).toBe(720);
  const edge = async locator => Math.round((await locator.first().boundingBox()).x);
  const tabsEdge = await edge(page.getByRole("tablist"));
  expect(await edge(page.getByRole("heading", { name: "Your 2026" }))).toBe(tabsEdge);
  expect(await edge(page.getByRole("link", { name: "Account settings" }))).toBe(tabsEdge);
  await expect(page.locator(".bv-shelf")).toHaveCSS("height", "140px");
  await expect(page.locator(".bv-shelf-spine").first()).toHaveCSS("width", /^(1[0-2]|9)(\.\d+)?px$/);
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(page.locator(".bv-list-card .bv-art").first()).toHaveCSS("height", "120px");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("tab", { name: "Year" }).click();
  await expect(page.locator(".bv-shelf")).toHaveCSS("height", "96px");
});

test("the 50-list limit is explained", async ({ page, app }) => {
  await page.goto("/profile?tab=lists");
  app.failNext["POST /me/lists"] = [422, "list_limit"];
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("One too many");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByText("You’ve reached 50 lists.")).toBeVisible();
});

test("a list page shows shelf status per book, can be shared and made private, renamed and deleted from a sheet", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await expect(page.getByRole("heading", { name: "Christie, in order", level: 1 })).toBeVisible();
  await expect(page.getByText("3 books · by St Michael")).toBeVisible();
  const rows = page.locator(".bv-list-books li");
  await expect(rows.nth(0)).toContainText("Finished · March");
  await expect(rows.nth(1)).toContainText("Want to read");
  await expect(rows.nth(2)).not.toContainText(/Owned|Want|Finished/);
  await expect(page.getByText("Only you can see this list")).toBeVisible();
  await page.getByRole("button", { name: "Share on your profile" }).click();
  await expect(page.getByText("Shared on your profile")).toBeVisible();
  await expect(page.getByText("Your profile is private, so no one can see it yet.")).toBeVisible();
  expect(sent(app, "PATCH", "/me/lists/7")[0].body).toEqual({ is_public: true });
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("Only you can see this list")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a book" })).toHaveAttribute("href", "/my-books");
  await expect(page.getByText("Open a book and choose Add to list.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename or delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Rename or delete" }).click();
  const sheet = page.getByRole("dialog", { name: "Rename or delete" });
  await sheet.getByLabel("List name").fill("Christie");
  await sheet.getByLabel("Description").fill("Poirot first.");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "Christie", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Christie", level: 1 })).toBeVisible();
  await expect(page.getByText("Poirot first.")).toBeVisible();
  expect(sent(app, "PATCH", "/me/lists/7").at(-1).body).toEqual({ name: "Christie", description: "Poirot first." });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Rename or delete" }).click();
  await sheet.getByRole("button", { name: "Delete list" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this list?" });
  await expect(dialog.getByText("Delete this list? The books stay in your library.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete list" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  expect(sent(app, "DELETE", "/me/lists/7")).toHaveLength(1);
});

test("Done is the filled exit from list editing, and each row gets 44px move and remove buttons on the same line", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Done" })).toHaveClass(/bv-button--primary/);
  const row = page.locator(".bv-list-books li").first();
  const rowBox = await row.boundingBox();
  for (const name of [/Move .* up/, /Move .* down/, /Remove .* from this list/]) {
    const box = await row.getByRole("button", { name }).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(rowBox.y - 1); expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

test("Remove takes a book off the list and Undo puts it back in its place", async ({ page, app }) => {
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Remove Peril at End House from this list" }).click();
  await expect(page.locator(".bv-list-books li")).toHaveCount(2);
  expect(sent(app, "DELETE", "/me/lists/7/books/2")).toHaveLength(1);
  const toast = page.locator(".bv-undo-toast");
  await expect(toast).toContainText("Removed Peril at End House.");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".bv-list-books li")).toHaveCount(3);
  await expect(page.locator(".bv-list-books li").nth(1)).toContainText("Peril at End House");
  await expect(toast).toHaveCount(0);
  expect(sent(app, "POST", "/me/lists/7/books").at(-1).body).toEqual({ book_id: 2 });
  expect(sent(app, "PUT", "/me/lists/7/order").at(-1).body).toEqual({ book_ids: [1, 2, 3] });
  expect(app.lists[0].books.map(item => item.id)).toEqual([1, 2, 3]);
});

test("the Undo toast goes away after six seconds", async ({ page, app: _app }) => {
  await page.goto("/profile/lists/7");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Remove Murder on the Orient Express from this list" }).click();
  await expect(page.locator(".bv-undo-toast")).toBeVisible();
  await expect(page.locator(".bv-undo-toast")).toHaveCount(0, { timeout: 8000 });
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
  await expect(page.locator(".bv-figures")).toContainText("finished2");
  await expect(page.locator(".bv-figures")).toContainText("pages400");
  await expect(page.locator(".bv-figures")).toContainText("biggest monthJan");
  await expect(page.getByText("Books finished")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Shared list/ })).toHaveAttribute("href", "/u/ada/lists/3");
  await expect(page.locator(".bv-profile-head .bv-avatar")).toHaveCSS("width", "96px");
  await expect(page.locator(".bv-profile-head .bv-avatar")).toHaveCSS("background-color", "rgb(107, 63, 94)");
  const text = await page.locator("main").innerText();
  for (const hidden of ["ada@example.com", "Secret note", "Want to read", "Owned", "Edit", "Make private", "Make public", "Only you", "Private list", "Account settings", "Sign out", "Edit profile"]) expect(text).not.toContain(hidden);
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

test("a missing or private public page shows the not-found page with its own tab title, and your own page says how others see it", async ({ page, app }) => {
  await page.goto("/u/missing");
  await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Bookvane");
  app.profile.handle = "ada"; app.profile.profile_public = true;
  await page.goto("/u/ada");
  await expect(page.getByText("This is how others see your profile.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create free account" })).toHaveCount(0);
});

test("the header shows the avatar as the profile entry, with the accessible name Your profile", async ({ page, app: _app }) => {
  await page.goto("/browse");
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toHaveAttribute("href", "/profile");
  await expect(page.getByRole("link", { name: "Your account" })).toHaveCount(0);
});

test("the hub ends with Account settings and Sign out, and Sign out signs the reader out", async ({ page, app }) => {
  await page.goto("/profile");
  const account = page.getByRole("region", { name: "Account" });
  await expect(account.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/account");
  const order = await page.locator(".bv-profile > *").evaluateAll(nodes => nodes.map(node => node.className || node.tagName));
  expect(order.at(-1)).toContain("bv-profile-account");
  await account.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => sent(app, "POST", "/auth/logout").length).toBe(1);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("guests who open /profile are sent to sign in and returned", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile$/);
});

test("profile tab screenshots", async ({ page, app }) => {
  test.skip(!process.env.PROFILE_SHOTS, "set PROFILE_SHOTS=1 to export screenshots");
  const dir = "../.bv-shots/profile-tabs";
  mkdirSync(dir, { recursive: true });
  app.profile.avatar_icon = "coffee"; app.profile.avatar_color = "rust"; app.profile.profile_public = false; app.profile.handle = "stmichael";
  app.stats = stats({ books_finished: 22, by_month: month(1, 2, 1, 3, 2, 4, 9, 3, 1, 2) });
  app.lists[0].is_public = true;
  app.lists.push({ id: 9, name: "Rainy-day rereads", description: null, is_public: false, book_count: 0, covers: [], books: [] });
  const fixtureLists = [...app.lists];
  const empty = stats({ books_finished: 0, pages_read: 0, by_month: month(), biggest_month: null, top_genres: [] });
  const data = app.stats;
  const shoot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true }); };
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    for (const [label, _width, height] of [["375", 375, 812], ["1440", 1440, 900], ["375-text200", 375, 812]]) {
      await page.setViewportSize({ width: Number.parseInt(label, 10), height });
      const zoom = label.endsWith("text200");
      const open = async path => { await page.goto(path).catch(() => page.goto(path)); await page.addStyleTag({ content: `.bv-mobile-nav { display: none !important; }${zoom ? " html { font-size: 200%; }" : ""}` }); };
      app.stats = data; app.guest = false;
      for (const tab of ["overview", "lists", "year"]) {
        await open(tab === "overview" ? "/profile" : `/profile?tab=${tab}`);
        await expect(page.getByRole("tab", { name: tab[0].toUpperCase() + tab.slice(1) })).toHaveAttribute("aria-selected", "true");
        await shoot(`${tab}-data-${label}-${theme}`);
      }
      if (zoom) continue;
      app.stats = empty;
      for (const tab of ["overview", "year"]) { await open(tab === "overview" ? "/profile" : `/profile?tab=${tab}`); await expect(page.getByRole("tab", { name: tab[0].toUpperCase() + tab.slice(1) })).toHaveAttribute("aria-selected", "true"); await shoot(`${tab}-empty-${label}-${theme}`); }
      app.lists = []; await open("/profile?tab=lists"); await expect(page.getByText("Make a list for a series")).toBeVisible(); await shoot(`lists-empty-${label}-${theme}`);
      app.lists = [...fixtureLists];
      app.stats = data; app.guest = true;
      for (const tab of ["overview", "lists", "year"]) { await open(tab === "overview" ? "/u/ada" : `/u/ada?tab=${tab}`); await expect(page.getByRole("tab", { name: tab[0].toUpperCase() + tab.slice(1) })).toHaveAttribute("aria-selected", "true"); await shoot(`public-${tab}-${label}-${theme}`); }
      app.guest = false;
    }
  }
});
