import { test, expect } from "@playwright/test";

// Local browser fixtures only. First-paint assertions deliberately hold the
// application module; these are not hosted TLS or physical-device acceptance.
for (const scenario of [
  { name: "current preference wins", current: "dark", legacy: "light", system: "light", expected: "dark" },
  { name: "current light wins", current: "light", legacy: "dark", system: "dark", expected: "light" },
  { name: "legacy migrates", legacy: "dark", system: "light", expected: "dark" },
  { name: "invalid current falls back to legacy", current: "invalid", legacy: "light", system: "dark", expected: "light" },
  { name: "invalid preferences use system", current: "invalid", legacy: "invalid", system: "dark", expected: "dark" },
  { name: "blocked reads use system", blockedRead: true, system: "dark", expected: "dark" },
  { name: "blocked writes preserve legacy choice", legacy: "dark", blockedWrite: true, system: "light", expected: "dark" },
]) {
  test(`M6 theme before and after React: ${scenario.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript(values => {
      localStorage.clear();
      if (values.current) localStorage.setItem("bookvane-theme", values.current);
      if (values.legacy) localStorage.setItem("shelfbound-theme", values.legacy);
      if (values.blockedRead) Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
      if (values.blockedWrite) Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    }, scenario);
    await page.route("**/test-api/**", route => route.fulfill({ status: 401, json: {} }));
    let releaseModule;
    const held = new Promise(resolve => { releaseModule = resolve; });
    await page.route("**/assets/*.js", async route => { await held; return route.continue(); });
    try {
      await page.goto("/login", { waitUntil: "commit" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", scenario.expected);
      await expect(page).toHaveTitle("Bookvane");
      expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe(scenario.expected);
      expect(await page.getByRole("heading", { name: "Welcome back." }).count()).toBe(0);
    } finally { releaseModule(); }
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", scenario.expected);
    if (!scenario.blockedRead && !scenario.blockedWrite) {
      expect(await page.evaluate(() => localStorage.getItem("bookvane-theme"))).toBe(scenario.expected);
    }
  });
}

test("M6 saved theme switches and reloads without preference reversal", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/test-api/**", route => route.fulfill({ status: 401, json: {} }));
  await page.goto("/login");
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", "dark");
});
