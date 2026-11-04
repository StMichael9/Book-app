import { test, expect } from "@playwright/test";

// The page text is Source Sans, bundled as "Bookvane Sans", not the system font; form controls inherit it.
test("the body and form controls render in Bookvane Sans", async ({ page, baseURL }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname.startsWith("/test-api/")) return route.fulfill({ status: 401, json: { detail: "Not signed in" } });
    return route.continue();
  });
  await page.goto("/browse");
  await expect(page.locator(".bv-root")).toBeVisible();
  const family = selector => page.evaluate(sel => getComputedStyle(document.querySelector(sel)).fontFamily, selector);
  expect(await family("body")).toMatch(/^"?Bookvane Sans"?/);
  expect(await family(".bv-root button")).toMatch(/^"?Bookvane Sans"?/);
  await page.evaluate(() => {
    const root = document.querySelector(".bv-root");
    for (const tag of ["input", "textarea", "select"]) { const node = document.createElement(tag); node.className = "font-probe"; root.append(node); }
  });
  for (const tag of ["input", "textarea", "select"]) expect(await family(`.font-probe${tag === "input" ? "" : ""}:is(${tag})`)).toMatch(/^"?Bookvane Sans"?/);
});

test("body font screenshots", async ({ page, baseURL }) => {
  test.skip(!process.env.BOOK_SHOTS, "set BOOK_SHOTS=1 to export screenshots");
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname.startsWith("/test-api/")) return route.fulfill({ status: 401, json: { detail: "Not signed in" } });
    return route.continue();
  });
  const dir = "node_modules/.bv-preview/body-font";
  for (const [label, width, height] of [["390", 390, 844], ["1440", 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/browse");
    await expect(page.locator(".bv-root")).toBeVisible();
    await page.screenshot({ path: `${dir}/after-${label}.png` });
    // "Before": the body in the system font and bare form controls, as the page rendered without the fix.
    const before = await page.addStyleTag({ content: `body { font-family: "Segoe UI", sans-serif !important; } .bv-root :is(button, input, select, textarea) { font-family: revert !important; }` });
    await page.screenshot({ path: `${dir}/before-${label}.png` });
    await before.evaluate(node => node.remove());
  }
});
