import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5187",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5187 --strictPort",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:5187/test-api" },
  },
});
