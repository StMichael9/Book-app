# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-lifecycle.spec.js >> editorial workspace paused actions put Resume first visually and by keyboard
- Location: frontend/tests/reading-lifecycle.spec.js:359:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('button', { name: 'Resume reading', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Resume reading', exact: true })

```

```yaml
- link "Skip to content":
  - /url: "#bv-main"
- banner:
  - link "Bookvane home":
    - /url: /
    - text: Bookvane
- navigation "Mobile navigation":
  - link "Discover":
    - /url: /browse
  - link "My Books":
    - /url: /my-books
  - link "You":
    - /url: /account
- main:
  - status "Loading books": Loading books…
- contentinfo:
  - link "Bookvane home":
    - /url: /
    - text: Bookvane
  - link "Privacy":
    - /url: /privacy
```

# Test source

```ts
  263 |   app.entries.set(101, entry);
  264 |   app.entries.set(201, { ...makeEntry(201, null), is_wanted: true });
  265 |   await page.setViewportSize({ width: 320, height: 900 });
  266 |   await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  267 |   await page.goto("/my-books/101");
  268 |   await expect(page.getByRole("region", { name: "Next after this" }).getByRole("article")).toHaveCount(1);
  269 |   const stop = page.getByRole("button", { name: "Stop reading", exact: true });
  270 |   await stop.focus(); await page.keyboard.press("Tab");
  271 |   await expect(page.getByRole("button", { name: "Add a note", exact: true })).toBeFocused();
  272 |   await page.keyboard.press("Tab");
  273 |   await expect(page.locator(".bv-save-reason > summary")).toBeFocused();
  274 |   await page.keyboard.press("Tab");
  275 |   await expect(page.locator(".bv-workspace-history > summary")).toBeFocused();
  276 |   await page.keyboard.press("Tab");
  277 |   await expect(page.locator(".bv-workspace-manage > summary")).toBeFocused();
  278 |   await page.keyboard.press("Tab");
  279 |   await expect(page.getByRole("region", { name: "Next after this" }).getByRole("link", { name: "Open your book", exact: true })).toBeFocused();
  280 |   // Exercise a user text override without resizing or inventing metadata.
  281 |   await page.locator(".bv-editorial-workspace").evaluate(root => {
  282 |     const sizes = [...root.querySelectorAll("h1,h2,h3,p,button,a,summary")].map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
  283 |     for (const [node, size] of sizes) node.style.fontSize = `${size * 2}px`;
  284 |   });
  285 |   const overflow = await page.locator(".bv-editorial-workspace *").evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().right > innerWidth + 1).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })));
  286 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
  287 |   expect(app.requests.filter(r => ["PUT", "PATCH", "DELETE"].includes(r.method))).toHaveLength(0);
  288 | });
  289 | 
  290 | test("editorial workspace history is lazy and reopening uses the loaded page", async ({ page, app }) => {
  291 |   app.privateContext = true;
  292 |   await page.goto("/my-books/101");
  293 |   await expect(page.getByRole("button", { name: "Update progress", exact: true })).toBeVisible();
  294 |   expect(app.requests.filter(r => r.path.endsWith("/attempts"))).toHaveLength(0);
  295 |   await openDisclosure(page, "Reading history");
  296 |   await expect(page.locator(".bv-reading-history li")).toHaveCount(1);
  297 |   const summary = page.locator(".bv-workspace-history > summary");
  298 |   await summary.click(); await summary.click();
  299 |   await expect(page.locator(".bv-reading-history li")).toBeVisible();
  300 |   expect(app.requests.filter(r => r.path.endsWith("/attempts"))).toHaveLength(1);
  301 |   expect(app.requests.filter(r => r.path.includes("reading-attempts"))).toHaveLength(0);
  302 | });
  303 | 
  304 | test("editorial workspace private books never request public metadata", async ({ page, app }) => {
  305 |   app.entries.set(101, makeEntry(101, "reading", true));
  306 |   await page.goto("/my-books/101");
  307 |   await expect(page.getByRole("heading", { name: "Private fixture 101", exact: true })).toBeVisible();
  308 |   await expect(page.getByText("No description is available for this private book.", { exact: false })).toBeVisible();
  309 |   expect(app.requests.filter(r => r.path.startsWith("/books/"))).toHaveLength(0);
  310 | });
  311 | 
  312 | test("editorial workspace keeps reading usable when book details fail", async ({ page, app }) => {
  313 |   app.bookDetailsFail = true;
  314 |   await page.goto("/my-books/101");
  315 |   await expect(page.getByRole("button", { name: "Try book details again", exact: true })).toBeVisible();
  316 |   await page.getByRole("button", { name: "Update progress", exact: true }).click();
  317 |   const field = page.getByLabel("Percent complete", { exact: true }); await field.fill("25");
  318 |   app.bookDetailsFail = false;
  319 |   await page.getByRole("button", { name: "Try book details again", exact: true }).click();
  320 |   await expect(page.getByText("Published 2000 · Catalogue: 999 pages · your copy may differ", { exact: true })).toBeVisible();
  321 |   await expect(field).toHaveValue("25");
  322 |   expect(app.requests.filter(r => r.path === "/books/101")).toHaveLength(2);
  323 |   expect(app.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
  324 | });
  325 | 
  326 | test("editorial workspace late metadata preserves a dirty version-captured editor", async ({ page, app }) => {
  327 |   let release;
  328 |   app.holdBookDetails = new Promise(done => { release = done; });
  329 |   try {
  330 |     await page.goto("/my-books/101");
  331 |     await page.getByRole("button", { name: "Update progress", exact: true }).click();
  332 |     const field = page.getByLabel("Percent complete", { exact: true }); await field.fill("25");
  333 |     await openDisclosure(page, "Manage this book");
  334 |     const want = page.getByRole("group", { name: "Your book flags" }).getByRole("button", { name: "Want", exact: true });
  335 |     await want.click(); await expect(want).toHaveAttribute("aria-pressed", "true");
  336 |     await expect(field).toHaveValue("25"); await field.focus();
  337 |     release();
  338 |     await expect(page.getByText("Published 2000 · Catalogue: 999 pages · your copy may differ", { exact: true })).toBeVisible();
  339 |     await expect(field).toBeFocused();
  340 |     await page.getByRole("button", { name: "Save progress", exact: true }).click();
  341 |     await expect(page.getByRole("alert")).toContainText("Your draft is still here");
  342 |     await expect(field).toHaveValue("25"); expect(app.attempt.progress_value).toBe(40);
  343 |     expect(app.requests.filter(r => r.path === "/books/101")).toHaveLength(1);
  344 |     expect(app.requests.find(r => r.path.includes("reading-attempts") && r.method === "PATCH").body.expected_version).toBe(2);
  345 |   } finally { release(); }
  346 | });
  347 | 
  348 | test("editorial workspace progress uses the saved copy and keeps missing values honest", async ({ page, app }) => {
  349 |   for (const [unit, value, total, text, max] of [[null, null, 200, "Not tracking progress", null], ["pages", 55, null, "Page 55", null], ["pages", 55, 200, "Page 55 of 200", "200"], ["percent", 0, null, "0%", "100"]]) {
  350 |     Object.assign(app.attempt, { progress_unit: unit, progress_value: value, total_pages: total });
  351 |     await page.goto("/my-books/101");
  352 |     await expect(page.getByRole("region", { name: "My reading", exact: true }).getByText(text, { exact: true })).toBeVisible();
  353 |     const meter = page.getByRole("progressbar", { name: "Reading progress", exact: true });
  354 |     if (max) await expect(meter).toHaveAttribute("max", max); else await expect(meter).toHaveCount(0);
  355 |     await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  356 |   }
  357 | });
  358 | 
  359 | test("editorial workspace paused actions put Resume first visually and by keyboard", async ({ page, app }) => {
  360 |   app.attempt.state = "paused"; app.entries.get(101).reading_state = "paused";
  361 |   await page.setViewportSize({ width: 390, height: 844 });
  362 |   await page.goto("/my-books/101");
> 363 |   await expect(page.getByRole("button", { name: "Resume reading", exact: true })).toBeEnabled();
      |                                                                                   ^ Error: expect(locator).toBeEnabled() failed
  364 |   await page.getByRole("link", { name: "Back to My Books", exact: true }).focus();
  365 |   for (const label of ["Own", "Want", "Resume reading", "Finish book", "Stop reading", "Update progress"]) {
  366 |     await page.keyboard.press("Tab");
  367 |     await expect(page.getByRole("button", { name: label, exact: true })).toBeFocused();
  368 |   }
  369 |   const resume = await page.getByRole("button", { name: "Resume reading", exact: true }).boundingBox();
  370 |   const progress = await page.getByRole("button", { name: "Update progress", exact: true }).boundingBox();
  371 |   expect(resume.y).toBeLessThan(progress.y);
  372 |   expect(app.requests.filter(r => ["PATCH", "PUT"].includes(r.method))).toHaveLength(0);
  373 | });
  374 | 
  375 | test("editorial workspace read-only progress is a view with no writable controls", async ({ page, app }) => {
  376 |   app.readOnly = true;
  377 |   await page.goto("/my-books/101");
  378 |   await page.getByRole("button", { name: "View progress and dates", exact: true }).click();
  379 |   await expect(page.getByLabel("Percent complete", { exact: true })).toBeDisabled();
  380 |   await expect(page.getByRole("button", { name: "Save progress", exact: true })).toBeDisabled();
  381 |   await expect(page.getByRole("button", { name: "Finish book", exact: true })).toHaveCount(0);
  382 |   expect(app.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
  383 | });
  384 | 
  385 | for (const status of [404, 503]) for (const moved of [false, true]) test(`editorial workspace retry preserves deliberate focus; ${status}; moved=${moved}`, async ({ page, app }) => {
  386 |   await page.route("**/test-api/me/library/101/reading", route => route.fulfill({ status, json: {} }), { times: 1 });
  387 |   await page.goto("/my-books/101");
  388 |   await expect(page.getByRole("heading", { name: "This reading couldn’t load.", exact: true })).toBeVisible();
  389 |   let release;
  390 |   app.holdWorkspace = new Promise(done => { release = done; });
  391 |   try {
  392 |     await page.getByRole("button", { name: "Try again", exact: true }).click();
  393 |     await expect(page.getByRole("heading", { name: "Loading your reading…", exact: true })).toBeFocused();
  394 |     const back = page.getByRole("link", { name: "Back to My Books", exact: true });
  395 |     if (moved) await back.focus();
  396 |     release();
  397 |     const title = page.getByRole("heading", { name: "Reading fixture 101", exact: true });
  398 |     await expect(title).toBeVisible();
  399 |     await expect(moved ? back : title).toBeFocused();
  400 |   } finally { release(); }
  401 | });
  402 | 
  403 | for (const moveFocus of [false, true]) test(`editorial workspace delayed identity respects keyboard focus; moved=${moveFocus}`, async ({ page, app }) => {
  404 |   let release;
  405 |   app.holdWorkspace = new Promise(done => { release = done; });
  406 |   try {
  407 |     await page.goto("/my-books");
  408 |     const link = page.getByRole("link", { name: "Reading fixture 101", exact: true });
  409 |     await link.focus(); await page.keyboard.press("Enter");
  410 |     await expect(page.getByRole("heading", { name: "Loading your reading…", exact: true })).toBeFocused();
  411 |     const back = page.getByRole("link", { name: "Back to My Books", exact: true });
  412 |     if (moveFocus) await back.focus();
  413 |     release();
  414 |     const title = page.getByRole("heading", { name: "Reading fixture 101", exact: true });
  415 |     await expect(title).toBeVisible();
  416 |     if (moveFocus) await expect(back).toBeFocused(); else await expect(title).toBeFocused();
  417 |   } finally { release(); }
  418 | });
  419 | 
  420 | test("editorial workspace late private preview cannot render after account departure", async ({ page, app }) => {
  421 |   app.nextRead = true;
  422 |   app.entries.set(203, { ...makeEntry(203, null, true), is_wanted: true });
  423 |   let release;
  424 |   app.holdNext = new Promise(done => { release = done; });
  425 |   try {
  426 |     await page.goto("/my-books/101");
  427 |     await expect.poll(() => app.requests.filter(r => r.path === "/me/next-read").length).toBe(1);
  428 |     app.authenticated = false;
  429 |     await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  430 |     await expect(page).toHaveURL(/\/login/);
  431 |     release();
  432 |     await expect(page.getByText("Private fixture 203", { exact: true })).toHaveCount(0);
  433 |   } finally { release(); }
  434 | });
  435 | 
  436 | test("M3 confirmed removal distinguishes a reading from the whole book; failure and Cancel preserve data", async ({ page, app }) => {
  437 |   app.dataControls = true;
  438 |   await page.goto("/my-books/101");
  439 |   await openDisclosure(page, "Reading history");
  440 |   await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  441 |   const dialog = page.getByRole("dialog");
  442 |   await expect(dialog).toContainText("Reading fixture 101");
  443 |   await expect(dialog).toContainText("Start date unknown");
  444 |   await expect(dialog).toContainText("other readings will stay");
  445 |   await page.keyboard.press("Escape");
  446 |   await expect(dialog).not.toBeVisible();
  447 |   expect(app.requests.filter(request => request.method === "DELETE")).toHaveLength(0);
  448 |   await openDisclosure(page, "Reading history");
  449 |   await page.getByRole("button", { name: "Delete this reading record", exact: true }).click();
  450 |   app.removeFails = true;
  451 |   await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  452 |   await expect(dialog.getByRole("alert")).toContainText("couldn’t confirm the removal");
  453 |   expect(app.attempt).not.toBeNull();
  454 |   app.removeFails = false;
  455 |   await dialog.getByRole("button", { name: "Delete reading record", exact: true }).click();
  456 |   await expect(dialog).not.toBeVisible();
  457 |   await expect(page.getByRole("heading", { name: "Not started", exact: true })).toBeVisible();
  458 |   expect(app.entries.get(101).is_owned).toBe(true);
  459 |   await openDisclosure(page, "Manage this book");
  460 |   await page.getByRole("button", { name: "Forget this book", exact: true }).click();
  461 |   await expect(dialog).toContainText("every reading, note and reaction");
  462 |   await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
  463 |   expect(app.entries.has(101)).toBe(true);
```