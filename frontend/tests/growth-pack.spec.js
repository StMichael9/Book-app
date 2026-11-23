import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installGenres } from "./support/genres.js";
import { listShareSpec, MAX_SHARE_BOOKS, SHARE_HEIGHT, SHARE_WIDTH } from "../src/components/share/shareImage.js";

// Browser fixtures only: /switch is a public page; the share picture is drawn in the browser from a list the page already has.

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { authenticated: false, requests: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
      state.requests.push(path);
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === "/health") return reply(200, { status: "ok" });
      if (path === "/auth/refresh") return state.authenticated ? reply(200, {}) : reply(401, { detail: "Not signed in" });
      if (path === "/me/reading-capabilities") return state.authenticated ? reply(200, { enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: true } }) : reply(404, { detail: "Not found" });
      if (path === "/me/profile") return reply(200, { display_name: "Rae", bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 });
      if (path === "/books") return reply(200, { items: [], total: 0, page: 1, size: 20 });
      return reply(404, { detail: "Not found" });
    });
    await installGenres(page, state);
    await provide(state);
  },
});

const theme = async (page, name) => { await page.emulateMedia({ colorScheme: name }); await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), name); };
const SIGN_UP = "/register?src=switch&returnTo=%2Fmy-books%2Fimport";

test("/switch signed out: the words, the two buttons go to sign-up with src=switch and the import next, and the tab is titled for the page", async ({ page, app }) => {
  await page.goto("/switch");
  await expect(page.getByRole("heading", { level: 1, name: "Leaving Goodreads or StoryGraph?" })).toBeVisible();
  await expect(page.getByText("Bring your library with you. Your shelves, reading dates and notes come across, and everything stays private to you.")).toBeVisible();
  await expect(page.getByText("Bookvane never asks for your Goodreads login.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Three steps" })).toBeVisible();
  await expect(page.locator(".bv-leave-steps li")).toHaveCount(3);
  await expect(page.getByText("Up to 20,000 books. You’ll see a summary before anything is added.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What comes across" })).toBeVisible();
  await expect(page.locator(".bv-leave-across li")).toHaveText(["Your shelves: read, reading and want to read", "Books you own", "Start and finish dates, including re-reads", "Your reviews and notes come along too, kept with the book"]);
  await expect(page.getByText("Ready when you are.")).toBeVisible();
  const buttons = page.getByRole("link", { name: "Start your import", exact: true });
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) await expect(button).toHaveAttribute("href", SIGN_UP);
  await expect(page).toHaveTitle("Move from Goodreads or StoryGraph to Bookvane · Bookvane");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Bring your shelves, reading dates and notes to Bookvane in three steps. Private by default.");
  await expect(page.locator(".bv-header").getByRole("link", { name: "Join free", exact: true })).toHaveAttribute("href", "/register?src=switch");
  await expect(page.locator(".bv-mobile-nav")).toHaveCount(0);
  await buttons.first().click();
  await expect(page).toHaveURL(/\/register\?src=switch&returnTo=%2Fmy-books%2Fimport$/);
  expect(app.errors).toEqual([]);
});

test("/switch signed in: the button goes straight to the import", async ({ page, app }) => {
  app.authenticated = true;
  await page.goto("/switch");
  await expect(page.getByRole("heading", { level: 1, name: "Leaving Goodreads or StoryGraph?" })).toBeVisible();
  for (const button of await page.getByRole("link", { name: "Start your import", exact: true }).all()) await expect(button).toHaveAttribute("href", "/my-books/import");
});

test("leaving /switch puts the page's own description back, and the footer links to it from anywhere", async ({ page, app: _app }) => {
  await page.goto("/switch");
  await page.goto("/browse");
  await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", /three steps/);
  const footer = page.locator(".bv-footer").getByRole("link", { name: "Import from Goodreads or StoryGraph", exact: true });
  await expect(footer).toHaveAttribute("href", "/switch");
  await footer.click();
  await expect(page).toHaveURL(/\/switch$/);
});

test("the landing page's Import my library opens /switch for a signed-out visitor", async ({ page, app: _app }) => {
  await page.goto("/");
  for (const link of await page.getByRole("link", { name: "Import my library", exact: true }).all()) await expect(link).toHaveAttribute("href", "/switch");
});

for (const width of [1440, 390]) test(`/switch lays out as a normal page at ${width}: the content is its own height and the footer comes after it`, async ({ page, app: _app }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/switch");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const box = await page.evaluate(() => { const section = document.querySelector(".bv-leave"), close = document.querySelector(".bv-leave-close").getBoundingClientRect(), footer = document.querySelector(".bv-footer").getBoundingClientRect(), style = getComputedStyle(section); return { sectionHeight: section.getBoundingClientRect().height, background: style.backgroundColor, closeBottom: close.bottom + scrollY, footerTop: footer.top + scrollY }; });
  expect(box.sectionHeight).toBeGreaterThan(600);                         // not a 24px switch control: the page's own class
  expect(box.background).toBe("rgba(0, 0, 0, 0)");
  expect(box.footerTop).toBeGreaterThanOrEqual(box.closeBottom);          // the footer sits after the content
});

test("/switch is in the sitemap", () => {
  expect(readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8")).toContain("<loc>https://bookvane.me/switch</loc>");
});

for (const name of ["light", "dark"]) test(`/switch does not scroll sideways at 390, 320 and 200% text; ${name}`, async ({ page, app: _app }) => {
  await theme(page, name);
  for (const [width, zoom] of [[390, false], [320, false], [390, true]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/switch");
    if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.getByRole("link", { name: "Start your import", exact: true }).all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

// ---- the list share picture: what goes in it ----------------------------------------------------------------------------------------------

const listOf = count => ({ id: 7, name: "Books that changed my year", is_public: false, description: "A private description", notes: "Secret note",
  books: Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Book ${index + 1}`, authors: [`Author ${index + 1}`], cover_image_url: null, status: "want", finished_month: "2026-03", notes: "Private note", rating: 5, reaction: "loved", started_on: "2026-01-02", page_count: 300 })) });

test("the share picture holds at most 5 books, in list order, with their titles and authors", () => {
  const spec = listShareSpec({ list: listOf(8), name: "Rae" });
  expect(spec.width).toBe(SHARE_WIDTH); expect(spec.height).toBe(SHARE_HEIGHT);
  expect(SHARE_WIDTH).toBe(1080); expect(SHARE_HEIGHT).toBe(1350); expect(MAX_SHARE_BOOKS).toBe(5);
  const covers = spec.ops.filter(op => op.type === "cover");
  expect(covers.map(op => op.title)).toEqual(["Book 1", "Book 2", "Book 3", "Book 4", "Book 5"]);
  const texts = spec.ops.filter(op => op.type === "text").map(op => op.text);
  expect(texts).toEqual(expect.arrayContaining(["A list by Rae", "Books that changed my year", "1", "Book 1", "Author 1", "5", "Book 5", "Author 5", "Made with Bookvane", "bookvane.me"]));
  expect(texts).not.toContain("Book 6");
  expect(texts.filter(text => /^\d$/.test(text))).toEqual(["1", "2", "3", "4", "5"]);
});

test("the share picture carries no notes, reactions, dates, ratings, counts or reading state", () => {
  const spec = listShareSpec({ list: listOf(3), name: "Rae" });
  const everything = JSON.stringify(spec);
  for (const secret of ["Secret note", "Private note", "private description", "loved", "2026-03", "2026-01-02", "want", "rating", "reaction", "300"]) expect(everything).not.toContain(secret);
  expect(spec.ops.filter(op => op.type === "text").map(op => op.text).join(" ")).not.toMatch(/\d+ books?/);
});

test("with no name the 'A list by' line is left out, and a list with no authors shows just the titles", () => {
  const list = { name: "Untitled", books: [{ title: "Only", authors: [], cover_image_url: null }] };
  const spec = listShareSpec({ list, name: "" });
  const texts = spec.ops.filter(op => op.type === "text").map(op => op.text);
  expect(texts.some(text => text.startsWith("A list by"))).toBe(false);
  expect(texts).toContain("Only");
});
