import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
const { channel, launchOptions, ...commonUse } = base.use;

// Real touch events are essential: mouse clicks do not reproduce Safari's
// focus on main before a link activates. WebKit is a simulation, not iOS.
export default defineConfig({
  ...base,
  use: commonUse,
  testMatch: "tests/mobile-navigation.spec.js",
  outputDir: "test-results/mobile-navigation",
  projects: [
    { name: "webkit-phone", use: { browserName: "webkit" } },
    { name: "chromium-phone", use: { browserName: "chromium", channel, launchOptions } },
  ],
});
