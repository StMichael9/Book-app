import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'reading-shelf-live.spec.js', workers: 1, timeout: 90_000,
  outputDir: 'test-results/shelf-integration',
  use: { baseURL: 'http://127.0.0.1:5198', browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: 'retain-on-failure' },
  webServer: [
    { command: 'python tests/reading/shelf_browser_server.py', cwd: '../backend',
      url: 'http://127.0.0.1:8006/health', reuseExistingServer: false,
      env: { IS_DEV: 'true', READING_V3_ENABLED: 'true', READING_V3_USER_IDS: '',
        EXTERNAL_CATALOGUE_ENABLED: 'false', PASSWORD_RESET_ENABLED: 'false',
        CORS_ORIGINS: 'http://127.0.0.1:5198', FRONTEND_BASE_URL: 'http://127.0.0.1:5198' } },
    { command: 'npm run build -- --outDir dist-shelf && npm run preview -- --outDir dist-shelf --host 127.0.0.1 --port 5198 --strictPort',
      url: 'http://127.0.0.1:5198', reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:8006' } },
  ],
});
