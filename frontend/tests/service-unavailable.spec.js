import { test, expect } from "@playwright/test";

// Browser fixtures only: the API answers 503 (or drops the connection) until the test lets it recover.
const book = { id: 1, title: "Outage fixture", authors: [{ id: 1, name: "Fixture Author" }], tags: [], description: "A fixture.", published_year: 2001, page_count: 200, cover_image_url: null };

async function mockApi(page, baseURL, state) {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith("/test-api/")) return route.continue();
    const path = url.pathname.slice("/test-api".length), reply = (status, json) => route.fulfill({ status, json });
    if (state.mode === "503") return reply(503, { detail: { code: "service_unavailable", message: "Bookvane is temporarily unavailable." } });
    if (state.mode === "network") return route.abort("failed");
    if (path === "/auth/refresh") return reply(401, {});
    if (path === "/me/reading-capabilities") return reply(200, { enabled: false });
    if (path === "/books") return reply(200, { items: [book], total: 1, page: 1, size: 20 });
    if (path === "/books/1") return reply(200, book);
    if (path.startsWith("/autocomplete")) return reply(200, []);
    return reply(200, {});
  });
}

for (const mode of ["503", "network"]) for (const start of ["/browse", "/"]) {
  test(`a ${mode} outage on ${start} shows one calm banner that clears when the API is back`, async ({ page, baseURL }) => {
    const state = { mode }, errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await mockApi(page, baseURL, state);
    if (start === "/") await page.addInitScript(() => localStorage.setItem("bookvane:session-hint:v1", "1"));
    await page.goto(start);
    const banner = page.getByText("Bookvane is having trouble on our end.");
    await expect(banner).toBeVisible();
    await expect(page.getByText("We couldn’t check your account.")).toHaveCount(0);
    await expect(page.getByText("Opening Bookvane…")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/50[234]|quota|Request failed/);
    state.mode = "ok";
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(banner).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

