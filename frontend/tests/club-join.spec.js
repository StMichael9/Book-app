import { expect, memberId, sent, test, TOKEN } from "./support/clubsFixture.js";

// Join a club by code or QR, From your shelves, the invite QR and code, and handing the club over. Browser fixtures only: the endpoints are mocked
// as .local-dev/handoffs/clubs-join-handover-contract.md words them.
test.use({ viewport: { width: 1440, height: 1000 } });

const WRONG = "That code doesn’t match a club. Check it with the person who invited you.";
const entry = (id, title, author) => ({ id: 800 + id, book_id: id, book: { id, title, authors: [{ id, name: author }], cover_image_url: null, page_count: 300 } });

// A camera with BarcodeDetector that reads QR codes: whatever the test pushes onto window.__codes.
const withQrCamera = page => page.addInitScript(() => {
  window.__codes = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#333"; setInterval(() => ctx.fillRect(0, 0, 640, 360), 100);
    const stream = canvas.captureStream(10), [track] = stream.getVideoTracks();
    track.getCapabilities = () => ({}); track.applyConstraints = async () => {};
    return stream;
  };
  window.BarcodeDetector = class { static async getSupportedFormats() { return ["qr_code"]; } async detect() { return window.__codes.splice(0).map(rawValue => ({ rawValue })); } };
});

// ---- Join a club --------------------------------------------------------------------------------------------------------

test("the list header and the empty page both offer Join a club, next to Start a club", async ({ page, app }) => {
  await page.goto("/clubs");
  await expect(page.getByRole("button", { name: "Join a club" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a club" })).toBeVisible();
  app.clubs = [];
  await page.goto("/clubs");
  await expect(page.getByText("Read together with friends.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join a club" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a club" })).toHaveClass(/bv-button--primary/);
});

test("a code (lowercase, with dashes) is looked up and goes on to the join page; a wrong one says so", async ({ page, app }) => {
  await page.goto("/clubs");
  await page.getByRole("button", { name: "Join a club" }).click();
  const sheet = page.getByRole("dialog", { name: "Join a club" });
  await expect(sheet.getByText("Or open the invite link you were sent.", { exact: true })).toBeVisible();
  await sheet.getByLabel("Invite code").fill("zzzzzz");
  await sheet.getByRole("button", { name: "Join", exact: true }).click();
  await expect(sheet.getByRole("alert")).toHaveText(WRONG);
  await sheet.getByLabel("Invite code").fill("k7m-4qx");
  await expect(sheet.getByLabel("Invite code")).toHaveValue("K7M-4QX");
  await sheet.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${TOKEN}$`));
  expect(app.requests.filter(request => request.path.startsWith("/club-invites/code/")).map(request => request.path)).toEqual(["/club-invites/code/ZZZZZZ", "/club-invites/code/K7M4QX"]);
});

test("Scan a QR code: a club link goes to the join page, anything else shows the wrong-code error", async ({ page, app: _app }) => {
  await withQrCamera(page);
  await page.goto("/clubs");
  await page.getByRole("button", { name: "Join a club" }).click();
  const sheet = page.getByRole("dialog", { name: "Join a club" });
  await sheet.getByRole("button", { name: "Scan a QR code" }).click();
  await expect(sheet.locator(".bv-scan-camera.is-on")).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => window.__codes.push("https://example.com/not-a-club"));
  await expect(sheet.getByRole("alert")).toHaveText(WRONG);
  await page.evaluate(token => window.__codes.push(`https://bookvane.me/c/${token}?ref=club`), TOKEN);
  await expect(page).toHaveURL(new RegExp(`/c/${TOKEN}$`));
});

// ---- The invite sheet ---------------------------------------------------------------------------------------------------

test("the invite sheet draws a QR code (an SVG) above Share invite link, and shows the code in large letters", async ({ page, app: _app }) => {
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: "Invite people" }).click();
  const sheet = page.getByRole("dialog", { name: "Invite people" });
  await sheet.getByRole("button", { name: "Share invite link" }).click();
  await expect(sheet.locator(".bv-club-qr svg")).toBeVisible({ timeout: 20000 });
  await expect(sheet.getByText("Invite code", { exact: true })).toBeVisible();
  await expect(sheet.locator(".bv-club-code")).toHaveText("K7M4QX");
  const order = await sheet.evaluate(node => { const qr = node.querySelector(".bv-club-qr"), button = [...node.querySelectorAll("button")].find(item => item.textContent === "Share invite link"); return qr.getBoundingClientRect().bottom <= button.getBoundingClientRect().top; });
  expect(order).toBe(true);
});

// ---- From your shelves --------------------------------------------------------------------------------------------------

for (const mode of ["add", "suggest"]) {
  test(`From your shelves lists up to five Want to read and Owned books before typing, and typing switches to search (${mode} mode)`, async ({ page, app }) => {
    app.shelfWant = [entry(1, "Middlemarch", "George Eliot"), entry(2, "Nineteen Eighty-Four", "George Orwell")];
    app.shelfOwned = [entry(3, "Emma", "Jane Austen"), entry(1, "Middlemarch", "George Eliot")];
    if (mode === "suggest") app.suggestions = [];
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: mode === "add" ? "Add a book" : "Suggest a book", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: mode === "add" ? "Add a book" : "Suggest a book" });
    await expect(sheet.getByRole("heading", { name: "From your shelves" })).toBeVisible();
    await expect(sheet.locator(".bv-club-shelves li")).toHaveCount(3);
    await expect(sheet.locator(".bv-club-shelves li").first()).toContainText("Want to read");
    await expect(sheet.locator(".bv-club-shelves li").nth(2)).toContainText("Owned");
    await sheet.getByLabel("Search books").fill("remains");
    await expect(sheet.getByRole("heading", { name: "From your shelves" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: /The Remains of the Day/ })).toBeVisible();
    await sheet.getByLabel("Search books").fill("");
    await sheet.getByRole("button", { name: /Emma/ }).click();
    if (mode === "suggest") { await expect.poll(() => sent(app, "POST", "/clubs/5/suggestions").map(request => request.body)).toEqual([{ book_id: 3 }]); }
    else await expect(page.getByRole("dialog", { name: "Emma" }).getByRole("button", { name: "Add to club" })).toBeVisible();
  });
}

// ---- Handing the club over ----------------------------------------------------------------------------------------------

test("an owner leaving must choose a successor (admins first); Leave and hand over is the green primary and sends successor_user_id", async ({ page, app }) => {
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: "Leave club", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Leave Tuesday Readers?" });
  await expect(sheet.getByText("Choose who runs the club after you.", { exact: true })).toBeVisible();
  const confirm = sheet.getByRole("button", { name: "Leave and hand over", exact: true });
  await expect(confirm).toHaveClass(/bv-button--primary/);
  await expect(confirm).toBeDisabled();
  await expect(sheet.getByRole("radio").first()).toHaveAccessibleName("Sam");
  await sheet.getByRole("radio", { name: "Ana" }).check({ force: true });
  await confirm.click();
  await expect(page).toHaveURL(/\/clubs$/);
  expect(sent(app, "POST", "/clubs/5/leave")[0].body).toEqual({ successor_user_id: memberId(1) });
});

test("a member leaving is unchanged (the plain confirm, no body), and an owner alone has no Leave", async ({ page, app }) => {
  app.myRole = "member";
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: "Leave club", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave Tuesday Readers?" }).getByRole("button", { name: "Leave club", exact: true }).click();
  await expect(page).toHaveURL(/\/clubs$/);
  expect(sent(app, "POST", "/clubs/5/leave")[0].body).toBeNull();
  app.myRole = "owner"; app.count = 1;
  await page.goto("/clubs/5?tab=members");
  await expect(page.getByRole("button", { name: "Leave club" })).toHaveCount(0);
});

test("Make owner (owners only) asks first, then calls transfer", async ({ page, app }) => {
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: /^Ana/ }).click();
  await page.getByRole("dialog", { name: "Ana" }).getByRole("button", { name: "Make owner", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Make Ana the owner?" });
  await expect(ask.getByText("You’ll stay in the club as an admin.", { exact: true })).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  expect(sent(app, "POST", "/clubs/5/transfer")).toHaveLength(0);
  await page.getByRole("dialog", { name: "Ana" }).getByRole("button", { name: "Make owner", exact: true }).click();
  await page.getByRole("dialog", { name: "Make Ana the owner?" }).getByRole("button", { name: "Make owner", exact: true }).click();
  await expect.poll(() => sent(app, "POST", "/clubs/5/transfer").map(request => request.body)).toEqual([{ user_id: memberId(1) }]);
});

// ---- Layout -------------------------------------------------------------------------------------------------------------

test("no sideways scroll at 320 with the join, invite, shelves and leave sheets open", async ({ page, app }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  app.shelfWant = [entry(1, "Middlemarch", "George Eliot")];
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.goto("/clubs");
  await page.getByRole("button", { name: "Join a club" }).click();
  expect(await fits()).toBe(true);
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: "Invite people" }).click();
  await page.getByRole("button", { name: "Share invite link" }).click();
  await expect(page.locator(".bv-club-qr svg")).toBeVisible({ timeout: 20000 });
  expect(await fits()).toBe(true);
  await page.goto("/clubs/5?tab=books");
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "From your shelves" })).toBeVisible();
  expect(await fits()).toBe(true);
  await page.goto("/clubs/5?tab=members");
  await page.getByRole("button", { name: "Leave club", exact: true }).click();
  expect(await fits()).toBe(true);
});
