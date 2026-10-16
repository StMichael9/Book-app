import { defineConfig } from "@playwright/test";
import base from "./playwright.reading-integration.config.js";

export default defineConfig({ ...base,
  testMatch: ["reading-library-live.spec.js", "library-import-live.spec.js"],
  outputDir: "../backend/.v3-test-runtime/m5-live-results", reporter: "line",
  webServer: base.webServer.map((server, index) => index === 0
    ? { ...server, env: { ...server.env, LIBRARY_IMPORT_ENABLED: "true", RESEND_API_KEY: "", PASSWORD_RESET_FROM: "" } }
    : server),
});
