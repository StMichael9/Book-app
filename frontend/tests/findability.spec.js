import { mkdirSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";
import { NAV_CLUBS, ON_LOAN_EMPTY, SCAN_LABEL, SWITCH_DISCOVER, SWITCH_MY_BOOKS, SWITCH_YOU } from "../src/components/ui-v2/findabilityCopy.js";

// The findability build: Clubs in the main menu, the Scan button, On loan as a permanent shelf, and the "Leaving Goodreads?" links.
// Browser fixtures only: every API request is intercepted.
const BOOK = { id: 1, title: "Middlemarch", authors: [{ id: 1, name: "George Eliot" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 1871, page_count: 880 };
const entry = { id: 50, book_id: 1, book: BOOK, is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const CLUB = { id: 5, name: "Tuesday Readers", description: null, color: "#3f6b52", role: "owner", member_count: 8, current_book: { book_id: 1, title: "Middlemarch" } };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, entries: [], loans: [], libraryImport: true, requests: [], errors: [] };
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
      if (path === "/clubs/5/reports") return reply(200, { items: [] });
      if (path.startsWith("/club-invites/")) return reply(404, { detail: "Not found" });
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

const labels = locator => locator.getByRole("link").evaluateAll(nodes => nodes.map(node => ([...node.querySelectorAll("span")].at(-1)?.textContent || node.textContent).trim()));
const scanInHeader = page => page.getByRole("banner").getByRole("button", { name: SCAN_LABEL, exact: true });

// ---- Clubs in the main menu ------------------------------------------------------------------------------------------

test.describe("Clubs in the menu", () => {
  test("the phone menu has five items in order, and Clubs is active on /clubs and on a club, not My Books", async ({ page, app: _app }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole("navigation", { name: "Mobile navigation" });
    await page.goto("/clubs");
    await expect(menu.getByRole("link")).toHaveCount(5);
    expect(await labels(menu)).toEqual(["Home", "Discover", "My Books", NAV_CLUBS, "You"]);
    await expect(menu.getByRole("link", { name: NAV_CLUBS })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "My Books" })).not.toHaveAttribute("aria-current", "page");
    await page.goto("/clubs/5");
    await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
    await expect(menu.getByRole("link", { name: NAV_CLUBS })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "My Books" })).not.toHaveAttribute("aria-current", "page");
    await page.goto("/my-books");
    await expect(menu.getByRole("link", { name: "My Books" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: NAV_CLUBS })).not.toHaveAttribute("aria-current", "page");
  });

  test("the desktop header has Clubs after My Books", async ({ page, app: _app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/clubs");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    expect(await labels(nav)).toEqual(["Home", "Discover", "My Books", NAV_CLUBS]);
    await expect(nav.getByRole("link", { name: NAV_CLUBS })).toHaveAttribute("aria-current", "page");
  });

  test("the old /my-books/clubs address goes to /clubs, and My Books has no Books | Clubs tabs", async ({ page, app: _app }) => {
    await page.goto("/my-books/clubs");
    await expect(page).toHaveURL(/\/clubs$/);
    await expect(page.getByRole("heading", { name: "Your clubs", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Your clubs · Bookvane");
    await page.goto("/my-books");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "My Books sections" })).toHaveCount(0);
  });

  test("signed out there is no Clubs in either menu", async ({ page, app }) => {
    app.guest = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/browse");
    await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Discover" })).toBeVisible();
    await expect(page.getByRole("link", { name: NAV_CLUBS })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("link", { name: NAV_CLUBS })).toHaveCount(0);
  });
});

// ---- Scan -------------------------------------------------------------------------------------------------------------

test.describe("Scan button on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the header button is an icon with the name Scan books and opens the one sheet from Home, Discover and a book page, returning focus", async ({ page, app: _app }) => {
    await page.goto("/home");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    for (const path of ["/home", "/browse", "/book/1"]) {
      await page.goto(path);
      const button = scanInHeader(page);
      await expect(button).toBeVisible();
      expect(await button.evaluate(node => node.textContent.trim())).toBe(""); // an icon, not the word
      await expect(button.locator("svg")).toHaveCount(1);
      if (process.env.FIND_SHOTS && path === "/home") {
        mkdirSync(process.env.FIND_SHOTS, { recursive: true });
        for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.screenshot({ path: `${process.env.FIND_SHOTS}/scan-button-390-${scheme}.png` }); }
        await page.emulateMedia({ colorScheme: null });
      }
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(page.getByRole("dialog", { name: SCAN_LABEL })).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: SCAN_LABEL })).toHaveCount(0);
      await expect(button).toBeFocused();
    }
  });

  test("My Books, Home's first-run card and the header all open the same single sheet", async ({ page, app: _app }) => {
    await page.goto("/home");
    await page.locator(".bv-start-shelf").getByRole("button", { name: /Scan books/ }).click();
    await expect(page.getByRole("dialog", { name: SCAN_LABEL })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.goto("/my-books");
    await page.getByRole("main").getByRole("button", { name: SCAN_LABEL, exact: true }).click();
    await expect(page.getByRole("dialog", { name: SCAN_LABEL })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await scanInHeader(page).click();
    await expect(page.getByRole("dialog", { name: SCAN_LABEL })).toHaveCount(1);
    expect(await page.locator("dialog.bv-scan-sheet").count()).toBe(1);
  });

  test("there is no header Scan button on the invite page or the sign-in screens", async ({ page, app }) => {
    await page.goto("/c/" + "x".repeat(24));
    await expect(page.getByRole("heading", { name: "This invite link isn’t working." })).toBeVisible();
    await expect(page.getByRole("button", { name: SCAN_LABEL })).toHaveCount(0);
    app.guest = true;
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: SCAN_LABEL })).toHaveCount(0);
  });
});

test("on a desktop with a mouse there is no header Scan button", async ({ page, app: _app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  await expect(page.getByRole("banner").getByRole("link", { name: "Your profile" })).toBeVisible();
  await expect(scanInHeader(page)).toHaveCount(0);
});

// ---- On loan ----------------------------------------------------------------------------------------------------------

test("On loan is always a shelf: with no loans it shows its empty line", async ({ page, app }) => {
  app.entries = [entry];
  await page.goto("/my-books");
  const shelf = page.getByRole("button", { name: /^On loan/ });
  await expect(shelf).toBeVisible();
  await shelf.click();
  await expect(page.getByRole("region", { name: "On loan" }).getByText(ON_LOAN_EMPTY, { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "On loan" }).locator("li")).toHaveCount(0);
});

test("with a loan the On loan shelf lists it as before", async ({ page, app }) => {
  app.entries = [entry];
  app.loans = [{ id: "l1", direction: "lent", person_name: "Ana", entry_id: 50, book_id: 1, title: "Middlemarch", authors: ["George Eliot"], cover_image_url: null, started_on: "2026-11-01", due_on: "2027-01-03", overdue: false, ended_on: null }];
  await page.goto("/my-books");
  await page.getByRole("button", { name: /^On loan/ }).click();
  await expect(page.getByRole("region", { name: "On loan" }).locator("li")).toHaveCount(1);
  await expect(page.getByText(ON_LOAN_EMPTY, { exact: true })).toHaveCount(0);
});

// ---- Leaving Goodreads? links ----------------------------------------------------------------------------------------

test.describe("the /switch links", () => {
  test("My Books, You and Home's import row link to /switch", async ({ page, app }) => {
    app.entries = [entry];
    await page.goto("/my-books");
    await expect(page.getByRole("link", { name: SWITCH_MY_BOOKS, exact: true })).toHaveAttribute("href", "/switch");
    // Settings shows one Goodreads link: the import itself when import is on, otherwise the /switch guide.
    await page.goto("/settings");
    const data = page.getByRole("region", { name: "Your data" });
    await expect(data.getByRole("link", { name: /Goodreads/ })).toHaveCount(1);
    await expect(data.getByRole("link", { name: "Import from Goodreads or StoryGraph", exact: true })).toHaveAttribute("href", "/my-books/import");
    app.libraryImport = false;
    app.readingExport = true;   // the section still shows for the data links, so the /switch guide takes the import link's place
    await page.goto("/settings");
    await expect(data.getByRole("link", { name: /Goodreads/ })).toHaveCount(1);
    await expect(data.getByRole("link", { name: SWITCH_YOU, exact: true })).toHaveAttribute("href", "/switch");
    app.libraryImport = true;
    app.readingExport = false;
    app.entries = [];
    await page.goto("/home");
    await expect(page.locator(".bv-start-shelf").getByRole("link", { name: /^Import from Goodreads or StoryGraph/ })).toHaveAttribute("href", "/switch");
  });

  test("the footer links to Contact by email", async ({ page, app }) => {
    app.guest = true;
    await page.goto("/browse");
    await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Contact", exact: true })).toHaveAttribute("href", "mailto:support@bookvane.me");
  });

  test("signed out, Discover says the shelf note once and every card's shelf buttons point at it", async ({ page, app }) => {
    app.guest = true;
    await page.goto("/browse");
    await expect(page.locator("article.bv-book-card").first()).toBeVisible();
    const note = "Want it, or already own it? Choose a shelf for this book.";
    await expect(page.getByText(note, { exact: true })).toHaveCount(1);
    await expect(page.locator('article.bv-book-card [data-shelf="want"]').first()).toHaveAccessibleDescription(note);
    await expect(page.locator('article.bv-book-card [data-shelf="owned"]').first()).toHaveAccessibleDescription(note);
  });

  test("Discover shows its link to /switch to signed-out visitors only", async ({ page, app }) => {
    app.guest = true;
    await page.goto("/browse");
    await expect(page.getByRole("link", { name: SWITCH_DISCOVER, exact: true })).toHaveAttribute("href", "/switch");
    app.guest = false;
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Find your next chapter." })).toBeVisible();
    await expect(page.getByRole("link", { name: SWITCH_DISCOVER })).toHaveCount(0);
  });
});

// ---- layout -----------------------------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"]) for (const [width, height] of [[320, 700], [390, 844], [1440, 1000]]) {
  test(`the new menu, Scan button and links fit at ${width}px with no sideways scroll; ${scheme}`, async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), scheme);
    await page.setViewportSize({ width, height });
    app.entries = [entry];
    const shots = process.env.FIND_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const visit = async (path, name, ready) => {
      await page.goto(path);
      await ready();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} scrolls sideways`).toBe(true);
      if (shots && width !== 320) await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
    };
    await visit("/my-books", "my-books", async () => { await expect(page.getByRole("button", { name: /^On loan/ })).toBeVisible(); await page.getByRole("button", { name: /^On loan/ }).click(); await expect(page.getByText(ON_LOAN_EMPTY)).toBeVisible(); });
    await visit("/clubs", "clubs", () => expect(page.locator(".bv-club-card")).toBeVisible());
    await visit("/book/1", "book", () => expect(page.getByRole("heading", { name: "Middlemarch", level: 1 })).toBeVisible());
    app.entries = [];
    await visit("/home", "home", () => expect(page.locator(".bv-start-shelf")).toBeVisible());
    if (width < 700) {
      const menu = page.getByRole("navigation", { name: "Mobile navigation" });
      await expect(menu.getByRole("link")).toHaveCount(5);
      for (const link of await menu.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await link.locator("span").last().evaluate(node => { const box = node.getBoundingClientRect(); return box.width > 2 && box.height < 1.6 * parseFloat(getComputedStyle(node).fontSize); }), `${await link.textContent()} is hidden or wraps`).toBe(true); // one line
      }
    }
    app.guest = true;
    await visit("/browse", "discover-signed-out", () => expect(page.getByRole("link", { name: SWITCH_DISCOVER })).toBeVisible());
  });
}
