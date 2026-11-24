import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// T78B: Clubs. Browser fixtures only: every API request is intercepted, the clubs endpoints included.
const BOOKS = [
  { id: 1, title: "Middlemarch", authors: [{ id: 1, name: "George Eliot" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1871, page_count: 880 },
  { id: 2, title: "Nineteen Eighty-Four", authors: [{ id: 2, name: "George Orwell" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1949, page_count: 328 },
];
const TOKEN = "T".repeat(24);
const checkpoints = [{ id: 1, unit: "pages", value: 100, due_on: "2026-11-21", label: null }, { id: 2, unit: "pages", value: 240, due_on: "2026-12-05", label: null }, { id: 3, unit: "pages", value: 380, due_on: "2026-12-19", label: null }];
const NAMES = ["Rae", "Ana", "Sam", "Priya", "Tom", "Jo", "Max", "Ida"];
const memberList = (count, myRole, myProgress) => Array.from({ length: count }, (_, index) => {
  const mine = index === (myRole === "owner" ? 0 : 1), role = index === 0 ? "owner" : index === 2 && myRole !== "admin" ? "admin" : mine ? myRole : "member";
  return { user_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: NAMES[index % NAMES.length], initials: NAMES[index % NAMES.length][0], role, joined_at: "2026-11-01T00:00:00Z", patron: false, me: mine,
    shares_progress: mine ? false : index < 3, progress: mine ? myProgress : index < 3 ? { state: "reading", unit: "pages", value: 100 + index * 40 } : null };
});

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, requests: [], errors: [], myRole: "owner", count: 8, plus: false, myProgress: { state: "reading", unit: "pages", value: 212 }, clubs: [{ id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", role: "owner", member_count: 8, current_book: { book_id: 1, title: "Middlemarch" } }],
      preview: { name: "Tuesday Readers", description: null, color: "#3f6b52", member_count: 8, full: false, owner_name: "Rae", current_book: { book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null } },
      previewStatus: 200, joinStatus: 200, noBook: false, posts: null };
    const detail = (id = 5) => ({ id, name: id === 6 ? state.newName : "Tuesday Readers", description: null, color: "#3f6b52", created_at: "2026-11-01T00:00:00Z", me: { role: state.myRole, share_progress: state.shared || false },
      member_count: state.count, club_plus: state.plus, cap: { free_limit: 25, full: state.count >= 25 && !state.plus },
      books: state.noBook || id === 6 ? [] : [{ id: 11, book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null, page_count: 880, status: "current", starts_on: "2026-11-14", ends_on: "2027-01-02", checkpoints },
        { id: 12, book_id: 2, title: "Nineteen Eighty-Four", authors: ["George Orwell"], cover_image_url: null, page_count: 328, status: "upcoming", starts_on: "2027-01-02", ends_on: null, checkpoints: [] }] });
    const posts = () => state.posts || [
      { id: 31, locked: true, unlocks_at: { unit: "pages", value: 310 }, author: { name: "Sam", initials: "S" }, created_at: "2026-11-20T10:00:00Z" },
      { id: 30, body: "Dorothea’s choice in chapter 20 finally makes sense to me.", author: { name: "Ana", initials: "A", patron: false }, mine: false, anchor: { unit: "pages", value: 205 }, created_at: "2026-11-20T10:00:00Z", edited_at: null },
      { id: 29, body: "My own note.", author: { name: "Rae", initials: "R", patron: false }, mine: true, anchor: { unit: "pages", value: 150 }, created_at: "2026-11-19T10:00:00Z", edited_at: null },
      { id: 28, hidden: true },
    ];
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
      const nothing = () => route.fulfill({ status: 204, body: "" });
      if (path === "/events") return nothing();
      if (path === "/auth/refresh") return reply(state.guest ? 401 : 200, {});
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: false } });
      if (path === "/me/library") return reply(200, { items: [], counts: { all: 0, owned: 0, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: 0, next_cursor: null, facets: {}, index: null });
      if (path === "/me/loans" && method === "GET") return reply(200, { items: [] }); // My Books asks for open loans (the On loan tab); none here
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/up-next") return reply(404, { detail: "Not found" });
      if (path === "/books/more") return reply(200, []);
      if (path.startsWith("/autocomplete")) return reply(200, path.endsWith("/books") ? [{ id: 2, title: "Nineteen Eighty-Four", authors: ["George Orwell"], year: 1949, cover_url: null }] : []);
      if (/^\/books\/\d+$/.test(path)) return reply(200, BOOKS[Number(path.split("/").at(-1)) - 1]);
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/me/library/books/1" && method === "PUT") return reply(200, { id: 900, book_id: 1, book: BOOKS[0], is_owned: false, is_wanted: true, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
      // clubs
      if (path === "/me/clubs" && method === "GET") return reply(200, { items: state.clubs });
      if (path === "/me/clubs" && method === "POST") { state.newName = body.name; const club = { id: 6, name: body.name, description: body.description, color: body.color, role: "owner", member_count: 1 }; state.clubs.push(club); state.myRole = "owner"; state.count = 1; return reply(201, club); }
      if (path === "/me/clubs/join") return state.joinStatus === 200 ? reply(200, { id: 5, name: "Tuesday Readers", joined: true }) : reply(state.joinStatus, { detail: { code: "club_full" } });
      if (path === `/club-invites/${TOKEN}`) return state.previewStatus === 200 ? reply(200, state.preview) : reply(404, { detail: "Not found" });
      if (path.startsWith("/club-invites/")) return reply(404, { detail: "Not found" });
      if (/^\/clubs\/(5|6)$/.test(path) && method === "GET") return reply(200, detail(Number(path.slice(-1))));
      if (/^\/clubs\/(5|6)$/.test(path) && method === "PATCH") return reply(200, { id: 5, ...body });
      if (/^\/clubs\/\d+$/.test(path) && method === "GET") return reply(404, { detail: "Club not found" });
      if (path === "/clubs/5/members") return reply(200, { items: memberList(state.count, state.myRole, state.myProgress) });
      if (path === "/clubs/6/members") return reply(200, { items: memberList(1, "owner", null) });
      if (/^\/clubs\/\d+\/members$/.test(path) && path !== "/clubs/5/members") return reply(404, { detail: "Club not found" });
      if (path === "/clubs/5/me") { state.shared = body.share_progress; return reply(200, { share_progress: body.share_progress }); }
      if (path === "/clubs/5/invites" && method === "POST") return reply(201, { id: "i-1", url: `https://bookvane.me/c/${TOKEN}?ref=club`, expires_at: "2026-12-05T00:00:00Z", max_uses: null });
      if (/^\/clubs\/5\/invites\/[^/]+$/.test(path) && method === "DELETE") return nothing();
      if (path === "/clubs/5/leave") return nothing();
      if (/^\/clubs\/5\/members\/[^/]+$/.test(path)) return method === "DELETE" ? nothing() : reply(200, { role: body.role });
      if (path === "/clubs/5/books" && method === "POST") return reply(201, { id: 13, book_id: body.book_id, status: body.status, starts_on: null, ends_on: null });
      if (path === "/clubs/5/books/11/posts" && method === "GET") return reply(200, { items: posts(), next_before: null });
      if (path === "/clubs/5/books/11/posts" && method === "POST") return reply(201, { id: 40, body: body.body, author: { name: "Rae", initials: "R", patron: false }, mine: true, anchor: body.anchor_unit ? { unit: body.anchor_unit, value: body.anchor_value } : null, created_at: "2026-11-22T10:00:00Z", edited_at: null });
      if (/^\/clubs\/5\/posts\/\d+$/.test(path) && method === "DELETE") return nothing();
      if (/^\/clubs\/5\/posts\/\d+\/report$/.test(path)) return reply(200, { reported: true });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await page.clock.setFixedTime(new Date("2026-11-22T12:00:00"));
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
const sent = (app, method, path) => app.requests.filter(request => request.method === method && request.path === path);

// ---- the list ---------------------------------------------------------------------------------------------------------

test("the clubs list is at /clubs and shows each club with its book, next checkpoint and the reader's page", async ({ page, app: _app }) => {
  await page.goto("/clubs");
  await expect(page.getByRole("heading", { name: "Your clubs", level: 1 })).toBeVisible();
  const card = page.locator(".bv-club-card");
  await expect(card).toContainText("Tuesday Readers");
  await expect(card).toContainText("8 members · Now reading Middlemarch");
  await expect(card).toContainText("Next: p. 240 by 5 Dec");
  await expect(card).toContainText("You’re on p. 212.");
  await expect(card).toHaveAttribute("href", "/clubs/5");
});

test("with no clubs the list says what clubs are, and Start a club makes one and opens it with Invite highlighted", async ({ page, app }) => {
  app.clubs = [];
  await page.goto("/clubs");
  await expect(page.getByText("Read together with friends.", { exact: true })).toBeVisible();
  await expect(page.getByText("Clubs are private and invite-only.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a club" })).toHaveCount(1);
  await page.getByRole("button", { name: "Start a club" }).click();
  const sheet = page.getByRole("dialog", { name: "Start a club" });
  await sheet.getByLabel("Club name").fill("Office Sci-Fi");
  await sheet.getByLabel("What’s it about? (optional)").fill("Short novels");
  await expect(sheet.getByRole("radio")).toHaveCount(6);
  await sheet.getByRole("radio").nth(1).check({ force: true });
  await sheet.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/6$/);
  expect(sent(app, "POST", "/me/clubs")[0].body).toEqual({ name: "Office Sci-Fi", description: "Short novels", color: "#9c432d" });
  await expect(page.getByRole("heading", { name: "Office Sci-Fi", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite" })).toHaveClass(/is-highlight/);
});

// ---- the club page ------------------------------------------------------------------------------------------------------

test.describe("club page", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("header, Now reading with its schedule, and the aside", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
    await expect(page.getByText("8 members · private, invite-only", { exact: true })).toBeVisible();
    const now = page.getByRole("region", { name: "Now reading" });
    await expect(now.locator(".bv-club-title")).toHaveText("Middlemarch");
    await expect(now.locator(".bv-club-author")).toHaveText("George Eliot");
    await expect(now.getByRole("heading", { name: "Schedule" })).toBeVisible();
    const marks = now.locator(".bv-club-marks li");
    await expect(marks).toHaveText(["p. 100 · 21 Nov", "p. 240 · 5 Dec", "p. 380 · 19 Dec", "End · 2 Jan"]);
    await expect(marks.nth(1)).toHaveClass(/is-next/);
    await expect(now.getByText("You’re on p. 212.", { exact: true })).toBeVisible();
    const aside = page.getByRole("complementary", { name: "Club members" });
    await expect(aside.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(aside.locator(".bv-club-member")).toHaveCount(5);
    await expect(aside.locator(".bv-club-member").first()).toContainText("owner");
    await aside.getByRole("button", { name: "See all 8" }).click();
    await expect(aside.locator(".bv-club-member")).toHaveCount(8);
    await expect(aside.getByRole("heading", { name: "Up next" })).toBeVisible();
    await expect(aside.locator(".bv-club-title")).toHaveText("Nineteen Eighty-Four");
    await expect(aside.getByText("from 2 Jan", { exact: true })).toBeVisible();
    await expect(aside.getByRole("button", { name: "Leave club" })).toHaveCount(0); // the owner cannot leave
  });

  test("Invite copies a link, shows Copied, and Stop this link ends it", async ({ page, app, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "Invite" }).click();
    const sheet = page.getByRole("dialog", { name: "Invite" });
    await expect(sheet.getByRole("button", { name: "Stop this link" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Copy invite link" }).click();
    await expect(sheet.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://bookvane.me/c/${TOKEN}?ref=club`);
    expect(sent(app, "POST", "/clubs/5/invites")).toHaveLength(1);
    await sheet.getByRole("button", { name: "Stop this link" }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent(app, "DELETE", "/clubs/5/invites/i-1")).toHaveLength(1);
  });

  test("Discussion: the composer is prefilled with the reader's page and posts with it; locked rows carry no text; menus offer Report on others' posts and Delete on your own", async ({ page, app }) => {
    await page.goto("/clubs/5");
    const discussion = page.getByRole("region", { name: "Discussion" });
    await expect(discussion.getByLabel("About page")).toHaveValue("212");
    await expect(discussion.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
    const locked = discussion.locator(".bv-club-post.is-locked");
    await expect(locked).toHaveText("Unlocks at p. 310 · a post by Sam");
    await expect(discussion.locator(".bv-club-post")).toHaveCount(3); // the hidden row draws nothing
    const ana = discussion.locator(".bv-club-post", { hasText: "Ana" });
    await expect(ana).toContainText("about p. 205 ·");
    await expect(ana).toContainText("Dorothea’s choice in chapter 20");
    await ana.getByRole("button", { name: /More actions/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report", "Delete"]); // the owner moderates
    await page.getByRole("menuitem", { name: "Report" }).click();
    await expect.poll(() => sent(app, "POST", "/clubs/5/posts/30/report")).toHaveLength(1);
    const mine = discussion.locator(".bv-club-post", { hasText: "My own note." });
    await mine.getByRole("button", { name: /More actions/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Delete"]);
    await page.keyboard.press("Escape");
    await discussion.getByLabel("Write about this book").fill("Loving the Lydgate chapters.");
    await discussion.getByRole("button", { name: "Post", exact: true }).click();
    await expect.poll(() => sent(app, "POST", "/clubs/5/books/11/posts")).toHaveLength(1);
    expect(sent(app, "POST", "/clubs/5/books/11/posts")[0].body).toEqual({ body: "Loving the Lydgate chapters.", anchor_unit: "pages", anchor_value: 212 });
  });

  test("a member deleting needs ownership or moderation: an owner sees Delete on any post", async ({ page, app }) => {
    await page.goto("/clubs/5");
    const ana = page.locator(".bv-club-post", { hasText: "Ana" });
    await ana.getByRole("button", { name: /More actions/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report", "Delete"]);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect.poll(() => sent(app, "DELETE", "/clubs/5/posts/30")).toHaveLength(1);
  });

  test("Share my progress with this club is a switch that saves at once", async ({ page, app }) => {
    await page.goto("/clubs/5");
    const toggle = page.getByRole("switch", { name: "Share my progress with this club" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(sent(app, "PATCH", "/clubs/5/me")[0].body).toEqual({ share_progress: true });
  });

  test("owner tools: Edit club, Add a book and Edit schedule are in the header menu; Make admin and Remove from club are on member rows", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "More actions for this club" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Edit club", "Add a book", "Edit schedule"]);
    await page.getByRole("menuitem", { name: "Add a book" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a book" });
    await sheet.getByLabel("Search books").fill("nineteen");
    await sheet.getByRole("button", { name: /Nineteen Eighty-Four/ }).click();
    await expect.poll(() => sent(app, "POST", "/clubs/5/books")).toHaveLength(1);
    expect(sent(app, "POST", "/clubs/5/books")[0].body).toEqual({ book_id: 2, status: "upcoming" });
    const row = page.locator(".bv-club-member", { hasText: "Ana" });
    await row.getByRole("button", { name: "More actions for Ana" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Make admin", "Remove from club"]);
    await page.getByRole("menuitem", { name: "Make admin" }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && /\/clubs\/5\/members\//.test(request.path))).toHaveLength(1);
    // Remove from club asks first: Cancel does nothing, Remove acts.
    await row.getByRole("button", { name: "More actions for Ana" }).click();
    await page.getByRole("menuitem", { name: "Remove from club" }).click();
    const ask = page.getByRole("dialog", { name: "Remove Ana from the club?" });
    await expect(ask.getByText("They’ll need a new invite to rejoin.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    expect(app.requests.filter(request => request.method === "DELETE" && /\/clubs\/5\/members\//.test(request.path))).toHaveLength(0);
    await row.getByRole("button", { name: "More actions for Ana" }).click();
    await page.getByRole("menuitem", { name: "Remove from club" }).click();
    await page.getByRole("dialog", { name: "Remove Ana from the club?" }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "DELETE" && /\/clubs\/5\/members\//.test(request.path))).toHaveLength(1);
  });

  test("the cap shows to the owner only: n of 25 from 20 members, and the full message at 25 with no link while there is nowhere to send it", async ({ page, app }) => {
    app.count = 19;
    await page.goto("/clubs/5");
    await expect(page.getByText(/ of 25 members/)).toHaveCount(0);
    app.count = 20;
    await page.goto("/clubs/5");
    await expect(page.getByText("20 of 25 members", { exact: true })).toBeVisible();
    app.count = 25;
    await page.goto("/clubs/5");
    await expect(page.getByText("Your club is full. Club Plus removes the limit.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "See Club Plus" })).toHaveCount(0);
    app.myRole = "member";
    await page.goto("/clubs/5");
    await expect(page.getByText(/Club Plus|of 25 members/)).toHaveCount(0);
  });

  test("a member sees no owner tools and no Invite, can Leave club, and a post's Delete is theirs only", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5");
    await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions for this club" })).toHaveCount(0);
    const ana = page.locator(".bv-club-post", { hasText: "Ana" });
    await ana.getByRole("button", { name: /More actions/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Leave club" }).click();
    const ask = page.getByRole("dialog", { name: "Leave Tuesday Readers?" });
    await expect(ask.getByText("You’ll need a new invite to rejoin.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    expect(sent(app, "POST", "/clubs/5/leave")).toHaveLength(0);
    await expect(page).toHaveURL(/\/clubs\/5$/);
    await page.getByRole("button", { name: "Leave club" }).click();
    await page.getByRole("dialog", { name: "Leave Tuesday Readers?" }).getByRole("button", { name: "Leave club" }).click();
    await expect(page).toHaveURL(/\/clubs$/);
    expect(sent(app, "POST", "/clubs/5/leave")).toHaveLength(1);
  });

  test("a club that does not exist, or isn't yours, shows the not-found page", async ({ page, app: _app }) => {
    await page.goto("/clubs/99");
    await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  });
});

// ---- the join page --------------------------------------------------------------------------------------------------------

test.describe("join page", () => {
  test("signed out: who invited you, the club, the book, Sign up to join, Sign in; no header navigation, no footer, and kept out of search", async ({ page, app }) => {
    app.guest = true;
    await page.goto(`/c/${TOKEN}`);
    await expect(page.getByText("Rae invited you to join", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
    await expect(page.getByText("8 members · private, invite-only", { exact: true })).toBeVisible();
    await expect(page.getByText("Now reading", { exact: true })).toBeVisible();
    await expect(page.locator(".bv-club-author")).toHaveText("George Eliot");
    const here = encodeURIComponent(`/c/${TOKEN}`);
    await expect(page.getByRole("link", { name: "Sign up to join" })).toHaveAttribute("href", `/register?ref=club&returnTo=${here}`);
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", `/login?returnTo=${here}`);
    await expect(page.getByText("Already have an account?")).toBeVisible();
    await expect(page.getByText("Clubs are private. Only members can see the discussion.", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    expect(app.requests.some(request => request.path.startsWith("/me/"))).toBe(false);
  });

  test("signed in: Join the club joins and adds the book to the shelf when the box is ticked, then opens the club", async ({ page, app }) => {
    await page.goto(`/c/${TOKEN}`);
    const box = page.getByRole("checkbox", { name: "Add Middlemarch to my shelf" });
    await expect(box).toBeChecked();
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page).toHaveURL(/\/clubs\/5$/);
    expect(sent(app, "POST", "/me/clubs/join")[0].body).toEqual({ token: TOKEN });
    expect(sent(app, "PUT", "/me/library/books/1")[0].body).toEqual({ is_wanted: true });
  });

  test("an unticked box joins without touching the shelf", async ({ page, app }) => {
    await page.goto(`/c/${TOKEN}`);
    await page.getByRole("checkbox", { name: "Add Middlemarch to my shelf" }).uncheck();
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page).toHaveURL(/\/clubs\/5$/);
    expect(sent(app, "PUT", "/me/library/books/1")).toHaveLength(0);
  });

  test("a full club says so, and a club that fills while you read says so too", async ({ page, app }) => {
    app.preview = { ...app.preview, full: true };
    await page.goto(`/c/${TOKEN}`);
    await expect(page.getByText("This club is full right now.", { exact: true })).toBeVisible();
    await expect(page.getByText("Ask Rae to make room.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join the club" })).toHaveCount(0);
    app.preview = { ...app.preview, full: false }; app.joinStatus = 409;
    await page.goto(`/c/${TOKEN}`);
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page.getByText("This club is full right now.", { exact: true })).toBeVisible();
  });

  test("a bad or expired link shows the not-found page", async ({ page, app: _app }) => {
    await page.goto(`/c/${"x".repeat(24)}`);
    await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  });
});

// ---- layout ---------------------------------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"]) for (const [width, height] of [[390, 844], [1440, 1000]]) {
  test(`the clubs screens do not scroll sideways at ${width}px; ${scheme}`, async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), scheme);
    await page.setViewportSize({ width, height });
    const shots = process.env.CLUBS_SHOTS;
    const check = async (path, name, ready) => {
      await page.goto(path);
      await ready();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} scrolls sideways`).toBe(true);
      if (shots) await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
    };
    await check("/clubs", "list", () => expect(page.locator(".bv-club-card")).toContainText("Next: p. 240"));
    await check("/clubs/5", "club", () => expect(page.locator(".bv-club-post")).toHaveCount(3));
    app.guest = true;
    await check(`/c/${TOKEN}`, "join", () => expect(page.getByRole("link", { name: "Sign up to join" })).toBeVisible());
  });
}
