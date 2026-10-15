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

test("M2 real lifecycle, progress, history, Home and phone navigation", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/register");
  await page.getByLabel("Email address", { exact: true }).fill("m2-lifecycle@example.com");
  await page.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("link", { name: "Find a book", exact: true }).click();
  await page.getByRole("link", { name: "View Local library integration book", exact: true }).click();
  await page.getByRole("button", { name: "Add Local library integration book to Own", exact: true }).click();
  await page.getByRole("button", { name: "Add Local library integration book to Want", exact: true }).click();
  await page.getByRole("link", { name: "Open or start your reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const api = "http://127.0.0.1:8005";
  const entry = (await (await page.request.get(`${api}/me/library`)).json()).items[0];
  expect(entry.is_owned).toBe(true); expect(entry.is_wanted).toBe(false);
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await page.getByLabel("Progress", { exact: true }).selectOption("percent");
  await page.getByLabel("Percent complete", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
  await expect(page.getByText("40%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await page.getByLabel("Percent complete", { exact: true }).fill("25");
  const current = (await (await page.request.get(`${api}/me/library/${entry.id}`)).json());
  expect((await page.request.patch(`${api}/me/library/${entry.id}`, { data: { is_wanted: true, expected_version: current.version } })).status()).toBe(200);
  await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("25");
  await page.getByRole("button", { name: "Close editor and reload", exact: true }).click();
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await expect(page.getByLabel("Percent complete", { exact: true })).toHaveValue("40");
  await page.getByLabel("Percent complete", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save progress and dates", exact: true }).click();
  await expect(page.getByText("25%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume reading", exact: true }).click();
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reopen this reading", exact: true }).click();
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stopped", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start reading again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const history = (await (await page.request.get(`${api}/me/library/${entry.id}/attempts`)).json()).items;
  expect(history).toHaveLength(2);
  expect(history.find(attempt => attempt.state === "dnf").progress_value).toBe(25);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await page.route("**/me/home", route => route.fulfill({ status: 503, json: { detail: "Isolated temporary outage" } }), { times: 1 });
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your reading couldn’t load.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("link", { name: "Continue your reading", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m2-home-phone.png", fullPage: true });
  await nav.getByRole("link", { name: "You", exact: true }).click();
  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await page.screenshot({ path: "../backend/.v3-test-runtime/m2-home-phone-dark.png", fullPage: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("link", { name: "Continue your reading", exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("M2 private missing book and historical dates stay private and optional", async ({ page, browser }) => {
  await page.goto("/register?returnTo=/my-books/private");
  await page.getByLabel("Email address", { exact: true }).fill("m2-private@example.com");
  await page.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("読書の家");
  await page.getByLabel("Author (optional)", { exact: true }).fill("Private test author");
  await page.getByRole("button", { name: "Add private book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "読書の家", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record a past finish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  const api = "http://127.0.0.1:8005";
  const entry = (await (await page.request.get(`${api}/me/library`)).json()).items[0];
  const history = (await (await page.request.get(`${api}/me/library/${entry.id}/attempts`)).json()).items;
  expect(entry.book_id).toBeNull(); expect(history[0].started_on).toBeNull(); expect(history[0].ended_on).toBeNull();
  // A client-side move between workspaces must discard the previous editor
  // and retry identity, even though React reuses the same route component.
  await page.getByRole("button", { name: "Edit progress or dates", exact: true }).click();
  await expect(page.getByLabel("Started on (optional)", { exact: true })).toBeVisible();
  const another = await page.request.post(`${api}/me/library/private`, { data: {
    request_id: crypto.randomUUID(), title: "Another private reading" } });
  expect(another.status()).toBe(200);
  const anotherEntry = await another.json();
  await page.evaluate(id => {
    history.pushState(null, "", `/my-books/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, anotherEntry.id);
  await expect(page.getByRole("heading", { name: "Another private reading", exact: true })).toBeVisible();
  await expect(page.getByLabel("Started on (optional)", { exact: true })).toHaveCount(0);
  await page.goto("/my-books/private");
  await page.getByLabel("Title", { exact: true }).fill("読書の家");
  await page.getByRole("button", { name: "Add private book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A title like this is already in your library.", exact: true })).toBeVisible();
  expect((await (await page.request.get(`${api}/me/library`)).json()).total).toBe(2);
  const other = await browser.newContext();
  expect((await other.request.get(`${api}/me/library/${entry.id}/reading`)).status()).toBe(401);
  const catalogue = (await (await other.request.get(`${api}/books?book=${encodeURIComponent("読書の家")}`)).json());
  expect(catalogue.total).toBe(0);
  await other.close();
});

test("M2 guest start intent survives registration without duplicating history on reload", async ({ page }) => {
  // Lose the first successful command response, not the committed database
  // write. Retry must reconcile the existing attempt instead of starting twice.
  await page.route("**/me/reading-attempts/*", async route => {
    await route.fetch();
    return route.abort("failed");
  }, { times: 1 });
  await page.goto("/my-books/start/1");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill("m2-guest-start@example.com");
  await page.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try starting again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try starting again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const api = "http://127.0.0.1:8005";
  const entry = (await (await page.request.get(`${api}/me/library`)).json()).items[0];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  expect((await (await page.request.get(`${api}/me/library/${entry.id}/attempts`)).json()).items).toHaveLength(1);
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  await page.goto("/my-books/start/1");
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
  expect((await (await page.request.get(`${api}/me/library/${entry.id}/attempts`)).json()).items).toHaveLength(1);
});
