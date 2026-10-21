import { test, expect } from "@playwright/test";

async function openReadingSection(page, label) {
  const section = page.locator("details").filter({ has: page.getByText(label, { exact: true }) });
  await expect(section.locator(":scope > summary")).toBeVisible();
  if (!(await section.evaluate(node => node.open))) await section.locator(":scope > summary").click();
}


async function registerReadingAccount(page, email, returnTo) {
  await page.goto(`/register?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
  await submitReadingRegistration(page);
}

async function submitReadingRegistration(page) {
  const registered = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/register" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  if ((await registered).status() === 429) {
    await expect(page.getByRole("alert")).toContainText("Too many requests");
    await page.waitForTimeout(61_000);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  }
}

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
    await submitReadingRegistration(tab);
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
  await submitReadingRegistration(page);
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("link", { name: "Find a book", exact: true }).click();
  await page.getByRole("link", { name: "View Local library integration book", exact: true }).click();
  await page.getByRole("button", { name: "Add Local library integration book to Own", exact: true }).click();
  await page.getByRole("button", { name: "Add Local library integration book to Want", exact: true }).click();
  // Start from the acknowledged shelf version, not an in-flight flag write.
  // Native optimistic concurrency deliberately refuses the latter as stale.
  await expect(page.getByRole("button", { name: "Remove Local library integration book from Want", exact: true })).toBeVisible();
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
  await expect(page.getByRole("link", { name: /^Continue your reading:/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m2-home-phone.png", fullPage: true });
  await nav.getByRole("link", { name: "You", exact: true }).click();
  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await page.screenshot({ path: "../backend/.v3-test-runtime/m2-home-phone-dark.png", fullPage: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("link", { name: /^Continue your reading:/ })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("M2 private missing book and historical dates stay private and optional", async ({ page, browser }) => {
  await page.goto("/register?returnTo=/my-books/private");
  await page.getByLabel("Email address", { exact: true }).fill("m2-private@example.com");
  await page.getByLabel("Password", { exact: true }).fill("isolated-browser-password");
  await submitReadingRegistration(page);
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
  await submitReadingRegistration(page);
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

test("M3 real private context persists, stays separate across rereads and is owner-only", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await registerReadingAccount(page, "m3-context@example.com", "/my-books/start/1");
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  await openReadingSection(page, "Only for you");
  await page.getByRole("button", { name: "Add save reason (optional)", exact: true }).click();
  await page.getByLabel("Save reason (optional)", { exact: true }).fill("A trusted recommendation");
  await page.getByRole("button", { name: "Save reason", exact: true }).click();
  await expect(page.getByText("A trusted recommendation", { exact: true })).toBeVisible();
  await openReadingSection(page, "Only for you");
  await page.getByRole("button", { name: "Add note and reaction (optional)", exact: true }).click();
  const memory = '<img src=x onerror="window.noteExecuted=true">\nRemember this reading 読書';
  await page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true }).fill(memory);
  await page.getByLabel("Reaction (optional)", { exact: true }).selectOption("loved");
  await page.route("**/me/reading-attempts/*", route => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.getByText(memory, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.noteExecuted)).toBeUndefined();
  await expect(page.locator(".bv-private-text img")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(memory, { exact: true })).toBeVisible();
  const api = "http://127.0.0.1:8005";
  const entry = (await (await page.request.get(`${api}/me/library`)).json()).items[0];
  const first = (await (await page.request.get(`${api}/me/library/${entry.id}/reading`)).json()).current_attempt;
  for (const path of ["/me/home", "/me/library", `/me/library/${entry.id}/attempts`, "/books"]) {
    expect(await (await page.request.get(`${api}${path}`)).text()).not.toContain("Remember this reading");
  }
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await page.getByRole("button", { name: "Start reading again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const current = (await (await page.request.get(`${api}/me/library/${entry.id}/reading`)).json()).current_attempt;
  expect(current.id).not.toBe(first.id); expect(current.note).toBeNull(); expect(current.reaction).toBeNull();
  await page.locator(".bv-reading-history").getByRole("button", { name: "Note and reaction", exact: true }).last().click();
  await expect(page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true })).toHaveValue(memory);
  await page.getByLabel("Where I left off / what I want to remember (optional)", { exact: true }).fill("Corrected first-read memory");
  await page.getByRole("button", { name: "Save reading memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`${api}/me/reading-attempts/${first.id}`)).json()).attempt.note).toBe("Corrected first-read memory");
  expect((await (await page.request.get(`${api}/me/reading-attempts/${current.id}`)).json()).attempt.note).toBeNull();
  const other = await browser.newContext();
  try {
    expect((await other.request.get(`${api}/me/reading-attempts/${first.id}`)).status()).toBe(401);
    const credentials = { email: "m3-context-other@example.com", password: "isolated-browser-password" };
    expect((await other.request.post(`${api}/auth/register`, { data: credentials })).ok()).toBe(true);
    expect((await other.request.post(`${api}/auth/login`, { data: credentials })).ok()).toBe(true);
    expect((await other.request.get(`${api}/me/reading-attempts/${first.id}`)).status()).toBe(404);
  } finally { await other.close(); }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m3-context-phone.png", fullPage: true });
  // Full M3 data controls: real owner-only export and lost-response removal.
  const workspaceUrl = page.url();
  await page.goto("/my-data");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("bookvane-reading-data.jsonl");
  expect(await download.failure()).toBeNull();
  await expect(page.getByRole("status").filter({ hasText: "Download started" })).toBeVisible();
  const exported = await page.request.get(`${api}/me/reading-export`);
  expect(exported.status()).toBe(200);
  const lines = (await exported.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(lines.at(-1)).toMatchObject({ type: "complete", counts: { entry: 1, reading: 2, preference: 0 } });
  expect(lines.filter(line => line.type === "reading").map(line => line.data.note)).toContain("Corrected first-read memory");
  expect(JSON.stringify(lines)).not.toContain("creation_fingerprint");
  await page.goto(workspaceUrl);
  await page.locator(".bv-reading-history").getByRole("button", { name: "Delete this reading record", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("other readings will stay");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m3-removal-phone.png", fullPage: true });
  await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
  expect((await page.request.get(`${api}/me/reading-attempts/${first.id}`)).status()).toBe(200);
  await page.route(`**/me/reading-attempts/${first.id}`, async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fetch(); return route.abort("failed");
  }, { times: 1 });
  await page.locator(".bv-reading-history").getByRole("button", { name: "Delete this reading record", exact: true }).last().click();
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.locator(".bv-reading-history li")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".bv-reading-history li")).toHaveCount(1);
  expect((await page.request.get(`${api}/me/reading-attempts/${first.id}`)).status()).toBe(404);
  const preserved = await (await page.request.get(`${api}/me/library/${entry.id}/reading`)).json();
  expect(preserved.entry.save_note).toBe("A trusted recommendation");
  expect(preserved.current_attempt.id).toBe(current.id);
  await openReadingSection(page, "Your data, your choice");
  await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  await dialog.getByRole("button", { name: "Forget book and history", exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  expect((await (await page.request.get(`${api}/me/library`)).json()).total).toBe(0);
  expect((await page.request.get(`${api}/me/reading-attempts/${current.id}`)).status()).toBe(404);
  expect((await page.request.get(`${api}/books/1`)).status()).toBe(200);
});

test("M4 real finish keeps success through suggestion failure, starts private Want safely and explores catalogue explicitly", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const api = "http://127.0.0.1:8005";
  await registerReadingAccount(page, "m4-reader@example.com", "/my-books/private");
  await page.getByLabel("Title", { exact: true }).fill("M4 first private reading");
  await page.getByRole("button", { name: "Add private book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "M4 first private reading", exact: true })).toBeVisible();
  const firstEntry = (await (await page.request.get(`${api}/me/library`)).json()).items[0];
  const queued = await page.request.post(`${api}/me/library/private`, { data: {
    request_id: crypto.randomUUID(), title: "M4 queued private reading", is_owned: true, is_wanted: true } });
  expect(queued.status()).toBe(200);
  const queuedEntry = await queued.json();
  await page.getByRole("button", { name: "Start reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  await page.route("**/me/next-read*", route => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await page.getByRole("button", { name: "Finish book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading saved.", exact: true })).toBeVisible();
  const choices = page.getByRole("region", { name: "Choose your next read" });
  await expect(choices.getByRole("alert")).toContainText("any saved finish are unchanged");
  expect((await (await page.request.get(`${api}/me/library/${firstEntry.id}/reading`)).json()).current_attempt.state).toBe("finished");
  await choices.getByRole("button", { name: "Try choices again", exact: true }).click();
  await expect(choices.getByRole("article")).toHaveCount(1);
  await expect(choices.getByRole("heading", { name: "M4 queued private reading", exact: true })).toBeVisible();
  await choices.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished", exact: true })).toBeFocused();
  await page.goto("/home");
  await expect(choices.getByRole("article")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../backend/.v3-test-runtime/m4-home-phone.png", fullPage: true });
  let creations = 0;
  await page.route("**/me/reading-attempts/*", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    creations += 1;
    expect(route.request().postDataJSON().started_via).toBe("next_read");
    await route.fetch(); return route.abort("failed");
  }, { times: 1 });
  const start = choices.getByRole("button", { name: "Start reading M4 queued private reading", exact: true });
  await start.click();
  await expect(choices.getByRole("alert")).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/my-books/${queuedEntry.id}$`));
  expect(creations).toBe(1);
  const workspace = await (await page.request.get(`${api}/me/library/${queuedEntry.id}/reading`)).json();
  expect(workspace.entry.is_owned).toBe(true); expect(workspace.entry.is_wanted).toBe(false);
  expect((await (await page.request.get(`${api}/me/library/${queuedEntry.id}/attempts`)).json()).items).toHaveLength(1);
  const exported = (await (await page.request.get(`${api}/me/reading-export`)).text()).trim().split("\n").map(line => JSON.parse(line));
  expect(exported.find(line => line.type === "reading" && line.data.user_book_id === queuedEntry.id).data.started_via).toBe("next_read");
  await page.goto("/home");
  await expect(choices.getByText("No Want books match these choices.", { exact: false })).toBeVisible();
  await choices.getByRole("button", { name: "Explore something new", exact: true }).click();
  await expect(choices.getByRole("heading", { name: "Local library integration book", exact: true })).toBeVisible();
  await choices.getByRole("button", { name: "Start reading Local library integration book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  const all = await (await page.request.get(`${api}/me/library`)).json();
  const catalogue = all.items.find(item => item.book_id === 1);
  expect(catalogue.is_owned).toBe(false); expect(catalogue.is_wanted).toBe(false);
  expect((await (await page.request.get(`${api}/me/home`)).json()).reading_count).toBe(2);
  expect(errors).toEqual([]);
});
