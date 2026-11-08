import { test as base, expect } from "@playwright/test";
import { GENRES, genreId, installGenres } from "./support/genres.js";

// Browser fixtures only: the genre list, the catalogue and the reader's preferences are mocked from the contract.
const book = (id, tags) => ({ id, title: `Genre fixture ${id}`, subtitle: null, authors: [{ id, name: `Author ${id}` }], tags, cover_image_url: null, page_count: 300, published_year: 2000, english_title: null, description: "A description." });

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], authenticated: false, genresFail: false,
      preferences: [{ tag_id: genreId("fantasy"), tag: { id: genreId("fantasy"), name: "fantasy", type: "genre" }, source_text: "" }, { tag_id: 9001, tag: { id: 9001, name: "cozy", type: "mood" }, source_text: "" }],
      books: [book(1, [{ id: genreId("fantasy"), name: "fantasy" }, { id: 9001, name: "cozy" }, { id: 9002, name: "some_unknown_slug" }])] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      state.requests.push({ path, method, params: Object.fromEntries(url.searchParams), tags: url.searchParams.getAll("tag"), body: ["POST", "PUT"].includes(method) ? route.request().postDataJSON() : null });
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return state.authenticated ? reply(200, {}) : reply(401, { detail: "Not signed in" });
      if (path === "/me/reading-capabilities") return reply(404, { detail: "Not found" });
      if (path === "/me/books") return reply(200, []);
      if (path === "/me/preferences") return method === "POST" ? reply(200, route.request().postDataJSON().tag_ids.map(id => ({ tag_id: id, tag: { id, name: String(id), type: "genre" }, source_text: "" }))) : reply(200, state.preferences);
      if (path === "/books") return reply(200, { items: state.books, total: state.books.length, page: 1, size: 20 });
      const one = path.match(/^\/books\/(\d+)$/);
      if (one) return reply(200, state.books.find(item => item.id === Number(one[1])) || state.books[0]);
      if (/\/description$/.test(path)) return reply(404, { detail: "Not found" });
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const ALL_LABELS = GENRES.map(genre => genre.label);
const SLUGS = /science_fiction|mystery_crime|historical_fiction|literary_fiction|young_adult|short_stories|graphic_novels|biography_memoir|science_nature|business_money|self_help|philosophy_religion|christian_faith|politics_society|food_cooking|art_music|some_unknown_slug/;

test("Discover's chip row is the 28 genres plus All subjects, as one radio group, and a raw key never shows", async ({ page, app }) => {
  await page.goto("/browse");
  const row = page.getByRole("radiogroup", { name: "Browse subjects" });
  await expect(row.getByRole("radio")).toHaveCount(29);
  await expect(row.getByRole("radio", { name: "All subjects" })).toBeChecked();
  for (const label of ALL_LABELS) await expect(row.getByRole("radio", { name: label, exact: true })).toBeAttached();
  expect(await page.locator("body").innerText()).not.toMatch(SLUGS);
  expect(app.genreRequests).toBe(1);
});

test("the chip row works from the keyboard: arrows choose, and the choice is the tag in the address", async ({ page, app: _app }) => {
  await page.goto("/browse");
  await page.getByRole("radio", { name: "All subjects" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Fantasy", exact: true })).toBeChecked();
  await expect(page).toHaveURL(/\/browse\?tag=fantasy$/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Science fiction", exact: true })).toBeChecked();
  await expect(page).toHaveURL(/tag=science_fiction$/);
  await expect(page.getByRole("heading", { name: "Science fiction", level: 2 })).toBeVisible();
  await page.getByRole("radio", { name: "All subjects" }).check({ force: true });
  await expect(page).toHaveURL(/\/browse$/);
});

test("the filters are the same genres under Fiction and Nonfiction and more, as checkboxes", async ({ page, app }) => {
  await page.goto("/browse");
  await page.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("group", { name: "Fiction", exact: true }).getByRole("checkbox")).toHaveCount(15);
  await expect(dialog.getByRole("group", { name: "Nonfiction and more", exact: true }).getByRole("checkbox")).toHaveCount(13);
  await expect(dialog.getByText(/\(\d+\)|\b\d{2,}\b/)).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Fantasy", exact: true }).check({ force: true });
  await dialog.getByRole("checkbox", { name: "Poetry", exact: true }).check({ force: true });
  await dialog.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => app.requests.filter(request => request.path === "/books").at(-1).tags).toEqual(["fantasy", "poetry"]);
  await expect(page.getByRole("heading", { name: "Fantasy + Poetry", level: 2 })).toBeVisible();
});

test("a book page shows only its genres, by their labels, and hides moods and unknown keys", async ({ page, app: _app }) => {
  await page.goto("/book/1");
  const tags = page.locator(".bv-book-tags");
  await expect(tags.getByRole("link")).toHaveText(["Fantasy"]);
  await expect(tags.getByRole("link", { name: "Fantasy" })).toHaveAttribute("href", "/browse?tag=fantasy");
  expect(await page.locator("body").innerText()).not.toMatch(SLUGS);
  await expect(page.getByText("cozy", { exact: false })).toHaveCount(0);
});

test("when the genre list cannot load, the genre controls are gone and nothing stands in for them", async ({ page, app }) => {
  app.genresFail = true;
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Books to explore" })).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByText("Fantasy")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/book/1");
  await expect(page.locator(".bv-book-tags")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(SLUGS);
});

test("Favourite genres uses the same grouped picker, and saving sends the genres' tag ids, keeping a non-genre choice", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/preferences");
  await expect(page.getByRole("group", { name: "Fiction", exact: true }).getByRole("checkbox")).toHaveCount(15);
  await expect(page.getByRole("group", { name: "Nonfiction and more", exact: true }).getByRole("checkbox")).toHaveCount(13);
  await expect(page.getByRole("checkbox", { name: "Fantasy", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Travel", exact: true }).check({ force: true });
  await page.getByRole("checkbox", { name: "Fantasy", exact: true }).uncheck({ force: true });
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect.poll(() => app.requests.find(request => request.path === "/me/preferences" && request.method === "POST")?.body?.tag_ids).toEqual([9001, genreId("travel")]);
});

test("Favourite genres explains itself when the genre list is down, and offers a retry", async ({ page, app }) => {
  app.authenticated = true; app.genresFail = true;
  await page.goto("/preferences");
  await expect(page.getByText("Genres aren’t available right now.")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  app.genresFail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("checkbox", { name: "Fantasy", exact: true })).toBeChecked();
});
