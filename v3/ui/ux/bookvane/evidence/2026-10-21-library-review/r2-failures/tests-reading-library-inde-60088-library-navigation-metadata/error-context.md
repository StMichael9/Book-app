# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/reading-library.spec.js >> independent review: another account cannot recover old library navigation metadata
- Location: frontend/tests/reading-library.spec.js:512:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Sign in', exact: true })

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
      - button "Use dark theme" [ref=e13] [cursor=pointer]
  - main [ref=e16]:
    - generic [ref=e18]:
      - complementary [ref=e19]:
        - paragraph [ref=e20]: Your next chapter starts here
        - heading "A little shelf. A lot of possibility." [level=2] [ref=e21]: A little shelf.A lot of possibility.
        - paragraph [ref=e22]: The books you own. The ones you’re curious about. A library you can come back to.
        - generic [ref=e23]:
          - paragraph [ref=e26]:
            - strong [ref=e27]: Own
            - text: The ones you know.
          - paragraph [ref=e28]:
            - strong [ref=e29]: Want
            - text: The next possibilities.
      - generic [ref=e30]:
        - generic [ref=e31]:
          - heading "Welcome back." [active] [level=1] [ref=e32]
          - generic [ref=e33]: Your books are right where you left them.
        - generic [ref=e34]:
          - generic [ref=e35]:
            - generic [ref=e36]: Email address
            - textbox "Email address" [ref=e37]:
              - /placeholder: you@example.com
          - generic [ref=e38]:
            - generic [ref=e39]: Password
            - generic [ref=e40]:
              - textbox "Password" [ref=e41]
              - button "Show password" [ref=e42] [cursor=pointer]: Show
            - generic [ref=e43]: You can use your password manager.
          - link "Forgot password?" [ref=e44] [cursor=pointer]:
            - /url: /forgot-password?returnTo=%2Fmy-books%2F5
          - button "Sign in" [ref=e45] [cursor=pointer]
        - paragraph [ref=e46]:
          - text: New to Bookvane?
          - link "Create an account" [ref=e47] [cursor=pointer]:
            - /url: /register?returnTo=%2Fmy-books%2F5
        - link "Back to books" [ref=e48] [cursor=pointer]:
          - /url: /browse
  - contentinfo [ref=e51]:
    - generic [ref=e52]:
      - link "Bookvane home" [ref=e53] [cursor=pointer]:
        - /url: /
        - generic [ref=e54]: Bookvane
      - link "Privacy" [ref=e55] [cursor=pointer]:
        - /url: /privacy
```

# Test source

```ts
  144 | });
  145 | 
  146 | test("Own and Want coexist, removing one preserves the other and survives reload", async ({ page, app }) => {
  147 |   await page.goto("/book/1");
  148 |   await page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true }).click();
  149 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true })).toHaveAttribute("aria-pressed", "true");
  150 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  151 |   await page.getByRole("button", { name: "Remove Library fixture 01 from Want", exact: true }).click();
  152 |   await page.reload();
  153 |   await expect(page.getByRole("button", { name: "Remove Library fixture 01 from Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  154 |   await expect(page.getByRole("button", { name: "Add Library fixture 01 to Want", exact: true })).toHaveAttribute("aria-pressed", "false");
  155 |   expect(app.entries.get(1).is_owned).toBe(true);
  156 |   expect(app.entries.get(1).is_wanted).toBe(false);
  157 |   expect(app.requests.some(request => request.path.endsWith("/status"))).toBe(false);
  158 | });
  159 | 
  160 | test("failed and malformed lookups block writes and offer a real retry", async ({ page, app }) => {
  161 |   app.malformedLookup = true;
  162 |   await page.goto("/book/1");
  163 |   await expect(page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true })).toBeDisabled();
  164 |   await expect(page.getByRole("button", { name: "Try saved status again" })).toBeVisible();
  165 |   app.malformedLookup = false;
  166 |   await page.getByRole("button", { name: "Try saved status again" }).click();
  167 |   await expect(page.getByRole("button", { name: "Add Library fixture 01 to Own", exact: true })).toBeEnabled();
  168 |   expect(app.requests.filter(request => request.method === "PUT")).toHaveLength(0);
  169 | });
  170 | 
  171 | test("a stale update shows current state without overwriting it", async ({ page, app }) => {
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
> 244 |   await page.getByRole("link", { name: "Sign in", exact: true }).click();
      |                                                                  ^ Error: locator.click: Test timeout of 60000ms exceeded.
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
  272 |           await expect.poll(() => app.heldStarted).toBe(true);
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
```