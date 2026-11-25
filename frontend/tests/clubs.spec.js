import { expect, sent, test, TOKEN } from "./support/clubsFixture.js";

// Clubs: the list, the invite page and the layout. The club page itself is in clubs-page.spec.js. Browser fixtures only (support/clubsFixture.js).

// ---- the list ---------------------------------------------------------------------------------------------------------

test("the clubs list is at /clubs and shows each club with its book, next checkpoint and the reader's page", async ({ page, app: _app }) => {
  await page.goto("/clubs");
  await expect(page.getByRole("heading", { name: "Your clubs", level: 1 })).toBeVisible();
  const card = page.locator(".bv-club-card");
  await expect(card).toContainText("Tuesday Readers");
  await expect(card).toContainText("8 members · Now reading Middlemarch");
  await expect(card).toContainText("Read to p. 240 by Sat 5 Dec · you’re on p. 212");
  await expect(card).toHaveAttribute("href", "/clubs/5");
});

test("with no clubs the list says what clubs are, and Start a club makes one and opens it", async ({ page, app }) => {
  app.clubs = [];
  await page.goto("/clubs");
  await expect(page.getByText("Read together with friends.", { exact: true })).toBeVisible();
  await expect(page.getByText("Clubs are private and invite-only.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a club" })).toHaveCount(1);
  await page.getByRole("button", { name: "Start a club" }).click();
  const sheet = page.getByRole("dialog", { name: "Start a club" });
  await sheet.getByLabel("Club name").fill("Office Sci-Fi");
  await expect(sheet.getByText("Add a description and colour later in Edit club.", { exact: true })).toBeVisible();
  await expect(sheet.getByLabel("What’s it about? (optional)")).toHaveCount(0);
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/6$/);
  expect(sent(app, "POST", "/me/clubs")[0].body).toEqual({ name: "Office Sci-Fi" });
  await expect(page.getByRole("heading", { name: "Office Sci-Fi", level: 1 })).toBeVisible();
});

// ---- the join page --------------------------------------------------------------------------------------------------------

test.describe("join page", () => {
  test("signed out: who invited you, the club, the book, Sign up to join, Sign in; no header navigation, no footer, and kept out of search", async ({ page, app }) => {
    app.guest = true;
    await page.goto(`/c/${TOKEN}`);
    await expect(page.getByText("Rae invited you to join", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
    await expect(page.getByText("8 members · private, invite-only", { exact: true })).toBeVisible();
    await expect(page.getByText("Now reading", { exact: true })).toBeVisible();
    await expect(page.locator(".bv-club-author")).toHaveText("George Eliot");
    const here = encodeURIComponent(`/c/${TOKEN}`);
    await expect(page.getByRole("link", { name: "Sign up to join" })).toHaveAttribute("href", `/register?ref=club&returnTo=${here}`);
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", `/login?returnTo=${here}`);
    await expect(page.getByText("Already have an account?")).toBeVisible();
    await expect(page.getByText("Clubs are private. Only members can see the discussion.", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    expect(app.requests.some(request => request.path.startsWith("/me/"))).toBe(false);
  });

  test("signed in: Join the club joins and adds the book to the shelf when the box is ticked, then opens the club", async ({ page, app }) => {
    await page.goto(`/c/${TOKEN}`);
    const box = page.getByRole("checkbox", { name: "Add Middlemarch to my shelf" });
    await expect(box).toBeChecked();
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page).toHaveURL(/\/clubs\/5$/);
    expect(sent(app, "POST", "/me/clubs/join")[0].body).toEqual({ token: TOKEN });
    expect(sent(app, "PUT", "/me/library/books/1")[0].body).toEqual({ is_wanted: true });
  });

  test("an unticked box joins without touching the shelf", async ({ page, app }) => {
    await page.goto(`/c/${TOKEN}`);
    await page.getByRole("checkbox", { name: "Add Middlemarch to my shelf" }).uncheck();
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page).toHaveURL(/\/clubs\/5$/);
    expect(sent(app, "PUT", "/me/library/books/1")).toHaveLength(0);
  });

  test("a full club says so, and a club that fills while you read says so too", async ({ page, app }) => {
    app.preview = { ...app.preview, full: true };
    await page.goto(`/c/${TOKEN}`);
    await expect(page.getByText("This club is full right now.", { exact: true })).toBeVisible();
    await expect(page.getByText("Ask Rae to make room.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join the club" })).toHaveCount(0);
    app.preview = { ...app.preview, full: false }; app.joinStatus = 409;
    await page.goto(`/c/${TOKEN}`);
    await page.getByRole("button", { name: "Join the club" }).click();
    await expect(page.getByText("This club is full right now.", { exact: true })).toBeVisible();
  });

  test("a bad or expired link shows the not-found page", async ({ page, app: _app }) => {
    await page.goto(`/c/${"x".repeat(24)}`);
    await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
  });
});

// ---- layout ---------------------------------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"]) for (const [width, height] of [[390, 844], [1440, 1000]]) {
  test(`the clubs screens do not scroll sideways at ${width}px; ${scheme}`, async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), scheme);
    await page.setViewportSize({ width, height });
    const shots = process.env.CLUBS_SHOTS;
    const check = async (path, name, ready) => {
      await page.goto(path);
      await ready();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} scrolls sideways`).toBe(true);
      if (shots) await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
    };
    await check("/clubs", "list", () => expect(page.locator(".bv-club-card")).toContainText("Next: p. 240"));
    await check("/clubs/5", "club", () => expect(page.locator(".bv-club-week")).toBeVisible());
    app.guest = true;
    await check(`/c/${TOKEN}`, "join", () => expect(page.getByRole("link", { name: "Sign up to join" })).toBeVisible());
  });
}
