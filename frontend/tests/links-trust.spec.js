import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Dead links, "With {club}", the privacy copy and the lend cover. Browser fixtures only (the findability fixture, trimmed).
const BOOK = { id: 1, title: "Middlemarch", authors: [{ id: 1, name: "George Eliot" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1871, page_count: 880 };
const entry = { id: 50, book_id: 1, book: BOOK, is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const CLUB = { id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", role: "owner", member_count: 8, current_book: { book_id: 1, title: "Middlemarch" } };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, entries: [], loans: [], libraryImport: true, currentReads: [], requests: [], errors: [] };
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
      if (path === "/me/home") return reply(200, { current_reads: state.currentReads, reading_count: state.currentReads.length, paused_count: 0 });
      if (/^\/me\/library\/\d+\/attempts$/.test(path)) return reply(200, { items: [] });
      if (path.startsWith("/loans/")) return reply(404, { detail: "Not found" });
      if (path === "/me/library") return reply(200, { items: state.entries, counts: { all: state.entries.length, owned: state.entries.length, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: state.entries.length, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: [] });
      if (path === "/me/loans" && method === "GET") return reply(200, { items: state.loans });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: Boolean(state.showPrompt), reading_since: 2026, email_tips: false });
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
      if (path === "/clubs/5/reports") return reply(200, { items: [] });
      if (path.startsWith("/club-invites/")) return reply(404, { detail: "Not found" });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});


const reading = (id, bookId, title) => ({ entry: { ...entry, id, book_id: bookId, book: { ...BOOK, id: bookId, title }, reading_state: "reading", version: 2 }, attempt: { id: `attempt-${id}`, state: "reading", started_on: "2026-11-03", progress_unit: "pages", progress_value: 10, total_pages: 300 } });

for (const signedIn of [false, true]) test(`a dead club invite explains itself ${signedIn ? "signed in" : "signed out"}`, async ({ page, app }) => {
  app.guest = !signedIn;
  await page.goto("/c/gone");
  await expect(page.getByRole("heading", { level: 1, name: "This invite link isn’t working." })).toBeVisible();
  await expect(page.getByText("It may have expired or been stopped. Ask the person who sent it for a new link.", { exact: true })).toBeVisible();
  const button = page.getByRole("main").getByRole("link", { name: signedIn ? "Your clubs" : "Go to Bookvane", exact: true });
  await expect(button).toHaveAttribute("href", signedIn ? "/clubs" : "/");
  await expect(page).toHaveTitle(/Join a club/);
});

test("a dead loan link explains itself", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/l/gone");
  await expect(page.getByRole("heading", { level: 1, name: "This loan link isn’t working." })).toBeVisible();
  await expect(page.getByText("The loan may have ended, or its owner stopped sharing it.", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Go to Bookvane", exact: true })).toHaveAttribute("href", "/");
});

test("Home shows With {club} only on the card whose book is the club's current book, and asks for the clubs once", async ({ page, app }) => {
  app.currentReads = [reading(50, 1, "Middlemarch"), reading(51, 2, "Circe")];
  await page.goto("/home");
  const cards = page.locator(".bv-now-card");
  await expect(cards).toHaveCount(2);
  const line = cards.first().getByRole("link", { name: "With Tuesday Readers" });
  await expect(line).toHaveAttribute("href", "/clubs/5");
  await expect(cards.nth(1).getByRole("link", { name: /^With / })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(app.requests.filter(request => request.path === "/me/clubs" && request.method === "GET")).toHaveLength(1);
});

test("the reading page shows With {club} for the club's current book", async ({ page, app: _app }) => {
  await page.goto("/my-books/50");
  await expect(page.getByRole("link", { name: "With Tuesday Readers" })).toHaveAttribute("href", "/clubs/5");
});

test("/privacy has the Clubs and Lending sections, word for word", async ({ page, app: _app }) => {
  await page.goto("/privacy");
  const clubs = page.getByRole("heading", { name: "Clubs", exact: true, level: 2 }), lending = page.getByRole("heading", { name: "Lending", exact: true, level: 2 });
  await expect(clubs.locator("xpath=following-sibling::p[1]")).toHaveText("Members of a club see your name and your posts. They see the page you’re on only if you turn on sharing. Nobody outside the club sees any of it.");
  await expect(lending.locator("xpath=following-sibling::p[1]")).toHaveText("A borrower’s link shows the book, its cover and your display name. It stops working soon after the loan ends, or as soon as you stop sharing it.");
});

test("the lend sheet cover is 56px wide", async ({ page, app: _app }) => {
  await page.goto("/privacy");
  expect(await page.evaluate(() => { const probe = document.createElement("div"); probe.className = "bv-loan-book-cover"; document.querySelector("main").append(probe); return probe.getBoundingClientRect().width; })).toBe(56);
});

test("a fresh account sees no \"Let friends find you?\" sheet on an invite page or the clubs pages, but still sees it on Home", async ({ page, app }) => {
  app.showPrompt = true;
  const sheet = page.getByRole("dialog", { name: "Let friends find you?" });
  await page.goto("/c/gone");
  await expect(page.getByRole("heading", { level: 1, name: "This invite link isn’t working." })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.goto("/clubs/5");
  await expect(page.getByRole("heading", { name: "Tuesday Readers" }).first()).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.goto("/home");
  await expect(sheet).toBeVisible();
});
