import config from './playwright.config.js';
export default { ...config, testMatch: ['tests/extended-catalogue.spec.js'],
  use: { ...config.use, baseURL: 'http://127.0.0.1:5196' },
  webServer: { ...config.webServer, command: 'npm run build -- --outDir dist-catalogue && npm run preview -- --outDir dist-catalogue --host 127.0.0.1 --port 5196 --strictPort',
    url: 'http://127.0.0.1:5196', env: { VITE_API_BASE_URL: 'http://127.0.0.1:5196/test-api' } },
};
