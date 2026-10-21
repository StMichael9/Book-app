import config from './playwright.config.js';
export default { ...config,
  testMatch: ['tests/extended-catalogue.spec.js', 'tests/reading-corrections.spec.js', 'tests/reading-lifecycle.spec.js', 'tests/library-import.spec.js'],
  use: { ...config.use, baseURL: 'http://127.0.0.1:5197' },
  webServer: { ...config.webServer,
    command: 'npm run build -- --outDir dist-journey && npm run preview -- --outDir dist-journey --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197', env: { VITE_API_BASE_URL: 'http://127.0.0.1:5197/test-api' } },
};
