import { test, expect } from "@playwright/test";

// Real browser → FastAPI → isolated PostgreSQL. No API mocks or external services.
test("M1 real registration, independent flags, persistence and two-account isolation", async ({ page, browser, baseURL }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const api = "http://127.0.0.1:8005";
  const catalogue = await page.request.get(`${api}/books`);
  const book = (await catalogue.json()).items[0];
  async function register(tab, email) {
    await tab.goto(`${baseURL}/register?returnTo=/book/${book.id}`);
    await tab.getByLabel("Email address", { exact: true }).fill(email);
    await tab.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
    await tab.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(tab.getByRole("heading", { name: book.title, exact: true })).toBeVisible();
  }
  await register(page, "m1-owner-a@example.com");
  await page.getByRole("button", { name: `Add ${book.title} to Want`, exact: true }).click();
  await page.getByRole("button", { name: `Add ${book.title} to Own`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Remove ${book.title} from Own`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: `Remove ${book.title} from Want`, exact: true })).toHaveAttribute("aria-pressed", "true");
  const ownerPage = await page.request.get(`${api}/me/library`);
  expect(ownerPage.status()).toBe(200);
  const entry = (await ownerPage.json()).items[0];
  expect(entry.is_owned && entry.is_wanted).toBe(true);
  const second = await browser.newContext();
  const other = await second.newPage();
  await register(other, "m1-owner-b@example.com");
  await expect(other.getByRole("button", { name: `Add ${book.title} to Own`, exact: true })).toHaveAttribute("aria-pressed", "false");
  expect((await other.request.get(`${api}/me/library/${entry.id}`)).status()).toBe(404);
  await other.getByRole("button", { name: `Add ${book.title} to Want`, exact: true }).click();
  await expect(other.getByRole("button", { name: `Remove ${book.title} from Want`, exact: true })).toBeVisible();
  await page.goto(`${baseURL}/my-books`);
  await expect(page.getByLabel("Search title or author")).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove ${book.title} from Own`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
  await second.close();
});
