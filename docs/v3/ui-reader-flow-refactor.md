# V3 reader-flow UI refactor

Michael approved the UI/UX research and implementation proposal on October 17, 2026. This feature starts from integrated V3 `c370014977b8e9c7983fbf3412af0e70347ce6dd` on `codex/v3-ui-reader-flow`. The original proposal is saved in the UI chat's workspace as `deliverables/Bookvane_V3_UI_UX_Research_and_Proposal_2026-10-17.md`.

## Approved direction

- Preserve the existing ivory/forest/rust light palette, charcoal/sage dark palette, fonts, logo, routes and domain contracts.
- Current reading leads Home. Paused books have an honest recovery path; choosing/discovering/importing remains optional.
- My Books catalogue and private card titles open their personal workspace; public catalogue details remain a separate secondary link.
- Finish commits independently. Its saved confirmation and skippable Want-first choices precede secondary workspace actions/context/history.
- Import stays on its existing My Books route, with an informational stage indicator, source guidance near upload, optional encoding/paste disclosure, preview before confirmation, and completed-results navigation to Home.
- Existing importer links on empty Home and You implement the recommended shortcut decision; there is no automatic onboarding or new import engine.
- Clarify historical facet meaning without changing queries/counts. Own and Want still coexist; Start clears Want and preserves Own; rereading and reopening are distinct.

## Implementation / file ownership

This UI branch owns the frontend presentation diff listed here. The implementation lead's local Windows checkout is separate; do not simultaneously edit these feature files during review/QA. Direct messaging to that chat was unavailable in this UI environment; no mutual execution hold or independent QA sign-off is claimed.

- `components/reading/ReadingCards.jsx`: current-reading and personal-library cards; delayed-read notice.
- `components/reading/ReadingPages.jsx`: Home composition and finish/workspace section order; optional memory/data disclosures. Editors remain outside request-loading branches, with their original captured versions and keys.
- `components/reading/LibraryPage.jsx`: personal destinations, grouped facets, truthful history captions and import entry.
- `components/reading/NextReadSection.jsx`: three-choice presentation only. Commands, reasons, filtering, rotation and pending-skip guards remain intact.
- `components/reading/imports/ImportJourney.jsx`: informational server-phase presentation.
- `components/reading/imports/LibraryImportPage.jsx`: presentation order and instructions. Existing upload/advance/decision/confirm handlers and consent fields are retained.
- `components/ui-v2/{BookvaneApp,AccountPages,DiscoveryPages}.jsx`: current-navigation semantics, import shortcut and concise reading/Start consequence copy.
- `styles/ui-v2/{reading-home,library-import}.css`: scoped layout using existing tokens; no palette replacement.
- Frontend regression specs: explicit disclosure navigation plus new hierarchy/destination/finish/import assertions. Existing safety assertions are not weakened.

No changes to `frontend/src/main.jsx`, retained legacy `frontend/src/App.jsx`, backend application files, auth/library providers, API clients, dependency manifests/lockfile, schema, migrations or hosting. No Neon/production/real-account requests or imports. No new design-system dependency or animation.

Public detail's guarded **Open or start your reading** route remains, with explicit consequences explained beside it. This avoids changing the already-tested pending-Want → Start sequence or silently manufacturing rereads. More granular public CTA state is a separate reviewed composition change, not a claim that opening public details now creates a reading.

## Verification and remaining gates

Results are recorded in the UI chat's implementation handoff after completion. Do not equate an implementation build/mock-browser pass with independent QA, physical Safari or hosted/public acceptance.

Initial verification setup failures: ordinary sandbox networking blocked dependency retrieval/server start; packages installed with the supported per-command network permission. WebKit installation using a workspace cache then failed with explicit network-policy 403 at browser-download hosts. No alternate-domain bypass was attempted. Chromium is available locally.

An initial 83-case targeted run was intentionally interrupted: 60 passed, one interrupted, 22 not run. It reached an old test path that did not open the newly disclosed removal controls. The final test paths explicitly open the relevant section before exercising the unchanged confirmation/version assertions. This interrupted run is not a complete pass and is not added to later counts.

Required independent handoff: exact frozen SHA; Chromium/Edge plus WebKit pointer/keyboard focus matrix; historical editor identity and retained stale drafts; phone bottom-nav/keyboard visibility; finish/Next pending and failure boundaries; upload/review/confirmation/pause/resume/cancel/results; owner/session isolation; both initial and toggled themes. Expand backend/integration testing only if the reviewed diff touches those contracts.

Current native Goodreads/StoryGraph export acceptance, physical iPhone file/reader-loop checks, matching hosted configuration/session acceptance, monitored privacy/support contact, and public rollout/recovery approval remain separate open release gates. No merge, deployment, migration or public enablement is implied by this UI branch.
