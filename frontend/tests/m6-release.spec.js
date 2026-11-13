import { test, expect } from "@playwright/test";

// Local browser fixtures only. First-paint assertions deliberately hold the
// application module; these are not hosted TLS or physical-device acceptance.
// A guest always matches the device, whatever an earlier visit saved, and loading the page never writes a theme.
for (const scenario of [
  { name: "a dark device", system: "dark", expected: "dark" },
  { name: "a light device", system: "light", expected: "light" },
  { name: "an old saved choice does not move a guest", current: "dark", system: "light", expected: "light" },
  { name: "an old legacy value does not move a guest", legacy: "dark", system: "light", expected: "light" },
  { name: "blocked reads use the device", blockedRead: true, system: "dark", expected: "dark" },
  { name: "blocked writes still follow the device", legacy: "dark", blockedWrite: true, system: "light", expected: "light" },
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
      await expect(page).toHaveTitle("Bookvane · Your personal reading home");
      expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe(scenario.expected);
      await expect(page.locator("body")).toHaveCSS("background-color", scenario.expected === "dark" ? "rgb(30, 29, 27)" : "rgb(250, 248, 242)");
      expect(await page.getByRole("heading", { name: "Welcome back." }).count()).toBe(0);
    } finally { releaseModule(); }
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    await expect(page.locator(".bv-root")).toHaveAttribute("data-theme", scenario.expected);
  });
}
