# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/components/ui-v2/tests/reader-flows.spec.js >> responsive routes and themes at 390px
- Location: frontend/src/components/ui-v2/tests/reader-flows.spec.js:211:44

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - navigating to "http://127.0.0.1:5189/browse", waiting until "load"

```

# Test source

```ts
  121 |   app.authenticated = true;
  122 |   await page.goto("/book/1"); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toBeEnabled();
  123 |   app.mutationFails = true; await page.getByRole("button", { name: "Add Pride and Prejudice to Own" }).click();
  124 |   await expect(page.getByRole("alert")).toBeVisible(); await checkContrast(".bv-field-error, .bv-button--saved, .bv-help");
  125 |   await page.goto("/account"); await page.getByRole("button", { name: "Switch theme" }).click();
  126 |   await expect(page.locator(".bv-root")).toHaveCSS("background-color", "rgb(250, 248, 242)");
  127 |   await expect(page.locator(".bv-root")).toHaveCSS("color", "rgb(32, 46, 40)");
  128 | });
  129 | 
  130 | test("anonymous save survives registration and resumes exactly once", async ({ page, app }) => {
  131 |   await page.goto("/browse"); await page.getByRole("button", { name: "Add The Time Machine to Want", exact: true }).click();
  132 |   await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("dialog")).toContainText("The Time Machine");
  133 |   await page.getByRole("dialog").getByRole("link", { name: "Create an account" }).click();
  134 |   await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByLabel("Password", { exact: true }).fill("valid-password");
  135 |   await page.getByRole("button", { name: "Create account", exact: true }).click();
  136 |   await expect(page).toHaveURL(/\/book\/3/); await expect(page.getByRole("button", { name: "Remove The Time Machine from Want" })).toHaveAttribute("aria-pressed", "true");
  137 |   expect(mutations(app)).toHaveLength(1); expect(app.saved[0].status).toBe("want");
  138 |   await page.getByRole("link", { name: "View My Books" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["The Time Machine"]);
  139 | });
  140 | 
  141 | test("save confirmation waits for the API and shelf moves update the shared library", async ({ page, app }) => {
  142 |   app.authenticated = true; let release; app.holdSave = new Promise((resolve) => { release = resolve; });
  143 |   await page.goto("/book/1"); const want = page.getByRole("button", { name: "Add Pride and Prejudice to Want" }); await expect(want).toBeEnabled(); await want.click();
  144 |   await expect(want).toHaveText("Saving…"); await expect(want).toHaveAttribute("aria-pressed", "false"); expect(app.saved).toHaveLength(0);
  145 |   release(); app.holdSave = null; await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toHaveAttribute("aria-pressed", "true");
  146 |   await page.getByRole("button", { name: "Add Pride and Prejudice to Own" }).click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Own" })).toHaveAttribute("aria-pressed", "true");
  147 |   expect(app.saved).toHaveLength(1); expect(app.saved[0].status).toBe("owned"); await page.goto("/my-books?status=owned");
  148 |   await page.getByRole("button", { name: "Remove Pride and Prejudice from Own" }).click(); await expect(page.getByRole("heading", { name: "Give your books a home." })).toBeVisible(); expect(app.saved).toHaveLength(0);
  149 | });
  150 | 
  151 | test("failed writes retain the prior status and offer a real retry", async ({ page, app }) => {
  152 |   app.authenticated = true; app.mutationFails = true; await page.goto("/book/1"); const button = page.getByRole("button", { name: "Add Pride and Prejudice to Want" }); await expect(button).toBeEnabled(); await button.click();
  153 |   await expect(page.getByRole("alert")).toContainText("couldn’t be saved"); await expect(button).toHaveAttribute("aria-pressed", "false");
  154 |   app.mutationFails = false; await button.click(); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toHaveAttribute("aria-pressed", "true");
  155 | });
  156 | 
  157 | test("initial library load blocks writes and failures do not imply an empty shelf", async ({ page, app }) => {
  158 |   app.authenticated = true; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }]; let release; app.holdShelves = new Promise((resolve) => { release = resolve; });
  159 |   await page.goto("/book/1"); await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want" })).toBeDisabled(); expect(mutations(app)).toHaveLength(0);
  160 |   app.shelfFailures = 1; release(); app.holdShelves = null; await expect(page.getByRole("alert")).toContainText("saved books couldn’t load");
  161 |   await expect(page.getByRole("button", { name: "Add Pride and Prejudice to Want" })).toBeDisabled(); await page.getByRole("button", { name: "Try again", exact: true }).click();
  162 |   await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toBeEnabled(); expect(mutations(app)).toHaveLength(0);
  163 | });
  164 | 
  165 | test("author search, AND filters, hidden owned books, history and pagination use the API contract", async ({ page, app }) => {
  166 |   app.authenticated = true; await page.goto("/browse"); await page.getByLabel("Search by", { exact: true }).selectOption("author"); await page.getByLabel("Search authors").fill("Jane");
  167 |   await page.getByRole("button", { name: "Filters", exact: true }).click(); await page.getByRole("dialog").getByLabel("Romance", { exact: true }).check(); await page.getByRole("dialog").getByLabel("Classics", { exact: true }).check();
  168 |   await page.getByRole("button", { name: "Apply filters" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
  169 |   const url = new URL(page.url()); expect(url.searchParams.get("author")).toBe("Jane"); expect(url.searchParams.getAll("tag")).toEqual(["romance", "classics"]);
  170 |   await page.getByRole("button", { name: "Clear search & filters" }).click(); await expect(page.locator(".bv-book-card")).toHaveCount(5); await page.goBack(); await expect(page.getByLabel("Search authors")).toHaveValue("Jane");
  171 |   await page.goto("/browse?tag=mystery&tag=classics"); await expect(page.locator(".bv-book-card h3")).toHaveText(["The Hound of the Baskervilles"]);
  172 |   app.saved = [{ id: 5, book_id: 5, status: "owned", book: books[4] }]; await page.getByRole("button", { name: /Filters/ }).click(); await page.getByLabel("Hide books I own").check(); await page.getByRole("button", { name: "Apply filters" }).click(); await expect(page.getByRole("heading", { name: "No books found." })).toBeVisible();
  173 |   await page.getByRole("button", { name: /Filters/ }).click(); await expect(page.getByLabel("Hide books I own")).toBeChecked(); await page.keyboard.press("Escape");
  174 |   app.catalogue = Array.from({ length: 45 }, (_, i) => ({ ...books[i % 5], id: i + 1, title: `Book ${i + 1}` })); await page.goto("/browse"); await expect(page.locator(".bv-book-card")).toHaveCount(20);
  175 |   await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page).toHaveURL(/page=2/); await expect(page.locator(".bv-book-card h3").first()).toHaveText("Book 21");
  176 | });
  177 | 
  178 | test("preference-load failures cannot overwrite data; saved tag IDs preserve existing notes", async ({ page, app }) => {
  179 |   app.authenticated = true; app.preferenceFailures = 1; await page.goto("/preferences"); await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible(); await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
  180 |   expect(app.requests.filter((request) => request.path === "/me/preferences" && request.method === "POST")).toHaveLength(0);
  181 |   await page.getByRole("button", { name: "Try again" }).click(); await expect(page.getByLabel("Mystery", { exact: true })).toBeChecked(); await page.getByLabel("Romance", { exact: true }).check();
  182 |   app.mutationFails = true; await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page.getByRole("alert")).toContainText("choices are still here"); await expect(page.getByLabel("Romance", { exact: true })).toBeChecked();
  183 |   app.mutationFails = false; await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page).toHaveURL(/\/browse$/); expect(app.preferences.map((item) => item.tag_id)).toContain(4); expect(app.preferences[0].source_text).toBe("Preserve this note");
  184 | });
  185 | 
  186 | test("malformed preferences are a load failure rather than writable empty choices", async ({ page, app }) => {
  187 |   app.authenticated = true; app.malformedPreferences = true; await page.goto("/preferences"); await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "Your preferences couldn’t load." })).toBeVisible();
  188 | });
  189 | 
  190 | test("recovery remains neutral, accepts a fragment token, and handles expired links", async ({ page, app }) => {
  191 |   await page.goto("/forgot-password"); await page.getByLabel("Email address", { exact: true }).fill("reader@example.com"); await page.getByRole("button", { name: "Send reset link" }).click(); await expect(page.getByText(/If an account exists/)).toBeVisible();
  192 |   await page.goto("/reset-password#token=valid-token"); await expect(page).toHaveURL(/\/reset-password$/); await page.getByLabel("New password").fill("new-password"); await page.getByRole("button", { name: "Reset password" }).click(); await expect(page.getByText("Your password is updated. You can sign in again.")).toBeVisible(); expect(app.requests.find((request) => request.path === "/auth/reset-password").body.token).toBe("valid-token");
  193 |   await page.goto("/reset-password#token=expired"); await page.getByLabel("New password").fill("new-password"); await page.getByRole("button", { name: "Reset password" }).click(); await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible();
  194 | });
  195 | 
  196 | test("dialog traps keyboard focus, closes with Escape, and restores the trigger", async ({ page, app }) => {
  197 |   await page.goto("/browse"); const trigger = page.getByRole("button", { name: "Filters", exact: true }); await trigger.focus(); await trigger.click(); await expect(page.getByRole("dialog")).toBeVisible();
  198 |   for (let i = 0; i < 23; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement.closest("dialog")))).toBe(true); }
  199 |   await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(trigger).toBeFocused(); expect(app.requests.some((request) => request.path === "/books")).toBe(true);
  200 | });
  201 | 
  202 | test("missing cover and description have intentional fallbacks; search failures preserve context", async ({ page, app }) => {
  203 |   app.brokenCover = true; app.catalogue = [{ ...books[0], description: null }]; await page.goto("/book/1"); await expect(page.getByRole("img", { name: "Cover unavailable for Pride and Prejudice" })).toBeVisible(); await expect(page.getByText(/A description isn’t available/)).toBeVisible();
  204 |   app.catalogueFails = true; await page.goto("/browse?author=Jane"); await expect(page.getByRole("heading", { name: "The books couldn’t load." })).toBeVisible(); await expect(page.getByLabel("Search authors")).toHaveValue("Jane"); app.catalogueFails = false; await page.getByRole("button", { name: "Try again" }).click(); await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
  205 | });
  206 | 
  207 | test("external return URLs are ignored and invalid login preserves the form", async ({ page, app }) => {
  208 |   app.loginFails = true; await page.goto("/login?returnTo=https%3A%2F%2Fexample.com"); await signIn(page); await expect(page.getByRole("alert")).toContainText("Invalid email or password"); await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("reader@example.com"); app.loginFails = false; await signIn(page); await expect(page).toHaveURL(/\/my-books$/);
  209 | });
  210 | 
  211 | for (const width of [320, 390, 768, 1440]) test(`responsive routes and themes at ${width}px`, async ({ page, app }) => {
  212 |   await page.setViewportSize({ width, height: 844 }); app.authenticated = true; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  213 |   app.catalogue = [{ ...books[0], title: "A deliberately very long book title that must wrap without hiding the reader’s shelf controls" }, ...books.slice(1)];
  214 |   for (const path of ["/", "/browse", "/book/1", "/my-books", "/preferences", "/account"]) {
  215 |     await page.goto(path); await expect(page.locator("h1")).toBeVisible(); await page.locator(".bv-book-card").first().waitFor({ timeout: 1000 }).catch(() => {});
  216 |     const overflow = await page.evaluate(() => [...document.querySelectorAll(".bv-root *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ element: element.className, right: element.getBoundingClientRect().right })).slice(0, 8));
  217 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: ${JSON.stringify(overflow)}`).toBe(true);
  218 |     await expect(page.locator("body")).not.toContainText(/Shelfbound/i);
  219 |   }
  220 |   await page.goto("/account"); await page.getByRole("button", { name: "Switch theme" }).click(); await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark"); await page.reload(); await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
> 221 |   await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/browse"); await page.getByRole("button", { name: "Filters", exact: true }).click(); expect(await page.getByRole("dialog").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
      |                                                                    ^ Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
  222 | });
  223 | 
  224 | 
  225 | test("discovery context survives book details and signing in to save", async ({ page, app }) => {
  226 |   await page.goto("/browse?author=Jane&tag=romance");
  227 |   await page.getByRole("link", { name: "View Pride and Prejudice", exact: true }).click();
  228 |   await expect(page.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/browse?author=Jane&tag=romance");
  229 |   await page.getByRole("button", { name: "Add Pride and Prejudice to Want" }).click();
  230 |   await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click();
  231 |   await signIn(page); await expect(page.getByRole("button", { name: "Remove Pride and Prejudice from Want" })).toBeEnabled();
  232 |   await page.getByRole("link", { name: "Back to discovery" }).click(); await expect(page).toHaveURL(/author=Jane&tag=romance/);
  233 |   expect(mutations(app)).toHaveLength(1);
  234 | });
  235 | 
  236 | test("save-after-sign-in failures offer a retry without repeating registration", async ({ page, app }) => {
  237 |   app.mutationFails = true; await page.goto("/browse"); await page.getByRole("button", { name: "Add Frankenstein to Want" }).click();
  238 |   await page.getByRole("dialog").getByRole("link", { name: "Sign in", exact: true }).click(); await signIn(page);
  239 |   await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible(); await expect(page.getByRole("alert")).toHaveCount(1); expect(app.saved).toHaveLength(0);
  240 |   app.mutationFails = false; await page.getByRole("button", { name: "Retry save" }).click();
  241 |   await expect(page.getByRole("button", { name: "Remove Frankenstein from Want" })).toBeEnabled(); await expect(page).not.toHaveURL(/save=/);
  242 |   expect(mutations(app)).toHaveLength(2); expect(app.requests.filter((request) => request.path === "/auth/login")).toHaveLength(1);
  243 | });
  244 | 
  245 | test("visual review exports the implemented desktop and mobile screens", async ({ page, app }) => {
  246 |   const directory = new URL("../../../../../docs/ui-v2/implementation/screenshots/", import.meta.url);
  247 |   mkdirSync(directory, { recursive: true });
  248 |   for (const theme of ["light", "dark"]) {
  249 |     await page.addInitScript((value) => localStorage.setItem("bookvane-theme", value), theme);
  250 |     for (const width of [390, 1440]) {
  251 |       await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  252 |       for (const [name, path, authenticated] of [["landing", "/", false], ["discovery", "/browse", false], ["book", "/book/1", true], ["library", "/my-books", true], ["preferences", "/preferences", true], ["register", "/register", false]]) {
  253 |         app.authenticated = authenticated; app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  254 |         await page.goto(path); await expect(page.locator("h1")).toBeVisible();
  255 |         await expect(page.getByRole("status", { name: "Loading books", exact: true })).toHaveCount(0);
  256 |         await expect(page.getByText("Checking account…", { exact: true })).toHaveCount(0);
  257 |         if (name === "book") await expect(page.locator("#bv-book-title")).toBeVisible();
  258 |         if (name === "library") await expect(page.locator(".bv-book-card")).toHaveCount(1);
  259 |         if (name === "preferences") await expect(page.getByRole("button", { name: "Save preferences" })).toBeVisible();
  260 |         await page.evaluate(() => document.fonts.ready);
  261 |         await page.locator(".bv-cover img").evaluateAll((images) => Promise.all(images.map((img) => img.decode().catch(() => {}))));
  262 |         await page.screenshot({ path: new URL(`${width}-${theme}-${name}.png`, directory).pathname, fullPage: true });
  263 |       }
  264 |     }
  265 |   }
  266 | });
  267 | 
  268 | 
  269 | test("dark theme keeps primary headings and book titles legible alongside legacy styles", async ({ page, app }) => {
  270 |   app.authenticated = true; await page.addInitScript(() => localStorage.setItem("bookvane-theme", "dark"));
  271 |   for (const path of ["/browse", "/book/1", "/my-books", "/preferences", "/account"]) {
  272 |     await page.goto(path); await expect(page.locator("h1")).toBeVisible();
  273 |     if (path === "/browse") await expect(page.locator(".bv-book-card")).toHaveCount(5);
  274 |     if (path === "/book/1") await expect(page.locator("#bv-book-title")).toBeVisible();
  275 |     const ratios = await page.evaluate(() => {
  276 |       const luminance = (color) => {
  277 |         const values = color.match(/[\d.]+/g).slice(0, 3).map((value) => Number(value) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  278 |         return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  279 |       };
  280 |       const background = luminance(getComputedStyle(document.querySelector(".bv-root")).backgroundColor);
  281 |       return [...document.querySelectorAll("h1, .bv-book-card h3, .bv-results-heading h2, .bv-description h2")].map((element) => {
  282 |         const text = luminance(getComputedStyle(element).color);
  283 |         return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  284 |       });
  285 |     });
  286 |     for (const ratio of ratios) expect(ratio, path).toBeGreaterThanOrEqual(4.5);
  287 |   }
  288 | });
  289 | 
  290 | 
  291 | test("an unfinished save notice does not follow the reader to an unrelated book", async ({ page, app }) => {
  292 |   app.authenticated = true; app.mutationFails = true; await page.goto("/book/1?save=want");
  293 |   await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  294 |   await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Discover", exact: true }).click();
  295 |   await page.getByRole("link", { name: "View Frankenstein", exact: true }).click();
  296 |   await expect(page.locator("#bv-book-title")).toHaveText("Frankenstein");
  297 |   await expect(page.getByRole("button", { name: "Retry save" })).toHaveCount(0);
  298 |   expect(mutations(app)).toHaveLength(1);
  299 | });
  300 | 
  301 | 
  302 | test("library failures have one retry on My Books and still block unknown shelf writes", async ({ page, app }) => {
  303 |   app.authenticated = true; app.shelfFailures = 1;
  304 |   app.saved = [{ id: 1, book_id: 1, status: "want", book: books[0] }];
  305 |   await page.goto("/my-books");
  306 |   await expect(page.getByRole("heading", { name: "Your library couldn’t load." })).toBeVisible();
  307 |   await expect(page.getByRole("alert")).toHaveCount(1);
  308 |   await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(1);
  309 |   await expect(page.getByRole("tab", { name: /Want/ })).toContainText("…");
  310 |   await page.getByRole("button", { name: "Try again", exact: true }).click();
  311 |   await expect(page.locator(".bv-book-card h3")).toHaveText(["Pride and Prejudice"]);
  312 |   await expect(page.getByRole("alert")).toHaveCount(0);
  313 |   expect(mutations(app)).toHaveLength(0);
  314 | });
  315 | 
  316 | test("choosing a different shelf after continuation failure replaces the pending save", async ({ page, app }) => {
  317 |   app.authenticated = true; app.mutationFails = true;
  318 |   await page.goto("/book/1?save=want&from=%2Fbrowse%3Ftag%3Dromance");
  319 |   await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  320 |   await expect(page.getByRole("alert")).toHaveCount(1);
  321 |   app.mutationFails = false;
```