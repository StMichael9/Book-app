# Bookvane V2 — implemented reader UI

The approved redesign is implemented as `frontend/src/components/ui-v2/BookvaneApp.jsx` on `codex-ui`. The current launch-fix pass is based on `origin/v2-codex` at **67b6850**, where the owner has already activated this UI through the standard entry. It uses the existing auth, shared library, catalogue, preferences, recovery and share APIs. This pass changes UI components and the HTML startup shell; reserved entry files, shared API clients/providers, dependency files, backend and deployment settings remain unchanged relative to that base.

The follow-up cleanup removes repeated prompts and promotional sections, visible ISBN metadata, duplicate errors/retries, redundant auth links and single-page pagination. See the [complete change record and rationale](ui-refresh-review.md). The agreed charcoal dark theme is now implemented. Light mode is unchanged; the logo review remains pending. The [October 8 launch-fix handoff](launch-fixes-2026-10-08.md) records the confirmed QA fixes, verification and release boundaries.

## Review the actual implementation

[Desktop/mobile screenshot gallery](gallery.html) contains 24 captures of the implemented React screens: landing, discovery, book details, My Books, preferences and registration, at 390px and 1440px in both themes. These captures use five real-title reference fixtures with publisher cover art to exercise the UI consistently. The displayed count of five belongs to the test fixture. Production screens read actual catalogue totals and `cover_image_url` values from the API; reference titles, covers and descriptions are not imported into the application bundle.

Run the active application with a locally running backend:

```sh
cd frontend
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

The separate UI preview remains available for isolated design review:

```sh
cd frontend
npm ci
npx vite --config src/components/ui-v2/vite.config.js --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. This entry supports the usual application routes without editing `src/main.jsx` or `src/App.jsx`. The server port and origin should match the backend's existing CORS configuration. The existing client defaults to `http://localhost:8000` in development; set `VITE_API_BASE_URL` when using a different approved backend. A built preview uses the existing production API default unless you set that variable before building.

## Integration status

**67b6850 already loads BookvaneApp through `frontend/src/main.jsx`.** No activation edit is needed for this branch. Earlier instructions to change the App import described the initial refresh before the owner's activation; they are obsolete for the current V2 base. The old App source remains inactive in the standard entry.

Review and merge the launch-fix commit from `codex-ui` into the intended V2 integration branch using the owner's normal PR flow. This UI work does not merge or deploy. QA reported Render's frontend at `dbd5ce9` with Auto-Deploy disabled; that hosted status was not independently rechecked in this pass. A branch push alone will not update that deployment. Hosted acceptance and physical iPhone checks remain pending.

## Implemented behavior

- Landing introduces discovery and the personal library, allows browsing before registration, uses actual covers/totals and links returning readers to their library.
- Discovery offers title/author search, subject chips and a modal for combined subjects, Own/Want scope and hiding owned books. Repeated subjects retain the backend's AND behavior. URL state, pagination and browser history remain authoritative.
- Book details show useful publication/page metadata without visible ISBN, description, deliberate unavailable-cover/description states, existing sharing, and a return link preserving discovery context.
- Own/Want actions use the existing mutually exclusive `want`/`owned` contract. Buttons wait for initial shelf hydration. Confirmations appear after successful API writes; failures preserve the known state and offer retry.
- Anonymous saves carry the chosen book and shelf through account creation/sign-in, resume once after hydration, and retain discovery context. A failed continuation has one message and retry beside the shelf controls. Manually choosing a shelf successfully also consumes the pending intent, without signing in again.
- My Books shows honest shelf counts, accessible tabs, shared status updates, useful empty/loading/error states and the existing conditional Bookshop links with disclosure.
- Shelf-dependent discovery filters refresh only after confirmed changes; failed writes retain the existing results and shelf state. Ordinary browsing avoids extra catalogue reads.
- Preferences load authoritatively before becoming writable. Canonical subject choices resolve to API tag IDs; existing saved subjects are retained. The existing first `source_text` value is preserved when saving choices. Failed reads block writes; failed saves retain edits. A delayed completion no longer redirects readers who have moved to another page. Optional preferences do not interrupt the first save.
- Login, registration, account controls and password recovery reuse the audited auth provider. Recovery keeps its neutral response, consumes fragment reset tokens in memory and removes them from the address bar. External return URLs are rejected. Invalid reset links now open a fresh request form. Recovery retains validated book/shelf/discovery context through sign-in; same-tab reset links can recover that context from optional session storage for up to 30 minutes. Tokens, passwords and email addresses are never stored with this context. Successful saves, explicit abandonment and logout clear it.
- Mobile navigation, comfortable controls, keyboard focus, dialogs, light/dark themes and reduced-motion settings use the same components as desktop. App-facing branding is Bookvane throughout the new UI, including the pre-JavaScript fallback title. The startup shell and hydrated app use the same theme setting and page colors. Focus transfers from a replaced loading heading to the final book/error heading only if the reader has not moved focus.

## Design and libraries

Existing React 19, React Router and Lucide remain the application libraries. Scoped CSS implements the existing ivory/forest/rust light palette and warm charcoal/ivory/sage/rust dark palette, with responsive layout. Dark backgrounds and large panels are neutral; sage emphasizes actions and saved states. Native controls follow the dark color scheme. Lora and Source Sans 3 are self-hosted as WOFF2 with their OFL license files. Existing Bookvane logo and real API covers are reused.

The planned Radix dialog dependency was replaced by native `<dialog>` to keep the shared dependency files untouched. It supplies modal semantics and background inertness; the wrapper adds focus cycling, Escape, scroll locking and trigger restoration. Motion is limited to 140ms control color transitions and a 180ms dialog fade with a 6px entrance. Reduced-motion disables both. No animation framework or feature/tracking additions were introduced.

## Verification

See the [current launch-fix handoff](launch-fixes-2026-10-08.md) for final results and exact reproduction commands. The standard suite builds and exercises the active production entry, including the original auth/data-safety and mobile-navigation checks. The new focused configuration additionally runs the launch regressions at desktop and touch-enabled phone dimensions; it includes a WebKit project for QA machines with that browser installed.

The earlier refresh passed 23 distinct Chromium UI checks and 23 legacy default-entry regression checks. Those are historical results; the default entry now loads BookvaneApp. The checked-in gallery retains 24 captures across six views, desktop/mobile and both themes, with charcoal dark surfaces. This behavior-focused pass does not regenerate the gallery or change the approved layout/palette.

Browser tests intercept API requests and create no real accounts or library records. Live cookie/CORS behavior, email delivery, Safari/iOS devices and hosted acceptance are not verified by mocked Chromium checks. This is a responsive web implementation, not a packaged native mobile app.

For a real API build, set the intended backend URL or omit the variable to use the existing production default:

```sh
cd frontend
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

The isolated preview is also available:

```sh
npx vite build --config src/components/ui-v2/vite.config.js
npx vite preview --config src/components/ui-v2/vite.config.js --host localhost --port 5173 --strictPort
```
