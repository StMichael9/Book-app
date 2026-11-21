import { test as base, expect } from "@playwright/test";
import { GENRES } from "./support/genres.js";

// The reading page and Home's Reading now cards, Direction D: one "Page or %" box, an inline finished prompt, a journal and one fold.
// Browser-only fixtures; every API call is mocked from the contract.
const book = { id: 1, title: "Piranesi", authors: [{ id: 1, name: "Susanna Clarke" }], tags: [], cover_image_url: null, page_count: 272, english_title: null };
const freshAttempt = () => ({ id: "a1", state: "reading", started_on: "2026-11-13", ended_on: null, progress_unit: null, progress_value: null, total_pages: 360, note: null, reaction: null, updated_at: "2026-11-13T10:00:00Z" });
const freshEntry = () => ({ id: 101, book_id: 1, book, is_owned: true, is_wanted: false, version: 1, reading_state: "reading", private_title: null, private_author: null, save_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-13T10:00:00Z" });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entry: freshEntry(), attempt: freshAttempt(), history: [], patches: [], requests: [], progressDays: undefined, readOnly: false, holdPatch: null, errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/auth/refresh") return reply(200, {});
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/genres") return reply(200, GENRES);
      if (path === "/autocomplete/tags/batch") return reply(200, []);
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/me/reading-capabilities") return reply(200, { enabled: true, writable: !state.readOnly, contract_version: 1, features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === "/me/home") return reply(200, { current_reads: state.attempt.state === "reading" ? [{ entry: state.entry, attempt: state.attempt }] : [], reading_count: state.attempt.state === "reading" ? 1 : 0, paused_count: 0 });
      if (path === "/me/library") return reply(200, { items: [state.entry], counts: { all: 1, owned: 1, want: 0, reading: 1, paused: 0, finished: 0, dnf: 0 }, total: 1, next_cursor: null, facets: {}, index: null });
      if (path === "/me/library/lookup") return reply(200, { items: body.book_ids.map(id => ({ book_id: id, entry_id: 101, version: state.entry.version, is_owned: state.entry.is_owned, is_wanted: state.entry.is_wanted, reading_state: state.entry.reading_state })) });
      if (path === "/me/stats" || path === "/me/up-next") return reply(path === "/me/stats" ? 200 : 200, path === "/me/stats" ? { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } : []);
      if (path === "/me/lists") return reply(200, []);
      if (path === "/me/library/101/reading") return reply(200, { entry: state.entry, current_attempt: state.attempt, editions: [], ...(state.progressDays !== undefined ? { progress_days: state.progressDays } : {}) });
      if (path === "/me/library/101/attempts") return reply(200, { items: state.history, next_cursor: null });
      if (path === "/me/reading-attempts/a1" && method === "PATCH") {
        state.patches.push(body);
        if (state.holdPatch) await state.holdPatch;
        const { expected_version: _version, ...changes } = body;
        state.attempt = { ...state.attempt, ...changes, updated_at: "2026-11-13T12:00:00Z" };
        state.entry = { ...state.entry, version: state.entry.version + 1, reading_state: state.attempt.state };
        return reply(200, { entry: state.entry, attempt: state.attempt });
      }
      if (path === "/me/library/101" && method === "PATCH") {
        const { expected_version: _version, ...changes } = body;
        state.entry = { ...state.entry, ...changes, version: state.entry.version + 1 };
        return reply(200, state.entry);
      }
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      if (path === "/books/1") return reply(200, { ...book, description: "A house of endless halls.", published_year: 2020, isbn13: null });
      state.errors.push(`Unhandled ${method} ${path}`);
      return reply(404, { detail: "Not found" });
    });
    await provide(state);
  },
});

// The affiliate build (port 5490) has both the Bookshop id and the Amazon tag, so the reading page's About shows both links.
test.use({ baseURL: "http://127.0.0.1:5490" });

test("the reading page's About shows the same Get a copy links, without a heading, with the disclosure and the click events", async ({ page, app }) => {
  await page.goto("/my-books/101");
  await page.getByText("About this book", { exact: true }).click();
  const about = page.locator(".bv-workspace-about");
  await expect(about.getByRole("link", { name: /^Bookshop\.org/ })).toHaveAttribute("href", "https://bookshop.org/search?keywords=Piranesi%20Susanna%20Clarke&affiliate=130585");
  const amazon = about.getByRole("link", { name: /^Amazon/ });
  await expect(amazon).toHaveAttribute("href", "https://www.amazon.com/s?k=Piranesi%20Susanna%20Clarke&tag=bookvane-20");
  for (const link of [about.getByRole("link", { name: /^Bookshop\.org/ }), amazon]) {
    await expect(link).toHaveAttribute("target", "_blank");
    expect((await link.getAttribute("rel")).split(" ").sort()).toEqual(["noopener", "sponsored"]);
    await expect(link.locator("svg")).toHaveCount(1);
  }
  await expect(about.getByRole("heading", { name: "Get a copy" })).toHaveCount(0);
  await expect(about.getByText("We may earn a small commission at no cost to you.")).toBeVisible();
  const beacon = async link => { await link.evaluate(node => node.addEventListener("click", event => event.preventDefault())); const [request] = await Promise.all([page.waitForRequest(item => item.url().endsWith("/test-api/events")), link.click()]); return JSON.parse(request.postData()); };
  expect(await beacon(about.getByRole("link", { name: /^Bookshop\.org/ }))).toEqual({ name: "get_copy_click", placement: "bookshop" });
  expect(await beacon(amazon)).toEqual({ name: "get_copy_click", placement: "amazon" });
  expect(app.errors).toEqual([]);
});
