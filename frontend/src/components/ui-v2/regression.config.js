import { fileURLToPath } from "node:url";
import existingConfig from "../../../playwright.config.js";

// Run the existing V2 tests with this environment's system browser.
// Keeps the shared test configuration and existing source files untouched.
export default {
  ...existingConfig,
  testDir: fileURLToPath(new URL("../../../tests/", import.meta.url)),
  outputDir: "./.regression-results",
  use: { ...existingConfig.use, launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined } },
  webServer: { ...existingConfig.webServer, cwd: fileURLToPath(new URL("../../../", import.meta.url)) },
};
