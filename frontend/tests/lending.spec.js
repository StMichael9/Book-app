import { test, expect } from "@playwright/test";

// Lending (T75B): the loan block on the book page, its sheets, share and the borrower's page. Every API request is intercepted.
const book = id => ({ id, title: `Lending fixture ${id}`, authors: [{ id: 1, name: "Fixture Author" }], tags: [], isbn13: null, description: "A fixture.",
  published_year: 2001, page_count: 200, cover_image_url: null, english_title: null });
const SHOTS = "../.bv-shots/lending";

async function mock(page, { signedIn = true, shelf = { 5: { entry_id: 50, is_owned: true }, 6: { entry_id: 60, is_owned: false }, 7: null }, loans = [], publicLoan = null, publicStatus = 200, webShare = false } = {}) {
  const state = { loans: [...loans], requests: [], shelf, errors: [], publicLoan, backCalls: 0 };
  page.on("pageerror", error => state.errors.push(error.message));
  // Edge on Windows has Web Share; the copy fallback is what these tests see unless a test brings its own.
  if (!webShare) await page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/cover.svg") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"/>' });
    if (!url.pathname.startsWith("/test-api/")) return route.continue();
    const path = url.pathname.slice("/test-api".length), method = request.method(), reply = (json, status = 200) => route.fulfill({ status, json });
    state.requests.push({ method, path, search: url.search, body: request.postData() ? JSON.parse(request.postData()) : null });
    if (path === "/auth/refresh") return route.fulfill({ status: signedIn ? 200 : 401, json: {} });
    if (path === "/me/reading-capabilities") return reply({ enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, library_import: false, next_read: false } });
    if (path === "/events") return route.fulfill({ status: 204, body: "" });
    if (path === "/me/home") return reply({ current_reads: [], reading_count: 0, paused_count: 0 });
    if (path === "/me/library/lookup") return reply({ items: JSON.parse(request.postData()).book_ids.map(id => ({ book_id: id, entry_id: null, version: null, is_owned: false, is_wanted: false, reading_state: null, ...(state.shelf[id] || {}), ...(state.shelf[id] ? { version: 1 } : {}) })) });
    if (path === "/me/books") return reply([]);
    if (path === "/me/library/50/reading") return reply({ entry: { id: 50, book_id: 5, book: book(5), is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, current_attempt: null, editions: [], imported_sources_count: 0 });
    if (path === "/me/library/50/attempts") return reply({ items: [], next_cursor: null });
    if (path === "/me/library") return reply({ items: [{ id: 50, book_id: 5, book: book(5), is_owned: true, is_wanted: false, version: 1, reading_state: null, private_title: null, private_author: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }], counts: { all: 1, want: 0, owned: 1, reading: 0, finished: 0, paused: 0, dnf: 0 }, total: 1, next_cursor: null });
    if (/^\/books\/\d+$/.test(path)) return reply(book(Number(path.split("/")[2])));
    if (/^\/(books|me\/library)\/\d+\/description$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
    if (path === "/me/loans" && method === "GET") {
      const entry = url.searchParams.get("entry_id") ? Number(url.searchParams.get("entry_id")) : null, want = url.searchParams.get("state"), limit = Number(url.searchParams.get("limit") || 200);
      return reply({ items: state.loans.filter(loan => (entry === null || loan.entry_id === entry) && (want === "closed" ? loan.ended_on : !loan.ended_on)).slice(0, limit) });
    }
    if (path === "/me/loans" && method === "POST") {
      const body = JSON.parse(request.postData());
      const entry_id = body.entry_id ?? 70;
      if (body.book_id) state.shelf[body.book_id] = { entry_id, is_owned: false };
      const loan = { id: `loan-${state.loans.length + 1}`, direction: body.direction, person_name: body.person_name, started_on: "2026-11-21", due_on: body.due_on ?? null, overdue: false, said_back: false, has_link: false, entry_id, ended_on: null, title: `Lending fixture ${body.book_id ?? 5}`, book_id: body.book_id ?? 5, cover_image_url: null, authors: ["Fixture Author"] };
      state.loans.push(loan);
      return reply(loan, 201);
    }
    const one = path.match(/^\/me\/loans\/([^/]+)(\/share)?$/);
    if (one) {
      const loan = state.loans.find(item => item.id === one[1]);
      if (one[2] && method === "POST") { loan.has_link = true; return reply({ url: "https://bookvane.me/l/secret-token" }); }
      if (one[2] && method === "DELETE") { loan.has_link = false; return route.fulfill({ status: 204, body: "" }); }
      if (method === "PATCH") { const body = JSON.parse(request.postData()); if (body.ended) loan.ended_on = "2026-11-21"; Object.assign(loan, { ...body, ended: undefined }); return reply(loan); }
      if (method === "DELETE") { state.loans = state.loans.filter(item => item !== loan); return route.fulfill({ status: 204, body: "" }); }
    }
    if (path === "/loans/the-token" && method === "GET") return publicStatus === 404 ? route.fulfill({ status: 404, json: { detail: "Not found" } }) : reply(state.publicLoan);
    if (path === "/loans/the-token/back" && method === "POST") { state.backCalls += 1; state.publicLoan = { ...state.publicLoan, said_back: true }; return reply(state.publicLoan); }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
  return state;
}
const lent = (extra = {}) => ({ id: "loan-a", direction: "lent", person_name: "Sam", started_on: "2026-12-03", due_on: "2027-01-03", overdue: false, said_back: false, has_link: false, entry_id: 50, ended_on: null, title: "Lending fixture 5", book_id: 5, cover_image_url: "/cover.svg", authors: ["Fixture Author"], ...extra });
const borrowed = (extra = {}) => ({ id: "loan-b", direction: "borrowed", person_name: "Ana", started_on: "2026-11-28", due_on: "2026-12-20", overdue: false, said_back: false, has_link: false, entry_id: 50, ended_on: null, title: "Lending fixture 5", book_id: 5, cover_image_url: "/cover.svg", authors: ["Fixture Author"], ...extra });
const block = page => page.getByRole("region", { name: "Lending" });

test("an owned book offers both pills; lending, sharing, stop sharing and returning work end to end", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/book/5");
  await expect(block(page).getByRole("button", { name: "Lend this book" })).toBeVisible();
  await expect(block(page).getByRole("button", { name: "I borrowed this" })).toBeVisible();
  await block(page).getByRole("button", { name: "Lend this book" }).click();
  const sheet = page.getByRole("dialog", { name: "Lend this book" });
  await expect(sheet.getByText("Only you can see this name.")).toBeVisible();
  await expect(sheet.getByLabel("Who’s borrowing it?")).toBeFocused();
  await sheet.getByLabel("Who’s borrowing it?").fill("Sam");
  await sheet.getByLabel("Due back (optional)").fill("2027-01-03");
  await sheet.getByRole("button", { name: "Lend", exact: true }).click();
  await expect(sheet.getByText("Want Sam to have a link to it?")).toBeVisible();
  const create = state.requests.find(request => request.method === "POST" && request.path === "/me/loans");
  expect(create.body).toMatchObject({ direction: "lent", person_name: "Sam", entry_id: 50, due_on: "2027-01-03" });
  expect(create.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  await sheet.getByRole("button", { name: "Send Sam a link" }).click();
  // No Web Share here, so the message is shown to copy.
  const message = page.getByRole("dialog", { name: "Send Sam a link" });
  await expect(message.getByRole("textbox")).toHaveValue("Hi Sam! Here’s the book I lent you: https://bookvane.me/l/secret-token");
  await message.getByRole("button", { name: "Copy message" }).click();
  await expect(message.getByRole("button", { name: "Copied" })).toBeVisible();
  await message.getByRole("button", { name: "Close Send Sam a link" }).click();
  await expect(block(page).getByText("Lent to Sam", { exact: true })).toBeVisible();
  await expect(block(page).getByText("since 21 Nov · due back 3 Jan 2027")).toBeVisible();
  await expect(block(page).getByRole("button", { name: "Lend this book" })).toHaveCount(0);
  await block(page).getByRole("button", { name: "Stop sharing" }).click();
  await expect(block(page).getByRole("button", { name: "Stop sharing" })).toHaveCount(0);
  expect(state.requests.some(request => request.method === "DELETE" && request.path === "/me/loans/loan-1/share")).toBe(true);
  await block(page).getByRole("button", { name: "Returned" }).click();
  await expect(block(page).getByRole("button", { name: "Lend this book" })).toBeVisible();
  await expect(block(page).getByRole("heading", { name: "Past loans" })).toBeVisible();
  await expect(block(page).getByText(/^Lent to Sam · .* – /)).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("Web Share carries the message when the browser has it", async ({ page }) => {
  await page.addInitScript(() => { navigator.share = async data => { window.__shared = data; }; });
  await mock(page, { loans: [lent()], webShare: true });
  await page.goto("/book/5");
  await block(page).getByRole("button", { name: "Send Sam a link" }).click();
  await expect.poll(() => page.evaluate(() => window.__shared?.text)).toBe("Hi Sam! Here’s the book I lent you: https://bookvane.me/l/secret-token");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a book that isn’t owned offers only I borrowed this; a borrowed book from the page saves it with book_id", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/book/6");
  await expect(block(page).getByRole("button", { name: "Lend this book" })).toHaveCount(0);
  await page.goto("/book/7");
  await expect(block(page).getByRole("button", { name: "Lend this book" })).toHaveCount(0);
  await block(page).getByRole("button", { name: "I borrowed this" }).click();
  const sheet = page.getByRole("dialog", { name: "I borrowed this" });
  await sheet.getByLabel("Who lent it to you?").fill("Ana");
  await expect(sheet.getByText("Only you can see this name.")).toHaveCount(0);
  await sheet.getByLabel("Give back by (optional)").fill("2026-12-20");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(block(page).getByText("Borrowed from Ana")).toBeVisible();
  const create = state.requests.find(request => request.method === "POST" && request.path === "/me/loans");
  expect(create.body).toMatchObject({ direction: "borrowed", person_name: "Ana", book_id: 7, due_on: "2026-12-20" });
  expect(create.body.entry_id).toBeUndefined();
  await block(page).getByRole("button", { name: "Given back" }).click();
  await expect(block(page).getByRole("heading", { name: "Past loans" })).toBeVisible();
});

test("overdue shows the chip and Remind; said back shows its own card; a retry sends the same request id", async ({ page }) => {
  await page.addInitScript(() => { navigator.share = async data => { window.__shared = data; }; });
  const state = await mock(page, { loans: [lent({ overdue: true, due_on: "2026-11-01" })], webShare: true });
  await page.goto("/book/5");
  await expect(block(page).getByText("Overdue", { exact: true })).toBeVisible();
  await block(page).getByRole("button", { name: "Remind Sam" }).click();
  await expect.poll(() => page.evaluate(() => window.__shared?.text)).toBe("Hi Sam! Just a gentle reminder about Lending fixture 5. Whenever it’s back with me, you can tap “I’ve given it back” here: https://bookvane.me/l/secret-token");
  state.loans[0].said_back = true; state.loans[0].overdue = false;
  await page.reload();
  await expect(block(page).getByText("Sam says it’s back")).toBeVisible();
  await expect(block(page).getByText("Lent to Sam since 3 Dec")).toBeVisible();
  await expect(block(page).getByRole("button", { name: "Returned" })).toBeVisible();
  await expect(block(page).getByRole("button", { name: /Send Sam a link|Remind/ })).toHaveCount(0);
});

test("a lent and a borrowed loan show as two cards, the lent one first; Edit changes the name, Delete removes", async ({ page }) => {
  const state = await mock(page, { loans: [borrowed(), lent()] });
  await page.goto("/book/5");
  const cards = block(page).locator(".bv-loan-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Lent to Sam");
  await expect(cards.last()).toContainText("Borrowed from Ana");
  await expect(cards.last()).toContainText("since 28 Nov · give back by 20 Dec");
  await cards.first().getByRole("button", { name: /More actions for Lent to Sam/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit" });
  await sheet.getByLabel("Who’s borrowing it?").fill("Samuel");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(block(page).getByText("Lent to Samuel")).toBeVisible();
  expect(state.requests.find(request => request.method === "PATCH").body).toEqual({ person_name: "Samuel" });
  await cards.last().getByRole("button", { name: /More actions for Borrowed from Ana/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this loan?" });
  await expect(confirm.getByText("This can’t be undone.")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(cards).toHaveCount(2);
  expect(state.requests.some(request => request.method === "DELETE" && request.path === "/me/loans/loan-b")).toBe(false);
  await cards.last().getByRole("button", { name: /More actions for Borrowed from Ana/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this loan?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(cards).toHaveCount(1);
  expect(state.requests.some(request => request.method === "DELETE" && request.path === "/me/loans/loan-b")).toBe(true);
});

test("the sheet closes back to the button that opened it, and Escape cancels", async ({ page }) => {
  await mock(page);
  await page.goto("/book/5");
  const open = block(page).getByRole("button", { name: "Lend this book" });
  await open.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
});

const privateLoan = (extra = {}) => lent({ id: "loan-p", entry_id: 90, title: "A private diary", book_id: null, cover_image_url: null, authors: ["Me"], person_name: "Lee", ...extra });

test("Home shows On loan only when something is overdue, with Remind and Given back", async ({ page }) => {
  await page.addInitScript(() => { navigator.share = async data => { window.__shared = data; }; });
  const state = await mock(page, { loans: [lent()], webShare: true });
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Reading now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On loan" })).toHaveCount(0);
  state.loans.push(lent({ id: "o1", overdue: true, due_on: "2026-11-01" }), borrowed({ id: "o2", overdue: true, due_on: "2026-11-02", entry_id: 51, title: "Lending fixture 6", book_id: 6 }), privateLoan({ overdue: true, due_on: "2026-11-03" }));
  await page.reload();
  const section = page.getByRole("region", { name: "On loan" });
  await expect(section.locator("li")).toHaveCount(3);
  await expect(section.getByText("Lent to Sam · due back 1 Nov")).toBeVisible();
  await expect(section.getByText("Overdue", { exact: true })).toHaveCount(3);
  await expect(section.getByRole("link", { name: "A private diary" })).toHaveAttribute("href", "/my-books/90");
  await expect(section.locator("img")).toHaveCount(2);   // the private diary has no cover: its jacket shows instead
  await section.getByRole("button", { name: "Remind Sam" }).click();
  await expect.poll(() => page.evaluate(() => window.__shared?.text)).toContain("a gentle reminder about Lending fixture 5");
  await section.getByRole("button", { name: "Given back" }).click();
  await expect(section.locator("li")).toHaveCount(2);
  expect(state.requests.some(request => request.method === "PATCH" && request.path === "/me/loans/o2")).toBe(true);
});

test("My Books has an On loan view: overdue first, then lent, then borrowed, from one request", async ({ page }) => {
  const state = await mock(page, { loans: [borrowed(), lent({ id: "l2", person_name: "Zed", due_on: "2027-02-01" }), lent({ id: "o1", person_name: "Old", overdue: true, due_on: "2026-11-01" })] });
  await page.goto("/my-books");
  const tab = page.getByRole("button", { name: /^On loan/ });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page).toHaveURL(/loan=1/);
  const rows = page.getByRole("region", { name: "On loan" }).locator("li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Lent to Old");
  await expect(rows.nth(1)).toContainText("Lent to Zed");
  await expect(rows.nth(2)).toContainText("Borrowed from Ana");
  expect(state.requests.filter(request => request.path === "/me/loans" && request.search.includes("entry_id"))).toHaveLength(0);
  expect(state.requests.filter(request => request.path.startsWith("/me/library/") && /^\/me\/library\/\d+$/.test(request.path))).toHaveLength(0);
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.getByRole("region", { name: "On loan" })).toHaveCount(0);
});

const publicLoan = (extra = {}) => ({ state: "open", title: "The Hobbit", authors: ["J.R.R. Tolkien"], cover_url: null, lender_first_name: "Rae", started_on: "2026-12-03", due_on: "2027-01-03", said_back: false, ...extra });

test("the borrower's page works signed out: wordmark only, noindex, one tap, thanks", async ({ page }) => {
  const state = await mock(page, { signedIn: false, publicLoan: publicLoan() });
  await page.goto("/l/the-token");
  await expect(page.getByRole("heading", { name: "The Hobbit" })).toBeVisible();
  await expect(page.getByText("Rae lent you this on 3 Dec.")).toBeVisible();
  await expect(page.getByText("Due back 3 Jan 2027.")).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start your own shelf" })).toHaveAttribute("href", "/register?ref=loan");
  await expect(page.getByText("Keep track of your own books.")).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  const tap = page.getByRole("button", { name: "I’ve given it back" });
  await tap.dblclick();
  await expect(page.getByText("Thanks! Rae will see that it’s back.")).toBeVisible();
  await expect(tap).toHaveCount(0);
  expect(state.backCalls).toBe(1);
  expect(JSON.stringify(state.requests)).not.toMatch(/person_name|borrower/);
  await page.reload();
  await expect(page.getByText("Thanks! Rae will see that it’s back.")).toBeVisible();
});

test("a closed loan says so; an unknown link shows the not-found page", async ({ page }) => {
  await mock(page, { signedIn: false, publicLoan: publicLoan({ state: "closed" }) });
  await page.goto("/l/the-token");
  await expect(page.getByText("This loan is closed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "I’ve given it back" })).toHaveCount(0);
  const other = await page.context().newPage();
  await mock(other, { signedIn: false, publicStatus: 404 });
  await other.goto("/l/the-token");
  await expect(other.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
});

for (const [name, width, height] of [["390", 390, 844], ["1440", 1440, 900]]) {
  for (const theme of ["light", "dark"]) {
    test(`layout shots at ${name} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme });
      await mock(page, { loans: [lent({ has_link: true }), borrowed()] });
      await page.goto("/book/5");
      await expect(block(page).locator(".bv-loan-card")).toHaveCount(2);
      expect(await page.evaluate(() => [...document.querySelectorAll("body *")].filter(node => node.getBoundingClientRect().right > window.innerWidth + 1).map(node => `${node.tagName}.${node.className}`).slice(0, 5))).toEqual([]);
      await block(page).screenshot({ path: `${SHOTS}/block-${name}-${theme}.png` });
      await block(page).getByRole("button", { name: /More actions for Lent to Sam/ }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.getByRole("dialog", { name: "Edit" })).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/sheet-${name}-${theme}.png` });
    });
  }
}

test("the reading page carries the loan block above About this book", async ({ page }) => {
  await mock(page, { loans: [lent({ has_link: true })] });
  await page.goto("/my-books/50");
  await expect(block(page).getByText("Lent to Sam", { exact: true })).toBeVisible();
  const loanTop = (await block(page).boundingBox()).y, aboutTop = (await page.getByText("About this book", { exact: true }).first().boundingBox()).y;
  expect(loanTop).toBeLessThan(aboutTop);
});

test("320px at 200% text: nothing runs off the page, with the block and an open sheet", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mock(page, { loans: [lent({ has_link: true, person_name: "Bartholomew Longname" }), borrowed()] });
  await page.goto("/book/5");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(block(page).locator(".bv-loan-card")).toHaveCount(2);
  const wide = () => page.evaluate(() => [...document.querySelectorAll("body *")].filter(node => !node.closest("dialog:not([open])") && node.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(node).position !== "fixed").map(node => `${node.tagName}.${node.className}`).slice(0, 5));
  expect(await wide()).toEqual([]);
  await block(page).getByRole("button", { name: /More actions for Lent to/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.waitForTimeout(400);
  expect(await wide()).toEqual([]);
  await expect(page.getByRole("dialog", { name: "Edit" }).getByRole("button", { name: "Save" })).toBeVisible();
});

test("the keyboard alone can lend: Enter opens the sheet, the name field has focus, Enter saves", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/book/5");
  await block(page).getByRole("button", { name: "Lend this book" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Who’s borrowing it?")).toBeFocused();
  await page.keyboard.type("Kim");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Want Kim to have a link to it?")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.requests.filter(request => request.method === "POST" && request.path === "/me/loans")).toHaveLength(1);
});

test("the borrower's page says A reader when the lender has no first name", async ({ page }) => {
  await mock(page, { signedIn: false, publicLoan: publicLoan({ lender_first_name: null }) });
  await page.goto("/l/the-token");
  await expect(page.getByText("A reader lent you this on 3 Dec.")).toBeVisible();
  await page.getByRole("button", { name: "I’ve given it back" }).click();
  await expect(page.getByText("Thanks! A reader will see that it’s back.")).toBeVisible();
});
