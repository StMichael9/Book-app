import { expect, sent, test } from "./support/clubsFixture.js";

// Club meetings, RSVPs and the vote on the next book. Browser fixtures only: the endpoints are mocked exactly as
// .local-dev/handoffs/clubs-meetings-votes-contract.md words them. The reader's timezone is fixed so the date reads the same everywhere.
test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC", locale: "en-GB" });

const meeting = (extra = {}) => ({ id: 21, starts_at: "2030-12-05T19:00:00Z", place: "Ana’s place, 12 Mill Lane", link: null, questions: [], counts: { going: 6, maybe: 2, no: 1 }, my_rsvp: null, ...extra });
const suggestion = (id, title, votes, extra = {}) => ({ id, book: { id, title, authors: ["An Author"], cover_image_url: null, page_count: 300 }, suggested_by: { name: "Ana" }, note: null, votes, my_vote: false, mine: false, ...extra });
const week = page => page.locator(".bv-club-week");
const card = page => page.getByRole("region", { name: "Next meeting" });

// ---- The meeting card ---------------------------------------------------------------------------------------------------

test("the meeting card shows when, where and the counts, leaving out the parts that are zero", async ({ page, app }) => {
  app.meeting = meeting();
  await page.goto("/clubs/5");
  await expect(card(page).getByRole("heading", { name: "Next meeting" })).toBeVisible();
  await expect(card(page).getByText("Thu 5 Dec, 7:00 pm", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Ana’s place, 12 Mill Lane", { exact: true })).toBeVisible();
  await expect(card(page).getByText("6 going · 2 maybe", { exact: true })).toBeVisible();
  app.meeting = meeting({ counts: { going: 3, maybe: 0, no: 4 } });
  await page.goto("/clubs/5");
  await expect(card(page).getByText("3 going", { exact: true })).toBeVisible();
  app.meeting = meeting({ counts: { going: 0, maybe: 0, no: 2 } });
  await page.goto("/clubs/5");
  await expect(card(page).locator(".bv-club-group")).toHaveCount(0);
});

test("a meeting with only a video link says Video call and offers Join call", async ({ page, app }) => {
  app.meeting = meeting({ place: null, link: "https://meet.example.com/abc" });
  await page.goto("/clubs/5");
  await expect(card(page).getByText("Video call", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("link", { name: "Join call" })).toHaveAttribute("href", "https://meet.example.com/abc");
});

test("the reading line says by the meeting when the part's date is the meeting's date, and the usual date otherwise", async ({ page, app }) => {
  app.meeting = meeting({ starts_at: "2026-12-05T19:00:00Z" });
  await page.goto("/clubs/5");
  await expect(week(page).getByText("Read to p. 240 by the meeting", { exact: true })).toBeVisible();
  app.meeting = meeting();
  await page.goto("/clubs/5");
  await expect(week(page).getByText("Read to p. 240 by Sat 5 Dec", { exact: true })).toBeVisible();
});

test("Add to calendar is a download link to the meeting's .ics", async ({ page, app }) => {
  app.meeting = meeting();
  await page.goto("/clubs/5");
  const link = card(page).getByRole("link", { name: "Add to calendar" });
  await expect(link).toHaveAttribute("download", "");
  await expect(link).toHaveAttribute("href", /\/clubs\/5\/meetings\/21\.ics$/);
});

// ---- RSVP ---------------------------------------------------------------------------------------------------------------

test("your answer is a radio group: choosing sends PUT, the counts follow, and the arrow keys move the choice", async ({ page, app }) => {
  app.meeting = meeting();
  await page.goto("/clubs/5");
  const group = card(page).getByRole("radiogroup");
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
  await group.getByRole("radio", { name: "Going" }).check({ force: true });
  await expect.poll(() => sent(app, "PUT", "/clubs/5/meetings/21/rsvp").map(request => request.body)).toEqual([{ status: "going" }]);
  await expect(card(page).getByText("7 going · 2 maybe", { exact: true })).toBeVisible();
  await group.getByRole("radio", { name: "Going" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Maybe" })).toBeChecked();
  await expect.poll(() => sent(app, "PUT", "/clubs/5/meetings/21/rsvp").map(request => request.body.status)).toEqual(["going", "maybe"]);
  await expect(card(page).getByText("6 going · 3 maybe", { exact: true })).toBeVisible();
});

test("a failed answer goes back to what it was, with the save error", async ({ page, app }) => {
  app.meeting = meeting({ my_rsvp: "going" });
  app.failRsvp = true;
  await page.goto("/clubs/5");
  const group = card(page).getByRole("radiogroup");
  await expect(group.getByRole("radio", { name: "Going" })).toBeChecked();
  await group.getByRole("radio", { name: "Can’t make it" }).check({ force: true });
  await expect(card(page).getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
  await expect(group.getByRole("radio", { name: "Going" })).toBeChecked();
  await expect(card(page).getByText("6 going · 2 maybe", { exact: true })).toBeVisible();
});

// ---- Plan the meeting ---------------------------------------------------------------------------------------------------

test("owners and admins plan the meeting: a link goes as link, anything else as place, with the questions one per line", async ({ page, app }) => {
  app.meeting = null;
  await page.goto("/clubs/5");
  await page.getByRole("button", { name: "Plan the meeting" }).click();
  const sheet = page.getByRole("dialog", { name: "Plan the meeting" });
  await expect(sheet.getByRole("button", { name: "Save meeting" })).toBeDisabled();
  await sheet.getByLabel("Date").fill("2030-12-05");
  await sheet.getByLabel("Time").fill("19:00");
  await sheet.getByLabel("Where").fill("https://meet.example.com/abc");
  await sheet.getByLabel("Questions (optional)").fill("Why does Dorothea marry Casaubon?\n\nWho do you trust most?");
  await sheet.getByRole("button", { name: "Save meeting" }).click();
  await expect(sheet).toHaveCount(0);
  expect(sent(app, "POST", "/clubs/5/meetings")[0].body).toEqual({ starts_at: "2030-12-05T19:00:00.000Z", link: "https://meet.example.com/abc", questions: ["Why does Dorothea marry Casaubon?", "Who do you trust most?"] });
  await expect(card(page).getByText("Video call", { exact: true })).toBeVisible();
  app.meeting = null;
  await page.goto("/clubs/5");
  await page.getByRole("button", { name: "Plan the meeting" }).click();
  await page.getByLabel("Date").fill("2030-12-06");
  await page.getByLabel("Time").fill("18:30");
  await page.getByLabel("Where").fill("Ana’s place");
  await page.getByRole("button", { name: "Save meeting" }).click();
  await expect.poll(() => sent(app, "POST", "/clubs/5/meetings").length).toBe(2);
  expect(sent(app, "POST", "/clubs/5/meetings")[1].body).toEqual({ starts_at: "2030-12-06T18:30:00.000Z", place: "Ana’s place", questions: [] });
});

test("Edit meeting (in the club menu, only when there is one) opens the same sheet and sends PATCH", async ({ page, app }) => {
  app.meeting = null;
  await page.goto("/clubs/5");
  await page.getByRole("button", { name: "More actions for this club" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit meeting" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  app.meeting = meeting({ questions: ["One?"] });
  await page.goto("/clubs/5");
  await page.getByRole("button", { name: "More actions for this club" }).click();
  await page.getByRole("menuitem", { name: "Edit meeting" }).click();
  const sheet = page.getByRole("dialog", { name: "Plan the meeting" });
  await expect(sheet.getByLabel("Date")).toHaveValue("2030-12-05");
  await expect(sheet.getByLabel("Time")).toHaveValue("19:00");
  await expect(sheet.getByLabel("Where")).toHaveValue("Ana’s place, 12 Mill Lane");
  await sheet.getByLabel("Time").fill("20:15");
  await sheet.getByRole("button", { name: "Save meeting" }).click();
  await expect(sheet).toHaveCount(0);
  expect(sent(app, "PATCH", "/clubs/5/meetings/21")[0].body).toEqual({ starts_at: "2030-12-05T20:15:00.000Z", place: "Ana’s place, 12 Mill Lane", link: null, questions: ["One?"] });
});

test("a second meeting is refused with the save error (meeting_exists)", async ({ page, app }) => {
  app.meeting = null;
  await page.goto("/clubs/5");
  await page.getByRole("button", { name: "Plan the meeting" }).click();
  app.meeting = meeting();
  const sheet = page.getByRole("dialog", { name: "Plan the meeting" });
  await sheet.getByLabel("Date").fill("2030-12-05");
  await sheet.getByLabel("Time").fill("19:00");
  await sheet.getByRole("button", { name: "Save meeting" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
});

test("members don't see the plan or edit controls, and the meeting card still shows", async ({ page, app }) => {
  app.myRole = "member"; app.meeting = null;
  await page.goto("/clubs/5");
  await expect(page.getByRole("button", { name: "Plan the meeting" })).toHaveCount(0);
  app.meeting = meeting();
  await page.goto("/clubs/5");
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "More actions for this club" })).toHaveCount(0);
});

// ---- Questions, Members, the list -----------------------------------------------------------------------------------------

test("For the meeting shows the questions above the posts, and only when there are some", async ({ page, app }) => {
  app.meeting = meeting({ questions: ["Why does Dorothea marry Casaubon?", "Who do you trust most?"] });
  await page.goto("/clubs/5");
  const questions = page.getByRole("region", { name: "For the meeting" });
  await expect(questions.locator("li")).toHaveText(["Why does Dorothea marry Casaubon?", "Who do you trust most?"]);
  const above = await page.evaluate(() => document.querySelector(".bv-club-questions").getBoundingClientRect().bottom <= document.querySelector(".bv-club-posts").getBoundingClientRect().top);
  expect(above).toBe(true);
  app.meeting = meeting({ questions: [] });
  await page.goto("/clubs/5");
  await expect(page.getByRole("heading", { name: "For the meeting" })).toHaveCount(0);
});

test("Members shows each answer in the same words, and nothing when there's no reply", async ({ page, app }) => {
  app.meeting = meeting(); app.rsvps = ["going", "maybe", "no"];
  await page.goto("/clubs/5?tab=members");
  const rows = page.locator(".bv-club-members > li");
  await expect(rows.nth(0)).toContainText("Going");
  await expect(rows.nth(1)).toContainText("Maybe");
  await expect(rows.nth(2)).toContainText("Can’t make it");
  await expect(rows.nth(3).locator(".bv-club-rsvp")).toHaveCount(0);
});

test("the clubs list card starts its line with the meeting's date", async ({ page, app }) => {
  app.meetingAt = "2030-12-05T19:00:00Z";
  await page.goto("/clubs");
  await expect(page.locator(".bv-club-card")).toContainText("Thu 5 Dec · Read to p. 240");
});

// ---- Choose the next book -----------------------------------------------------------------------------------------------

test("Choose the next book lists suggestions with votes; Vote and Voted toggle, sending PUT then DELETE", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4), suggestion(62, "Dune", 1)];
  await page.goto("/clubs/5?tab=books");
  const choose = page.getByRole("region", { name: "Choose the next book" });
  await expect(choose.locator(".bv-club-suggestion").first()).toContainText("The Hobbit");
  await expect(choose.getByText("An Author · 4 votes")).toBeVisible();
  await expect(choose.getByText("An Author · 1 vote", { exact: true })).toBeVisible();
  await choose.getByRole("button", { name: /^Vote: The Hobbit/ }).click();
  await expect(choose.getByRole("button", { name: /^Voted: The Hobbit/ })).toHaveAttribute("aria-pressed", "true");
  await expect(choose.getByText("An Author · 5 votes")).toBeVisible();
  expect(sent(app, "PUT", "/clubs/5/suggestions/61/vote")).toHaveLength(1);
  await choose.getByRole("button", { name: /^Voted: The Hobbit/ }).click();
  await expect(choose.getByRole("button", { name: /^Vote: The Hobbit/ })).toHaveAttribute("aria-pressed", "false");
  expect(sent(app, "DELETE", "/clubs/5/suggestions/61/vote")).toHaveLength(1);
});

test("a failed vote goes back with the save error", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4)]; app.failVote = true;
  await page.goto("/clubs/5?tab=books");
  const choose = page.getByRole("region", { name: "Choose the next book" });
  await choose.getByRole("button", { name: /^Vote: The Hobbit/ }).click();
  await expect(choose.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
  await expect(choose.getByText("An Author · 4 votes")).toBeVisible();
});

test("Suggest a book uses the Add a book search and posts a suggestion, not a club book; its 409s show the save error", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4)];
  await page.goto("/clubs/5?tab=books");
  await page.getByRole("button", { name: "Suggest a book" }).click();
  const sheet = page.getByRole("dialog", { name: "Suggest a book" });
  await sheet.getByLabel("Search books").fill("remains");
  await sheet.getByRole("button", { name: /The Remains of the Day/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(sent(app, "POST", "/clubs/5/suggestions")[0].body).toEqual({ book_id: 4 });
  expect(sent(app, "POST", "/clubs/5/books")).toHaveLength(0);
  await expect(page.getByRole("region", { name: "Choose the next book" }).locator(".bv-club-suggestion", { hasText: "The Remains of the Day" })).toBeVisible();
  for (const code of ["already_suggested", "on_club_shelf"]) {
    app.suggestError = code;
    await page.getByRole("button", { name: "Suggest a book" }).click();
    const again = page.getByRole("dialog", { name: "Suggest a book" });
    await again.getByLabel("Search books").fill("emma");
    await again.getByRole("button", { name: /Emma/ }).click();
    await expect(again.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
    await page.keyboard.press("Escape");
    await expect(again).toHaveCount(0);
  }
});

test("Close the vote (owners and admins) asks first, then says what's up next; members don't see it", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4), suggestion(62, "Dune", 1)];
  await page.goto("/clubs/5?tab=books");
  await page.getByRole("button", { name: "Close the vote" }).click();
  const ask = page.getByRole("dialog", { name: "Close the vote" });
  await ask.getByRole("button", { name: "Cancel" }).click();
  expect(sent(app, "POST", "/clubs/5/suggestions/close")).toHaveLength(0);
  await page.getByRole("button", { name: "Close the vote" }).click();
  await page.getByRole("dialog", { name: "Close the vote" }).getByRole("button", { name: "Close the vote", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Up next: The Hobbit. Chosen with 4 votes." })).toBeVisible();
  expect(sent(app, "POST", "/clubs/5/suggestions/close")).toHaveLength(1);
  app.myRole = "member"; app.suggestions = [suggestion(62, "Dune", 1)];
  await page.goto("/clubs/5?tab=books");
  await expect(page.getByRole("region", { name: "Choose the next book" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close the vote" })).toHaveCount(0);
});

test("a suggestion can be removed from its row's menu by the suggester and by moderators, not by other members", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4, { mine: true }), suggestion(62, "Dune", 1)];
  app.myRole = "member";
  await page.goto("/clubs/5?tab=books");
  await expect(page.getByRole("button", { name: "More actions for The Hobbit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More actions for Dune" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for The Hobbit" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect.poll(() => sent(app, "DELETE", "/clubs/5/suggestions/61").length).toBe(1);
  await expect(page.getByText("The Hobbit", { exact: true })).toHaveCount(0);
});

test("on desktop the vote also sits beside the Discussion tab", async ({ page, app }) => {
  app.suggestions = [suggestion(61, "The Hobbit", 4)];
  await page.goto("/clubs/5");
  await expect(page.getByRole("region", { name: "Choose the next book" })).toBeVisible();
  const [posts, vote] = await page.evaluate(() => [document.querySelector(".bv-club-discussion").getBoundingClientRect().left, document.querySelector(".bv-club-choose").getBoundingClientRect().left]);
  expect(vote).toBeGreaterThan(posts + 300);
});

// ---- Layout -------------------------------------------------------------------------------------------------------------

test("at 1280 the meeting and reading cards sit side by side", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  app.meeting = meeting({ questions: ["One?"] }); app.suggestions = [suggestion(61, "The Hobbit", 4)];
  await page.goto("/clubs/5");
  await expect(card(page)).toBeVisible();
  const boxes = await page.evaluate(() => ["#bv-club-meeting-h", ".bv-club-week"].map(selector => { const box = document.querySelector(selector).closest("section").getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right }; }));
  expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left + 1);
  expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThan(4);
});

for (const width of [320, 390]) {
  test(`no sideways scroll at ${width}px, with the meeting and the vote, and at 200% text`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    app.meeting = meeting({ questions: ["Why does Dorothea marry Casaubon, of all the people she could have chosen?"] }); app.suggestions = [suggestion(61, "The Hobbit", 4, { mine: true }), suggestion(62, "A Very Long Title for a Book That Someone Suggested", 1)];
    for (const tab of ["discussion", "books", "members"]) {
      await page.goto(`/clubs/5?tab=${tab}`);
      await expect(card(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} at ${width}`).toBe(true);
    }
    await page.goto("/clubs/5?tab=books");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(card(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `200% at ${width}`).toBe(true);
  });
}
