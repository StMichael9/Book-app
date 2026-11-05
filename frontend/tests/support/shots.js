import { mkdirSync } from "node:fs";

// Phase A screenshot matrix, written outside node_modules so it survives a reinstall. Set FOUNDATIONS_SHOTS=before|after.
// Each caller passes the page to open; the matrix is 390 and 1440 wide, light and dark, full page.
export const shotsEnabled = () => Boolean(process.env.FOUNDATIONS_SHOTS);

export async function shootMatrix(page, name, open) {
  const dir = `../.bv-shots/foundations/${process.env.FOUNDATIONS_SHOTS}`;
  mkdirSync(dir, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(value => localStorage.setItem("bookvane-theme", value), theme);
    for (const [width, height] of [[390, 844], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await open();
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".bv-cover img").evaluateAll(images => Promise.all(images.map(image => image.decode().catch(() => {}))));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-${width}-${theme}.png`, fullPage: true });
    }
  }
}
