import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/critical-flows.spec.js", "tests/auth-data.spec.js", "tests/mobile-navigation.spec.js", "src/components/ui-v2/tests/reader-flows.spec.js"],
  // Screenshot export remains available via the isolated UI config; normal
  // regression runs must not overwrite the checked-in design gallery.
  grepInvert: /visual review exports/,
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5189",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5189 --strictPort",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:5189/test-api" },
  },
});
