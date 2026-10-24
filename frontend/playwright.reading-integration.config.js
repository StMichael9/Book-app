import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests", testMatch: "reading-library-live.spec.js", workers: 1, timeout: 90_000,
  outputDir: "test-results/reading-integration",
  use: { baseURL: "http://127.0.0.1:5193", browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: "retain-on-failure" },
  webServer: [
    { command: "python tests/reading/browser_server.py", cwd: "../backend",
      url: "http://127.0.0.1:8005/health", reuseExistingServer: false,
      env: { IS_DEV: "true", READING_V3_ENABLED: "true", READING_V3_USER_IDS: "",
        CORS_ORIGINS: "http://127.0.0.1:5193", FRONTEND_BASE_URL: "http://127.0.0.1:5193" } },
    { command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5193 --strictPort",
      url: "http://127.0.0.1:5193", reuseExistingServer: false,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:8005" } },
  ],
});
