# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-library.spec.js >> independent review: library controls and missing covers light 320
- Location: frontend/tests/reading-library.spec.js:420:3

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 145
Received:    88
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#bv-main"
  - banner [ref=e5]:
    - link "Bookvane home" [ref=e7] [cursor=pointer]:
      - /url: /home
      - generic [ref=e8]: Bookvane
  - navigation "Mobile navigation" [ref=e9]:
    - link "Home" [ref=e10] [cursor=pointer]:
      - /url: /home
    - link "Discover" [ref=e15] [cursor=pointer]:
      - /url: /browse
    - link "My Books" [ref=e20] [cursor=pointer]:
      - /url: /my-books
    - link "You" [ref=e24] [cursor=pointer]:
      - /url: /account
  - main [ref=e29]:
    - generic [ref=e30]:
      - generic [ref=e31]:
        - heading "My Books" [level=1] [ref=e33]
        - link "Bring Your Library" [ref=e34] [cursor=pointer]:
          - /url: /my-books/import
      - search "Search your library" [ref=e35]:
        - generic [ref=e36]: Search title or author
        - generic [ref=e37]:
          - textbox "Search title or author" [ref=e38]:
            - /placeholder: Find a saved book
          - button "Search" [ref=e39] [cursor=pointer]
      - generic [ref=e40]:
        - group "Filter your library" [ref=e41]:
          - button "All 8" [pressed] [ref=e42] [cursor=pointer]:
            - text: All
            - generic [ref=e43]: "8"
          - button "Reading 6" [ref=e44] [cursor=pointer]:
            - text: Reading
            - generic [ref=e45]: "6"
          - button "Want 8" [ref=e46] [cursor=pointer]:
            - text: Want
            - generic [ref=e47]: "8"
          - button "Finished 0" [ref=e48] [cursor=pointer]:
            - text: Finished
            - generic [ref=e49]: "0"
        - group [ref=e50]:
          - generic "More filters" [ref=e51] [cursor=pointer]
      - status [ref=e52]: 8 books in this view.
      - generic [ref=e53]:
        - article [ref=e54]:
          - link "Open Library fixture 08" [ref=e55] [cursor=pointer]:
            - /url: /my-books/8
            - img "Cover unavailable for Library fixture 08" [ref=e57]:
              - generic [ref=e60]: Cover unavailable
          - heading [level=3] [ref=e62]:
            - link "Library fixture 08" [ref=e63] [cursor=pointer]:
              - /url: /my-books/8
          - paragraph [ref=e64]: Isolated test author
          - paragraph [ref=e65]: Want to read
        - article [ref=e66]:
          - link "Open My private reading" [ref=e67] [cursor=pointer]:
            - /url: /my-books/7
            - img "Cover unavailable for My private reading" [ref=e69]:
              - generic [ref=e72]: Cover unavailable
          - generic [ref=e73]: Private book
          - heading [level=3] [ref=e75]:
            - link "My private reading" [ref=e76] [cursor=pointer]:
              - /url: /my-books/7
          - paragraph [ref=e77]: Private author
          - paragraph [ref=e78]: Want to read
        - article [ref=e79]:
          - link "Open Library fixture 06" [ref=e80] [cursor=pointer]:
            - /url: /my-books/6
            - img "Cover unavailable for Library fixture 06" [ref=e82]:
              - generic [ref=e85]: Cover unavailable
          - generic [ref=e86]: Reading
          - heading [level=3] [ref=e88]:
            - link "Library fixture 06" [ref=e89] [cursor=pointer]:
              - /url: /my-books/6
          - paragraph [ref=e90]: Isolated test author
          - paragraph [ref=e91]: Owned · Want to read
        - article [ref=e92]:
          - link "Open Library fixture 05" [ref=e93] [cursor=pointer]:
            - /url: /my-books/5
            - img "Cover unavailable for Library fixture 05" [ref=e95]:
              - generic [ref=e98]: Cover unavailable
          - generic [ref=e99]: Reading
          - heading [level=3] [ref=e101]:
            - link "Library fixture 05" [ref=e102] [cursor=pointer]:
              - /url: /my-books/5
          - paragraph [ref=e103]: Isolated test author
          - paragraph [ref=e104]: Owned · Want to read
        - article [ref=e105]:
          - link "Open Library fixture 04" [ref=e106] [cursor=pointer]:
            - /url: /my-books/4
            - img "Cover unavailable for Library fixture 04" [ref=e108]:
              - generic [ref=e111]: Cover unavailable
          - generic [ref=e112]: Reading
          - heading [level=3] [ref=e114]:
            - link "Library fixture 04" [ref=e115] [cursor=pointer]:
              - /url: /my-books/4
          - paragraph [ref=e116]: Isolated test author
          - paragraph [ref=e117]: Owned · Want to read
        - article [ref=e118]:
          - link "Open Library fixture 03" [ref=e119] [cursor=pointer]:
            - /url: /my-books/3
            - img "Cover unavailable for Library fixture 03" [ref=e121]:
              - generic [ref=e124]: Cover unavailable
          - generic [ref=e125]: Reading
          - heading [level=3] [ref=e127]:
            - link "Library fixture 03" [ref=e128] [cursor=pointer]:
              - /url: /my-books/3
          - paragraph [ref=e129]: Isolated test author
          - paragraph [ref=e130]: Owned · Want to read
        - article [ref=e131]:
          - link "Open Library fixture 02" [ref=e132] [cursor=pointer]:
            - /url: /my-books/2
            - img "Cover unavailable for Library fixture 02" [ref=e134]:
              - generic [ref=e137]: Cover unavailable
          - generic [ref=e138]: Reading
          - heading [level=3] [ref=e140]:
            - link "Library fixture 02" [ref=e141] [cursor=pointer]:
              - /url: /my-books/2
          - paragraph [ref=e142]: Isolated test author
          - paragraph [ref=e143]: Owned · Want to read
        - article [ref=e144]:
          - link "Open Library fixture 01" [ref=e145] [cursor=pointer]:
            - /url: /my-books/1
            - img "Cover unavailable for Library fixture 01" [ref=e147]:
              - generic [ref=e150]: Cover unavailable
          - generic [ref=e151]: Reading
          - heading [level=3] [ref=e153]:
            - link "Library fixture 01" [ref=e154] [cursor=pointer]:
              - /url: /my-books/1
          - paragraph [ref=e155]: Isolated test author
          - paragraph [ref=e156]: Owned · Want to read
      - paragraph [ref=e157]:
        - link "Add a missing book" [ref=e158] [cursor=pointer]:
          - /url: /my-books/private
  - contentinfo [ref=e159]:
    - generic [ref=e160]:
      - link "Bookvane home" [ref=e161] [cursor=pointer]:
        - /url: /home
        - generic [ref=e162]: Bookvane
      - link "Privacy" [ref=e163] [cursor=pointer]:
        - /url: /privacy
```

# Test source

```ts
  373 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  374 |   app.entries.set(1, { ...app.entries.get(1), is_wanted: false, version: 2 });
  375 |   await page.goForward();
  376 |   await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
  377 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  378 |   await expect(page).toHaveURL(/cursor=25/);
  379 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  380 |   await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  381 |   await expect(page).not.toHaveURL(/cursor=/);
  382 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  383 | });
  384 | 
  385 | 
  386 | test("independent review: mobile collection reaches books without a wall of controls", async ({ page, app }, testInfo) => {
  387 |   app.readingActions = true;
  388 |   app.libraryImport = true;
  389 |   app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  390 |   await page.setViewportSize({ width: 390, height: 844 });
  391 |   await page.goto("/my-books");
  392 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  393 |   const top = await page.locator(".bv-book-card").first().evaluate(el => el.getBoundingClientRect().top + scrollY);
  394 |   console.log(`LIBRARY_GEOMETRY ${JSON.stringify({ width: 390, firstBookTop: top })}`);
  395 |   await testInfo.attach("library-first-book-position", { body: JSON.stringify({ width: 390, firstBookTop: top }), contentType: "application/json" });
  396 |   await page.screenshot({ path: testInfo.outputPath("review-library-390.png"), fullPage: false });
  397 |   expect(top).toBeLessThan(420);
  398 | });
  399 | 
  400 | test("independent review: workspace returns to the searched filtered library page", async ({ page, app }) => {
  401 |   app.readingActions = true;
  402 |   app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  403 |   await page.goto("/my-books?q=Library&status=want&label=Imported");
  404 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  405 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  406 |   await expect(page.locator(".bv-book-card")).toHaveCount(5);
  407 |   const original = page.url();
  408 |   await page.locator(".bv-book-card h3 a").first().click();
  409 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  410 |   await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  411 |   await expect(page).toHaveURL(original);
  412 |   await expect(page.locator(".bv-book-card")).toHaveCount(5);
  413 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  414 |   await expect(page).not.toHaveURL(/cursor=/);
  415 |   await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  416 | });
  417 | 
  418 | 
  419 | for (const theme of ["light", "dark"]) for (const width of [320, 390, 768, 1440]) {
  420 |   test(`independent review: library controls and missing covers ${theme} ${width}`, async ({ page, app }, testInfo) => {
  421 |     app.readingActions = true;
  422 |     app.libraryImport = true;
  423 |     app.entries = new Map(books.slice(0, 6).map(book => [book.id, { ...row(book.id, true, true), reading_state: "reading" }]));
  424 |     app.entries.set(7, { ...row(7), book: null, private_title: "My private reading", private_author: "Private author" });
  425 |     app.entries.set(8, { ...row(8), book: { ...books[7], cover_image_url: "/invalid-fixture-cover.png" } });
  426 |     await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  427 |     await page.setViewportSize({ width, height: 900 });
  428 |     await page.emulateMedia({ reducedMotion: "reduce" });
  429 |     await page.goto("/my-books");
  430 |     await expect(page.locator(".bv-personal-book")).toHaveCount(8);
  431 |     await expect(page.locator(".bv-personal-book .bv-cover-fallback")).toHaveCount(8);
  432 |     await expect(page.getByRole("heading", { name: "My private reading", exact: true })).toBeVisible();
  433 |     await expect(page.getByRole("img", { name: "Cover unavailable for My private reading", exact: true })).toBeVisible();
  434 |     for (const fallback of await page.locator(".bv-personal-book .bv-cover-fallback strong").all()) await expect(fallback).toBeHidden();
  435 |     const controls = page.getByRole("group", { name: "Filter your library", exact: true }).getByRole("button");
  436 |     const normalControlWidth = (await controls.first().boundingBox()).width;
  437 |     const normalSearchWidth = (await page.getByLabel("Search title or author").boundingBox()).width;
  438 |     for (const control of await controls.all()) {
  439 |       const box = await control.boundingBox();
  440 |       expect(box.height).toBeGreaterThanOrEqual(44);
  441 |       expect(box.width).toBeGreaterThanOrEqual(44);
  442 |     }
  443 |     if (width <= 390) {
  444 |       const tops = await controls.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  445 |       expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  446 |       const firstTop = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top + scrollY);
  447 |       expect(firstTop).toBeLessThan(420);
  448 |       await testInfo.attach("geometry", { body: JSON.stringify({ theme, width, firstTop }), contentType: "application/json" });
  449 |     }
  450 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  451 |     await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}.png`), fullPage: false });
  452 |     // Actual computed text sizes are doubled once; allow more vertical wrapping.
  453 |     await page.evaluate(() => {
  454 |       const nodes = [...document.querySelectorAll(".bv-root *")].map(el => [el, getComputedStyle(el).fontSize]);
  455 |       for (const [el, size] of nodes) el.style.fontSize = `${parseFloat(size) * 2}px`;
  456 |     });
  457 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  458 |     await expect(page.getByLabel("Search title or author")).toBeVisible();
  459 |     if (width <= 390) {
  460 |       expect((await controls.first().boundingBox()).width).toBeGreaterThan(normalControlWidth);
  461 |       expect((await page.getByLabel("Search title or author").boundingBox()).width).toBeGreaterThan(normalSearchWidth);
  462 |       const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
  463 |       const discover = nav.getByRole("link", { name: "Discover", exact: true });
  464 |       const textLines = await discover.locator("span").evaluate(node => {
  465 |         const range = document.createRange(); range.selectNodeContents(node);
  466 |         return range.getClientRects().length;
  467 |       });
  468 |       expect(textLines).toBe(1);
  469 |       const box = await discover.boundingBox();
  470 |       expect(box.width).toBeGreaterThanOrEqual(44);
  471 |       expect(box.height).toBeGreaterThanOrEqual(44);
  472 |       const clearance = await page.locator(".bv-root").evaluate(node => parseFloat(getComputedStyle(node).paddingBottom));
> 473 |       expect(clearance).toBeGreaterThanOrEqual((await nav.boundingBox()).height);
      |                         ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  474 |     }
  475 |     await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}-enlarged.png`), fullPage: false });
  476 |     const importLink = page.getByRole("link", { name: "Bring Your Library", exact: true });
  477 |     await importLink.focus();
  478 |     await expect(importLink).toBeFocused();
  479 |   });
  480 | }
  481 | 
  482 | test("independent review: known previous page survives book return and browser navigation", async ({ page, app }) => {
  483 |   app.readingActions = true;
  484 |   app.entries = new Map(Array.from({ length: 76 }, (_, index) => {
  485 |     const id = index + 1;
  486 |     return [id, { ...row(1), id, book_id: id, book: { ...books[0], id, title: `Saved book ${id}` } }];
  487 |   }));
  488 |   await page.goto("/my-books?status=want");
  489 |   for (let i = 0; i < 2; i++) {
  490 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  491 |     await expect(page).toHaveURL(new RegExp(`cursor=${25 * (i + 1)}`));
  492 |   }
  493 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  494 |   await page.locator(".bv-personal-book h3 a").first().click();
  495 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&cursor=50");
  496 |   await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  497 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  498 |   await expect(page).toHaveURL(/status=want&cursor=25$/);
  499 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  500 |   await expect(page).toHaveURL(/my-books\?status=want$/);
  501 |   await page.goBack();
  502 |   await expect(page).toHaveURL(/cursor=25$/);
  503 |   await page.goForward();
  504 |   await expect(page).not.toHaveURL(/cursor=/);
  505 |   await page.getByLabel("Search title or author").fill("Saved book 76");
  506 |   await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
  507 |   await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  508 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  509 |   expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  510 | });
  511 | 
  512 | for (const direct of [false, true]) test(`independent review: ${direct ? "direct" : "refreshed"} later page has truthful bounded recovery`, async ({ page, app }) => {
  513 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  514 |   if (direct) await page.goto("/my-books?status=want&q=Library&label=Keep&cursor=25");
  515 |   else {
  516 |     await page.goto("/my-books?status=want&q=Library&label=Keep");
  517 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  518 |     await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  519 |     await page.reload();
  520 |   }
  521 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  522 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  523 |   await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  524 |   await expect(page).not.toHaveURL(/cursor=/);
  525 |   await expect(page).toHaveURL(/label=Keep/);
  526 |   await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  527 |   await expect(page.getByRole("button", { name: /^Want/ })).toHaveAttribute("aria-pressed", "true");
  528 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  529 |   expect(app.requests.filter(r => r.path === "/me/library").every(r => !r.query.has("limit"))).toBe(true);
  530 | });
  531 | 
  532 | test("independent review: another account cannot recover old library navigation metadata", async ({ page, app }) => {
  533 |   app.readingActions = true;
  534 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  535 |   await page.goto("/my-books?q=Library&status=want");
  536 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  537 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  538 |   await page.locator(".bv-personal-book h3 a").first().click();
  539 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library&cursor=25");
  540 |   const oldState = await page.evaluate(() => ({ ...history.state, url: location.pathname }));
  541 |   await expireAndSignInAsB(page, app, oldState.url, true);
  542 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  543 |   await page.evaluate(state => { const { url, ...entry } = state; history.replaceState(entry, "", url); dispatchEvent(new PopStateEvent("popstate", { state: entry })); }, oldState);
  544 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books");
  545 |   const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
  546 |   expect(stored).not.toContain("libraryReturn");
  547 |   expect(stored).not.toContain("Library");
  548 | });
  549 | 
  550 | 
  551 | test("independent review: paging from the bottom reveals the new page instead of its footer", async ({ page, app }) => {
  552 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  553 |   await page.setViewportSize({ width: 390, height: 844 });
  554 |   await page.goto("/my-books");
  555 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  556 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  557 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  558 |   await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeFocused();
  559 |   const top = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top);
  560 |   expect(top).toBeGreaterThanOrEqual(0);
  561 |   expect(top).toBeLessThan(420);
  562 | });
  563 | 
  564 | test("independent review: workspace history pagination retains the collection return context", async ({ page, app }) => {
  565 |   app.readingActions = true;
  566 |   app.historyNextCursor = "older-reading";
  567 |   await page.goto("/my-books?status=want&q=Library");
  568 |   await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  569 |   await page.locator(".bv-personal-book h3 a").click();
  570 |   await page.getByText("Reading history", { exact: true }).click();
  571 |   await page.getByRole("button", { name: "Older readings", exact: true }).click();
  572 |   await expect(page).toHaveURL(/history_cursor=older-reading/);
  573 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library");
```