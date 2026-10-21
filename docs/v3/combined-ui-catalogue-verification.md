# Combined UI and catalogue verification — 21 October 2026

Owner authorized combining catalogue PR #23 and UI PR #24 into v3. PR #24 already incorporates UI PR #22; merge the combined ancestry, not independent overlapping UI patches.

Combined application tree tested: e3d404e174e17f3311c0d2472a1945ec7b2d681c, incorporating UI b06dca1 and backend correction c81dd46. This document is subsequent evidence only.

## Executed on the combined tree

- 23/23 focused backend catalogue API/unit tests passed, using only disposable local PostgreSQL on 127.0.0.1:55437 with synthetic data; remote transport mocked.
- 16/16 extended-catalogue browser tests passed (31.4s).
- 10/10 reading-correction browser tests passed (27.4s), including same-attempt undo finish, deliberate reread, preserved older history, version failures and pending/read-only guards.
- Both browser runs built the production frontend entry first; synthetic APIs and installed desktop Chrome only. No real provider/account access.
- Independent QA source review closed ECL001–004. ECL005 error-isolation browser regression passes in the combined tree. UI lead confirmed frozen b06dca1 with no additional integration blocker.

The final backend correction binds a new shared-book selection receipt to the originally requested ID, allowing an identical alias retry without the remote service. Conflicting UUID reuse still fails; flags, notes and entry identity are preserved. No schema change was needed for this correction.

## Failures retained, not represented as passes

- Initial unprivileged backend run: 11 unit passes, 12 setup errors because the sandbox blocked localhost PostgreSQL. Rerun with local access permitted.
- First new alias regression fixture: 22 passed, one failure because the synthetic owned flag used an invalid null legacy status. Fixed fixture to the valid owned projection; then 23 passed, repeated successfully on the combined tree.
- First browser attempt: all 16 launch failures because bundled Chromium was absent. Rerun with existing Chrome succeeded; no application changes for that environment issue.

Earlier broad backend/UI results retain their original SHA and limitations in the separate handoffs. A new complete all-application suite was not run for this merge. Physical Safari, current native exports and hosted/public-release acceptance remain separate gates.

## Actual local library repair (completed before merge)

Verified the owner's running backend on the intended Neon v3-development branch, not production. Applied only existing migration a17d09c25ef1 after f5c12a608de3. Books, user-book flags/notes, reading attempts and preferences retained identical before/after row fingerprints. Authenticated localhost My Books reload showed eight saved books and no browser errors. Full sanitized evidence is in deliverables/Bookvane_Local_Library_Repair_2026-10-21.md in the lead workspace.

The repaired development database is at a17d09c25ef1. Other databases must follow the normal verified-target migration procedure before running the catalogue models. No stamping, manual column repair, data reset or production migration.

## Boundaries

Git integration only: no Render deployment, production migration, lookup enablement, credentials change, ingestion or public catalogue promotion. External catalogue remains disabled by default.
