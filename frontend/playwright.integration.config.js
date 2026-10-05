import { defineConfig } from "@playwright/test";

// Run only after following the isolated HTTPS harness instructions in README.
export default defineConfig({
  testDir: "./tests",
  testMatch: "live-local-auth.spec.js",
  timeout: 60_000,
  workers: 1,
  outputDir: "test-results/local-integration",
  use: {
    baseURL: "https://127.0.0.1:5192",
    ignoreHTTPSErrors: true, // Only the local self-signed test certificate.
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
});
