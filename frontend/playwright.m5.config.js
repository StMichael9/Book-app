import base from "./playwright.config.js";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, testMatch: ["tests/library-import.spec.js"],
  reporter: "line", outputDir: "../backend/.v3-test-runtime/m5-browser-results" });
