# M1 independent QA corrections

Scope: V3-M1-001 (P1 account-switching isolation) and V3-M1-002 (P2 empty-page recovery), on `codex/v3-reading-home`. No M2 work, backend/schema changes, production migration, deployment, catalogue import, or new infrastructure.

## What changed

- `frontend/src/components/ui-v2/DiscoveryPages.jsx`: Welcome and Discover now use the existing authentication session generation in their authenticated cache scope. That same scope is already part of both the API in-flight deduplication key and the screen request key. A later account therefore starts its own request; the existing request hook ignores departed-screen responses. Anonymous cache TTL and within-session deduplication are unchanged. No user identity is sent as a query parameter or stored in local storage.
- `frontend/src/components/reading/LibraryPage.jsx`: pagination is outside the nonempty-card branch. Empty cursor pages retain Previous (when reached through pagination) and Return to first page. Copy distinguishes an empty page or filtered view from a genuinely empty library. Filters/search survive recovery, and browser history still drives Previous. No saved entry or relationship is removed by this correction.
- `frontend/tests/reading-library.spec.js`: extends the existing intercepted-API browser fixtures; no real accounts, database writes, or external API calls. Adds independent-account delayed-response cases for V2 and V3, Want/Own/exclude-owned, successful/error/401-refresh responses, Welcome, empty page recovery in both themes on phones, direct read-only cursor links, filtered empty states, and concurrent changes on page three.

## Verification boundary

Executed with installed Edge against the existing production-build test entry and intercepted local API:

- Initial two targeted correction cases: **2 passed (12.9 s)**.
- Complete frontend regression suite: **97 passed (3.4 min)**. This includes the existing 72 cases and the first 25 new regression cases.
- Final expanded library suite, including the additional concurrent page-three case: **34 passed (1.6 min)**. This overlaps the full run; it is not 34 additional unique tests.
- Final screenshot-setup/phone recovery recheck: **2 passed (18.4 s)**, covering both themes.
- Production build succeeded as part of each browser run. Final lint exited 0 with the same 12 existing warnings and no errors. `git diff --check` passed.
- Light/dark phone empty-page captures were inspected. The final capture setup scrolls to the top to avoid a full-document screenshot artifact from off-viewport fixed elements.

An initial restricted-process browser attempt could not reach its child loopback server and was cancelled; restricted lint also traversed ignored dependencies. The local-only browser and lint runs above were rerun successfully through the approved execution context, not reported as passes from those unsuccessful attempts.

These frontend checks do not recertify hosted cookies, actual backend authorization, or production database behavior. The backend/migration code is unchanged; the prior M1 backend/recovery evidence remains historical evidence, not a fresh run for this patch. All 26 new regression cases are synthetic browser fixtures, not catalogue records.

Independent QA owns retest and milestone sign-off. Fix implementation alone does not override the independent QA NO-GO. M2 and production remain unauthorized.
