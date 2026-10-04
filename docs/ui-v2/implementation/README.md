# Bookvane V2 — implemented reader UI

The approved redesign is implemented as `frontend/src/components/ui-v2/BookvaneApp.jsx` on `codex-ui`, based on the audited V2 contracts at `39ca688`. It uses the existing auth, shared library, catalogue, preferences, recovery and share APIs. New source files are limited to the agreed UI directories; no existing application source, package, lockfile, backend or deployment configuration was edited.

The follow-up cleanup removes repeated prompts and promotional sections, visible ISBN metadata, duplicate errors/retries, redundant auth links and single-page pagination. See the [complete change record and rationale](ui-refresh-review.md). The agreed charcoal dark theme and logo review remain pending; this pass preserves the current theme colors.

## Review the actual implementation

[Desktop/mobile screenshot gallery](gallery.html) contains 24 captures of the implemented React screens: landing, discovery, book details, My Books, preferences and registration, at 390px and 1440px in both themes. These captures use five real-title reference fixtures with publisher cover art to exercise the UI consistently. The displayed count of five belongs to the test fixture. Production screens read actual catalogue totals and `cover_image_url` values from the API; reference titles, covers and descriptions are not imported into the application bundle.

Run the isolated application with a locally running backend:

```sh
cd frontend
npm ci
npx vite --config src/components/ui-v2/vite.config.js --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. This entry supports the usual application routes without editing `src/main.jsx` or `src/App.jsx`. The server port and origin should match the backend's existing CORS configuration. The existing client defaults to `http://localhost:8000` in development; set `VITE_API_BASE_URL` when using a different approved backend. A built preview uses the existing production API default unless you set that variable before building.

## Activate in the main application — reserved file owner

Once these new files are present in the intended V2 integration branch, change **one import** in `frontend/src/main.jsx`:

```diff
-import App from "./App.jsx";
+import App from "./components/ui-v2/BookvaneApp.jsx";
```

Keep the existing `<App />`, `BrowserRouter`, `AuthProvider`, `UserBooksProvider` and `index.css` import. `BookvaneApp` imports its own scoped stylesheet. The isolated preview includes the original global CSS and provider order, so this combination was exercised in browser tests. The reserved `App.jsx` can remain in place; it is not imported by the new entry.

This reserved owner edit has **not been made by this UI work**. The branch has been pushed; the owner reported merging the initial refresh into **v2-codex**. Merging files alone does not activate this import. The owner's local checkout may differ from GitHub, and deployment has not been verified.

## Implemented behavior

- Landing introduces discovery and the personal library, allows browsing before registration, uses actual covers/totals and links returning readers to their library.
- Discovery offers title/author search, subject chips and a modal for combined subjects, Own/Want scope and hiding owned books. Repeated subjects retain the backend's AND behavior. URL state, pagination and browser history remain authoritative.
- Book details show useful publication/page metadata without visible ISBN, description, deliberate unavailable-cover/description states, existing sharing, and a return link preserving discovery context.
- Own/Want actions use the existing mutually exclusive `want`/`owned` contract. Buttons wait for initial shelf hydration. Confirmations appear after successful API writes; failures preserve the known state and offer retry.
- Anonymous saves carry the chosen book and shelf through account creation/sign-in, resume once after hydration, and retain discovery context. A failed continuation has one message and retry beside the shelf controls. Manually choosing a shelf successfully also consumes the pending intent, without signing in again.
- My Books shows honest shelf counts, accessible tabs, shared status updates, useful empty/loading/error states and the existing conditional Bookshop links with disclosure.
- Preferences load authoritatively before becoming writable. Canonical subject choices resolve to API tag IDs; existing saved subjects are retained. The existing first `source_text` value is preserved when saving choices. Failed reads block writes; failed saves retain edits. Optional preferences do not interrupt the first save.
- Login, registration, account controls and password recovery reuse the audited auth provider. Recovery keeps its neutral response, consumes fragment reset tokens in memory and removes them from the address bar. External return URLs are rejected.
- Mobile navigation, comfortable controls, keyboard focus, dialogs, light/dark themes and reduced-motion settings use the same components as desktop. App-facing branding is Bookvane throughout the new UI.

## Design and libraries

Existing React 19, React Router and Lucide remain the application libraries. Scoped CSS implements the ivory/forest/rust palette and responsive layout. Lora and Source Sans 3 are self-hosted as WOFF2 with their OFL license files. Existing Bookvane logo and real API covers are reused.

The planned Radix dialog dependency was replaced by native `<dialog>` to keep the shared dependency files untouched. It supplies modal semantics and background inertness; the wrapper adds focus cycling, Escape, scroll locking and trigger restoration. Motion is limited to 140ms control color transitions and a 180ms dialog fade with a 6px entrance. Reduced-motion disables both. No animation framework or feature/tracking additions were introduced.

## Verification

- **22 current Chromium browser checks passed together**, including save-after-auth, one-time resumption/retry, failed writes and reads, filters/history/pagination, preference preservation, recovery links, keyboard dialogs, cover fallbacks, safe return URLs, reduced motion, theme persistence and primary dark-theme text contrast.
- Routes were checked at **320, 390, 768 and 1440px** with deliberately long titles; no horizontal page overflow occurred.
- **23 existing V2 regression checks passed** against the unchanged default application during the initial implementation; those source files remain untouched.
- Isolated redesign and original frontend production builds passed.
- New UI source lint is clean. Full frontend lint exits successfully with 11 existing warnings in untouched source files.
- All 24 screenshots were regenerated after the cleanup; desktop/mobile landing, registration and detail captures were inspected. The initial refresh also corrected legacy global heading colors in dark mode.

Browser tests intercept API requests and create no real accounts or library records. Live cookie/CORS behavior, email delivery and Safari/iOS device behavior were not independently verified here. This is a responsive web implementation, not a packaged native mobile app.

Reproduce UI verification using the existing locked dependencies:

```sh
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:5189/test-api npx vite build --config src/components/ui-v2/vite.config.js
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config src/components/ui-v2/playwright.config.js
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config src/components/ui-v2/regression.config.js
npx oxlint src/components/ui-v2
npm run lint
```

Omit `PLAYWRIGHT_EXECUTABLE_PATH` when using an installed Playwright browser. The regression wrapper only adapts the original test configuration to the system browser; it does not change the existing tests. Generated build and test outputs stay in ignored directories inside `ui-v2`.

For a real API build, replace the test API variable with the intended backend URL, or omit it to use the existing production default:

```sh
npx vite build --config src/components/ui-v2/vite.config.js
npx vite preview --config src/components/ui-v2/vite.config.js --host localhost --port 5173 --strictPort
```
