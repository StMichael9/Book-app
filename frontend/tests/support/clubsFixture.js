import { test as base, expect } from "@playwright/test";
import { installGenres } from "./genres.js";

// The clubs fixture shared by clubs.spec.js (list, join, layout) and clubs-page.spec.js (the club page). Browser fixtures only: every API request
// is intercepted, the clubs endpoints included. State is mutable so a test can change what the "server" holds and read what the app sent.
export const BOOKS = [
  { id: 1, title: "Middlemarch", authors: [{ id: 1, name: "George Eliot" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1871, page_count: 880 },
  { id: 2, title: "Nineteen Eighty-Four", authors: [{ id: 2, name: "George Orwell" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1949, page_count: 328 },
  { id: 3, title: "Emma", authors: [{ id: 3, name: "Jane Austen" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1815, page_count: 474 },
  { id: 4, title: "The Remains of the Day", authors: [{ id: 4, name: "Kazuo Ishiguro" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1989, page_count: 258 },
  { id: 5, title: "Persuasion", authors: [{ id: 3, name: "Jane Austen" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1817, page_count: 249 },
];
export const TOKEN = "T".repeat(24);
const NAMES = ["Rae", "Ana", "Sam", "Priya", "Tom", "Jo", "Max", "Ida"];
const uid = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const memberId = index => uid(index);

const freshBooks = () => [
  { id: 11, book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null, page_count: 880, status: "current", starts_on: "2026-11-14", ends_on: "2027-01-02",
    checkpoints: [{ id: 1, unit: "pages", value: 100, due_on: "2026-11-21", label: null }, { id: 2, unit: "pages", value: 240, due_on: "2026-12-05", label: null }, { id: 3, unit: "pages", value: 380, due_on: "2026-12-19", label: null }] },
  { id: 12, book_id: 2, title: "Nineteen Eighty-Four", authors: ["George Orwell"], cover_image_url: null, page_count: 328, status: "upcoming", starts_on: "2027-01-02", ends_on: null, checkpoints: [] },
  { id: 14, book_id: 4, title: "The Remains of the Day", authors: ["Kazuo Ishiguro"], cover_image_url: null, page_count: 258, status: "upcoming", starts_on: null, ends_on: null, checkpoints: [] },
  { id: 10, book_id: 3, title: "Emma", authors: ["Jane Austen"], cover_image_url: null, page_count: 474, status: "past", starts_on: "2026-09-20", ends_on: "2026-10-18", checkpoints: [] },
  { id: 9, book_id: 5, title: "Persuasion", authors: ["Jane Austen"], cover_image_url: null, page_count: 249, status: "past", starts_on: "2026-08-01", ends_on: "2026-08-30", checkpoints: [] },
];
const freshPosts = () => [
  { id: 32, locked: true, unlocks_at: { unit: "pages", value: 450 }, author: { name: "Tom" }, created_at: "2026-11-20T11:00:00Z" },
  { id: 31, locked: true, unlocks_at: { unit: "pages", value: 310 }, author: { name: "Sam" }, created_at: "2026-11-20T10:00:00Z" },
  { id: 30, body: "Dorothea’s choice in chapter 20 finally makes sense to me.", author: { name: "Ana", initials: "A", patron: false }, mine: false, anchor: { unit: "pages", value: 205 }, created_at: "2026-11-20T10:00:00Z", edited_at: null },
  { id: 29, body: "My own note.", author: { name: "Rae", initials: "R", patron: false }, mine: true, anchor: { unit: "pages", value: 150 }, created_at: "2026-11-19T10:00:00Z", edited_at: null },
  { id: 28, hidden: true },
];

export const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, requests: [], errors: [], myRole: "owner", count: 8, plus: false, shared: false, roles: {}, myProgress: { state: "reading", unit: "pages", value: 212 },
      clubs: [{ id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", role: "owner", member_count: 8, current_book: { book_id: 1, title: "Middlemarch" } }],
      books: freshBooks(), posts: freshPosts(), reports: [
        { id: 41, body: "A post that was reported.", author: "Priya", report_count: 3, reasons: ["Spoils the ending", "Rude"], hidden: true, created_at: "2026-11-20T10:00:00Z" },
        { id: 42, body: "Another reported post.", author: "Jo", report_count: 1, reasons: [], hidden: false, created_at: "2026-11-20T10:00:00Z" }],
      entryId: 900, attempt: { id: "a1", state: "reading", started_on: "2026-11-14", ended_on: null, progress_unit: "pages", progress_value: 212, total_pages: 880, note: null, reaction: null, updated_at: "2026-11-20T10:00:00Z" }, aheadError: false, failBookPatchAt: 0, failBookDelete: false, patchCount: 0, newName: "",
      preview: { name: "Tuesday Readers", description: null, color: "#3f6b52", member_count: 8, full: false, owner_name: "Rae", current_book: { book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null } },
      previewStatus: 200, joinStatus: 200 };
    const members = () => Array.from({ length: state.count }, (_, index) => {
      const mine = index === (state.myRole === "owner" ? 0 : 1), base = index === 0 ? "owner" : index === 2 && state.myRole !== "admin" ? "admin" : mine ? state.myRole : "member";
      const role = state.roles[uid(index)] || base, shares = mine ? state.shared : index < 3;
      const progress = mine ? state.myProgress : index === 1 ? { state: "reading", unit: "pages", value: 260 } : index === 2 ? { state: "reading", unit: "pages", value: 180 } : null;
      return { user_id: uid(index), name: NAMES[index % NAMES.length], initials: NAMES[index % NAMES.length][0], role, joined_at: "2026-11-01T00:00:00Z", patron: false, me: mine, shares_progress: shares, progress: mine || shares ? progress : null };
    });
    const detail = (id = 5) => ({ id, name: id === 6 ? state.newName : "Tuesday Readers", description: null, color: "#3f6b52", created_at: "2026-11-01T00:00:00Z", me: { role: state.myRole, share_progress: state.shared },
      member_count: state.count, club_plus: state.plus, ...(state.limit ? { member_limit: state.limit, effective_cap: state.limit } : {}), cap: { free_limit: 25, full: state.count >= (state.limit || 25) && !state.plus }, books: id === 6 ? [] : state.books });
    const entry = () => ({ id: 900, book_id: 1, book: BOOKS[0], is_owned: false, is_wanted: true, version: 1 + state.patchCount, reading_state: state.attempt ? "reading" : null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
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
      if (path === "/me/loans" && method === "GET") return reply(200, { items: [] });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/up-next") return reply(200, []);
      if (path === "/books/more") return reply(200, []);
      if (path.startsWith("/autocomplete")) { const q = (url.searchParams.get("q") || "").toLowerCase(); return reply(200, path.endsWith("/books") ? BOOKS.filter(book => book.title.toLowerCase().includes(q)).map(book => ({ id: book.id, title: book.title, authors: [book.authors[0].name], year: book.published_year, cover_url: null })) : []); }
      if (/^\/books\/\d+$/.test(path)) return reply(200, BOOKS[Number(path.split("/").at(-1)) - 1]);
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (/^\/authors\/\d+\/books$/.test(path)) return reply(200, { items: [], total: 0, page: 1, size: 24, pages: 1 });
      // the reader's own shelf, for Update my page
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: id === 1 ? state.entryId : null, version: id === 1 && state.entryId ? entry().version : null, is_owned: false, is_wanted: id === 1 && Boolean(state.entryId), reading_state: null })) });
      if (path === "/me/library/books/1" && method === "PUT") { state.entryId = 900; return reply(200, entry()); }
      if (path === "/me/library/900/reading") return reply(200, { entry: entry(), current_attempt: state.attempt, editions: [] });
      if (path === "/me/library/900") return reply(200, entry());
      if (/^\/me\/reading-attempts\/[^/]+$/.test(path) && method === "PUT") { state.attempt = { id: path.split("/").at(-1), state: "reading", started_on: "2026-11-22", ended_on: null, progress_unit: null, progress_value: null, total_pages: 880, note: null, reaction: null, updated_at: "2026-11-22T10:00:00Z" }; state.patchCount += 1; return reply(200, { entry: entry(), attempt: state.attempt }); }
      if (/^\/me\/reading-attempts\/[^/]+$/.test(path) && method === "PATCH") {
        state.attempt = { ...state.attempt, progress_unit: body.progress_unit, progress_value: body.progress_value }; state.patchCount += 1;
        state.myProgress = { state: "reading", unit: body.progress_unit, value: body.progress_value };
        return reply(200, { entry: entry(), attempt: state.attempt });
      }
      // clubs
      if (path === "/me/clubs" && method === "GET") return reply(200, { items: state.clubs });
      if (path === "/me/clubs" && method === "POST") { state.newName = body.name; const club = { id: 6, name: body.name, description: body.description, color: body.color, role: "owner", member_count: 1 }; state.clubs.push(club); state.myRole = "owner"; state.count = 1; return reply(201, club); }
      if (path === "/me/clubs/join") return state.joinStatus === 200 ? reply(200, { id: 5, name: "Tuesday Readers", joined: true }) : reply(state.joinStatus, { detail: { code: "club_full" } });
      if (path === `/club-invites/${TOKEN}`) return state.previewStatus === 200 ? reply(200, state.preview) : reply(404, { detail: "Not found" });
      if (path.startsWith("/club-invites/")) return reply(404, { detail: "Not found" });
      if (/^\/clubs\/(5|6)$/.test(path) && method === "GET") return reply(200, detail(Number(path.slice(-1))));
      if (/^\/clubs\/(5|6)$/.test(path) && method === "PATCH") { if (body.member_limit) state.limit = body.member_limit; return reply(200, { id: 5, ...body }); }
      if (path === "/clubs/5" && method === "DELETE") return nothing();
      if (/^\/clubs\/\d+$/.test(path) && method === "GET") return reply(404, { detail: "Club not found" });
      if (path === "/clubs/5/members") return reply(200, { items: members() });
      if (path === "/clubs/6/members") return reply(200, { items: [{ ...members()[0], me: true, role: "owner", shares_progress: false, progress: null }] });
      if (/^\/clubs\/\d+\/members$/.test(path)) return reply(404, { detail: "Club not found" });
      if (path === "/clubs/5/me") { state.shared = body.share_progress; return reply(200, { share_progress: body.share_progress }); }
      if (path === "/clubs/5/invites" && method === "POST") return reply(201, { id: "i-1", url: `https://bookvane.me/c/${TOKEN}?ref=club`, expires_at: "2026-12-05T00:00:00Z", max_uses: null });
      if (/^\/clubs\/5\/invites\/[^/]+$/.test(path) && method === "DELETE") return nothing();
      if (path === "/clubs/5/leave") return nothing();
      if (/^\/clubs\/5\/members\/[^/]+$/.test(path)) { const target = path.split("/").at(-1); if (method === "DELETE") return nothing(); state.roles[target] = body.role; return reply(200, { role: body.role }); }
      if (path === "/clubs/5/books" && method === "POST") { const known = BOOKS[body.book_id - 1], added = { id: 13, book_id: body.book_id, title: known.title, authors: [known.authors[0].name], cover_image_url: null, page_count: known.page_count, status: body.status, starts_on: body.starts_on || null, ends_on: null, checkpoints: [] }; state.books.push(added); return reply(201, added); }
      if (/^\/clubs\/5\/books\/\d+$/.test(path) && method === "PATCH") {
        state.patchBookCalls = (state.patchBookCalls || 0) + 1;
        if (state.failBookPatchAt && state.patchBookCalls === state.failBookPatchAt) return reply(500, { detail: "down" });
        const target = state.books.find(item => item.id === Number(path.split("/").at(-1))); if (target) Object.assign(target, body);
        return reply(200, { id: target?.id, ...body });
      }
      if (/^\/clubs\/5\/books\/\d+\/checkpoints$/.test(path) && method === "POST") { const target = state.books.find(item => item.id === Number(path.split("/")[4])); const point = { id: 100 + (state.pointId = (state.pointId || 0) + 1), label: null, ...body }; target.checkpoints.push(point); return reply(201, point); }
      if (/^\/clubs\/5\/books\/\d+\/checkpoints\/\d+$/.test(path) && method === "DELETE") { const target = state.books.find(item => item.id === Number(path.split("/")[4])); target.checkpoints = target.checkpoints.filter(point => point.id !== Number(path.split("/")[6])); return nothing(); }
      if (/^\/clubs\/5\/books\/\d+$/.test(path) && method === "DELETE") {
        if (state.failBookDelete) return reply(500, { detail: "down" });
        state.books = state.books.filter(item => item.id !== Number(path.split("/").at(-1))); return nothing();
      }
      if (/^\/clubs\/5\/books\/\d+\/posts$/.test(path) && method === "GET") return url.searchParams.get("before") ? reply(200, { items: state.older || [], next_before: null }) : reply(200, { items: state.posts, next_before: state.older ? 28 : null });
      if (/^\/clubs\/5\/books\/\d+\/posts$/.test(path) && method === "POST") {
        if (state.aheadError) return reply(422, { detail: { code: "anchor_ahead_of_progress" } });
        return reply(201, { id: 40, body: body.body, author: { name: "Rae", initials: "R", patron: false }, mine: true, anchor: body.anchor_unit && body.anchor_value ? { unit: body.anchor_unit, value: body.anchor_value } : null, created_at: "2026-11-22T10:00:00Z", edited_at: null });
      }
      if (/^\/clubs\/5\/posts\/\d+$/.test(path) && method === "PATCH") { const target = state.posts.find(post => post.id === Number(path.split("/").at(-1))); if (target) { target.body = body.body; target.edited_at = "2026-11-22T10:00:00Z"; } return reply(200, target || {}); }
      if (/^\/clubs\/5\/posts\/\d+$/.test(path) && method === "DELETE") { state.posts = state.posts.filter(post => post.id !== Number(path.split("/").at(-1))); return nothing(); }
      if (/^\/clubs\/5\/posts\/\d+\/report$/.test(path)) return reply(200, { reported: true });
      if (path === "/clubs/5/reports") return reply(200, { items: state.reports });
      if (path === "/clubs/6/reports") return reply(200, { items: [] });
      if (/^\/clubs\/5\/posts\/\d+\/review$/.test(path)) { state.reports = state.reports.filter(item => item.id !== Number(path.split("/")[4])); return reply(200, { action: body.action }); }
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await page.clock.setFixedTime(new Date("2026-11-22T12:00:00"));
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
export const sent = (app, method, path) => app.requests.filter(request => request.method === method && request.path === path);
export { expect };
