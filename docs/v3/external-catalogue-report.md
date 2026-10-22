# Bookvane Catalogue — implementation and verification handoff

## Current verification — 22 October 2026

The application integration and UI corrections are already in `v3` at
`64abc8fa784639724ff89a19b6c3f7a30d4e4bf7` (PRs #24 and #26). The older
branch/review statements below are retained as dated implementation history,
not the current merge status.

- After the owner disclosed the initial local token, approved database-token
  invalidation was completed. The previous unexpired credential returned HTTP
  401. All older database tokens must be considered unusable, including importer
  credentials. Books, billing and the separate organization token were unchanged.
- A replacement 30-day read-only credential was saved only in Git-ignored local
  `backend/.env.catalogue`. It expires 21 November 2026, 18:24:43 UTC. No token
  value belongs in this report, frontend, command arguments, Git or Render.
- The new opt-in real-provider browser test passed: **1 passed in 45.7s**
  (journey 7.2s), using Chrome at a 390px viewport, local FastAPI and the fresh
  restricted-role database `bookvane_external_catalogue_live_browser_test` on
  localhost port 55437, migrated to `a17d09c25ef1`.
- No API mocks in that journey: automatic search returned bounded live Turso
  results; review/cancel created no entry; confirmation created one private
  Want entry with provenance; reload retained it; starting reading then replaying
  the same confirmation preserved the entry, current attempt and changed Want
  flag. No browser request to `turso.io` or page error was observed. This is not
  an exhaustive token-leak audit or comprehensive catalogue-quality measurement.
- This execution used public metadata SELECTs only, with synthetic local users.
  No Neon writes, production migration, Render change, importer restart or
  public enablement was performed. Owner-local runtime activation is separate
  from this successful isolated test.
- Existing mocked catalogue browser regression rerun: **16 passed in 44.4s**.
  Covers outage/manual fallback, feature-off behavior, filter boundaries,
  malformed responses, keyboard/phone confirmation, loading/empty states,
  selection-error reset, private draft/account switching and cover preservation.
- Independent QA reviewed the source, successful run marker and final private
  Reading screenshot; no blocking defect identified for this bounded evidence.
  QA did not independently rerun the test, inspect credentials or query Turso.
  Final commit binding is recorded separately in the coordination handoff.
- The same candidate's focused backend catalogue API/unit execution was
  **23 passed, one warning in 12.21s**; provider transport mocked. No application
  code changed afterward. The entire backend suite was not rerun for this
  test/documentation-only delta; historical full-suite results below remain
  explicitly historical.

The bounded verification harness is in `backend/tests/reading/catalogue_browser_server.py`
and `frontend/playwright.catalogue-live.config.js`. It refuses nonlocal targets,
missing opt-ins, superuser roles, wrong schema revision or populated Book/User
tables; it does not reset a used database. A rerun requires a newly authorized
fresh isolated target, not deleting failed-run evidence. Email delivery is
explicitly disabled in this harness.

## Historical implementation handoff — 21 October 2026

## Delivered on the feature branch

Draft PR: https://github.com/StMichael9/Book-app/pull/23
Branch: codex/v3-catalogue-lookup. Latest v3 b05bd69 was merged into this branch; v3 itself was not changed.

- Measured 149,718 distinct identified works across Neon and the existing indexed Turso subset; only 179 overlap. The 103 Neon rows without source IDs are not guessed into the distinct count.
- No additional ingestion/index writes, bulk restart, billing changes or paid dependencies.
- Disabled-by-default backend lookup, fixed endpoint/SELECT queries, bounded ready-100K membership, timeouts, cache, failure breaker and authenticated owner controls.
- Confirmed selection creates a private Want entry with source/snapshot/cover provenance; shared matches use existing Neon identities.
- Local committed identities are reconciled before remote/token access. Same-work selections preserve existing private entries if a shared identity later appears. New shared selections bind their request UUID atomically. Deduplication precedes the visible result limit.
- Nullable provenance migration plus unique per-owner external identity index. No backfill. Downgrade refuses to destroy populated provenance.
- Additive browser UI reuses existing components and preserves the newer Home/collection cards.

## Tests actually executed

| Execution | Result |
| --- | --- |
| Full backend regression on migrated synthetic local database, before final catalogue-route QA corrections | 278 passed, 3 skipped |
| Final focused catalogue API/unit suite, including all corrected routes | 22 passed |
| Latest-v3 existing browser regression | 192 passed |
| New catalogue browser journeys on latest-v3 interface | 6 passed |
| Populated full-chain upgrade, safe downgrade, provenance downgrade refusal, dump/restore | 1 passed |
| Live bounded SELECT-only Turso adapter smoke | Passed |
| Focused changed-component lint and Git whitespace check | Passed |
| Independent QA's original isolated adapter unit file | 11 passed; not a second run on corrected routes |

The three full-suite skips were explicit environment/opt-in gates: separate M1 migration target variables, separate M5 migration target variables, and M5 scale measurement. The new migration was separately rehearsed. The complete backend suite has NOT been relabeled as executed after the final route corrections; those changes have the 22-case focused execution.

Failures and harness corrections are retained as history, not counted as passes:
- Initial unit test caught the missing fixed-100K upper bound; corrected.
- An initial integration fixture changed flags without synchronizing legacy status; corrected fixture.
- First full backend run used create_all rather than migration-installed triggers: 3 import tests failed, 271 passed, 3 skipped. Fresh fully migrated rerun passed as above.
- First migration/restore run retained an old hard-coded head assertion; corrected and rerun on fresh databases.
- Two browser builds initially shared dist with different API ports, invalidating the larger run. Isolated dist-catalogue and reran cleanly.
- Broad lint traversed the dependency junction; focused source lint was used instead. Existing legacy source warnings are not new fixes.

## Independent review and work still pending

Initial QA found three repeat-save/identity issues and two lower-priority observations. Backend corrections and regression cases are implemented; corrected-candidate independent review is requested, not presumed passed.

UI/UX lead now owns the owner's new request on a separate feature branch:
- Make CSV/TSV importing distinct from manual title/author entry.
- Make correcting an accidental finish clearly different from creating a genuine reread; do not delete history or silently change backend facets.
- Preserve the manual fallback's search draft; unify local/extended empty/loading feedback.
- Preserve cover metadata in the additional PR #22 rendering factories when that separate UI branch is integrated.
- Clear stale failed-confirm dialog feedback between choices.

PR #22 is NOT incorporated merely because current v3 was merged. The 192-case run certifies the current-v3 combination, not an unmerged PR #22 interface. The user-reported same title under Finished and Reading is consistent with historical plus active reading attempts; no inspection of the owner's account proved duplicate library rows.

## Release boundary

This is not a public deployment or an exact-150K completion claim. The remaining staged 500K import is incomplete and excluded. Missing authors/covers/editions and popularity coverage remain data limitations, not invented metadata.

Before public enablement: finish the UI work and independent review; approve a recovery point, production migration and matching deployment; configure a database-scoped read-only token privately in the backend; verify provider Free/overages-disabled settings and hosted account journeys. No hosted migration, application data write, Render change or public enablement was performed here.

The owner explicitly deferred revoking bookvane-catalogue-usage-temporary and removing TURSO_CATALOGUE_USAGE_TOKEN until deployment review. Both were left intact. The monitor remains deleted; no import is running.

Detailed operations and rollback: docs/v3/external-catalogue.md.
Measured catalogue evidence: deliverables/Turso_Catalogue_Overlap_2026-10-21.json.

