import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // Globs, so a new spec is picked up without editing this line. The live-backend specs belong to the integration configs, and the
  // visual-export spec is excluded by grepInvert below. In CI the timing-sensitive speed baseline is skipped too (the laptop keeps it).
  testMatch: ["tests/**/*.spec.js", "src/**/tests/*.spec.js"],
  testIgnore: ["**/*-live.spec.js", "**/live-local-auth.spec.js", ...(process.env.CI ? ["**/speed-baseline.spec.js"] : [])],
  // Screenshot export remains available via the isolated UI config; normal
  // regression runs must not overwrite the checked-in design gallery.
  grepInvert: /visual review exports/,
  timeout: 60_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5189",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined },
    trace: "retain-on-failure",
  },
  webServer: [{
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5189 --strictPort",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    timeout: process.env.CI ? 180_000 : 60_000,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:5189/test-api" },
  }, {
    // A second build with a Bookshop affiliate ID, for the "Get a copy" link; the first has none.
    command: "npm run build -- --outDir dist-affiliate && npm run preview -- --outDir dist-affiliate --host 127.0.0.1 --port 5190 --strictPort",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    timeout: process.env.CI ? 180_000 : 60_000,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:5190/test-api", VITE_BOOKSHOP_AFFILIATE_ID: "130585" },
  }],
});
