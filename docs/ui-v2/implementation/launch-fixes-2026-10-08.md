# Bookvane V2 — confirmed UI launch fixes

October 8, 2026. Implemented on `codex-ui`, based on `origin/v2-codex` **67b6850bb8f59e97a1a4f595a880de5eae0ed179**. This is a focused implementation of the independently reproduced QA findings, preserving the approved editorial layout, light palette and charcoal dark mode.

## What changed

| QA finding | Result | Primary files |
| --- | --- | --- |
| P1 invalid/expired recovery link leaves the request page stuck | Request and reset routes mount separate recovery state. **Send a new link** now opens the email form and can submit a fresh request. | `BookvaneApp.jsx` |
| P2 shelf-filtered discovery stays stale after a shelf move | Successful shelf mutations invalidate shelf-dependent results and request deduplication scope. Want/Own filters and hiding owned books reflect the confirmed server state without a reload. Failed writes retain results; ordinary browsing avoids extra catalogue reads. | `ReaderContext.jsx`, `DiscoveryPages.jsx` |
| P2 recovery loses the pending book/save/discovery path | Forgot-password and return-to-sign-in links carry validated local context. Fragment-only reset links in the same tab can recover that context from optional session storage. Signing in resumes once after library hydration, retains the discovery path and consumes the pending intent after confirmed success. | `AccountPages.jsx`, `recoveryIntent.js`, `ReaderContext.jsx` |
| P2 late preferences completion redirects after leaving the page | Completion still invalidates preference-dependent ordering, but only announces, updates form state or navigates if the initiating editor is still mounted on the same route. Existing saved tag IDs and first note remain preserved. | `AccountPages.jsx`, `DiscoveryPages.jsx` |
| P2 loading-book heading replacement loses keyboard focus | If route navigation focused the loading heading, focus follows its replacement title/error heading. Moving focus to another control cancels that transfer. The observer cleans up on navigation/unmount. | `BookvaneApp.jsx` |
| P3 pre-JavaScript fallback title says Shelfbound | The standard HTML title is **Bookvane**, including while the module is delayed or fails to load. Route titles retain Bookvane. | `frontend/index.html` |
| P3 startup theme differs from the saved/current theme | Both HTML entries and the reader use **bookvane-theme**, with the same OS fallback and ivory/charcoal canvas colors. The root canvas also stays correct when toggling. | `frontend/index.html`, `preview.html`, `ReaderContext.jsx` |

The P1 first-tap Safari/Discover jump was already fixed in base **67b6850**. Its main-focus guard is preserved and its inherited touch/keyboard regressions remain in the standard suite. This pass does not claim a new Safari release.

Component paths above are relative to `frontend/src/components/ui-v2/` unless explicitly stated otherwise. Historical inactive source and archives were not mass-renamed; the active entry, HTML startup shell and rendered routes contain no Shelfbound branding.

## Continuity and data boundaries

- Recovery storage contains only canonical book ID, `want`/`owned`, a validated local return path and a 30-minute expiry in `sessionStorage`. Reset tokens, passwords and email addresses are never persisted with this metadata.
- Query context works without storage. The fragment-only reset fallback is limited to the same origin and tab; it does not promise cross-device continuity.
- Successful saves clear recovery context for that book, including manual shelf choices and already-saved continuations. Failed writes keep it available for retry. Explicit **Back to books** and logout clear it; expired or external stored context cannot resume a save.
- Writes continue through the existing shared provider and auth/cookie sequencing. Shelf hydration, failure blocking, stale-session guards, neutral recovery responses and single-use reset handling remain intact.
- No changes relative to **67b6850** in reserved `frontend/src/main.jsx`, `frontend/src/App.jsx`, `backend/main.py`, shared API clients/providers, dependency files, database schema or deployment settings. The owner has already activated the new App in the standard entry.

## Verification

- **85 standard-entry Chromium checks passed together** (1.8 minutes), covering the inherited 64 checks plus 21 new launch regressions. This includes auth/cookie sequencing, startup retry, reset single use, preferences preservation, bounded ordinary-browse requests and the existing first-tap/keyboard mobile cases.
- **42 focused launch checks passed together** (44.3 seconds): the same 21 cases on desktop Chromium and touch-enabled Chromium at 390 × 844.
- The corrected inherited contrast check also passed **three consecutive runs** before the final full suite.
- Standard frontend and isolated UI production builds both passed using the normal production API defaults after browser testing.
- Full frontend lint exits successfully with **13 pre-existing warnings**, including the unchanged `SessionStatus` effect in `BookvaneApp.jsx:43`. UI-scoped lint has only that inherited warning; this pass adds no lint warnings.
- `git diff --check` passed, and comparison against **67b6850** confirms zero changes in reserved entry/backend files, shared clients/providers and dependency files.

All browser cases intercept API requests and use local fixtures. They create no real users, books, preference records or shelf writes. New coverage includes expired-link navigation, Want/Own/exclude-owned refresh, failed mutations, both pending shelf choices through recovery, same-tab reset continuation, storage expiry/safe returns, manual save cleanup, delayed preferences success/failure, loading-heading success/error/reader-moved-focus, and startup theme/title before the deferred module loads.

One inherited contrast test sampled the 140 ms primary-to-saved color transition during hydration. It now explicitly waits for the final saved text and background colors before measuring contrast. The contrast thresholds and production styles are unchanged.

Reproduce with existing locked dependencies:

```sh
cd frontend
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config playwright.config.js
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config src/components/ui-v2/launch-fixes.config.js --project chromium-desktop --project chromium-phone
npm run lint
npm run build
npx vite build --config src/components/ui-v2/vite.config.js
```

Omit `PLAYWRIGHT_EXECUTABLE_PATH` on a machine with a Playwright-managed Chromium installation. The standard and focused configurations build the standard entry with an intercepted test API. The final ordinary builds use the existing production API default. Generated outputs are ignored; the gallery is not overwritten.

For independent WebKit acceptance on a QA machine with the browser installed:

```sh
npx playwright test --config src/components/ui-v2/launch-fixes.config.js --project webkit-phone
```

WebKit installation was attempted here, but the execution environment returned **403 Domain forbidden** for the official browser-download URLs. No WebKit pass, installed Edge pass, physical iPhone pass or hosted acceptance is claimed by this implementation. QA's prior independent WebKit/Edge reproductions establish the original defects, not verification of these fixes.

## Integration and release handoff

Review/merge this branch through the owner's normal V2 PR flow. No activation import edit is needed on this base. This UI pass does not create a PR, merge, deploy, change Auto-Deploy or write a database.

QA last reported the hosted frontend at **dbd5ce9** with Auto-Deploy disabled, and the compatible backend at **bfd88b9**. Hosted versions were not independently rechecked here. Pushing the branch therefore does not establish that the hosted fixes are live. After the intended frontend release, independently accept the real discovery → recovery/sign-in → save → My Books journey on desktop and a physical iPhone, including hosted cookies/CORS and email recovery. No backend migration is introduced by this diff. Logo refinement and broader design work remain optional follow-ups.
