# Bookvane Catalogue — implementation handoff (21 October 2026)

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

