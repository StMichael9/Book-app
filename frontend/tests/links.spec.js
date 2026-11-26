import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// Links: none underlined at rest, four kinds. Browser fixtures only (the findability fixture, trimmed): every API request is intercepted.
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
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
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


const PAGES = ["/settings", "/home", "/browse", "/book/1", "/profile", "/privacy"];
// Every visible link or link-styled button, at rest: no underline. A link inside a sentence is bold instead (the cue that it is a link).
const sample = page => page.evaluate(() => [...document.querySelectorAll("a, button.bv-link-button, button.bv-inline-action, button.bv-text-link")].filter(node => node.getClientRects().length).map(node => {
  const style = getComputedStyle(node), inSentence = Boolean(node.closest("p, li")) && node.closest("p, li") !== node && !node.closest("nav, header, footer, .bv-book-card, .bv-next-card, .bv-upshelf-item");
  return { text: node.textContent.trim().slice(0, 30), line: style.textDecorationLine, weight: Number(style.fontWeight), inSentence };
}));

for (const theme of ["light", "dark"]) test(`no link is underlined at rest, and a sentence link is bold; ${theme}`, async ({ page, app }) => {
  app.entries = [entry];
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (const link of await sample(page)) {
      expect(link.line, `${path}: ${link.text}`).toBe("none");
      if (link.inSentence) expect(link.weight, `${path}: ${link.text}`).toBeGreaterThanOrEqual(600);
    }
  }
});

test("the footer links are muted grey, not underlined, and turn ink on hover", async ({ page, app: _app }) => {
  await page.goto("/privacy");
  const link = page.getByRole("contentinfo").getByRole("link", { name: "Contact", exact: true });
  const color = () => link.evaluate(node => getComputedStyle(node).color);
  const rest = await color();
  await link.hover();
  expect(await color()).not.toBe(rest);
  expect(await link.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("none");
});

test("a link inside a sentence is underlined on keyboard focus and on hover", async ({ page, app: _app }) => {
  await page.goto("/privacy");
  const link = page.locator("main p a, main li a, main p .bv-text-link").first();
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  expect(await link.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("underline");
});

test("the desktop menu marks the current page with a soft pill and no underline; the others have no fill", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const look = link => link.evaluate(node => { const s = getComputedStyle(node); return { bg: s.backgroundColor, border: s.borderBottomWidth, line: s.textDecorationLine }; });
  const current = await look(nav.getByRole("link", { name: "Home", exact: true }));
  expect(current.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(current.border).toBe("0px");
  for (const name of ["Discover", "My Books"]) expect((await look(nav.getByRole("link", { name, exact: true }))).bg, name).toBe("rgba(0, 0, 0, 0)");
});

test("Settings destinations are rows: a link with a chevron, 52px tall, and the whole row clicks", async ({ page, app: _app }) => {
  await page.goto("/settings");
  const genres = page.getByRole("link", { name: "Choose genres", exact: true });
  await expect(genres.locator("svg")).toHaveCount(1);
  const row = await page.locator(".bv-account-row--link").boundingBox();
  expect(row.height).toBeGreaterThanOrEqual(52);
  await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await expect(page).toHaveURL(/\/preferences$/);
  await page.goto("/settings");
  for (const name of ["Your reading data", "Import from Goodreads or StoryGraph"]) {
    const link = page.locator(".bv-account-rowlinks").getByRole("link", { name, exact: true });
    await expect(link.locator("svg")).toHaveCount(1);
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(52);
  }
  await page.mouse.click(0, 0);
  await page.locator(".bv-account-rowlinks").getByRole("link", { name: "Your reading data", exact: true }).click({ position: { x: 5, y: 20 } });
  await expect(page).toHaveURL(/\/my-data$/);
});

for (const [width, zoom] of [[390, false], [390, true]]) test(`Settings and Home do not scroll sideways at ${width}px${zoom ? " with 200% text" : ""}`, async ({ page, app }) => {
  app.entries = [entry];
  await page.setViewportSize({ width, height: 844 });
  for (const path of ["/settings", "/home"]) {
    await page.goto(path);
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
});
