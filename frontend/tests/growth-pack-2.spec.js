import { mkdirSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { installGenres } from "./support/genres.js";

// T74 part 2: ref capture, scan events, "Start your shelf", "Start your own shelf" on public pages, the email tick and toggle,
// and the privacy line. Browser fixtures only: every API request is intercepted.
const books = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, title: `Growth fixture ${String(index + 1).padStart(2, "0")}`,
  authors: [{ id: 1, name: "Fixture Author" }], tags: [], cover_image_url: null, english_title: null, description: "A fixture.", published_year: 2001, page_count: 200 }));
const ISBN = "9780141439518";
const profile = (extra = {}) => ({ display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026, email_tips: false, ...extra });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { guest: false, entries: new Map(), libraryImport: true, events: [], registers: [], patches: [], writes: [], profile: profile(), failPatch: false, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (url.pathname.startsWith("/test-cover/")) return route.fulfill({ status: 404, body: "" });
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length);
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/events") { state.events.push(JSON.parse(request.postData())); return route.fulfill({ status: 204, body: "" }); }
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      if (path === "/me/loans" && method === "GET") return reply(200, { items: [] }); // My Books and Home ask for open loans; none here
      if (path === "/auth/refresh") return reply(state.refreshStatus || (state.guest ? 401 : 200), {});
      if (path === "/auth/register") { state.registers.push(body); state.guest = false; return reply(200, {}); }
      if (path === "/auth/login") { state.guest = false; return reply(200, {}); }
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: state.libraryImport } });
      if (path === "/me/home") return reply(200, { current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === "/books") return reply(200, { items: books, total: books.length, page: 1, size: 30 });
      if (/^\/books\/\d+$/.test(path)) return reply(200, books[Number(path.split("/").at(-1)) - 1]);
      if (path === "/me/library") {
        const items = [...state.entries.values()];
        return reply(200, { items, counts: { all: items.length, owned: items.length, want: 0, reading: 0, paused: 0, finished: 0, dnf: 0 }, total: items.length, next_cursor: null, facets: {}, index: null });
      }
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: null, version: null, is_owned: false, is_wanted: false, reading_state: null })) });
      if (path === "/me/profile" && method === "PATCH") {
        state.patches.push(body);
        if (state.failPatch) return reply(500, { detail: "down" });
        state.profile = { ...state.profile, ...body }; return reply(200, state.profile);
      }
      if (path === "/me/profile") return reply(200, state.profile);
      if (path === "/me/stats") return reply(200, { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null });
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/up-next") return reply(404, { detail: "Not found" });
      if (path === "/me/preferences") return reply(200, []);
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path.startsWith("/autocomplete") || path === "/books/more") return reply(200, []);
      if (path === "/u/ada") return reply(200, { display_name: "Ada Reader", initials: "AR", avatar_icon: "feather", avatar_color: "plum", bio: "Quiet reader.", reading_since: 2025,
        stats: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null }, lists: [{ id: 3, name: "Shared list", description: null, book_count: 1, covers: [] }] });
      if (path === "/u/ada/lists/3") return reply(200, { id: 3, name: "Shared list", description: "Good ones.", owner: { display_name: "Ada Reader", initials: "AR" }, books: [books[0]] });
      const isbnAt = path.match(/^\/me\/catalogue\/isbn\/(\d+)$/);
      if (isbnAt) return reply(200, { isbn13: isbnAt[1], status: "catalogue", book_id: 7, edition_id: 1, title: "Emma", authors: ["An Author"], cover_url: null, on_shelf: null });
      if (/^\/me\/library\/books\/\d+$/.test(path) && method === "PUT") { state.writes.push({ path, body }); return reply(200, { id: 900, book_id: 7, book: books[6], is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }); }
      state.errors.push(`Unhandled request ${method} ${path}`); return reply(500, {});
    });
    await installGenres(page, state);
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

// landing_visit is counted once per session on any first page; the tests below look at the other events, and the ref tests at it directly.
const names = app => app.events.map(event => event.name).filter(name => name !== "landing_visit");
const session = (page, key) => page.evaluate(name => sessionStorage.getItem(name), key);

// A camera stand-in: a canvas stream, and a BarcodeDetector that reports whatever the test pushes onto window.__codes.
const withCamera = page => page.addInitScript(() => {
  window.__codes = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d"); let shade = 0;
    setInterval(() => { shade = (shade + 20) % 255; context.fillStyle = `rgb(${shade},${shade},${shade})`; context.fillRect(0, 0, 320, 240); }, 100);
    return canvas.captureStream(10);
  };
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["ean_13"]; }
    async detect() { return window.__codes.splice(0).map(rawValue => ({ rawValue })); }
  };
});

// ---- ref capture -----------------------------------------------------------------------------------------------------

test("a known ref is kept for the session, sent once with landing_visit, and stripped from the address with the other parameters and the hash kept", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/browse?ref=tt&q=dune#results");
  await expect.poll(() => app.events.map(event => event.name)).toContain("landing_visit");
  await expect(page).toHaveURL(url => url.search === "?q=dune" && url.hash === "#results");
  expect(await session(page, "bv-ref")).toBe("tt");
  expect(app.events.filter(event => event.name === "landing_visit")).toEqual([{ name: "landing_visit", ref: "tt" }]);
  await page.reload();
  await page.goto("/");
  await page.waitForTimeout(300);
  expect(app.events.filter(event => event.name === "landing_visit")).toHaveLength(1);
  expect(await session(page, "bv-ref")).toBe("tt");
});

test("a visit with no ref still counts once, with no ref; an unknown ref is ignored and removed from the address", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/browse?ref=nonsense");
  await expect.poll(() => app.events.map(event => event.name)).toContain("landing_visit");
  await expect(page).toHaveURL(url => url.search === "");
  expect(await session(page, "bv-ref")).toBeNull();
  expect(app.events.filter(event => event.name === "landing_visit")).toEqual([{ name: "landing_visit" }]);
});

for (const [label, setup] of [["a signed-in reader", app => { app.guest = false; }], ["a reader whose account check can't be made", app => { app.refreshStatus = 503; }]]) {
  test(`${label} is never counted as a visit, though a known ref is still kept and cleaned from the address`, async ({ page, app }) => {
    setup(app);
    const settled = page.waitForResponse(response => response.url().endsWith("/auth/refresh"));
    await page.goto("/browse?ref=tt&q=dune");
    await settled;
    await expect(page).toHaveURL(url => url.search === "?q=dune");
    expect(await session(page, "bv-ref")).toBe("tt");
    await page.waitForTimeout(500);
    expect(app.events.map(event => event.name)).not.toContain("landing_visit");
  });
}

test("registering sends the stored ref and then forgets it; without a ref the body has no ref", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/register?ref=ig");
  await expect.poll(() => session(page, "bv-ref")).toBe("ig");
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => app.registers.length).toBe(1);
  expect(app.registers[0]).toEqual({ email: "reader@example.com", password: "valid-password", ref: "ig" });
  await expect.poll(() => session(page, "bv-ref")).toBeNull();
  app.guest = true;
  await page.goto("/register");
  await page.getByLabel("Email address", { exact: true }).fill("again@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => app.registers.length).toBe(2);
  expect(app.registers[1]).toEqual({ email: "again@example.com", password: "valid-password" });
});

// ---- the email tick and toggle ---------------------------------------------------------------------------------------

test("the sign-up tick for reading tips is unticked by default and sends email_tips only when ticked", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/register");
  const tick = page.getByRole("checkbox", { name: "Send me a few reading tips by email", exact: true });
  await expect(tick).not.toBeChecked();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await tick.check();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => app.registers.length).toBe(1);
  expect(app.registers[0]).toEqual({ email: "reader@example.com", password: "valid-password", email_tips: true });
  await page.goto("/login");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("Settings: Reading tips by email is a switch after Favourite genres; it saves through the profile at once and reverts with the error line when saving fails", async ({ page, app }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Reading tips by email" });
  await expect(page.getByText("A few short emails in your first weeks. Turn off any time.", { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const rows = await page.locator(".bv-account-row h2").allTextContents();
  expect(rows.indexOf("Reading tips by email")).toBe(rows.indexOf("Favourite genres") + 1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => app.patches).toEqual([{ email_tips: true }]);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Reading tips by email" })).toHaveAttribute("aria-checked", "true");
  app.failPatch = true;
  await page.getByRole("switch", { name: "Reading tips by email" }).click();
  await expect(page.getByRole("alert")).toContainText("couldn’t");
  await expect(page.getByRole("switch", { name: "Reading tips by email" })).toHaveAttribute("aria-checked", "true");
  expect(app.patches).toEqual([{ email_tips: true }, { email_tips: false }]);
});

// ---- scan events -----------------------------------------------------------------------------------------------------

test.describe("scan events", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("scan_opened once when the camera sheet opens, and scan_added carries the number of books added", async ({ page, app }) => {
    await withCamera(page);
    await page.goto("/my-books");
    await page.getByRole("button", { name: "Scan books", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Scan books" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => names(app)).toEqual(["scan_opened"]);
    // The reader needs two matching reads before it takes a code (T80), as a real scan would give.
    await page.evaluate(code => { window.__codes.push(code); window.__codes.push(code); }, ISBN);
    await expect(dialog.locator(".bv-scan-row")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Add 1 book" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Add 1 book" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => names(app)).toEqual(["scan_opened", "scan_engine_native", "scan_added"]);
    expect(app.events.find(event => event.name === "scan_added")).toEqual({ name: "scan_added", n: 1 });
  });

  test("a wider screen's typed ISBN opens no camera and sends no scan_opened", async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/my-books");
    await page.getByLabel("Type an ISBN").fill(ISBN);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Scan books" })).toBeVisible();
    await page.waitForTimeout(300);
    expect(names(app)).toEqual([]);
  });
});

// ---- Start your shelf ------------------------------------------------------------------------------------------------

test.describe("Start your shelf", () => {
  const card = page => page.locator(".bv-start-shelf");
  test("on a phone the card has three rows in order, Scan opens the camera, Hide persists, and Tell us what you like stays under it", async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withCamera(page);
    await page.goto("/home");
    await expect(card(page).getByRole("heading", { name: "Start your shelf", exact: true })).toBeVisible();
    const rows = card(page).locator(".bv-start-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Scan books");
    await expect(rows.nth(0)).toContainText("Point your camera at the barcodes");
    await expect(rows.nth(1)).toContainText("Import from Goodreads or StoryGraph");
    await expect(rows.nth(1)).toContainText("Bring your shelves, reading dates and notes");
    await expect(rows.nth(1)).toHaveAttribute("href", "/my-books/import");
    await expect(rows.nth(2)).toContainText("Search");
    await expect(rows.nth(2)).toContainText("Find a book by title or author");
    await expect(page.locator(".bv-first-run-paths")).toHaveCount(0);
    const below = await page.getByRole("link", { name: "Tell us what you like (optional)" }).boundingBox();
    expect(below.y).toBeGreaterThan((await card(page).boundingBox()).y + (await card(page).boundingBox()).height - 1);
    expect(below.y).toBeLessThan((await page.getByRole("heading", { name: "Pick a few books", exact: true }).boundingBox()).y);
    await rows.nth(0).click();
    await expect(page.getByRole("dialog", { name: "Scan books" })).toBeVisible();
    await expect.poll(() => names(app)).toEqual(["scan_opened"]);
    await page.keyboard.press("Escape");
    await rows.nth(2).click();
    await expect(page).toHaveURL(/\/browse$/);
    await expect(page.locator("#bv-search-query")).toBeFocused();
    await page.goto("/home");
    await card(page).getByRole("button", { name: "Hide", exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tell us what you like (optional)" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("bv-start-hidden"))).not.toBeNull();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pick a few books", exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test("on a desktop screen there is no Scan row, and Search focuses the header search", async ({ page, app: _app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await withCamera(page);
    await page.goto("/home");
    const rows = card(page).locator(".bv-start-row");
    await expect(rows).toHaveCount(2);
    await expect(card(page).getByText("Scan books")).toHaveCount(0);
    await rows.nth(1).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator(".bv-header-search input")).toBeFocused();
  });

  test("the import row is absent when library import is off, and the card is gone once the shelf has a book", async ({ page, app }) => {
    app.libraryImport = false;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/home");
    await expect(card(page).locator(".bv-start-row")).toHaveCount(1);
    await expect(card(page).getByText("Import from Goodreads or StoryGraph")).toHaveCount(0);
    app.entries.set(2, { id: 2, book_id: 2, book: books[1], is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    await page.reload();
    await expect(page.getByRole("heading", { name: /^(Home|Good (morning|afternoon|evening), .+)$/ })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
});

// ---- Start your own shelf --------------------------------------------------------------------------------------------

test("signed-out viewers get one quiet Start your own shelf line, last on a public profile and a public list; signed-in readers get none", async ({ page, app }) => {
  app.guest = true;
  for (const path of ["/u/ada", "/u/ada/lists/3"]) {
    await page.goto(path);
    const line = page.getByRole("link", { name: "Start your own shelf", exact: true });
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("href", "/register?ref=share");
    await expect(page.getByText("Keep your own reading year on Bookvane.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create free account" })).toHaveCount(0);
    const last = await page.locator(".bv-profile > *").evaluateAll(nodes => nodes.at(-1).className);
    expect(last).toContain("bv-profile-join");
  }
  app.guest = false;
  for (const path of ["/u/ada", "/u/ada/lists/3"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start your own shelf" })).toHaveCount(0);
  }
});

test("following Start your own shelf registers with ref=share, which the sign-up then sends", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/u/ada");
  await page.getByRole("link", { name: "Start your own shelf", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect.poll(() => session(page, "bv-ref")).toBe("share");
  await page.getByLabel("Email address", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("valid-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => app.registers.length).toBe(1);
  expect(app.registers[0].ref).toBe("share");
});

// ---- privacy ---------------------------------------------------------------------------------------------------------

test("the privacy page says visits and sign-ups are counted by where they came from, in daily totals", async ({ page, app }) => {
  app.guest = true;
  await page.goto("/privacy");
  await expect(page.getByText("We count visits and sign-ups by where they came from (for example TikTok), in daily totals only. Nothing is linked to you.", { exact: true })).toBeVisible();
});

test("the sign-up tips tick row is at least 44px tall and the submit button still sits within 520px at 375px", async ({ page, app }) => {
  app.guest = true;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/register");
  const row = page.locator(".bv-register-form .bv-tick");
  await expect(row).toBeVisible();
  expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: "Create account", exact: true }).boundingBox()).y).toBeLessThan(520);
});

// ---- layout ----------------------------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"]) for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
  test(`Start your shelf, Settings and the sign-up tick do not scroll sideways at ${width}px${zoom ? " and 200% text" : ""}; ${scheme}`, async ({ page, app }) => {
    const shots = process.env.GROWTH_SHOTS ? "../.bv-shots/growth-pack-2" : null;
    if (shots) mkdirSync(shots, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), scheme);
    await page.setViewportSize({ width, height: 844 });
    await withCamera(page);
    const check = async (path, name) => {
      await page.goto(path);
      if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} scrolls sideways`).toBe(true);
      if (shots) await page.screenshot({ path: `${shots}/${name}-${width}${zoom ? "-200" : ""}-${scheme}.png`, fullPage: true });
    };
    await check("/home", "start-shelf");
    await expect(page.locator(".bv-start-shelf .bv-start-row")).toHaveCount(3);
    for (const row of await page.locator(".bv-start-shelf .bv-start-row").all()) expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await check("/settings", "settings");
    expect((await page.getByRole("switch", { name: "Reading tips by email" }).boundingBox()).height).toBeGreaterThanOrEqual(44);
    app.guest = true;
    await check("/register", "register");
    await expect(page.getByRole("checkbox", { name: "Send me a few reading tips by email" })).toBeVisible();
    await check("/u/ada", "public-profile");
  });
}
