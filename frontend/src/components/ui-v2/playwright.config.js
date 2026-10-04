import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests", outputDir: "./.test-results", workers: 1, timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5189", browserName: "chromium", trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: "npx vite preview --config src/components/ui-v2/vite.config.js --host 127.0.0.1 --port 5189 --strictPort",
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    url: "http://127.0.0.1:5189", reuseExistingServer: false,
  },
});
