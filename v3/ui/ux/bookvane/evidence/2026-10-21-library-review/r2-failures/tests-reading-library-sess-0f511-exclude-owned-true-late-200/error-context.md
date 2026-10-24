# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-library.spec.js >> session isolation: V2, exclude_owned=true, late 200
- Location: frontend/tests/reading-library.spec.js:266:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: undefined

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#bv-main"
  - banner [ref=e5]:
    - generic [ref=e6]:
      - link "Bookvane home" [ref=e7] [cursor=pointer]:
        - /url: /
        - generic [ref=e8]: Bookvane
      - navigation "Main navigation" [ref=e9]:
        - link "Discover" [ref=e10] [cursor=pointer]:
          - /url: /browse
        - link "My Books" [ref=e11] [cursor=pointer]:
          - /url: /my-books
        - link "Preferences" [ref=e12] [cursor=pointer]:
          - /url: /preferences
      - generic [ref=e13]:
        - button "Use dark theme" [ref=e14] [cursor=pointer]
        - link "Your account" [ref=e17] [cursor=pointer]:
          - /url: /account
  - main [ref=e22]:
    - generic [ref=e23]:
      - generic [ref=e24]:
        - heading "Find your next chapter." [level=1] [ref=e25]
        - paragraph [ref=e26]: Search by title or author, or start with a subject you love.
      - generic [ref=e27]:
        - search [ref=e28]:
          - generic [ref=e29]: Search by
          - combobox "Search by" [ref=e30]:
            - option "Title" [selected]
            - option "Author"
          - generic [ref=e31]: Search book titles
          - searchbox "Search book titles" [ref=e32]
          - button "Search" [ref=e33] [cursor=pointer]
        - button "Filters, 1 active" [ref=e38] [cursor=pointer]:
          - generic [ref=e40]: Filters
      - generic "Browse subjects" [ref=e41]:
        - button "All subjects" [ref=e42] [cursor=pointer]
        - button "Fantasy" [ref=e43] [cursor=pointer]
        - button "Mystery" [ref=e44] [cursor=pointer]
        - button "Romance" [ref=e45] [cursor=pointer]
        - button "Science fiction" [ref=e46] [cursor=pointer]
        - button "Classics" [ref=e47] [cursor=pointer]
        - button "History" [ref=e48] [cursor=pointer]
      - generic "Applied filters" [ref=e49]:
        - generic [ref=e50]: Books you own hidden
        - button "Clear search & filters" [ref=e51] [cursor=pointer]
      - generic [ref=e52]:
        - heading "Books to explore" [level=2] [ref=e53]
        - generic [ref=e54]: Loading books…
      - status "Loading books" [ref=e55]:
        - generic [ref=e56]: Loading books…
  - contentinfo [ref=e108]:
    - generic [ref=e109]:
      - link "Bookvane home" [ref=e110] [cursor=pointer]:
        - /url: /
        - generic [ref=e111]: Bookvane
      - link "Privacy" [ref=e112] [cursor=pointer]:
        - /url: /privacy
```

# Test source

```ts
  172 |   app.conflictNext = true;
  173 |   await page.goto("/book/1");
  174 |   await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  175 |   await expect(page.getByRole("alert")).toContainText("changed on another page");
  176 |   expect(app.entries.get(1).is_owned).toBe(false);
  177 |   await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want", exact: true })).toBeVisible();
  178 |   await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  179 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toBeVisible();
  180 | });
  181 | 
  182 | test("large library pagination, search and both facets use bounded server queries", async ({ page, app }) => {
  183 |   app.entries = new Map(books.map(book => [book.id, row(book.id, true, true)]));
  184 |   await page.goto("/my-books");
  185 |   await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  186 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  187 |   await page.getByRole("button", { name: "Next page", exact: true }).click();
  188 |   await expect(page.locator(".bv-book-card")).toHaveCount(5);
  189 |   await page.goBack();
  190 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  191 |   await page.goForward();
  192 |   await expect(page.locator(".bv-book-card")).toHaveCount(5);
  193 |   await page.getByRole("button", { name: "Previous page", exact: true }).click();
  194 |   await expect(page.locator(".bv-book-card")).toHaveCount(25);
  195 |   await page.getByLabel("Search title or author").fill("fixture 01");
  196 |   await page.getByRole("search", { name: "Search your library" }).getByRole("button", { name: "Search", exact: true }).click();
  197 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  198 |   await page.getByText("More filters", { exact: true }).click();
  199 |   await page.getByRole("group", { name: "More library filters" }).getByRole("button", { name: /^Own/ }).click();
  200 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  201 |   expect(app.requests.some(request => request.path === "/me/books")).toBe(false);
  202 | });
  203 | 
  204 | test("capability failure stays gated instead of falling back to unsafe legacy writes", async ({ page, app }) => {
  205 |   app.capabilityFails = true;
  206 |   await page.goto("/my-books");
  207 |   await expect(page.getByRole("heading", { name: "Your library couldn’t load." })).toBeVisible();
  208 |   expect(app.requests.filter(request => request.path === "/me/books")).toHaveLength(0);
  209 |   app.capabilityFails = false;
  210 |   await page.getByRole("button", { name: "Try again", exact: true }).click();
  211 |   await expect(page.getByLabel("Search title or author")).toBeVisible();
  212 | });
  213 | 
  214 | test("pilot library stays usable on a phone in both themes", async ({ page, app }) => {
  215 |   await page.setViewportSize({ width: 390, height: 844 });
  216 |   await page.goto("/my-books");
  217 |   await expect(page.getByLabel("Search title or author")).toBeVisible();
  218 |   await expect(page.getByLabel("Search title or author")).toHaveCSS("border-top-width", "1px");
  219 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  220 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  221 |   await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-phone-final.png", fullPage: true });
  222 |   await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "You", exact: true }).click();
  223 |   await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  224 |   await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "My Books", exact: true }).click();
  225 |   await expect(page.getByLabel("Search title or author")).toBeVisible();
  226 |   await expect(page.locator(".bv-book-card")).toHaveCount(1);
  227 |   await page.screenshot({ path: "../backend/.v3-test-runtime/m1-library-phone-dark.png", fullPage: true });
  228 |   expect(app.requests.some(request => request.path === "/me/books")).toBe(false);
  229 | });
  230 | 
  231 | test("disabling writes preserves the richer library in read-only mode", async ({ page, app }) => {
  232 |   app.readOnly = true;
  233 |   app.entries.set(1, row(1, true, true));
  234 |   await page.goto("/my-books");
  235 |   await expect(page.getByRole("status").filter({ hasText: "Your library is available to read. Changes are temporarily paused." })).toBeVisible();
  236 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toBeDisabled();
  237 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  238 |   expect(app.requests.some(request => request.path.endsWith("/status") || request.method === "PUT")).toBe(false);
  239 | });
  240 | 
  241 | async function expireAndSignInAsB(page, app, returnTo) {
  242 |   app.authenticated = false;
  243 |   await page.evaluate(() => window.dispatchEvent(new Event("bookvane:session-expired")));
  244 |   await page.getByRole("link", { name: "Sign in", exact: true }).click();
  245 |   await expect(page).toHaveURL(/\/login(?:\?|$)/);
  246 |   await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  247 |   // Keep this entirely within the SPA: a full navigation would clear the
  248 |   // module-level request map and conceal the account-switching defect.
  249 |   if (returnTo) await page.evaluate(path => {
  250 |     window.history.replaceState(null, "", `/login?returnTo=${encodeURIComponent(path)}`);
  251 |     window.dispatchEvent(new PopStateEvent("popstate"));
  252 |   }, returnTo);
  253 |   if (returnTo) await expect(page.getByRole("link", { name: "Create an account", exact: true })).toHaveAttribute("href", `/register?${new URLSearchParams({ returnTo })}`);
  254 |   await page.getByLabel("Email address", { exact: true }).fill("b@example.com");
  255 |   await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  256 |   await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("b@example.com");
  257 |   await expect(page.getByLabel("Password", { exact: true })).toHaveValue("synthetic-password");
  258 |   const signedIn = page.waitForResponse(response => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  259 |   await page.getByRole("button", { name: "Sign in", exact: true }).click();
  260 |   await signedIn;
  261 | }
  262 | 
  263 | for (const legacy of [true, false]) {
  264 |   for (const filter of ["shelf_status=want", "shelf_status=owned", "exclude_owned=true"]) {
  265 |     for (const lateStatus of [200, 503, 401]) {
  266 |       test(`session isolation: ${legacy ? "V2" : "V3"}, ${filter}, late ${lateStatus}`, async ({ page, app }) => {
  267 |         Object.assign(app, { legacy, accountFixtures: true, account: "A", lateCatalogueStatus: lateStatus });
  268 |         let release;
  269 |         app.holdCatalogue = new Promise(resolve => { release = resolve; });
  270 |         try {
  271 |           await page.goto(`/browse?${filter}`);
> 272 |           await expect.poll(() => app.heldStarted).toBe(true);
      |                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  273 |           await expireAndSignInAsB(page, app, `/browse?${filter}`);
  274 |           // B must finish its OWN request before A is allowed to complete.
  275 |           await expect.poll(() => app.requests.filter(r => r.path === "/books" && r.account === "B" && r.query.toString().includes(filter)).length).toBe(1);
  276 |           await expect(page.getByRole("heading", { name: "No books found.", exact: true })).toBeVisible();
  277 |           release();
  278 |           await expect.poll(() => app.heldCompleted).toBe(true);
  279 |           // Settle React callbacks from both a late success and a late failure.
  280 |           await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  281 |           await expect(page.getByRole("heading", { name: "No books found.", exact: true })).toBeVisible();
  282 |           await expect(page.getByRole("link", { name: "Your account", exact: true })).toBeVisible();
  283 |           await expect(page.locator(".bv-book-card")).toHaveCount(0);
  284 |           // A departed session's 401 must not rotate B's cookies or replay its
  285 |           // operation using B's identity, even for an otherwise safe read.
  286 |           expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(1);
  287 |           expect(app.requests.filter(r => r.path === "/books" && r.account === "B" && r.query.toString().includes(filter))).toHaveLength(1);
  288 |         } finally { release(); }
  289 |       });
  290 |     }
  291 |   }
  292 | 
  293 |   test(`Welcome isolates pending personalized results across ${legacy ? "V2" : "V3"} sessions`, async ({ page, app }) => {
  294 |     Object.assign(app, { legacy, accountFixtures: true, account: "A" });
  295 |     let release;
  296 |     app.holdCatalogue = new Promise(resolve => { release = resolve; });
  297 |     try {
  298 |       await page.goto("/");
  299 |       await expect.poll(() => app.heldStarted).toBe(true);
  300 |       await expireAndSignInAsB(page, app, "/");
  301 |       await expect.poll(() => app.requests.filter(r => r.path === "/books" && r.account === "B").length).toBe(1);
  302 |       await expect(page.locator(".bv-book-card")).toHaveCount(1);
  303 |       release();
  304 |       await expect.poll(() => app.heldCompleted).toBe(true);
  305 |       await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  306 |       await expect(page.locator(".bv-book-card")).toContainText("Library fixture 02");
  307 |       await expect(page.locator(".bv-book-card")).not.toContainText("Library fixture 01");
  308 |     } finally { release(); }
  309 |   });
  310 | }
  311 | 
  312 | for (const theme of ["light", "dark"]) {
  313 |   test(`empty later library page retains recovery after mutation (${theme})`, async ({ page, app }) => {
  314 |     app.entries = new Map(books.slice(0, 26).map(book => [book.id, row(book.id)]));
  315 |     await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
  316 |     await page.setViewportSize({ width: 390, height: 844 });
  317 |     await page.goto("/my-books?status=want");
  318 |     await expect(page.locator(".bv-book-card")).toHaveCount(25);
  319 |     await page.getByRole("button", { name: "Next page", exact: true }).click();
  320 |     await expect(page.locator(".bv-book-card")).toHaveCount(1);
  321 |     await page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true }).click();
  322 |     await expect(page.getByRole("heading", { name: "No books on this page.", exact: true })).toBeVisible();
  323 |     // Capture from the top so off-viewport fixed elements are not included at
  324 |     // the prior scroll offset by a full-document browser screenshot.
  325 |     await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  326 |     await page.screenshot({ path: `../backend/.v3-test-runtime/m1-empty-page-${theme}.png`, fullPage: true });
  327 |     expect([...app.entries.values()].filter(entry => entry.is_wanted)).toHaveLength(25);
  328 |     await page.getByRole("button", { name: "Previous page", exact: true }).click();
  329 |     await expect(page.locator(".bv-book-card")).toHaveCount(25);
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
```