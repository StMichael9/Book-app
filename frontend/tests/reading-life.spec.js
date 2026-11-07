import { test as base, expect } from "@playwright/test";

// Browser fixtures only. Your reading life: /me/stats?year= (T42 fields years_with_reading, rereads and imported_years are mocked).
const stamp = "2026-01-01T00:00:00Z";
const figures = (extra = {}) => ({ books: 14, pages: 4200, pages_unknown: 0, avg_length: 300, median_days: 14, stopped: 0, months: [], top_subjects: [{ name: "Fantasy", count: 5 }],
  length_mix: { short: 3, medium: 8, long: 3, unknown: 0 }, authors_new: 9, authors_returning: 5, ...extra });
const CURRENT = { year: 2026, books_finished: 23, pages_read: 7840, biggest_month: 5, by_month: [2, 1, 3, 2, 4, 1, 3, 2, 1, 3, 1, 0], top_genres: [],
  books: 23, pages: 7840, pages_unknown: 2, avg_length: 341, median_days: 11, stopped: 2, rereads: 3,
  top_subjects: [{ name: "Fantasy", count: 8 }, { name: "Literary fiction", count: 5 }, { name: "History", count: 3 }, { name: "Science fiction", count: 3 }, { name: "Memoir", count: 2 }, { name: "Poetry", count: 1 }],
  length_mix: { short: 7, medium: 11, long: 5, unknown: 0 }, authors_new: 14, authors_returning: 9,
  previous: figures({ books: 18, pages: 6640, median_days: 14 }),
  all_time: { books: 212, pages: 68400 }, shelf: { owned_unfinished: 38, want: 148, oldest_waiting: { entry_id: 301, book_id: 1, title: "Middlemarch", cover_url: null, saved_at: "2021-03-04T10:00:00Z" } } };
const PAST = { ...CURRENT, year: 2025, books_finished: 18, books: 18, pages_read: 6640, pages: 6640, rereads: 0, stopped: 0, pages_unknown: 0, by_month: [1, 2, 1, 1, 2, 2, 1, 2, 1, 2, 2, 1], median_days: 14,
  top_subjects: [{ name: "History", count: 6 }], previous: figures({ books: 0, pages: 0, median_days: null }) };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], current: structuredClone(CURRENT), past: structuredClone(PAST), years: null, imported: null, statsStatus: 200 };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      const body = ["POST", "PUT", "PATCH"].includes(method) ? route.request().postDataJSON() : null;
      state.requests.push({ path, method, body, year: url.searchParams.get("year") });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/me/profile") return reply(200, { display_name: "Rae Fixture", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: true } });
      if (path === "/me/stats") {
        if (state.statsStatus !== 200) return reply(state.statsStatus, { detail: "No" });
        const year = url.searchParams.get("year");
        const found = year && Number(year) !== state.current.year ? { ...state.past, year: Number(year) } : state.current;
        return reply(200, { ...found, ...(state.years ? { years_with_reading: state.years } : {}), ...(state.imported ? { imported_years: state.imported } : {}) });
      }
      const workspace = path.match(/^\/me\/library\/(\d+)\/reading$/);
      if (workspace) return reply(200, { entry: { id: 301, book_id: 1, book: { id: 1, title: "Middlemarch", authors: [], cover_image_url: null }, is_owned: false, is_wanted: true, version: 1, created_at: stamp, updated_at: stamp }, current_attempt: null, editions: [] });
      const attempt = path.match(/^\/me\/reading-attempts\/(.+)$/);
      if (attempt && method === "PUT") return reply(200, { entry: { id: 301, version: 2, reading_state: "reading", book: { id: 1, title: "Middlemarch", authors: [] } }, attempt: { id: attempt[1], state: "reading", started_on: body.started_on } });
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test("the page shows every figure, the shelf with a text version, the cards and the shelf totals", async ({ page, app: _app }) => {
  await page.goto("/reading-life");
  await expect(page.getByRole("heading", { name: "Your reading life", level: 1 })).toBeVisible();
  await expect(page.getByText("Private to you", { exact: true })).toBeVisible();
  const figs = page.locator(".bv-life-figures");
  await expect(figs).toContainText("23");
  await expect(figs).toContainText("books finished");
  await expect(figs).toContainText("rereads, counted every time");
  await expect(figs).toContainText("pages · 2 without page counts");
  await expect(figs).toContainText("341");
  await expect(figs).toContainText("11 days");
  await expect(figs).toContainText("stopped, and that’s fine");
  // The spine shelf is decoration; the text version lists every month for screen readers.
  const shelf = page.getByRole("region", { name: "Your 2026 on the shelf" });
  await expect(shelf.locator(".bv-shelf")).toHaveAttribute("aria-hidden", "true");
  await expect(shelf.locator(".bv-sr-only li").nth(0)).toHaveText("January: 2");
  await expect(shelf.locator(".bv-sr-only li")).toHaveCount(12);
  // Top five subjects only, as bars with counts.
  const subjects = page.getByRole("region", { name: "What you read" });
  await expect(subjects.getByRole("listitem")).toHaveCount(5);
  await expect(subjects.getByRole("listitem").first()).toContainText("Fantasy");
  const length = page.getByRole("region", { name: "Length and authors" });
  await expect(length).toContainText("Short 7");
  await expect(length).toContainText("Medium 11");
  await expect(length).toContainText("Long 5");
  await expect(length).toContainText("14 new authors");
  await expect(length).toContainText("9 you came back to");
  const compare = page.getByRole("region", { name: "Compared with 2025" });
  await expect(compare).toContainText("5 more books than 2025");
  await expect(compare).toContainText("1,200 more pages");
  await expect(compare).toContainText("Books took about 3 days less");
  await expect(compare).toContainText("More fantasy");
  const shelfCard = page.getByRole("region", { name: "Your shelf" });
  await expect(shelfCard).toContainText("38 books you own and haven’t read · 148 on Want to read");
  await expect(shelfCard).toContainText("Waiting longest · saved March 2021");
  await expect(page.getByRole("region", { name: "All time" })).toContainText("212 books");
  await expect(page.getByRole("region", { name: "All time" })).toContainText("68,400 pages");
  await expect(page.getByRole("region", { name: "All time" })).toContainText("Includes your imported history.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("without T42 the switcher offers this year and All time only", async ({ page, app }) => {
  await page.goto("/reading-life");
  const years = page.getByRole("group", { name: "Year" });
  await expect(years.getByRole("button")).toHaveText(["2026", "All time"]);
  await expect(years.getByRole("button", { name: "2026" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/include your import|includes your import/)).toHaveCount(0);
  expect(app.requests.filter(item => item.path === "/me/stats")).toHaveLength(1);
});

test("the year switcher lists years_with_reading, fetches that year and names imported years", async ({ page, app }) => {
  app.years = [2023, 2024, 2025, 2026]; app.imported = [2023, 2024];
  await page.goto("/reading-life");
  const years = page.getByRole("group", { name: "Year" });
  await expect(years.getByRole("button")).toHaveText(["2023", "2024", "2025", "2026", "All time"]);
  await expect(page.getByText("2023 and 2024 include your import", { exact: true })).toBeVisible();
  await years.getByRole("button", { name: "2025" }).click();
  await expect(page).toHaveURL(/year=2025/);
  await expect(page.getByRole("region", { name: "Your 2025 on the shelf" })).toBeVisible();
  await expect(page.locator(".bv-life-figures")).toContainText("18");
  expect(app.requests.filter(item => item.path === "/me/stats").at(-1).year).toBe("2025");
  // 2025 has no data before it, so there is no comparison card.
  await expect(page.getByRole("region", { name: "Compared with 2024" })).toHaveCount(0);
  await years.getByRole("button", { name: "2026" }).click();
  await expect(page).not.toHaveURL(/year=/);
  await expect(page.getByRole("region", { name: "Compared with 2025" })).toBeVisible();
});

test("figures that are zero or unknown are not shown", async ({ page, app }) => {
  Object.assign(app.current, { rereads: 0, stopped: 0, pages_unknown: 0, avg_length: null, median_days: null, previous: figures({ books: 0, pages: 0 }) });
  await page.goto("/reading-life");
  const figs = page.locator(".bv-life-figures");
  await expect(figs).toContainText("books finished");
  await expect(figs).not.toContainText("rereads");
  await expect(figs).not.toContainText("stopped");
  await expect(figs).not.toContainText("without page counts");
  await expect(figs).not.toContainText("average length");
  await expect(figs).not.toContainText("typical start to finish");
  await expect(page.getByRole("region", { name: /Compared with/ })).toHaveCount(0);
});

test("All time shows only the totals and subjects", async ({ page, app }) => {
  app.current.all_time = { ...CURRENT.all_time, top_subjects: [{ name: "Fantasy", count: 40 }, { name: "History", count: 22 }] };
  await page.goto("/reading-life");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(page).toHaveURL(/year=all/);
  await expect(page.getByRole("region", { name: "All time" })).toContainText("212 books");
  await expect(page.getByRole("region", { name: "What you read" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator(".bv-life-figures")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /on the shelf$/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your shelf" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Length and authors" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All time", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "All time", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a year with nothing finished gives one calm line, never zeros", async ({ page, app }) => {
  Object.assign(app.current, { books_finished: 0, books: 0, pages_read: 0, pages: 0, by_month: new Array(12).fill(0), biggest_month: null, rereads: 0, stopped: 0, pages_unknown: 0, top_subjects: [], previous: figures({ books: 0, pages: 0 }) });
  await page.goto("/reading-life");
  await expect(page.getByText("Nothing finished in 2026 yet.")).toBeVisible();
  await expect(page.locator(".bv-life-figures")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What you read" })).toHaveCount(0);
});

test("a failed load says so and retries", async ({ page, app }) => {
  app.statsStatus = 503;
  await page.goto("/reading-life");
  await expect(page.getByText("Your reading life couldn’t load.")).toBeVisible();
  app.statsStatus = 200;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Your reading life", level: 1 })).toBeVisible();
});

test("Start reading on the book waiting longest starts it and opens it", async ({ page, app }) => {
  await page.goto("/reading-life");
  await page.getByRole("button", { name: "Start reading Middlemarch" }).click();
  await expect(page).toHaveURL(/\/my-books\/301$/);
  expect(app.requests.filter(item => item.method === "PUT")).toHaveLength(1);
});

test("the profile Overview links to the page", async ({ page, app: _app }) => {
  await page.goto("/profile");
  await page.getByRole("link", { name: "Your reading life" }).click();
  await expect(page).toHaveURL(/\/reading-life$/);
});

// Screenshots for design review: LIFE_SHOTS=1 writes them to ../.bv-shots/reading-life; skipped otherwise.
for (const theme of ["light", "dark"]) for (const [width, height, zoom] of [[390, 844, false], [1440, 900, false], [390, 844, true]]) {
  test(`reading life screenshots ${theme} ${width}${zoom ? " 200%" : ""}`, async ({ page, app }) => {
    test.skip(!process.env.LIFE_SHOTS, "design review only");
    app.years = [2023, 2024, 2025, 2026]; app.imported = [2023, 2024];
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.goto("/reading-life");
    await expect(page.getByRole("heading", { name: "Your reading life", level: 1 })).toBeVisible();
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const dir = "../.bv-shots/reading-life", tag = `${width}${zoom ? "-200" : ""}-${theme}`;
    const shoot = async name => { await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.screenshot({ path: `${dir}/${name}-${tag}.png`, fullPage: true }); };
    await shoot("life");
    if (!zoom) {
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await expect(page.getByRole("region", { name: "All time" })).toBeVisible();
      await shoot("life-all-time");
      Object.assign(app.current, { books_finished: 0, books: 0, pages_read: 0, pages: 0, by_month: new Array(12).fill(0), biggest_month: null, rereads: 0, stopped: 0, pages_unknown: 0, top_subjects: [] });
      await page.goto("/reading-life");
      await expect(page.getByText("Nothing finished in 2026 yet.")).toBeVisible();
      await shoot("life-empty");
    }
  });
}
