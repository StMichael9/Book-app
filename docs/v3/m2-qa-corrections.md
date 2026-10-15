# M2 independent QA corrections

Feature branch: `codex/v3-m2-reading-lifecycle`; draft PR #13 targets `v3`. Corrects the three findings from independent QA at `1a10fd1`. No production, migration, catalogue, backend/auth, hosting or dependency changes; no M3 work.

## Changes

- **V3-M2-001, P2 — unsaved draft loss:** `ReadingPages.jsx` keeps the editor outside the workspace loading/error branch. Own/Want success updates flag state without closing the editor, so the same form and entered progress/dates survive the bounded refetch. The original entry version remains captured with the draft; it is never silently rebased after a flag write. A subsequent conflict leaves the draft visible. Explicit close/reload explains that unsaved edits are discarded. Other lifecycle/history-selection controls cannot replace an open draft; reopening a selected older attempt explicitly labels its discard effect. Workspace-route and account changes still discard the previous scope's draft, preventing cross-book/account state reuse.
- **V3-M2-002, P2 — missing reading state:** `LibraryPage.jsx` renders the API's existing `reading_state` as Reading / Paused / Finished / Stopped for catalogue and private entries. No invented state for untracked books, new database field, history download or extra query. Active/latest precedence remains server-owned.
- **V3-M2-003, P3 — unexplained disabled creation:** the private form uses the existing read-only notice; Home also explains paused changes. Home/library hide the creation link when read-only, while direct links still give an explanation and a working return path. Disabled/older backends keep the existing V2 fallback.

The UI lead reviewed the proposed interaction and requested retained drafts with captured versions, no autosave or confirmation dialogs for independent flags, the existing readable API state, and consistent paused-creation guidance. Existing design primitives and styles are reused.

## Executed verification

- **10 targeted Edge browser regressions passed, 36.7 s**, using only in-memory API responses. Both flags: successful change during a deliberately delayed workspace refetch retains percent/date fields; stale save uses the original version, fails safely, and retains values; explicit reload/reapply then succeeds. Failed flag writes leave the draft usable and permit a valid save.
- The same targeted run checks public/private card states and no-attempt behavior in light/dark 390 px layouts, no extra history requests, read-only private form/Home/library guidance, disabled and capability-404 compatibility, workspace-route editor reset, and account-expiry draft clearance. No page errors were recorded by the fixture.
- Lint passed with the same 12 existing warnings and no errors. Production build passed as browser-test setup.
- **Complete frontend regression suite: 109 passed, 4.0 min**, including the ten correction checks. This covers the final route-key correction and these fixes alongside the existing V2/M1/auth/session-isolation cases. The targeted ten overlap this full run; do not add them as separate unique tests. Earlier implementation backend/live-integration results remain attributed to their original candidate and are not represented as re-executed for this frontend-only correction.

## Independent closure and remaining boundaries

Independent QA retested application commit `3f1104db8f9beec23d767eacbfeb0cc9fb00923d`: **10 checks passed**, six Edge/four WebKit, zero page errors. It independently closed **V3-M2-001, V3-M2-002 and V3-M2-003**. The UI lead also reported no blocking source/design finding in those corrections. This is their disposition, not an implementing-developer substitution for independent review.

After Michael's explicit M2-specific approval, independent QA executed **17 lifecycle tests (6.23 s)** and **four real browser/API/PostgreSQL journeys (39.3 s)** on two fresh disposable local databases, all passing with zero failures/errors/skips. Final decision: **GO for M2 milestone integration review**. QA verified targets/roles/freshness, migrated only fresh fixtures, stopped its services and released the shared-build hold. No existing implementation/M1 QA target was reused or cleared.

Saved final independent report: `deliverables/Bookvane_V3_M2_Independent_QA_2026-10-15.md`; evidence manifest/logs/JUnit under `deliverables/qa-v3-m2-2026-10-15/verification-r1/` in the parent workspace. Documentation updates after the tested commit change no application code.

No production/Neon, email, real import, physical phone or hosted-cookie certification is included. Main/V2 stay unchanged; no merge, deployment or M3 begins here. Historical startup branding/theme findings remain separately tracked, not silently fixed or closed by this patch. The milestone is ready for integration review, not a full-V3 public release.
