import { defineConfig } from "@playwright/test";

// Local-only (untracked): the clubs spec on port 5489, so it never touches the 5189 lock.
export default defineConfig({
  testDir: ".",
  testMatch: ["tests/clubs.spec.js", "tests/clubs-page.spec.js", "tests/profile.spec.js", "tests/findability.spec.js"],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5489",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: [{
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5489 --strictPort",
    url: "http://127.0.0.1:5489",
    reuseExistingServer: false, timeout: 300000,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:5489/test-api" },
  }],
});
