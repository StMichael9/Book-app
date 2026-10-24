import { test, expect } from "@playwright/test";

// Real browser → API → guarded disposable PostgreSQL. This is a deliberately
// synthetic Goodreads-shaped file, NOT native platform-export acceptance.
test("M5 real file import, source privacy, replay, CSV and cross-account isolation", async ({ page, browser, baseURL }) => {
  const api = "http://127.0.0.1:8005", errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const book = (await (await page.request.get(`${api}/books`)).json()).items[0];
  async function register(tab, email) {
    await tab.goto(`${baseURL}/register?returnTo=/my-books/import`);
    await tab.getByLabel("Email address", { exact: true }).fill(email);
    await tab.getByLabel("Password", { exact: true }).fill("synthetic-m5-browser-password");
    const response = tab.waitForResponse(result => new URL(result.url()).pathname === "/auth/register");
    await tab.getByRole("button", { name: "Create account", exact: true }).click();
    const registered = await response;
    if (registered.status() === 429) {
      await expect(tab.getByRole("alert")).toContainText("Too many requests");
      await tab.waitForTimeout(61000);
      await tab.getByRole("button", { name: "Create account", exact: true }).click();
    } else expect(registered.status(), await registered.text()).toBe(201);
    await expect(tab.getByRole("heading", { name: "Bring your library", exact: true })).toBeVisible();
  }
  await register(page, "m5-live-owner@example.com");
  await page.goto(`/book/${book.id}`);
  await expect(page.getByRole("button", { name: `Add ${book.title} to Owned`, exact: true })).toBeEnabled();
  await page.goto("/my-books/import");
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const file = "Book Id,Title,Author,Exclusive Shelf,My Rating,My Review,Owned Copies,Date Read,Read Count\r\n" + [
    ["9001", book.title, book.authors[0].name, "read", "4", "Owner-only imported review", "1", "2025/05/05", "1"],
    ["9002", "Missing private work 夜", "A source author", "to-read", "0", '=HYPERLINK("https://example.test","inert text")', "1", "", "0"],
  ].map(row => row.map(quote).join(",")).join("\r\n");
  async function upload() {
    await page.getByLabel("Library file", { exact: false }).setInputFiles({ name: "synthetic-goodreads.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
    await page.getByRole("button", { name: "Check my library", exact: true }).click();
    // Upload + durable analysis/grouping are several real database requests,
    // not an instantaneous mocked route. Keep a bounded journey-level wait.
    await expect(page.getByRole("heading", { name: "Review your library", exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Approve unmatched books as private entries.").check();
    await page.getByRole("button", { name: "Confirm import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your library is here", exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await upload();
  await page.goto(`/book/${book.id}`);
  await expect(page.getByRole("button", { name: `Remove ${book.title} from Owned`, exact: true })).toBeVisible();
  const first = await (await page.request.get(`${api}/me/library`)).json();
  expect(first.total).toBe(2);
  const catalogueEntry = first.items.find(entry => entry.book_id === book.id);
  const privateEntry = first.items.find(entry => entry.book_id === null);
  expect(privateEntry.is_owned && privateEntry.is_wanted).toBe(true);
  const history = await (await page.request.get(`${api}/me/library/${catalogueEntry.id}/attempts`)).json();
  expect(history.items).toHaveLength(1);
  expect(history.items[0].origin).toBe("import");
  expect(history.items[0].ended_on).toBe("2025-05-05");
  const run = (await (await page.request.get(`${api}/me/library-imports`)).json()).items[0];
  await page.goto(`/my-books/${catalogueEntry.id}`);
  await page.getByText("From your import (1) · private", { exact: true }).click();
  await expect(page.getByText("Owner-only imported review", { exact: true })).toBeVisible();
  await page.goto("/my-books/import");
  await upload();
  const repeated = await (await page.request.get(`${api}/me/library`)).json();
  expect(repeated.items.map(entry => entry.id).sort()).toEqual(first.items.map(entry => entry.id).sort());
  expect((await (await page.request.get(`${api}/me/library/${catalogueEntry.id}/attempts`)).json()).items).toHaveLength(1);
  const csv = await page.request.get(`${api}/me/library-imports/export.csv`);
  expect(csv.status()).toBe(200);
  expect(Number(csv.headers()["content-length"])).toBe((await csv.body()).length);
  expect(await csv.text()).toContain(`bv-entry-${catalogueEntry.id}`);
  const sourceExport = await (await page.request.get(`${api}/me/reading-export`)).text();
  expect(sourceExport).toContain("Owner-only imported review");
  expect(sourceExport).not.toContain("accepted_hash");
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await register(other, "m5-live-other@example.com");
  expect((await other.request.get(`${api}/me/library/${catalogueEntry.id}/imported-sources`)).status()).toBe(404);
  expect((await other.request.get(`${api}/me/library-imports/${run.id}/rows`)).status()).toBe(404);
  expect((await (await other.request.get(`${api}/me/library`)).json()).total).toBe(0);
  expect(errors).toEqual([]);
  await otherContext.close();
});
