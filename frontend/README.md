# React + Vite

## Critical-flow regression tests

From `frontend`, run `npm ci` and `npm test`. These tests build and exercise the
production frontend in a browser, intercept **all** API requests, and never
connect to Neon or the hosted backend. The test-only catalogue exists only in
browser-test fixtures; it is not added to the application's catalogue.

On Windows, reuse installed Edge without downloading a test browser:

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm test
```

Otherwise install the default test browser once with `npx playwright install
chromium`, then run `npm test`. Port 5187 must be free; the runner starts and
stops its own preview server. Test traces/results are ignored by Git.

These tests cover frontend requests/state, not actual email delivery, hosted
HTTPS/CORS/cookies, or backend authorization. Run the isolated backend suite
and the hosted release checklist separately. Nothing here is a production
import or a deployment.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
