import { defineConfig } from "@playwright/test";
import base from "./playwright.integration.config.js";

// Reuse the loopback-only HTTPS harness; never use a hosted connection string.
export default defineConfig({ ...base, timeout: 120_000,
  metadata: { readingTLS: true, cookieSameSite: "Lax" },
  outputDir: "../backend/.v3-test-runtime/m6-https-results",
  webServer: {
    command: "npm --prefix ../frontend run build && python tests/browser_server.py",
    cwd: "../backend",
    url: "https://127.0.0.1:8009/health", ignoreHTTPSErrors: true,
    reuseExistingServer: false, timeout: 120_000,
    env: { IS_DEV: "false", BOOKVANE_V3_TLS_TEST: "yes",
      READING_V3_ENABLED: "true", READING_V3_USER_IDS: "",
      COOKIE_DOMAIN: "", COOKIE_SAMESITE: "lax", CORS_ORIGINS: "https://127.0.0.1:5192",
      FRONTEND_BASE_URL: "https://127.0.0.1:5192", VITE_API_BASE_URL: "https://127.0.0.1:8009",
      RESEND_API_KEY: "", PASSWORD_RESET_FROM: "" },
  },
});
