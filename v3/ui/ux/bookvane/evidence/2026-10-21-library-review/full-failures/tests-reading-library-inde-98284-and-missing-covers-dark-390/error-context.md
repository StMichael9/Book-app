# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-library.spec.js >> independent review: library controls and missing covers dark 390
- Location: frontend/tests/reading-library.spec.js:420:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.bv-personal-book')
Expected: 8
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.bv-personal-book')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#bv-main"
  - banner [ref=e5]:
    - link "Bookvane home" [ref=e7] [cursor=pointer]:
      - /url: /
      - generic [ref=e8]: Bookvane
  - navigation "Mobile navigation" [ref=e9]:
    - link "Discover" [ref=e10] [cursor=pointer]:
      - /url: /browse
    - link "My Books" [ref=e15] [cursor=pointer]:
      - /url: /my-books
    - link "You" [ref=e19] [cursor=pointer]:
      - /url: /account
  - main [ref=e24]:
    - generic [ref=e25]:
      - generic [ref=e26]:
        - generic [ref=e27]:
          - paragraph [ref=e28]: A little more you
          - heading "My Books" [level=1] [ref=e29]
          - generic [ref=e30]: Your collection. Your next possibilities.
        - link "Find more" [ref=e31] [cursor=pointer]:
          - /url: /browse
      - tablist "Your shelves" [ref=e35]:
        - tab "Want…" [selected] [ref=e36] [cursor=pointer]
        - tab "Own…" [ref=e37] [cursor=pointer]
      - tabpanel "Want…" [ref=e38]:
        - paragraph [ref=e39]: The books that caught your eye. Pick up where your curiosity left off.
        - status "Loading books" [ref=e40]:
          - generic [ref=e41]: Loading books…
  - contentinfo [ref=e68]:
    - generic [ref=e69]:
      - link "Bookvane home" [ref=e70] [cursor=pointer]:
        - /url: /
        - generic [ref=e71]: Bookvane
      - link "Privacy" [ref=e72] [cursor=pointer]:
        - /url: /privacy
```

# Test source

```ts
  330 |     // Previous navigates to an explicit known page, rather than browser Back.
  331 |     await page.goBack();
  332 |     await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
  333 |     await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  334 |     await expect(page.locator(".bv-book-card")).toHaveCount(25);
  335 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  336 |   });
  337 | 
  338 |   test(`direct empty cursor recovers in read-only mode (${theme})`, async ({ page, app }) => {
  339 |     app.readOnly = true;
  340 |     app.entries = new Map(books.slice(0, 25).map(book => [book.id, row(book.id)]));
  341 |     await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  342 |     await page.setViewportSize({ width: 390, height: 844 });
  343 |     await page.goto("/my-books?status=want&cursor=25");
  344 |     await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
  345 |     await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  346 |     await expect(page.locator(".bv-book-card")).toHaveCount(25);
  347 |     await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toBeDisabled();
  348 |     expect(app.requests.filter(r => r.method === "PUT" || r.method === "PATCH")).toHaveLength(0);
  349 |   });
  350 | }
  351 | 
  352 | test("an empty first-page facet does not claim the entire library is empty", async ({ page, app }) => {
  353 |   app.entries.set(1, row(1, true, false));
  354 |   await page.goto("/my-books?status=want");
  355 |   await expect(page.getByRole("heading", { name: "No saved books match this view.", exact: true })).toBeVisible();
  356 |   await page.getByRole("group", { name: "Filter your library" }).getByRole("button", { name: /^All/ }).click();
  357 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  358 | });
  359 | 
  360 | test("a concurrent change on page three preserves history and first-page recovery", async ({ page, app }) => {
  361 |   app.entries = new Map(Array.from({ length: 51 }, (_, index) => {
  362 |     const id = index + 1;
  363 |     return [id, { ...row(id), book: { ...books[0], id, title: `Library fixture ${id}` } }];
  364 |   }));
  365 |   await page.goto("/my-books?status=want");
  366 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  367 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  368 |   await expect(page).toHaveURL(/cursor=25/);
  369 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  370 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  371 |   // Another browser changes this view while the reader returns to page two.
  372 |   await page.goBack();
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
> 430 |     await expect(page.locator(".bv-personal-book")).toHaveCount(8);
      |                                                     ^ Error: expect(locator).toHaveCount(expected) failed
  431 |     await expect(page.locator(".bv-personal-book .bv-cover-fallback")).toHaveCount(8);
  432 |     await expect(page.getByRole("heading", { name: "My private reading", exact: true })).toBeVisible();
  433 |     await expect(page.getByRole("img", { name: "Cover unavailable for My private reading", exact: true })).toBeVisible();
  434 |     for (const fallback of await page.locator(".bv-personal-book .bv-cover-fallback strong").all()) await expect(fallback).toBeHidden();
  435 |     const controls = page.getByRole("group", { name: "Filter your library", exact: true }).getByRole("button");
  436 |     const normalControlWidth = (await controls.first().boundingBox()).width;
  437 |     for (const control of await controls.all()) {
  438 |       const box = await control.boundingBox();
  439 |       expect(box.height).toBeGreaterThanOrEqual(44);
  440 |       expect(box.width).toBeGreaterThanOrEqual(44);
  441 |     }
  442 |     if (width <= 390) {
  443 |       const tops = await controls.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  444 |       expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  445 |       const firstTop = await page.locator(".bv-personal-book").first().evaluate(el => el.getBoundingClientRect().top + scrollY);
  446 |       expect(firstTop).toBeLessThan(420);
  447 |       await testInfo.attach("geometry", { body: JSON.stringify({ theme, width, firstTop }), contentType: "application/json" });
  448 |     }
  449 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  450 |     await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}.png`), fullPage: false });
  451 |     // Actual computed text sizes are doubled once; allow more vertical wrapping.
  452 |     await page.evaluate(() => {
  453 |       const nodes = [...document.querySelectorAll(".bv-root *")].map(el => [el, getComputedStyle(el).fontSize]);
  454 |       for (const [el, size] of nodes) el.style.fontSize = `${parseFloat(size) * 2}px`;
  455 |     });
  456 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  457 |     await expect(page.getByLabel("Search title or author")).toBeVisible();
  458 |     if (width <= 390) expect((await controls.first().boundingBox()).width).toBeGreaterThan(normalControlWidth);
  459 |     await page.screenshot({ path: testInfo.outputPath(`library-review-${theme}-${width}-enlarged.png`), fullPage: false });
  460 |     const importLink = page.getByRole("link", { name: "Bring Your Library", exact: true });
  461 |     await importLink.focus();
  462 |     await expect(importLink).toBeFocused();
  463 |   });
  464 | }
  465 | 
  466 | test("independent review: known previous page survives book return and browser navigation", async ({ page, app }) => {
  467 |   app.readingActions = true;
  468 |   app.entries = new Map(Array.from({ length: 76 }, (_, index) => {
  469 |     const id = index + 1;
  470 |     return [id, { ...row(1), id, book_id: id, book: { ...books[0], id, title: `Saved book ${id}` } }];
  471 |   }));
  472 |   await page.goto("/my-books?status=want");
  473 |   for (let i = 0; i < 2; i++) {
  474 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  475 |     await expect(page).toHaveURL(new RegExp(`cursor=${25 * (i + 1)}`));
  476 |   }
  477 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  478 |   await page.locator(".bv-personal-book h3 a").first().click();
  479 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&cursor=50");
  480 |   await page.getByRole("link", { name: "Back to My Books", exact: true }).click();
  481 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  482 |   await expect(page).toHaveURL(/status=want&cursor=25$/);
  483 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  484 |   await expect(page).toHaveURL(/my-books\?status=want$/);
  485 |   await page.goBack();
  486 |   await expect(page).toHaveURL(/cursor=25$/);
  487 |   await page.goForward();
  488 |   await expect(page).not.toHaveURL(/cursor=/);
  489 |   await page.getByLabel("Search title or author").fill("Saved book 76");
  490 |   await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
  491 |   await expect(page.locator(".bv-personal-book")).toHaveCount(1);
  492 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  493 |   expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  494 | });
  495 | 
  496 | for (const direct of [false, true]) test(`independent review: ${direct ? "direct" : "refreshed"} later page has truthful bounded recovery`, async ({ page, app }) => {
  497 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  498 |   if (direct) await page.goto("/my-books?status=want&q=Library&label=Keep&cursor=25");
  499 |   else {
  500 |     await page.goto("/my-books?status=want&q=Library&label=Keep");
  501 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  502 |     await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  503 |     await page.reload();
  504 |   }
  505 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  506 |   await expect(page.getByRole("button", { name: "Previous page", exact: true })).toHaveCount(0);
  507 |   await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  508 |   await expect(page).not.toHaveURL(/cursor=/);
  509 |   await expect(page).toHaveURL(/label=Keep/);
  510 |   await expect(page.getByLabel("Search title or author")).toHaveValue("Library");
  511 |   await expect(page.getByRole("button", { name: /^Want/ })).toHaveAttribute("aria-pressed", "true");
  512 |   await expect(page.locator(".bv-personal-book")).toHaveCount(25);
  513 |   expect(app.requests.filter(r => r.path === "/me/library").every(r => !r.query.has("limit"))).toBe(true);
  514 | });
  515 | 
  516 | test("independent review: another account cannot recover old library navigation metadata", async ({ page, app }) => {
  517 |   app.readingActions = true;
  518 |   app.entries = new Map(books.map(book => [book.id, row(book.id)]));
  519 |   await page.goto("/my-books?q=Library&status=want");
  520 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  521 |   await expect(page.locator(".bv-personal-book")).toHaveCount(5);
  522 |   await page.locator(".bv-personal-book h3 a").first().click();
  523 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books?status=want&q=Library&cursor=25");
  524 |   const oldState = await page.evaluate(() => ({ ...history.state, url: location.pathname }));
  525 |   await expireAndSignInAsB(page, app, oldState.url, true);
  526 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toBeVisible();
  527 |   await page.evaluate(state => { const { url, ...entry } = state; history.replaceState(entry, "", url); dispatchEvent(new PopStateEvent("popstate", { state: entry })); }, oldState);
  528 |   await expect(page.getByRole("link", { name: "Back to My Books", exact: true })).toHaveAttribute("href", "/my-books");
  529 |   const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
  530 |   expect(stored).not.toContain("libraryReturn");
```