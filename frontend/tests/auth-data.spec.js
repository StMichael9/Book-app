import { test as base, expect } from "@playwright/test";

const book = { id: 1, title: "Browser-only book", authors: [], tags: [] };
const tag = { id: 1, name: "fantasy", type: "genre" };
const test = base.extend({
  app: async ({ page }, provide) => {
    const app = { authenticated: true, requests: [], errors: [], saved: [],
      preferences: [{ tag_id: 1, tag, source_text: "Keep this note" }], expireNext: false };
    page.on("pageerror", error => app.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5189") {
        app.errors.push(`Unexpected external request: ${url.origin}`); return route.abort();
      }
      if (!url.pathname.startsWith("/test-api/")) return route.continue();
      const path = url.pathname.slice("/test-api".length), method = request.method();
      const body = method === "POST" ? request.postDataJSON() : null;
      app.requests.push({ path, method, body });
      const reply = (status, json, headers) => route.fulfill({ status, json, headers });
      if (path === "/auth/refresh") {
        if (app.refreshNetworkFails) return route.abort("failed");
        if (app.refreshStatus) return reply(app.refreshStatus, { detail: "Service temporarily unavailable" });
        const allowed = app.authenticated && !app.refreshFails;
        if (app.holdRefresh) await app.holdRefresh;
        return reply(allowed ? 200 : 401, {}, app.cookies && allowed ? {
          "set-cookie": "access_token=older-session; Path=/; HttpOnly; SameSite=Lax",
        } : undefined);
      }
      if (path === "/auth/register") return reply(201, {});
      if (path === "/auth/login") {
        app.authenticated = true;
        return reply(200, {}, app.cookies ? {
          "set-cookie": "access_token=new-session; Path=/; HttpOnly; SameSite=Lax",
        } : undefined);
      }
      if (path === "/auth/logout") {
        app.authenticated = false;
        return reply(200, {}, { "set-cookie": "access_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax" });
      }
      if (path === "/auth/forgot-password") return reply(202, {});
      if (path === "/auth/reset-password") {
        if (app.usedReset || body.token === "invalid") return reply(400, { detail: "Invalid or expired reset link" });
        app.usedReset = true; app.authenticated = false; return reply(200, {});
      }
      if (path.startsWith("/me/") || path.endsWith("/status")) {
        if (!app.authenticated || app.expireNext) {
          app.expireNext = false; return reply(401, { detail: "Not authenticated" });
        }
      }
      if (path === "/me/books") {
        if (app.holdShelves) await app.holdShelves;
        return reply(200, app.saved);
      }
      if (path === "/me/preferences") {
        if (method === "GET") return reply(200, app.preferences);
        app.preferences = body.tag_ids.map(id => ({ tag_id: id, tag, source_text: body.source_text }));
        return reply(200, app.preferences);
      }
      if (path === "/books/1/status") {
        if (app.holdSave) await app.holdSave;
        app.saved = method === "DELETE" ? [] : [{ id: 1, book_id: 1, book, status: body.status }];
        return method === "DELETE" ? route.fulfill({ status: 204 }) : reply(200, app.saved[0]);
      }
      if (path === "/books/1") return reply(200, book);
      if (path === "/books") return reply(200, { items: [book], total: 1, page: 1, size: 20 });
      if (path === "/autocomplete/tags/batch") return reply(200, [tag]);
      if (path === "/autocomplete/tags") return reply(200, url.searchParams.get("q") === "fantasy" ? [tag] : []);
      app.errors.push(`Unhandled API: ${path}`); return reply(500, {});
    });
    await provide(app); expect(app.errors).toEqual([]);
  },
});

async function login(page) {
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("slow startup explains the wait without parallel refreshes or a navigation workaround", async ({ page, app }) => {
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  try {
    await page.goto("/my-books");
    await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(1);
    await page.clock.fastForward(9000);
    await expect(page.getByText("The server is taking longer than usual.", { exact: true })).toBeVisible();
    expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(1);
    expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.getByText("Checking your account…", { exact: true })).toHaveCount(0);
});

test("unreachable startup keeps private data gated and retries without navigation", async ({ page, app }) => {
  app.refreshNetworkFails = true;
  await page.goto("/my-books");
  await expect(page.getByRole("heading", { name: "We couldn’t check your account." })).toBeVisible();
  await expect(page).toHaveURL(/\/my-books$/);
  expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  app.refreshNetworkFails = false;
  await page.getByRole("button", { name: "Try account check again" }).click();
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Your account", exact: true })).toBeVisible();
  expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(2);
});

test("startup server errors offer retry; genuine expiry returns to sign in", async ({ page, app }) => {
  app.refreshStatus = 503;
  await page.goto("/preferences");
  await expect(page.getByRole("heading", { name: "We couldn’t check your account." })).toBeVisible();
  expect(app.requests.filter(r => r.path === "/me/preferences")).toHaveLength(0);
  app.refreshStatus = null; app.authenticated = false;
  await page.getByRole("button", { name: "Try account check again" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "We couldn’t check your account." })).toHaveCount(0);
});

test("a stalled startup has a finite deadline and a safe retry", async ({ page, app }) => {
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  try {
    await page.goto("/my-books");
    await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(1);
    await page.clock.fastForward(91_000);
    await expect(page.getByRole("heading", { name: "We couldn’t check your account." })).toBeVisible();
    await expect(page.getByText("Checking your account…", { exact: true })).toHaveCount(0);
    expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(0);
  } finally { release(); app.holdRefresh = null; }
  await page.getByRole("button", { name: "Try account check again" }).click();
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(2);
});

test("a refresh outage does not silently sign out or overwrite a saved shelf", async ({ page, app }) => {
  app.saved = [{ id: 1, book_id: 1, book, status: "want" }];
  await page.goto("/book/1");
  const own = page.getByRole("button", { name: "Add Browser-only book to Own" });
  await expect(own).toBeEnabled();
  app.expireNext = true; app.refreshNetworkFails = true;
  await own.click();
  await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(2);
  await expect(own).toBeEnabled();
  await expect(page.getByRole("link", { name: "Your account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Browser-only book from Want" })).toBeVisible();
  expect(app.saved[0].status).toBe("want");
});

test("a timed-out startup cannot replace cookies from a later explicit login", async ({ page, context, app }) => {
  app.cookies = true;
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  try {
    await page.goto("/login");
    await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(1);
    await page.clock.fastForward(91_000);
    await expect(page.getByRole("heading", { name: "We couldn’t check your account." })).toBeVisible();
    await login(page);
    await expect(page).toHaveURL(/\/my-books$/);
    release(); app.holdRefresh = null;
    await page.waitForTimeout(100);
    await expect.poll(async () => (await context.cookies()).find(c => c.name === "access_token")?.value).toBe("new-session");
    await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
  } finally { release(); app.holdRefresh = null; }
});

test("startup refresh failure cannot undo explicit login", async ({ page, app }) => {
  app.authenticated = false;
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  await page.goto("/login"); await expect.poll(() => app.requests.length).toBeGreaterThan(0);
  await login(page); expect(app.requests.some(r => r.path === "/auth/login")).toBe(false);
  release(); await expect(page).toHaveURL(/\/my-books$/);
  await expect(page.getByRole("heading", { name: "My Books", exact: true })).toBeVisible();
});

test("startup cookie response completes before a newer login cookie", async ({ page, context, app }) => {
  app.cookies = true;
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  await page.goto("/login"); await expect.poll(() => app.requests.length).toBeGreaterThan(0);
  await login(page); expect(app.requests.some(r => r.path === "/auth/login")).toBe(false);
  release(); await expect(page).toHaveURL(/\/my-books$/);
  await expect.poll(async () => (await context.cookies()).find(c => c.name === "access_token")?.value).toBe("new-session");
});

test("expired access refreshes once; permanent expiry removes private UI", async ({ page, app }) => {
  await page.goto("/book/1");
  const own = page.getByRole("button", { name: "Add Browser-only book to Own" });
  await expect(own).toBeEnabled(); app.expireNext = true; await own.click();
  const owned = page.getByRole("button", { name: "Remove Browser-only book from Own" });
  await expect(owned).toBeEnabled(); expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(2);
  app.expireNext = true; app.refreshFails = true; await owned.click();
  await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(3);
  await page.goto("/my-books"); await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("logout waits for a cookie-writing automatic refresh", async ({ page, app }) => {
  await page.goto("/account"); await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  app.cookies = true; app.expireNext = true;
  let release; app.holdRefresh = new Promise(resolve => { release = resolve; });
  // A preferences read returns 401 and starts the real API client's refresh.
  await page.getByRole("link", { name: /Choose subjects/ }).click();
  await expect.poll(() => app.requests.filter(r => r.path === "/auth/refresh").length).toBe(2);
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "My Books", exact: true }).waitFor();
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForTimeout(100);
  try { expect(app.requests.filter(r => r.path === "/auth/logout")).toHaveLength(0); }
  finally { release(); }
  await expect(page).toHaveURL(/\/$/);
  expect(app.requests.findIndex(r => r.path === "/auth/logout")).toBeGreaterThan(app.requests.findIndex(r => r.path === "/auth/refresh"));
});

test("explicit preference clearing and first note preservation survive the new UI", async ({ page, app }) => {
  await page.goto("/preferences"); await expect(page.getByLabel("Fantasy", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences[0].source_text).toBe("Keep this note");
  expect(app.requests.filter(r => r.path === "/autocomplete/tags/batch")).toHaveLength(1);
  expect(app.requests.filter(r => r.path === "/autocomplete/tags")).toHaveLength(0);
  await page.goto("/preferences"); await page.getByLabel("Fantasy", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click(); await expect(page).toHaveURL(/\/browse$/);
  expect(app.preferences).toEqual([]);
});

test("a reset link can be consumed once through the production entry", async ({ page, app }) => {
  app.authenticated = false;
  for (const reused of [false, true]) {
    await page.goto("/reset-password#token=browser-only-token");
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel("New password").fill("Test-password-123");
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    if (reused) await expect(page.getByRole("heading", { name: "This link is no longer valid." })).toBeVisible();
    else await expect(page.getByText("Your password is updated. You can sign in again.")).toBeVisible();
  }
});

test("ordinary discovery has one shared library read and one startup refresh", async ({ page, app }) => {
  await page.goto("/browse"); await expect(page.locator(".bv-book-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add Browser-only book to Want" })).toBeEnabled();
  expect(app.requests.filter(r => r.path === "/me/books")).toHaveLength(1);
  expect(app.requests.filter(r => r.path === "/auth/refresh")).toHaveLength(1);
  expect(app.requests.filter(r => r.path === "/books")).toHaveLength(1);
});
