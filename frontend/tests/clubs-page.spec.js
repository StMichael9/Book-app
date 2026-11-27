import { expect, memberId, sent, test } from "./support/clubsFixture.js";

// The club page (clubs redesign): This week, the setup card, three tabs, the owner and admin "…" menu, and the sheets behind them. Browser fixtures only.
test.use({ viewport: { width: 1440, height: 1000 } });

const tabs = page => page.getByRole("tablist", { name: "Club sections" });
const menu = async (page, name = "More actions for this club") => { await page.getByRole("button", { name }).click(); return page.getByRole("menu"); };
const items = async page => page.getByRole("menuitem").allTextContents();
const advances = app => app.requests.filter(request => request.method === "POST" && request.path.endsWith("/advance")).map(request => ({ path: request.path, body: request.body }));

// ---- This week ---------------------------------------------------------------------------------------------------------

const attemptAt = value => ({ id: "a1", state: "reading", started_on: "2026-11-14", ended_on: null, progress_unit: "pages", progress_value: value, total_pages: 880, note: null, reaction: null, updated_at: "2026-11-20T10:00:00Z" });

test("the header has the name and the member count only, and This week shows the book, the target, your page, the group and one primary button", async ({ page, app: _app }) => {
  await page.goto("/clubs/5");
  await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
  await expect(page.getByText("8 members", { exact: true })).toBeVisible();
  await expect(page.getByText("private, invite-only")).toHaveCount(0);
  const card = page.getByRole("region", { name: "This week" });
  await expect(card.locator(".bv-club-title")).toHaveText("Middlemarch");
  await expect(card.locator(".bv-club-author")).toHaveText("George Eliot");
  await expect(card.getByText("Read to p. 240 by Sat 5 Dec", { exact: true })).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "Reading progress for Middlemarch" })).toHaveAttribute("value", "24");
  await expect(card.getByText("You’re on p. 212.", { exact: true })).toBeVisible();
  await expect(card.getByText("1 member is past p. 240.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Update my page", exact: true })).toHaveClass(/bv-button--primary/);
});

test("a club with only you in it says so under its name", async ({ page, app }) => {
  app.count = 1;
  await page.goto("/clubs/5");
  await expect(page.getByText("Just you so far", { exact: true })).toBeVisible();
  await expect(page.getByText("1 member", { exact: true })).toHaveCount(0);
});

test("Update my page for a book on the shelf and being read opens ProgressBox in a sheet, saves, and refreshes the club and members", async ({ page, app }) => {
  await page.goto("/clubs/5");
  const clubReads = () => sent(app, "GET", "/clubs/5").length, memberReads = () => sent(app, "GET", "/clubs/5/members").length;
  await page.getByRole("region", { name: /^(This week|Now reading)$/ }).getByRole("button", { name: "Update my page", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Update my page" });
  await expect(sheet).toBeVisible();
  expect(sent(app, "PUT", "/me/library/books/1")).toHaveLength(0); // already on the shelf
  expect(app.requests.filter(request => request.method === "PUT" && request.path.startsWith("/me/reading-attempts/"))).toHaveLength(0);
  const before = [clubReads(), memberReads()];
  await sheet.getByLabel("Page or % for Middlemarch").fill("300");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && request.path.startsWith("/me/reading-attempts/")).length).toBe(1);
  expect(app.requests.find(request => request.method === "PATCH" && request.path.startsWith("/me/reading-attempts/")).body).toMatchObject({ progress_unit: "pages", progress_value: 300 });
  await expect.poll(() => [clubReads(), memberReads()]).toEqual([before[0] + 1, before[1] + 1]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("You’re on p. 300.", { exact: false })).toBeVisible();
});

test("a book on the shelf that isn't being read yet starts the reading when Update my page opens", async ({ page, app }) => {
  app.attempt = null;
  await page.goto("/clubs/5");
  await page.getByRole("region", { name: /^(This week|Now reading)$/ }).getByRole("button", { name: "Update my page", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Update my page" }).getByLabel("Page or % for Middlemarch")).toBeVisible();
  expect(app.requests.filter(request => request.method === "PUT" && request.path.startsWith("/me/reading-attempts/"))).toHaveLength(1);
  expect(sent(app, "PUT", "/me/library/books/1")).toHaveLength(0);
});

test("a book that isn't on your shelf asks to be added first: one primary button, no progress, and then Update my page appears", async ({ page, app }) => {
  app.entryId = null; app.attempt = null;
  await page.goto("/clubs/5");
  const card = page.getByRole("region", { name: "This week" });
  await expect(card.getByText("Add it to your shelf to track your page.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Update my page" })).toHaveCount(1); // a quiet link, not a second primary
  await expect(card.locator(".bv-club-primary")).toHaveCount(1);
  await expect(card.getByRole("link", { name: "Middlemarch" })).toHaveAttribute("href", "/book/1");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await card.getByRole("button", { name: "Add to my shelf", exact: true }).click();
  await expect.poll(() => sent(app, "PUT", "/me/library/books/1").length).toBe(1);
  await expect(card.getByRole("button", { name: "Update my page", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Add to my shelf" })).toHaveCount(0);
});

test("when you are at or past the part that's due: you're up to date, what's next, and Update my page is no longer the primary button", async ({ page, app }) => {
  app.myProgress = { state: "reading", unit: "pages", value: 250 };
  app.attempt = attemptAt(250);
  await page.goto("/clubs/5");
  const card = page.getByRole("region", { name: "This week" });
  await expect(card.getByText("You’re up to date", { exact: true })).toBeVisible();
  await expect(card.getByText("You’re on p. 250. Next: p. 380 by Sat 19 Dec.", { exact: true })).toBeVisible();
  await expect(card.getByText(/members? (is|are) past/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Update my page", exact: true })).not.toHaveClass(/bv-button--primary/);
});

test("with no reading plan the card is Now reading, with no target, and owners and admins can make a plan", async ({ page, app }) => {
  app.books[0].checkpoints = []; app.books[0].ends_on = null;
  await page.goto("/clubs/5");
  const card = page.getByRole("region", { name: "Now reading" });
  await expect(card.locator(".bv-club-title")).toHaveText("Middlemarch");
  await expect(card.getByText(/^Read to/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Make a reading plan" })).toHaveCount(0); // the setup card owns it
  await page.getByRole("region", { name: "Set up your club" }).getByRole("button", { name: "Make a reading plan", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Reading plan" })).toBeVisible();
  await page.keyboard.press("Escape");
  app.myRole = "member";
  await page.goto("/clubs/5");
  await expect(page.getByRole("region", { name: "Now reading" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make a reading plan" })).toHaveCount(0);
});

test("with no current book members see 'No book chosen yet.', and the Discussion tab says posts open once the club picks a book", async ({ page, app }) => {
  app.books = app.books.filter(book => book.status !== "current");
  app.myRole = "member";
  await page.goto("/clubs/5");
  await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
  await expect(page.getByText("No book chosen yet.", { exact: true })).toBeVisible();
  await expect(page.getByText("Posts open once the club picks a book.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update my page" })).toHaveCount(0);
});

// ---- the setup card (owners and admins) ----------------------------------------------------------------------------

test.describe("Set up your club", () => {
  const steps = page => page.getByRole("region", { name: "Set up your club" });
  test("a new club: three steps, only the first still to do has a button, and it is the one primary button", async ({ page, app }) => {
    app.count = 1; app.books = [];
    await page.goto("/clubs/5");
    const card = steps(page);
    await expect(card.getByRole("listitem")).toHaveText(["Choose the first book", "Plan the reading (optional)", "Invite your members"]);
    await expect(card.getByRole("button")).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Choose a book", exact: true })).toHaveClass(/bv-button--primary/);
    await expect(page.getByRole("region", { name: "This week" })).toHaveCount(0);
    await card.getByRole("button", { name: "Choose a book" }).click();
    await expect(page.getByRole("dialog", { name: "Add a book" })).toBeVisible();
  });

  test("with a book chosen the next step is the plan, then the invite; each ticks off as the data says it is done", async ({ page, app }) => {
    app.count = 1; app.books[0].checkpoints = []; app.books[0].ends_on = null;
    await page.goto("/clubs/5");
    const card = steps(page);
    await expect(card.locator("li.is-done")).toHaveText(["Choose the first book"]);
    await expect(card.getByRole("button")).toHaveCount(1);
    await card.getByRole("button", { name: "Make a reading plan", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Reading plan" })).toBeVisible();
    await page.keyboard.press("Escape");
    app.books[0].ends_on = "2027-01-02";
    await page.goto("/clubs/5");
    await expect(steps(page).locator("li.is-done")).toHaveText(["Choose the first book", "Plan the reading (optional)"]);
    await steps(page).getByRole("button", { name: "Invite people", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Invite people" })).toBeVisible();
  });

  test("it goes once all three are done, and members never see it", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await expect(page.getByRole("region", { name: "This week" })).toBeVisible();
    await expect(steps(page)).toHaveCount(0);
    app.count = 1; app.books[0].checkpoints = [];
    app.myRole = "member"; // a member of a one-person club cannot happen, but the card is for owners and admins only
    await page.goto("/clubs/5");
    await expect(steps(page)).toHaveCount(0);
  });
});

test("new posts show as \"{n} new\" on the list card and the Discussion tab, and nothing when there are none", async ({ page, app }) => {
  await page.goto("/clubs");
  await expect(page.locator(".bv-club-card")).not.toContainText("new");
  await page.goto("/clubs/5");
  await expect(tabs(page).getByRole("tab", { name: "Discussion", exact: true })).toBeVisible();
  app.newPosts = 3;
  await page.goto("/clubs");
  await expect(page.locator(".bv-club-card-name")).toContainText("3 new");
  await page.goto("/clubs/5");
  await expect(tabs(page).getByRole("tab", { name: "Discussion · 3 new", exact: true })).toBeVisible();
});

test("above the tabs there is at most one primary button and two other buttons, with and without the setup card", async ({ page, app }) => {
  const count = () => page.evaluate(() => {
    const top = document.querySelector('[role="tablist"]').getBoundingClientRect().top;
    const buttons = [...document.querySelectorAll("#bv-main button, #bv-main a.bv-button")].filter(node => node.getClientRects().length && node.getBoundingClientRect().bottom <= top + 1);
    return { primary: buttons.filter(node => node.classList.contains("bv-button--primary")).length, others: buttons.filter(node => !node.classList.contains("bv-button--primary")).length };
  });
  await page.goto("/clubs/5");
  await expect(page.getByRole("region", { name: "This week" })).toBeVisible();
  const full = await count();
  expect(full.primary).toBeLessThanOrEqual(1);
  expect(full.others).toBeLessThanOrEqual(2);
  app.count = 1; app.books[0].checkpoints = []; app.books[0].ends_on = null;
  await page.goto("/clubs/5");
  await expect(page.getByRole("region", { name: "Set up your club" })).toBeVisible();
  const setup = await count();
  expect(setup.primary).toBeLessThanOrEqual(1);
  expect(setup.others).toBeLessThanOrEqual(2);
  app.books = [];
  await page.goto("/clubs/5");
  await expect(page.getByRole("button", { name: "Choose a book" })).toBeVisible();
  const empty = await count();
  expect(empty.primary).toBeLessThanOrEqual(1);
  expect(empty.others).toBeLessThanOrEqual(2);
});

// ---- tabs ----------------------------------------------------------------------------------------------------------------

test("three tabs, Discussion by default; the arrow keys, Home and End move between them, and the tab is kept in ?tab=", async ({ page, app: _app }) => {
  await page.goto("/clubs/5");
  const list = tabs(page);
  await expect(list.getByRole("tab")).toHaveText(["Discussion", "Books", "Members"]);
  await expect(list.getByRole("tab", { name: "Discussion" })).toHaveAttribute("aria-selected", "true");
  await list.getByRole("tab", { name: "Discussion" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(list.getByRole("tab", { name: "Books" })).toBeFocused();
  await expect(page).toHaveURL(/\?tab=books$/);
  await page.keyboard.press("End");
  await expect(list.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?tab=members$/);
  await page.keyboard.press("ArrowRight");
  await expect(list.getByRole("tab", { name: "Discussion" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page).toHaveURL(/\?tab=discussion$/);
  await expect(page.getByRole("tabpanel")).toBeVisible();
  // The tab survives a reload, and an unknown one falls back to Discussion.
  await page.goto("/clubs/5?tab=members");
  await expect(tabs(page).getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/clubs/5?tab=nonsense");
  await expect(tabs(page).getByRole("tab", { name: "Discussion" })).toHaveAttribute("aria-selected", "true");
});

// ---- Discussion ---------------------------------------------------------------------------------------------------------

test.describe("Discussion", () => {
  const panel = page => page.getByRole("region", { name: "Discussion" });
  const postBy = (page, text) => panel(page).locator(".bv-club-post", { hasText: text });
  const postMenu = (page, text) => postBy(page, text).getByRole("button", { name: /More actions/ });

  test("posts show 'up to p. n'; the posts further on are one line with Update my page; there is one Write a post button", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await expect(panel(page).getByRole("button", { name: "Write a post", exact: true })).toBeVisible();
    await expect(panel(page).locator(".bv-club-locked")).toHaveText("2 posts unlock at p. 310. Update my page");
    await expect(panel(page).locator(".bv-club-post")).toHaveCount(2); // the locked and hidden ones draw no rows
    await expect(postBy(page, "Ana")).toContainText("up to p. 205 ·");
    await expect(panel(page).getByText("Unlocks at")).toHaveCount(0);
  });

  test("the locked-posts line opens Update my page in the same sheet as This week", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await panel(page).getByRole("button", { name: "Update my page" }).click();
    await expect(page.getByRole("dialog", { name: "Update my page" }).getByLabel("Page or % for Middlemarch")).toBeVisible();
  });

  test("one post further on reads in the singular; a post with no spoiler page says 'no spoilers'; with no posts the empty state shows", async ({ page, app }) => {
    app.posts = [{ id: 31, locked: true, unlocks_at: { unit: "pages", value: 310 }, author: { name: "Sam" }, created_at: "2026-11-20T10:00:00Z" },
      { id: 33, body: "For everyone.", author: { name: "Ana", initials: "A", patron: false }, mine: false, anchor: null, created_at: "2026-11-20T10:00:00Z", edited_at: null }];
    await page.goto("/clubs/5");
    await expect(panel(page).locator(".bv-club-locked")).toHaveText("1 post unlocks at p. 310. Update my page");
    await expect(postBy(page, "For everyone.")).toContainText("no spoilers ·");
    app.posts = [];
    await page.goto("/clubs/5");
    await expect(panel(page).getByText("No posts yet.", { exact: true })).toBeVisible();
  });

  test("Write a post: a labelled sheet; Spoilers up to page starts at your page, with its help line, and the post is sent with it", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Write a post" });
    await expect(sheet.getByLabel("Your post")).toHaveAttribute("placeholder", "What did you think?");
    await expect(sheet.getByLabel("Spoilers up to page")).toHaveValue("212");
    await expect(sheet.getByText("Hidden from anyone who hasn’t reached this page.", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("switch", { name: "No spoilers" })).not.toBeChecked();
    await expect(sheet.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
    await sheet.getByLabel("Your post").fill("Loving the Lydgate chapters.");
    await sheet.getByRole("button", { name: "Post", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent(app, "POST", "/clubs/5/books/11/posts")[0].body).toEqual({ body: "Loving the Lydgate chapters.", anchor_unit: "pages", anchor_value: 212 });
  });

  test("the No spoilers switch shows the post to everyone and greys out the page; a page left empty sends no anchor", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    let sheet = page.getByRole("dialog", { name: "Write a post" });
    await sheet.getByRole("switch", { name: "No spoilers" }).check({ force: true });
    await expect(sheet.getByLabel("Spoilers up to page")).toBeDisabled();
    await sheet.getByLabel("Your post").fill("For everyone.");
    await sheet.getByRole("button", { name: "Post", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    sheet = page.getByRole("dialog", { name: "Write a post" });
    await sheet.getByLabel("Spoilers up to page").fill("");
    await sheet.getByLabel("Your post").fill("No page.");
    await sheet.getByRole("button", { name: "Post", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent(app, "POST", "/clubs/5/books/11/posts").map(request => request.body)).toEqual([{ body: "For everyone.", anchor_unit: "pages", anchor_value: 0 }, { body: "No page." }]);
  });

  test("a member who hasn't started the book can post (page empty, or No spoilers) and sets their page from the club", async ({ page, app }) => {
    app.entryId = null; app.attempt = null; app.myProgress = null;
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Write a post" });
    await expect(sheet.getByLabel("Spoilers up to page")).toHaveValue("");
    await sheet.getByRole("switch", { name: "No spoilers" }).check({ force: true });
    await sheet.getByLabel("Your post").fill("Starting soon.");
    await sheet.getByRole("button", { name: "Post", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent(app, "POST", "/clubs/5/books/11/posts")[0].body).toEqual({ body: "Starting soon.", anchor_unit: "pages", anchor_value: 0 });
    const quiet = page.getByRole("region", { name: "This week" }).getByRole("button", { name: "Update my page" });
    expect(await quiet.evaluate(node => getComputedStyle(node).textDecorationLine)).not.toContain("underline"); // no underline at rest
    const title = page.getByRole("region", { name: "This week" }).getByRole("link", { name: "Middlemarch" });
    expect(await title.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("none");
    await title.hover();
    expect(await title.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("underline");
    await quiet.click();
    await expect(page.getByRole("dialog", { name: "Update my page" })).toBeVisible();
  });

  test("a page ahead of yours is refused with the existing line, and the sheet stays open", async ({ page, app }) => {
    app.aheadError = true;
    await page.goto("/clubs/5");
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Write a post" });
    await sheet.getByLabel("Spoilers up to page").fill("500");
    await sheet.getByLabel("Your post").fill("Too far");
    await sheet.getByRole("button", { name: "Post", exact: true }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Choose a page you’ve reached. You’re on p. 212.");
  });

  test("your own post has Edit post and Delete post; editing saves the text only; deleting asks first and Cancel does nothing", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await postMenu(page, "My own note.").click();
    await expect(page.getByRole("menuitem")).toHaveText(["Edit post", "Delete post"]);
    await page.getByRole("menuitem", { name: "Edit post" }).click();
    const edit = page.getByRole("dialog", { name: "Edit post" });
    await expect(edit.getByLabel("Your post")).toHaveValue("My own note.");
    await expect(edit.getByText("Spoilers up to p. 150", { exact: true })).toBeVisible();
    await edit.getByLabel("Your post").fill("My changed note.");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => sent(app, "PATCH", "/clubs/5/posts/29").map(request => request.body)).toEqual([{ body: "My changed note." }]);
    await expect(postBy(page, "My changed note.")).toBeVisible();
    await postMenu(page, "My changed note.").click();
    await page.getByRole("menuitem", { name: "Delete post" }).click();
    const ask = page.getByRole("dialog", { name: "Delete your post?" });
    await expect(ask.getByText("This can’t be undone.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent(app, "DELETE", "/clubs/5/posts/29")).toHaveLength(0);
    await postMenu(page, "My changed note.").click();
    await page.getByRole("menuitem", { name: "Delete post" }).click();
    await page.getByRole("dialog", { name: "Delete your post?" }).getByRole("button", { name: "Delete post", exact: true }).click();
    await expect.poll(() => sent(app, "DELETE", "/clubs/5/posts/29")).toHaveLength(1);
  });

  test("someone else's post can be reported, with an optional reason; the reason goes with the report and Reported. is announced", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5");
    await postMenu(page, "Ana").click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report post"]);
    await page.getByRole("menuitem", { name: "Report post" }).click();
    const sheet = page.getByRole("dialog", { name: "Report this post?" });
    await expect(sheet.getByText("Only the club’s owner and admins see reports.", { exact: true })).toBeVisible();
    await expect(sheet.getByLabel("Why? (optional)")).not.toHaveAttribute("placeholder", /./);
    await sheet.getByLabel("Why? (optional)").fill("Gives away the ending");
    await sheet.getByRole("button", { name: "Report", exact: true }).click();
    await expect(panel(page).getByRole("status")).toHaveText("Reported.");
    expect(sent(app, "POST", "/clubs/5/posts/30/report").map(request => request.body)).toEqual([{ reason: "Gives away the ending" }]);
    await postMenu(page, "Ana").click();
    await page.getByRole("menuitem", { name: "Report post" }).click();
    await page.getByRole("dialog", { name: "Report this post?" }).getByRole("button", { name: "Report", exact: true }).click();
    await expect.poll(() => sent(app, "POST", "/clubs/5/posts/30/report")).toHaveLength(2);
    expect(sent(app, "POST", "/clubs/5/posts/30/report")[1].body).toEqual({});
  });

  test("owners and admins can also Remove post on someone else's post, after asking; members cannot", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await postMenu(page, "Ana").click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report post", "Remove post"]);
    await page.getByRole("menuitem", { name: "Remove post" }).click();
    const ask = page.getByRole("dialog", { name: "Remove Ana’s post?" });
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent(app, "DELETE", "/clubs/5/posts/30")).toHaveLength(0);
    await postMenu(page, "Ana").click();
    await page.getByRole("menuitem", { name: "Remove post" }).click();
    await page.getByRole("dialog", { name: "Remove Ana’s post?" }).getByRole("button", { name: "Remove post", exact: true }).click();
    await expect.poll(() => sent(app, "DELETE", "/clubs/5/posts/30")).toHaveLength(1);
    app.myRole = "admin";
    await page.goto("/clubs/5");
    await postMenu(page, "My own note.").click();
    await expect(page.getByRole("menuitem")).toHaveText(["Edit post", "Delete post"]);
  });

  test("Older posts loads the next page of posts and then goes", async ({ page, app }) => {
    app.older = [{ id: 20, body: "An older post.", author: { name: "Ana", initials: "A", patron: false }, mine: false, anchor: { unit: "pages", value: 90 }, created_at: "2026-11-10T10:00:00Z", edited_at: null }];
    await page.goto("/clubs/5");
    await expect(panel(page).locator(".bv-club-post")).toHaveCount(2);
    await panel(page).getByRole("button", { name: "Older posts" }).click();
    await expect(postBy(page, "An older post.")).toContainText("up to p. 90");
    await expect(panel(page).getByRole("button", { name: "Older posts" })).toHaveCount(0);
  });
});

// ---- Books -------------------------------------------------------------------------------------------------------------------

test.describe("Books tab", () => {
  const titleLinks = panel => panel.locator(".bv-club-title a").evaluateAll(nodes => nodes.map(node => [node.textContent, node.getAttribute("href")]));

  test("owners see one primary Add a book, then Now reading with its plan, Up next (several, dated or not) and Read together, newest first", async ({ page, app: _app }) => {
    await page.goto("/clubs/5?tab=books");
    const panel = page.getByRole("region", { name: "Books" });
    await expect(panel.locator(".bv-button--primary")).toHaveText("Add a book");
    const order = await panel.locator(".bv-club-label").allTextContents();
    expect(order).toEqual(["Now reading", "Up next", "Read together"]);
    await expect(panel.getByRole("region", { name: "Now reading" }).locator(".bv-club-author")).toHaveText("George Eliot");
    await expect(panel.locator(".bv-club-plan")).toHaveText("p. 100 by 21 Nov · p. 240 by 5 Dec · p. 380 by 19 Dec · end 2 Jan");
    await expect(panel.locator(".bv-club-plan b")).toHaveText("p. 240 by 5 Dec");
    const up = panel.getByRole("region", { name: "Up next" });
    await expect(up.locator(".bv-club-book")).toHaveCount(2);
    await expect(up.locator(".bv-club-book").nth(0)).toContainText("From 2 Jan");
    await expect(up.locator(".bv-club-book").nth(1)).toContainText("The Remains of the Day");
    await expect(up.locator(".bv-club-book").nth(1)).toContainText("No date yet");
    const past = panel.getByRole("region", { name: "Read together" });
    await expect(past.locator(".bv-club-book")).toHaveText([/Emma\s*Oct 2026/, /Persuasion\s*Aug 2026/]);
    expect(await titleLinks(panel)).toEqual([["Middlemarch", "/book/1"], ["Nineteen Eighty-Four", "/book/2"], ["The Remains of the Day", "/book/4"], ["Emma", "/book/3"], ["Persuasion", "/book/5"]]);
  });

  test("members see the same sections with no Add and no menus, and the titles still open the book page", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5?tab=books");
    const panel = page.getByRole("region", { name: "Books" });
    await expect(panel.getByRole("region", { name: "Now reading" })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Up next" })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Read together" })).toBeVisible();
    await expect(panel.getByRole("button")).toHaveCount(0);
    expect((await titleLinks(panel)).map(pair => pair[1])).toEqual(["/book/1", "/book/2", "/book/4", "/book/3", "/book/5"]);
    await panel.getByRole("link", { name: "Emma" }).click();
    await expect(page).toHaveURL(/\/book\/3$/);
  });

  test("each book has one menu: Now reading, Up next and Read together hold their own actions", async ({ page, app: _app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    expect(await items(page)).toEqual(["Edit reading plan", "Finish this book", "Remove book"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions for Nineteen Eighty-Four" }).click();
    expect(await items(page)).toEqual(["Start reading now", "Remove book"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions for Emma" }).click();
    expect(await items(page)).toEqual(["Remove from history"]);
  });

  // ---- Add a book ----

  test("Add a book with the club reading nothing: search, then Read it now (the default) and Add to club; the reading plan opens filled in", async ({ page, app }) => {
    app.books = app.books.filter(book => book.status !== "current");
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "Add a book", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add a book" });
    await sheet.getByLabel("Search books").fill("remains");
    await sheet.getByRole("button", { name: /The Remains of the Day/ }).click();
    const step = page.getByRole("dialog", { name: "The Remains of the Day" });
    await expect(step.getByRole("radio", { name: "Read it now" })).toBeChecked();
    await expect(step.getByRole("radio", { name: "Read it next" })).not.toBeChecked();
    await expect(step.getByText("Read it now shows only")).toHaveCount(0);
    await step.getByRole("button", { name: "Add to club", exact: true }).click();
    expect(sent(app, "POST", "/clubs/5/books")[0].body).toEqual({ book_id: 4, status: "current", starts_on: "2026-11-22" });
    const plan = page.getByRole("dialog", { name: "Reading plan" });
    await expect(plan.getByLabel("Finish by")).toHaveValue("2026-12-20"); // four weeks from today
    await expect(plan.getByLabel("Split into")).toHaveValue("4");
    await expect(plan.locator("#bv-plan-parts option:checked")).toHaveText("4 parts");
    await expect(plan.locator(".bv-club-plan-preview li")).toHaveText([/Part 1\s*to p\. 65 by 29 Nov/, /Part 2\s*to p\. 129 by 6 Dec/, /Part 3\s*to p\. 194 by 13 Dec/, /Part 4\s*End by 20 Dec/]);
    await plan.getByRole("button", { name: "Save plan", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "POST" && request.path === "/clubs/5/books/13/checkpoints").map(request => request.body)).toEqual([
      { unit: "pages", value: 65, due_on: "2026-11-29" }, { unit: "pages", value: 129, due_on: "2026-12-06" }, { unit: "pages", value: 194, due_on: "2026-12-13" }]);
    expect(app.requests.filter(request => request.method === "PATCH" && request.path === "/clubs/5/books/13").map(request => request.body)).toEqual([{ ends_on: "2026-12-20" }]);
    await expect(page.getByRole("region", { name: "Now reading" }).locator(".bv-club-plan")).toContainText("end 20 Dec");
  });

  test("Skip for now leaves the new current book without a plan", async ({ page, app }) => {
    app.books = app.books.filter(book => book.status !== "current");
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "Add a book", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add a book" });
    await sheet.getByLabel("Search books").fill("remains");
    await sheet.getByRole("button", { name: /The Remains of the Day/ }).click();
    await page.getByRole("dialog", { name: "The Remains of the Day" }).getByRole("button", { name: "Add to club", exact: true }).click();
    await page.getByRole("dialog", { name: "Reading plan" }).getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Reading plan" })).toHaveCount(0);
    expect(app.requests.filter(request => request.path.includes("/checkpoints"))).toHaveLength(0);
    await expect(page.locator(".bv-club-week .bv-club-title")).toHaveText("The Remains of the Day");
  });

  test("while the club is reading something, the new book can only go next: no Read it now, and no plan sheet", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "Add a book", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add a book" });
    await sheet.getByLabel("Search books").fill("persuasion");
    await sheet.getByRole("button", { name: /Persuasion/ }).click();
    const step = page.getByRole("dialog", { name: "Persuasion" });
    await expect(step.getByRole("radio", { name: "Read it now" })).toHaveCount(0);
    await expect(step.getByRole("radio", { name: "Read it next" })).toBeChecked();
    await step.getByRole("button", { name: "Add to club", exact: true }).click();
    expect(sent(app, "POST", "/clubs/5/books")[0].body).toEqual({ book_id: 5, status: "upcoming" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // ---- the reading plan ----

  test("Edit reading plan starts from the saved plan, and Save plan replaces its checkpoints and the end date; Cancel does nothing", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Edit reading plan" }).click();
    const plan = page.getByRole("dialog", { name: "Reading plan" });
    await expect(plan.getByLabel("Finish by")).toHaveValue("2027-01-02");
    await expect(plan.getByLabel("Split into")).toHaveValue("4"); // three checkpoints and the end
    await plan.getByRole("button", { name: "Cancel" }).click();
    expect(app.requests.filter(request => request.path.includes("/checkpoints") || (request.method === "PATCH" && request.path.startsWith("/clubs/5/books/")))).toHaveLength(0);
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Edit reading plan" }).click();
    await page.getByRole("dialog", { name: "Reading plan" }).getByLabel("Split into").selectOption("2");
    await page.getByRole("dialog", { name: "Reading plan" }).getByRole("button", { name: "Save plan", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "DELETE" && /\/checkpoints\/\d+$/.test(request.path)).length).toBe(3);
    await expect.poll(() => app.requests.filter(request => request.method === "POST" && request.path === "/clubs/5/books/11/checkpoints").map(request => request.body.value)).toEqual([440]);
    await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && request.path === "/clubs/5/books/11").map(request => request.body)).toEqual([{ ends_on: "2027-01-02" }]);
  });

  test("the Reading plan item in the club menu opens the same sheet", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await menu(page);
    await page.getByRole("menuitem", { name: "Reading plan" }).click();
    await expect(page.getByRole("dialog", { name: "Reading plan" })).toBeVisible();
  });

  // ---- Finish this book ----

  test("Finish this book with a next book: it asks first, then makes the current book past and the next one current", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Finish this book" }).click();
    const ask = page.getByRole("dialog", { name: "Finish Middlemarch?" });
    await expect(ask.getByText("It moves to Read together. Nineteen Eighty-Four becomes the club’s book.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(advances(app)).toHaveLength(0);
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Finish this book" }).click();
    await page.getByRole("dialog", { name: "Finish Middlemarch?" }).getByRole("button", { name: "Finish book", exact: true }).click();
    await expect.poll(() => advances(app)).toEqual([{ path: "/clubs/5/books/11/advance", body: { next_club_book_id: 12 } }]);
    await expect(page.locator(".bv-club-week .bv-club-title")).toHaveText("Nineteen Eighty-Four");
    await expect(page.getByRole("region", { name: "Read together" }).locator(".bv-club-book").first()).toContainText("Middlemarch");
  });

  test("Finish this book with no next book says so, and only makes the book past", async ({ page, app }) => {
    app.books = app.books.filter(book => book.status !== "upcoming");
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Finish this book" }).click();
    const ask = page.getByRole("dialog", { name: "Finish Middlemarch?" });
    await expect(ask.getByText("It moves to Read together. No next book yet.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Finish book", exact: true }).click();
    await expect.poll(() => advances(app)).toEqual([{ path: "/clubs/5/books/11/advance", body: {} }]);
  });

  test("if finishing the book fails, the existing save error shows and the club is fetched again", async ({ page, app }) => {
    app.failAdvance = true;
    await page.goto("/clubs/5?tab=books");
    const reads = () => sent(app, "GET", "/clubs/5").length, before = reads();
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Finish this book" }).click();
    const ask = page.getByRole("dialog", { name: "Finish Middlemarch?" });
    await ask.getByRole("button", { name: "Finish book", exact: true }).click();
    await expect(ask.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
    await expect.poll(reads).toBeGreaterThan(before);
  });

  // ---- Start reading now ----

  test("Start reading now while another book is current asks to finish it first, then makes it past and the chosen book current", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for The Remains of the Day" }).click();
    await page.getByRole("menuitem", { name: "Start reading now" }).click();
    const ask = page.getByRole("dialog", { name: "Finish Middlemarch first?" });
    await expect(ask.getByText("Middlemarch moves to Read together, and The Remains of the Day becomes the club’s book.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(advances(app)).toHaveLength(0);
    await page.getByRole("button", { name: "More actions for The Remains of the Day" }).click();
    await page.getByRole("menuitem", { name: "Start reading now" }).click();
    await page.getByRole("dialog", { name: "Finish Middlemarch first?" }).getByRole("button", { name: "Finish and start", exact: true }).click();
    await expect.poll(() => advances(app)).toEqual([{ path: "/clubs/5/books/11/advance", body: { next_club_book_id: 14 } }]);
    await expect(page.locator(".bv-club-week .bv-club-title")).toHaveText("The Remains of the Day");
  });

  test("Start reading now with nothing current makes the book current at once, with no ask", async ({ page, app }) => {
    app.books = app.books.filter(book => book.status !== "current");
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Nineteen Eighty-Four" }).click();
    await page.getByRole("menuitem", { name: "Start reading now" }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && request.path.startsWith("/clubs/5/books/")).map(request => `${request.path} ${request.body.status}`)).toEqual(["/clubs/5/books/12 current"]);
    await expect(page.locator(".bv-club-week .bv-club-title")).toHaveText("Nineteen Eighty-Four");
  });

  test("if Finish and start fails, the save error shows and the club is fetched again", async ({ page, app }) => {
    app.failAdvance = true;
    await page.goto("/clubs/5?tab=books");
    const reads = () => sent(app, "GET", "/clubs/5").length, before = reads();
    await page.getByRole("button", { name: "More actions for The Remains of the Day" }).click();
    await page.getByRole("menuitem", { name: "Start reading now" }).click();
    const ask = page.getByRole("dialog", { name: "Finish Middlemarch first?" });
    await ask.getByRole("button", { name: "Finish and start", exact: true }).click();
    await expect(ask.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
    await expect.poll(reads).toBeGreaterThan(before);
  });

  // ---- Remove ----

  for (const [section, title, action] of [["Now reading", "Middlemarch", "Remove book"], ["Up next", "Nineteen Eighty-Four", "Remove book"], ["Read together", "Emma", "Remove from history"]]) {
    test(`${action} from ${section}: it asks with a danger button, Cancel does nothing, and confirming deletes the book`, async ({ page, app }) => {
      await page.goto("/clubs/5?tab=books");
      const region = page.getByRole("region", { name: section });
      await region.getByRole("button", { name: `More actions for ${title}` }).click();
      await page.getByRole("menuitem", { name: action }).click();
      const ask = page.getByRole("dialog", { name: `Remove ${title} from the club?` });
      await expect(ask.getByText("Its reading plan and posts are deleted too. This can’t be undone.", { exact: true })).toBeVisible();
      await expect(ask.getByRole("button", { name: action, exact: true })).toHaveClass(/bv-button--danger/);
      await ask.getByRole("button", { name: "Cancel" }).click();
      expect(app.requests.filter(request => request.method === "DELETE" && request.path.startsWith("/clubs/5/books/"))).toHaveLength(0);
      await region.getByRole("button", { name: `More actions for ${title}` }).click();
      await page.getByRole("menuitem", { name: action }).click();
      await page.getByRole("dialog", { name: `Remove ${title} from the club?` }).getByRole("button", { name: action, exact: true }).click();
      await expect.poll(() => app.requests.filter(request => request.method === "DELETE" && request.path.startsWith("/clubs/5/books/")).length).toBe(1);
      await expect(page.getByRole("button", { name: `More actions for ${title}` })).toHaveCount(0);
    });
  }

  test("a failed remove uses the existing save error line and keeps the book", async ({ page, app }) => {
    app.failBookDelete = true;
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Nineteen Eighty-Four" }).click();
    await page.getByRole("menuitem", { name: "Remove book" }).click();
    const ask = page.getByRole("dialog", { name: "Remove Nineteen Eighty-Four from the club?" });
    await ask.getByRole("button", { name: "Remove book", exact: true }).click();
    await expect(ask.getByRole("alert")).toHaveText("That couldn’t be saved. Please try again.");
  });

  test("removing the current book does not promote an upcoming one", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=books");
    await page.getByRole("button", { name: "More actions for Middlemarch" }).click();
    await page.getByRole("menuitem", { name: "Remove book" }).click();
    await page.getByRole("dialog", { name: "Remove Middlemarch from the club?" }).getByRole("button", { name: "Remove book", exact: true }).click();
    await expect(page.getByRole("region", { name: "Now reading" })).toHaveCount(0);
    expect(app.requests.filter(request => request.method === "PATCH" && request.path.startsWith("/clubs/5/books/"))).toHaveLength(0);
    await expect(page.getByRole("region", { name: "Up next" })).toBeVisible();
  });
});

// ---- Members -------------------------------------------------------------------------------------------------------------

test.describe("Members tab", () => {
  const noShare = page => page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });

  test("your own row is first, with the Share my progress switch; the others show their role and place as text; six rows, then See all", async ({ page, app: _app }) => {
    await page.goto("/clubs/5?tab=members");
    const panel = page.getByRole("region", { name: "Members" });
    await expect(panel.getByRole("button", { name: "Invite people", exact: true })).toBeVisible();
    await expect(panel.getByText("8 of 25 places used", { exact: true })).toBeVisible();
    const rows = panel.locator(".bv-club-members > li");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText("You");
    await expect(rows.nth(0)).toContainText("owner · not sharing");
    await expect(rows.nth(0).getByRole("switch", { name: "Share my progress" })).not.toBeChecked();
    await expect(rows.nth(1)).toContainText("Ana");
    await expect(rows.nth(1)).toContainText("p. 260");
    await expect(rows.nth(2)).toContainText("Sam");
    await expect(rows.nth(2)).toContainText("admin · p. 180");
    await expect(rows.nth(3)).toContainText("not sharing");
    await expect(panel.getByText("Members see the page you’re on.", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "See all 8" }).click();
    await expect(rows).toHaveCount(8);
    await expect(panel.getByRole("button", { name: /^See all/ })).toHaveCount(0);
  });

  test("the switch shares your progress, says Sharing on or off, and your row shows your page once it's on", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=members");
    const panel = page.getByRole("region", { name: "Members" });
    await panel.getByRole("switch", { name: "Share my progress" }).check({ force: true });
    await expect(panel.getByRole("status")).toHaveText("Sharing on");
    expect(sent(app, "PATCH", "/clubs/5/me")[0].body).toEqual({ share_progress: true });
    await expect(panel.locator(".bv-club-members > li").first()).toContainText("owner · p. 212");
    await panel.getByRole("switch", { name: "Share my progress" }).uncheck({ force: true });
    await expect(panel.getByRole("status")).toHaveText("Sharing off");
    expect(sent(app, "PATCH", "/clubs/5/me").map(request => request.body)).toEqual([{ share_progress: true }, { share_progress: false }]);
  });

  test("members see the list and their own row, with no Invite people, no places line, no tappable rows and a Leave club button at the bottom", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5?tab=members");
    const panel = page.getByRole("region", { name: "Members" });
    await expect(panel.locator(".bv-club-members > li").first()).toContainText("You");
    await expect(panel.getByRole("button", { name: "Invite people" })).toHaveCount(0);
    await expect(panel.getByText(/places used/)).toHaveCount(0);
    await expect(panel.locator(".bv-club-members button")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Leave club", exact: true })).toBeVisible();
  });

  test("the owner has no Leave club", async ({ page, app: _app }) => {
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByRole("button", { name: "Leave club" })).toHaveCount(0);
  });

  test("Leave club asks first, and Cancel does nothing", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5?tab=members");
    await page.getByRole("button", { name: "Leave club", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Leave Tuesday Readers?" });
    await expect(ask.getByText("You’ll need a new invite to rejoin.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent(app, "POST", "/clubs/5/leave")).toHaveLength(0);
    await page.getByRole("button", { name: "Leave club", exact: true }).click();
    await page.getByRole("dialog", { name: "Leave Tuesday Readers?" }).getByRole("button", { name: "Leave club", exact: true }).click();
    await expect(page).toHaveURL(/\/clubs$/);
    expect(sent(app, "POST", "/clubs/5/leave")).toHaveLength(1);
  });

  test("Invite people opens the sheet without making a link; Share invite link makes one, copies it, and says when it stops and how many places are left", async ({ page, app, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await noShare(page);
    await page.goto("/clubs/5?tab=members");
    await page.getByRole("button", { name: "Invite people", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite people" });
    expect(sent(app, "POST", "/clubs/5/invites")).toHaveLength(0);
    await expect(sheet.getByRole("button", { name: "Stop this link" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Share invite link", exact: true }).click();
    await expect(sheet.getByText("Link copied", { exact: true })).toBeVisible();
    await expect(sheet.getByText("The link works until 5 Dec. 17 places left.", { exact: true })).toBeVisible();
    expect(sent(app, "POST", "/clubs/5/invites")).toHaveLength(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/c/");
    await sheet.getByRole("button", { name: "Stop this link", exact: true }).click();
    await expect.poll(() => sent(app, "DELETE", "/clubs/5/invites/i-1")).toHaveLength(1);
    await expect(sheet).toHaveCount(0);
  });

  test("Share invite link uses the phone's share sheet when there is one, and copies nothing then", async ({ page, app }) => {
    await page.addInitScript(() => { window.__shared = null; Object.defineProperty(navigator, "share", { value: async data => { window.__shared = data; }, configurable: true }); });
    await page.goto("/clubs/5?tab=members");
    await page.getByRole("button", { name: "Invite people", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Invite people" });
    await sheet.getByRole("button", { name: "Share invite link", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__shared?.url || "")).toContain("/c/");
    await expect(sheet.getByText("The link works until 5 Dec. 17 places left.", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Link copied")).toHaveCount(0);
    expect(sent(app, "POST", "/clubs/5/invites")).toHaveLength(1);
  });

  test("a club with no limit says when the link works until and no places line", async ({ page, app, context }) => {
    app.plus = true;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await noShare(page);
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText(/places used/)).toHaveCount(0);
    await page.getByRole("button", { name: "Invite people", exact: true }).click();
    await page.getByRole("dialog", { name: "Invite people" }).getByRole("button", { name: "Share invite link", exact: true }).click();
    await expect(page.getByText("The link works until 5 Dec.", { exact: true })).toBeVisible();
  });

  test("a full club (owner) keeps the existing notice", async ({ page, app }) => {
    app.count = 25;
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("Your club is full.", { exact: true })).toBeVisible();
    await expect(page.getByText("Club Plus removes the limit.", { exact: true })).toBeVisible();
  });

  test("today's backend (no member_limit): the places line has no Change link and a full owner club keeps the Club Plus notice", async ({ page, app: _app }) => {
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("8 of 25 places used", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);
  });

  test("with member_limit the owner sees {n} of {limit} places used and a Change link; Club size offers 10, 15, 20 and 25, below the member count disabled, and saves member_limit", async ({ page, app }) => {
    app.limit = 15; app.count = 12;
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("12 of 15 places used")).toBeVisible();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Club size" });
    await expect(sheet.getByRole("radio")).toHaveCount(4);
    await expect(sheet.getByRole("radio", { name: "10" })).toBeDisabled();
    await expect(sheet.getByRole("radio", { name: "15" })).toBeChecked();
    await expect(sheet.getByRole("radio", { name: "20" })).toBeEnabled();
    await expect(sheet.getByText("Members can join until the club is full.", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await sheet.getByRole("radio", { name: "20" }).check({ force: true });
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent(app, "PATCH", "/clubs/5")[0].body).toEqual({ member_limit: 20 });
    await expect(page.getByText("12 of 20 places used")).toBeVisible();
  });

  test("admins see the count but cannot change it", async ({ page, app }) => {
    app.limit = 15; app.myRole = "admin";
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("8 of 15 places used")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);
  });

  test("a full club under 25 offers Add places, which opens Club size; the Club Plus line is not shown", async ({ page, app }) => {
    app.limit = 15; app.count = 15;
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("Your club is full.", { exact: true })).toBeVisible();
    await expect(page.getByText("Club Plus removes the limit.")).toHaveCount(0);
    await page.getByRole("button", { name: "Add places", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Club size" })).toBeVisible();
  });

  test("a full club at 25 keeps the Club Plus line, with no button", async ({ page, app }) => {
    app.limit = 25; app.count = 25;
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByText("Your club is full.", { exact: true })).toBeVisible();
    await expect(page.getByText("Club Plus removes the limit.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add places" })).toHaveCount(0);
  });

  test("tapping a member opens their sheet, with role, place and the date they joined: an owner can make a member admin, and an admin a member again", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=members");
    await page.getByRole("button", { name: /^Ana/ }).click();
    const sheet = page.getByRole("dialog", { name: "Ana" });
    await expect(sheet.getByText("Member · p. 260", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Joined 1 Nov", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Make admin", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Remove from club", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Make member" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Make admin", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && request.path === `/clubs/5/members/${memberId(1)}`).map(request => request.body)).toEqual([{ role: "admin" }]);
    await page.getByRole("button", { name: /^Sam/ }).click();
    const admin = page.getByRole("dialog", { name: "Sam" });
    await expect(admin.getByText("Admin · p. 180", { exact: true })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Make member", exact: true })).toBeVisible();
    await admin.getByRole("button", { name: "Make member", exact: true }).click();
    await expect.poll(() => app.requests.filter(request => request.method === "PATCH" && request.path === `/clubs/5/members/${memberId(2)}`).map(request => request.body)).toEqual([{ role: "member" }]);
  });

  test("Remove from club asks first: Cancel does nothing, Remove acts", async ({ page, app }) => {
    await page.goto("/clubs/5?tab=members");
    await page.getByRole("button", { name: /^Priya/ }).click();
    await page.getByRole("dialog", { name: "Priya" }).getByRole("button", { name: "Remove from club", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Remove Priya from the club?" });
    await expect(ask.getByText("They’ll need a new invite to rejoin.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent(app, "DELETE", `/clubs/5/members/${memberId(3)}`)).toHaveLength(0);
    await page.getByRole("dialog", { name: "Priya" }).getByRole("button", { name: "Remove from club", exact: true }).click();
    await page.getByRole("dialog", { name: "Remove Priya from the club?" }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => sent(app, "DELETE", `/clubs/5/members/${memberId(3)}`)).toHaveLength(1);
  });

  test("an admin can remove a member but has no role changes, and cannot act on the owner or another admin", async ({ page, app }) => {
    app.myRole = "admin";
    await page.goto("/clubs/5?tab=members");
    await expect(page.getByRole("button", { name: /^Rae/ })).toHaveCount(0); // the owner
    await expect(page.getByRole("button", { name: /^You/ })).toHaveCount(0); // you
    await page.getByRole("button", { name: /^Priya/ }).click();
    const sheet = page.getByRole("dialog", { name: "Priya" });
    await expect(sheet.getByRole("button", { name: "Remove from club", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Make (admin|member)/ })).toHaveCount(0);
  });
});

// ---- the "…" menu --------------------------------------------------------------------------------------------------------

test.describe("the club menu", () => {
  test("owner: Edit club, Reading plan, Reported posts (n), Delete club; nothing about sharing, inviting or leaving", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await menu(page);
    await expect.poll(() => items(page)).toEqual(["Edit club", "Reading plan", "Reported posts (2)", "Delete club"]);
  });

  test("admin: the same without Delete club", async ({ page, app }) => {
    app.myRole = "admin";
    await page.goto("/clubs/5");
    await menu(page);
    await expect.poll(() => items(page)).toEqual(["Edit club", "Reading plan", "Reported posts (2)"]);
  });

  test("members have no menu in the header at all", async ({ page, app }) => {
    app.myRole = "member";
    await page.goto("/clubs/5");
    await expect(page.getByRole("heading", { name: "Tuesday Readers", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "More actions for this club" })).toHaveCount(0);
  });

  test("with no current book there is no Reading plan item", async ({ page, app }) => {
    app.books = app.books.filter(book => book.status !== "current");
    await page.goto("/clubs/5");
    await menu(page);
    await expect.poll(() => items(page)).toEqual(["Edit club", "Reported posts (2)", "Delete club"]);
  });

  test("Delete club (owner) asks with the full warning; Cancel does nothing, and confirming deletes and goes to /clubs", async ({ page, app }) => {
    await page.goto("/clubs/5");
    await menu(page);
    await page.getByRole("menuitem", { name: "Delete club" }).click();
    const ask = page.getByRole("dialog", { name: "Delete Tuesday Readers?" });
    await expect(ask.getByText("The discussion and reading plan are deleted for everyone. This can’t be undone.", { exact: true })).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent(app, "DELETE", "/clubs/5")).toHaveLength(0);
    await menu(page);
    await page.getByRole("menuitem", { name: "Delete club" }).click();
    await page.getByRole("dialog", { name: "Delete Tuesday Readers?" }).getByRole("button", { name: "Delete club", exact: true }).click();
    await expect(page).toHaveURL(/\/clubs$/);
    expect(sent(app, "DELETE", "/clubs/5")).toHaveLength(1);
  });

  test("Edit club holds the name, description and colour; Reading plan opens the plan sheet", async ({ page, app: _app }) => {
    await page.goto("/clubs/5");
    await menu(page);
    await page.getByRole("menuitem", { name: "Edit club" }).click();
    const edit = page.getByRole("dialog", { name: "Edit club" });
    await expect(edit.getByLabel("Club name")).toHaveValue("Tuesday Readers");
    await expect(edit.getByLabel("What’s it about? (optional)")).toBeVisible();
    await expect(edit.getByRole("radio")).toHaveCount(6);
    await page.keyboard.press("Escape");
    await menu(page);
    await page.getByRole("menuitem", { name: "Reading plan" }).click();
    await expect(page.getByRole("dialog", { name: "Reading plan" })).toBeVisible();
  });
});

// ---- reported posts ------------------------------------------------------------------------------------------------------

test("Reported posts lists each with its author, how often it was reported, its text and the reasons given; Keep it restores and Remove it deletes", async ({ page, app }) => {
  await page.goto("/clubs/5");
  await menu(page);
  await page.getByRole("menuitem", { name: "Reported posts (2)" }).click();
  const sheet = page.getByRole("dialog", { name: "Reported posts" });
  await expect(sheet.getByText("A post reported 3 times is hidden until you decide.", { exact: true })).toBeVisible();
  const first = sheet.locator("li", { hasText: "Priya" });
  await expect(first).toContainText("reported 3 times");
  await expect(first).toContainText("A post that was reported.");
  await expect(first.locator(".bv-club-reason")).toHaveText(["“Spoils the ending”", "“Rude”"]);
  await expect(sheet.locator("li", { hasText: "Jo" })).toContainText("reported 1 time");
  await expect(sheet.locator("li", { hasText: "Jo" }).locator(".bv-club-reason")).toHaveCount(0);
  await first.getByRole("button", { name: "Keep it" }).click();
  await expect.poll(() => sent(app, "POST", "/clubs/5/posts/41/review").map(request => request.body)).toEqual([{ action: "restore" }]);
  await expect(sheet.locator("li", { hasText: "Priya" })).toHaveCount(0);
  await sheet.locator("li", { hasText: "Jo" }).getByRole("button", { name: "Remove it" }).click();
  await expect.poll(() => sent(app, "POST", "/clubs/5/posts/42/review").map(request => request.body)).toEqual([{ action: "delete" }]);
  await expect(sheet.getByText("Nothing to review.", { exact: true })).toBeVisible();
});

// ---- not found, and layout -------------------------------------------------------------------------------------------------

test("a club that does not exist, or isn't yours, shows the not-found page", async ({ page, app: _app }) => {
  await page.goto("/clubs/99");
  await expect(page.getByRole("heading", { name: "This page isn’t on the shelf." })).toBeVisible();
});

for (const scheme of ["light", "dark"]) for (const [width, height, zoom] of [[320, 700, false], [390, 844, false], [390, 844, true], [1440, 1000, false]]) {
  test(`the club page does not scroll sideways at ${width}px${zoom ? " and 200% text" : ""}, on every tab; ${scheme}`, async ({ page, app: _app }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), scheme);
    await page.setViewportSize({ width, height });
    const shots = process.env.CLUBS_REDESIGN_SHOTS;
    for (const tab of ["discussion", "books", "members"]) {
      await page.goto(`/clubs/5?tab=${tab}`);
      if (zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect(page.getByRole("region", { name: "This week" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} scrolls sideways`).toBe(true);
      if (shots && !zoom && width !== 320) await page.screenshot({ path: `${shots}/club-${tab}-${width}-${scheme}.png`, fullPage: true });
    }
  });
}
