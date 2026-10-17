# M5 verification handoff

Status: developer verification in progress; **not a QA GO**. The exact frozen
commit and execution-hold transfer must be supplied in the QA chat before QA
runs anything. This document is not permission to deploy or start M6.

## Scope and boundaries

Feature branch `codex/v3-m5-library-import`, based on accepted M4 merge
`2d14fd9b0033b9986a4a94999390f797301ac77b`. Eventual PR base is `v3`.
Keep `main`, V2, production, Neon, real catalogue ingestion and hosted settings
untouched. `LIBRARY_IMPORT_ENABLED` defaults false and also requires enabled
V3 reading writes. No worker, object storage, paid service or external lookup.

The human M5 instruction is attachment
`7f51227d-8fb1-4d3b-85ba-0327b2e2dbf5/Pasted text.txt`.
The two V3 architecture documents and the decision record remain the contracts;
the attachment moves the entire feature into **My Books → Bring Your Library**.

## Implementation map

- `library_import_models.py`, migration `f5c12a608de3`: private runs/rows,
  accepted source records and read-event replay links; composite ownership,
  bounded fields, active-run uniqueness, deletion triggers and FK indexes.
- `library_import_schemas.py`, `services/library_imports/formats.py`: strict
  request limits and pure versioned source adapters. No raw-file server storage.
- `matching.py`: bounded local work/edition evidence; contradictory identifiers,
  ambiguous title/author and uncertain private matches need review.
- `workflow.py`, `application.py`: durable upload/manifests, grouping, preview,
  revision-bound decisions/confirmation, atomic bounded apply and checkpoints.
  Native data wins. Cancellation retains already committed additions.
- `provenance.py`, `exports.py`, routes: owner-only source context/removal,
  private labels, minimal removed markers and bounded CSV portability/reporting.
  Existing JSONL reading export gains explicit optional accepted-source records.
- Frontend `components/reading/imports`: one lazy My Books route, streamed
  Papa Parse file handling, paste, clarification, preview, confirmation,
  pause/resume, results, template/export and official navigation-only links.
  Existing shelf cache is invalidated after committed import batches.

## Local verification setup

Use **fresh disposable local databases**, role `bookvane_v3_test`, loopback
`127.0.0.1:55433`, with `test` in each database name. Never use a hosted URL.
Keep `BOOKVANE_TEST_DB_ISOLATED=yes`, `IS_DEV=true`, a synthetic `SECRET_KEY`,
and empty `RESEND_API_KEY` / `PASSWORD_RESET_FROM`. The app guard URL must
identify the deliberately nonexistent local `bookvane_unused_app_guard` database;
`TEST_DATABASE_URL` identifies the distinct migrated test target.

Apply the candidate head only to a verified disposable target. Do not reuse
the early draft `bookvane_v3_m5_import_test`: it lacks the final draft FK indexes.
`metadata.create_all` is not a substitute for the migration.

Run with `backend/venv/Scripts/python.exe` from `backend`:

```
python -m pytest tests/test_library_import_formats.py tests/test_library_import_workflow.py tests/test_library_import_exports.py tests/reading/test_context.py tests/reading/test_library.py tests/reading/test_lifecycle.py tests/reading/test_next_read.py tests/reading/test_private_logs.py tests/auth tests/application tests/data/test_clean.py -q -p no:cacheprovider --tb=short
```

Migration/recovery uses separate fresh empty targets. Set
`LIBRARY_IMPORT_MIGRATION_DATABASE_URL` and `LIBRARY_IMPORT_RESTORE_DATABASE_URL`
for `tests/test_library_import_migration.py`. This rehearses populated M4 upgrade,
empty downgrade/reupgrade, refused lossy downgrade, source deletion/account
cascades, and a synthetic dump/restore containing private provenance and an
interrupted upload. `tests/reading/test_migrations.py` independently uses fresh
`MIGRATION_DATABASE_URL` and `MIGRATION_RESTORE_DATABASE_URL` for the full chain.

Scale measurement: set `M5_IMPORT_BENCHMARK=yes` and run
`tests/test_library_import_scale.py -q -s -p no:cacheprovider --tb=short` on its
own freshly migrated database. It generates a 50K SQL catalogue fixture and
1K/10K/20K personal libraries, checks completion/counts, measures bounded steps,
storage and immediate Home/library reads, then exercises account cleanup.
This is not real catalogue ingestion or a hosted-capacity guarantee. Keep its
database separate from regression fixtures, which delete synthetic catalogue rows.
`M5_IMPORT_BENCHMARK_ROWS=20000` selects only that size for a targeted interrupted
measurement rerun; unset it for the normal complete 1K/10K/20K gate. The fresh
final-index all-size attempt timed out during the 20K storage check; do not claim
that entire attempt passed or remove/raise the guard. The API rollback/503/retry
behavior now has an actual PostgreSQL statement-timeout regression test.

From `frontend`, `PLAYWRIGHT_CHANNEL=msedge`:

- `playwright test --config playwright.config.js --reporter=line`: full mocked
  client regressions, including actual local-file parsing and M5 mobile checks.
- `playwright test --config playwright.m5-integration.config.js --reporter=line`:
  seven real browser/API/PostgreSQL journeys. Set `DATABASE_URL` and
  `TEST_DATABASE_URL` to the same fresh, empty, migrated browser-only target;
  the browser server independently verifies its identity/role/head and refuses
  populated databases. Put the backend virtualenv on PATH. No mocks or emails.
  Registration fixtures respect the existing five/minute limit with one bounded
  wait/retry; do not raise the production authentication limits.

Do not overlap frontend production builds: they share `dist`. Stop only verified
task-owned preview processes. Transfer the local cluster execution hold explicitly.

## Independent checks and pending gates

Prioritize cross-owner reads/writes/downloads; malicious source text; no writes
before confirmation; work vs edition disagreement; native data winning; same-file,
reordered, interrupted and repeated uploads; changed sources and stale previews;
removed-entry/read/source-context replay; concurrent run/apply/removal; expiry,
capacity refusal, partial cancellation and report retention. Verify V2 and M1–M4
with importing off as well as on. Confirm history/labels never become public tags.
Assess the pre-existing rapid Want-write → immediate start-reading edge: stale
version is refused safely and offers retry. The normal-flow live fixture waits
for the acknowledged shelf state; that correction is not a UX fix/certification.

Read-only QA previously identified mixed finished/DNF histories choosing displayed
state by UUID tie. Candidate now requires an explicit context-only decision for
that case; native history ordering is unchanged. **Independent closure is pending.**

Native Goodreads and StoryGraph exports are still a separate completion gate.
Founder agreed to provide small owned/sanitized exports near the end. Current
synthetic files and historical public example schemas are engineering evidence,
not proof of every current platform variant. Non-empty StoryGraph date-list
syntax remains preserved source context unless validated by a real fixture.

Record exact executed results and defects; do not turn skips into passes. No
integration/production-readiness claim until independent QA and native-format
acceptance are resolved. Stop before M6 and production enablement.
