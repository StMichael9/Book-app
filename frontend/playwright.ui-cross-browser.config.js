import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
const { channel, launchOptions, ...common } = base.use;

// Uses the same isolated in-memory API fixtures as the standard suite. Firefox
// does not implement Playwright's isMobile emulation; viewport tests still run.
export default defineConfig({
  ...base,
  use: common,
  outputDir: "test-results/ui-cross-browser",
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel, launchOptions } },
    { name: "firefox", testIgnore: "**/mobile-navigation.spec.js", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
