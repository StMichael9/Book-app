import { test, expect } from "@playwright/test";

const api = "https://127.0.0.1:8009";
const origin = "https://127.0.0.1:5192";
const password = "Local-test-password-123";

test("real HTTPS cookies, refresh, two-user isolation, persistence and password reset", async ({ browser }) => {
  const first = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const failures = [];
  for (const context of [first, second]) {
    await context.route("**/*", route => {
      if (![origin, api].includes(new URL(route.request().url()).origin)) {
        failures.push("Unexpected external network request"); return route.abort();
      }
      return route.continue();
    });
    context.on("page", page => page.on("pageerror", error => failures.push(error.message)));
  }
  const a = await first.newPage(), b = await second.newPage();
  const emailA = `local-a-${Date.now()}@example.com`, emailB = `local-b-${Date.now()}@example.com`;
  async function register(page, email) {
    await page.goto(`${origin}/register`);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/my-books`);
  }
  try {
    await register(a, emailA); await register(b, emailB);
    for (const context of [first, second]) {
      const cookies = (await context.cookies(api)).filter(c => ["access_token", "refresh_token"].includes(c.name));
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie.secure).toBe(true); expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("None");
      }
    }
    expect(await a.evaluate(() => document.cookie)).not.toContain("access_token");
    await a.goto(`${origin}/browse`);
    await a.getByRole("button", { name: "Add Local browser integration book to Want" }).click();
    await expect(a.getByRole("button", { name: "Remove Local browser integration book from Want" })).toBeEnabled();
    await a.goto(`${origin}/my-books`); await a.reload(); await expect(a.locator(".bv-book-card")).toHaveCount(1);
    await b.reload(); await expect(b.locator(".bv-book-card")).toHaveCount(0);
    const blocked = await second.request.delete(`${api}/books/1/status`, { headers: { Origin: origin } });
    expect(blocked.status()).toBe(404);
    await a.goto(`${origin}/preferences`); await a.getByLabel("Fantasy", { exact: true }).check();
    await a.getByRole("button", { name: "Save preferences" }).click(); await expect(a).toHaveURL(`${origin}/browse`);
    await b.goto(`${origin}/preferences`); await expect(b.getByLabel("Fantasy", { exact: true })).not.toBeChecked();
    await b.getByLabel("Mystery", { exact: true }).check(); await b.getByRole("button", { name: "Save preferences" }).click();
    await expect(b).toHaveURL(`${origin}/browse`);
    await a.goto(`${origin}/preferences`); await expect(a.getByLabel("Fantasy", { exact: true })).toBeChecked();
    await expect(a.getByLabel("Mystery", { exact: true })).not.toBeChecked();
    const denied = await first.request.post(`${api}/me/preferences`, { headers: { Origin: "https://untrusted.example" }, data: { tag_ids: [] } });
    expect(denied.status()).toBe(403);
    await a.reload(); await expect(a.getByLabel("Fantasy", { exact: true })).toBeChecked();

    const refreshBefore = (await first.cookies(api)).find(c => c.name === "refresh_token").value;
    const expired = await first.request.get(`${api}/__test__/expire-access`, { headers: { "X-Bookvane-Test": "local-browser-test-only" } });
    expect(expired.status()).toBe(200);
    // A protected UI write must rotate the refresh cookie and retry once.
    await a.getByLabel("Fantasy", { exact: true }).uncheck(); await a.getByRole("button", { name: "Save preferences" }).click();
    await expect(a).toHaveURL(`${origin}/browse`);
    expect((await first.cookies(api)).find(c => c.name === "refresh_token").value).not.toBe(refreshBefore);
    const replay = await first.request.post(`${api}/auth/refresh`, { headers: { Origin: origin, Cookie: `refresh_token=${refreshBefore}` } });
    expect(replay.status()).toBe(401);

    const oldAccess = (await first.cookies(api)).find(c => c.name === "access_token").value;
    const oldRefresh = (await first.cookies(api)).find(c => c.name === "refresh_token").value;
    await a.goto(`${origin}/forgot-password`); await a.getByLabel("Email address", { exact: true }).fill(emailA);
    await a.getByRole("button", { name: "Send reset link" }).click(); await expect(a.getByText(/If an account exists/)).toBeVisible();
    const delivered = await first.request.get(`${api}/__test__/reset-link?email=${encodeURIComponent(emailA)}`, { headers: { "X-Bookvane-Test": "local-browser-test-only" } });
    const { url } = await delivered.json(); expect(url).toContain(`${origin}/reset-password#token=`);
    await a.goto(url); await expect(a).toHaveURL(`${origin}/reset-password`);
    await a.getByLabel("New password").fill("New-local-password-456"); await a.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(a.getByText("Your password is updated. You can sign in again.")).toBeVisible();
    expect((await first.cookies(api)).filter(c => ["access_token", "refresh_token"].includes(c.name))).toEqual([]);
    const oldSession = await first.request.get(`${api}/me/books`, { headers: { Cookie: `access_token=${oldAccess}` } });
    expect(oldSession.status()).toBe(401);
    const oldRotation = await first.request.post(`${api}/auth/refresh`, { headers: { Origin: origin, Cookie: `refresh_token=${oldRefresh}` } });
    expect(oldRotation.status()).toBe(401);
    await a.goto(url); await a.getByLabel("New password").fill("Different-local-password-789");
    await a.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(a.getByRole("heading", { name: "This link is no longer valid." })).toBeVisible();
    await a.goto(`${origin}/login`); await a.getByLabel("Email address", { exact: true }).fill(emailA);
    await a.getByLabel("Password", { exact: true }).fill(password); await a.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(a.getByRole("alert")).toContainText("Invalid email or password");
    await a.getByLabel("Password", { exact: true }).fill("New-local-password-456"); await a.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(a).toHaveURL(`${origin}/my-books`); await expect(a.locator(".bv-book-card")).toHaveCount(1);
    const toRevoke = (await first.cookies(api)).find(c => c.name === "refresh_token").value;
    await a.goto(`${origin}/account`); await a.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(a).toHaveURL(`${origin}/`);
    expect((await first.cookies(api)).filter(c => ["access_token", "refresh_token"].includes(c.name))).toEqual([]);
    const revoked = await first.request.post(`${api}/auth/refresh`, { headers: { Origin: origin, Cookie: `refresh_token=${toRevoke}` } });
    expect(revoked.status()).toBe(401);
    await a.goto(`${origin}/my-books`); await expect(a).toHaveURL(/\/login\?returnTo=/);
    await b.goto(`${origin}/preferences`); await expect(b.getByLabel("Mystery", { exact: true })).toBeChecked();
    expect(failures).toEqual([]);
  } finally { await first.close(); await second.close(); }
});
