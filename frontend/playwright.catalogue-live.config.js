import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'external-catalogue-live.spec.js', workers: 1, timeout: 90_000,
  outputDir: 'test-results/catalogue-live',
  use: { baseURL: 'http://127.0.0.1:5199', browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: 'retain-on-failure' },
  webServer: [
    { command: 'python tests/reading/catalogue_browser_server.py', cwd: '../backend',
      url: 'http://127.0.0.1:8007/health', reuseExistingServer: false,
      env: { IS_DEV: 'true', READING_V3_ENABLED: 'true', READING_V3_USER_IDS: '',
        CORS_ORIGINS: 'http://127.0.0.1:5199', FRONTEND_BASE_URL: 'http://127.0.0.1:5199' } },
    { command: 'npm run build -- --outDir dist-catalogue-live && npm run preview -- --outDir dist-catalogue-live --host 127.0.0.1 --port 5199 --strictPort',
      url: 'http://127.0.0.1:5199', reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:8007' } },
  ],
});
