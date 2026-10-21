# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-library.spec.js >> independent review: workspace history pagination retains the collection return context
- Location: frontend/tests/reading-library.spec.js:545:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('link', { name: 'Back to My Books', exact: true })
Expected: "/my-books?status=want&q=Library"
Received: "/my-books"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByRole('link', { name: 'Back to My Books', exact: true })
    14 × locator resolved to <a href="/my-books" class="bv-text-link" data-discover="true">Back to My Books</a>
       - unexpected value "/my-books"

```

```yaml
- link "Back to My Books":
  - /url: /my-books
```

# Test source

```ts
  454 |     });
  455 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  456 |     await expect(page.getByLabel("Search title or author")).toBeVisible();
  457 |     const importLink = page.getByRole("link", { name: "Bring Your Library", exact: true });
  458 |     await importLink.focus();
  459 |     await expect(importLink).toBeFocused();
  460 |   });
  461 | }
  462 | 
  463 | test("independent review: known previous page survives book return and browser navigation", async ({ page, app }) => {
  464 |   app.readingActions = true;
  465 |   app.entries = new Map(Array.from({ length: 76 }, (_, index) => {
  466 |     const id = index + 1;
  467 |     return [id, { ...row(1), id, book_id: id, book: { ...books[0], id, title: `Saved book ${id}` } }];
  468 |   }));
  469 |   await page.goto("/my-books?status=want");
  470 |   for (let i = 0; i < 2; i++) {
  471 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  472 |     await expect(page).toHaveURL(new RegExp(`cursor=${25 * (i + 1)}`));
  473 |   }
  474 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  475 |   await page.locator(".bv-personal-book h3 a").first().click();
  476 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&cursor=50");
  477 |   await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  478 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  479 |   await expect(page).toHaveURL(/status=want&cursor=25$/);
  480 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  481 |   await expect(page).toHaveURL(/my-books\?status=want$/);
  482 |   await page.goBack();
  483 |   await expect(page).toHaveURL(/cursor=25$/);
  484 |   await page.goForward();
  485 |   await expect(page).not.toHaveURL(/cursor=/);
  486 |   await page.getByLabel("Search title or author").fill("Saved book 76");
  487 |   await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
  488 |   await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  489 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  490 |   expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  491 | });
  492 | 
  493 | for (const direct of [false, true]) test(`independent review: ${direct ? "direct" : "refreshed"} later page has truthful bounded recovery`, async ({ page, app }) => {
  494 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  495 |   if (direct) await page.goto("/my-books?status=want&q=Library&label=Keep&cursor=25");
  496 |   else {
  497 |     await page.goto("/my-books?status=want&q=Library&label=Keep");
  498 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  499 |     await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  500 |     await page.reload();
  501 |   }
  502 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  503 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  504 |   await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  505 |   await expect(page).not.toHaveURL(/cursor=/);
  506 |   await expect(page).toHaveURL(/label=Keep/);
  507 |   await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  508 |   await expect(page.getByRole("button", { name: /^Want/ })).toHaveAttribute("aria-pressed", "true");
  509 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  510 |   expect(app.requests.filter(r => r.path === "/me/library").every(r => !r.query.has("limit"))).toBe(true);
  511 | });
  512 | 
  513 | test("independent review: another account cannot recover old library navigation metadata", async ({ page, app }) => {
  514 |   app.readingActions = true;
  515 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  516 |   await page.goto("/my-books?q=Library&status=want");
  517 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  518 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  519 |   await page.locator(".bv-personal-book h3 a").first().click();
  520 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library&cursor=25");
  521 |   const oldState = await page.evaluate(() => ({ ...history.state, url: location.pathname }));
  522 |   await expireAndSignInAsB(page, app, oldState.url, true);
  523 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  524 |   await page.evaluate(state => { const { url, ...entry } = state; history.replaceState(entry, "", url); dispatchEvent(new PopStateEvent("popstate", { state: entry })); }, oldState);
  525 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books");
  526 |   const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
  527 |   expect(stored).not.toContain("libraryReturn");
  528 |   expect(stored).not.toContain("Library");
  529 | });
  530 | 
  531 | 
  532 | test("independent review: paging from the bottom reveals the new page instead of its footer", async ({ page, app }) => {
  533 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  534 |   await page.setViewportSize({ width: 390, height: 844 });
  535 |   await page.goto("/my-books");
  536 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  537 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  538 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  539 |   await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeFocused();
  540 |   const top = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top);
  541 |   expect(top).toBeGreaterThanOrEqual(0);
  542 |   expect(top).toBeLessThan(420);
  543 | });
  544 | 
  545 | test("independent review: workspace history pagination retains the collection return context", async ({ page, app }) => {
  546 |   app.readingActions = true;
  547 |   app.historyNextCursor = "older-reading";
  548 |   await page.goto("/my-books?status=want&q=Library");
  549 |   await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  550 |   await page.locator(".bv-personal-book h3 a").click();
  551 |   await page.getByText("Reading history", { exact: true }).click();
  552 |   await page.getByRole("button", { name: "Older readings", exact: true }).click();
  553 |   await expect(page).toHaveURL(/history_cursor=older-reading/);
> 554 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library");
      |                                                                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
  555 | });
  556 | 
```