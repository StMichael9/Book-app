import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config.js";

const { channel, launchOptions, ...commonUse } = base.use;
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL("../../../", import.meta.url)),
  testMatch: "src/components/ui-v2/tests/reader-flows.spec.js",
  grep: /launch:/,
  outputDir: "./.test-results/launch",
  use: commonUse,
  webServer: { ...base.webServer, cwd: fileURLToPath(new URL("../../../", import.meta.url)) },
  projects: [
    { name: "chromium-desktop", use: { browserName: "chromium", channel, launchOptions } },
    { name: "chromium-phone", use: { browserName: "chromium", channel, launchOptions, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "webkit-phone", use: { browserName: "webkit", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
