# V3 M0/M1 implementation and QA report

14 October 2026 · branch `codex/v3-reading-home` · stop before M2

## Result

Follow-up: independent QA identified an account-switching discovery defect and an empty-page recovery defect after this implementation handoff. Both were corrected and independently retested on local `faa7a9e`; both findings are closed. Corrections, evidence and remaining independent verification boundaries are recorded in [m1-qa-corrections.md](m1-qa-corrections.md). The original test evidence below is preserved. Current independent decision is M1 CONDITIONAL GO pending the broader authorized database/migration/integration pass; this report is not authorization for M2.

M0 and M1 are complete and ready for human QA review. The reading-library foundation passed the executed checks below. V3 is disabled by default. Production migrations, public enablement, M2 reading actions and later features have not been performed.

Starting commit: `100ab702faf8baa17289f93caa36c1bd41c4c34a`, fetched from main. Its files matched completed V2 commit `67b6850bb8f59e97a1a4f595a880de5eae0ed179`. Existing main and v2-codex branches are preserved. The approved architecture/import proposals are archived in this directory, with the fixed implementation choices in [decision-record.md](decision-record.md).

## Acceptance criteria and evidence

| M0/M1 requirement | Implementation / verification |
|---|---|
| Agreed behavior and boundaries | Decision record fixes identity, transitions, optional context, free product, mandatory importing, capability/version contracts, private fallback and release gates |
| Dedicated V3 branch | Created from verified current main; all implementation changes on `codex/v3-reading-home` |
| Safe baseline | Fresh local PostgreSQL 16 cluster, separate non-superuser test role, distinct regression/migration/restore/browser databases; test guards retained |
| Migration safety | Full V2 chain executed; populated upgrade preserved IDs/timestamps/data; safe downgrade round-trip passed; downgrade with reading data rejected; synthetic backup/restore verified |
| Preserve V2 identity and meaning | Owned/want backfilled to independent flags; no finished reads inferred; legacy schemas/projection and exclusive-shelf behavior retained while V3 is off |
| Independent Own/Want | Explicit, version-checked commands; both may be true; removing one preserves the other and history |
| Bounded personal library | 25-row default, 100 maximum; signed owner/query/facet cursors; server title/author search; facet counts; summary DTOs |
| Avoid complete shelf startup load | Enabled accounts query visible IDs, at most 50/request; 200-entry session cache; no `/me/books` download for V3 |
| Isolation and stale writes | Owner-derived IDs, 404 for another account's entry, locked/versioned writes, concurrent ensure uniqueness, 409 for stale updates |
| Stale V2 clients | Legacy mutations rejected for enabled accounts or richer entries; cannot cascade away reading data |
| Public catalogue behavior | Search/counts use canonical flags independently; existing public schema, hidden taxonomy and small-count privacy threshold retained |
| Cohesive UI | Reuses active V2 shell/cards/buttons/theme/cover fallbacks; pilot My Books adds search/facets/pagination; phone and desktop reviewed |
| Later milestone foundation | Attempt constraints, stable entry identity, retry fields, private identity fields and edition snapshots exist; unfinished actions remain unavailable |

## Data layer

Migration **`ef41a83d9012`** follows `d9b6e1f2a3c4` and is additive to reader data:

- `UserBook`: adds `is_owned`, `is_wanted`, `version`, bounded `save_note`, private title/author and retry UUID/fingerprint fields. Preserves existing IDs, owner/book links and timestamps. Legacy status remains as a nullable compatibility projection: owned first, then want, then null.
- Existing owned rows become owned=true/wanted=false; existing want rows become the inverse. No reading dates, notes or history are invented.
- Keeps unique user/catalogue-work identity; adds unique user/private-create-request identity, mutually exclusive catalogue/private identity checks, text bounds and positive version checks.
- `ReadingAttempt`: UUID identity, state, optional dates/progress/edition snapshot/note/reaction, immutable creation-intent field and native/import origin. Database constraints validate states, end-date ordering, progress ranges, text bounds and reactions. A partial unique index permits only one reading/paused attempt per entry. Attempt APIs are M2 work.
- Catalogue Book deletion changes from cascading personal records to RESTRICT, including removal of the ORM delete-orphan cascade. Account/personal-entry deletion can still cascade through private history. Edition deletion sets the reference to null while retaining the saved context.
- Adds user/entry pagination and attempt/history indexes. Existing catalogue, edition, ISBN, taxonomy and ingestion indexes are retained.
- A small PostgreSQL compatibility trigger synchronizes old status-only writes during backend rollout and keeps flags/projection/version coherent. Canonical service writes still validate expected versions and control their transaction.
- Upgrade uses lock/statement timeouts. Downgrade refuses when richer state/history would be lost. After V3 activity, use the compatibility-aware backend and forward fixes rather than dropping tables.

No catalogue import or production migration ran. Source-managed catalogue behavior, Book IDs, Own/Want references and preferences were not rebuilt. A read-only production metadata check confirmed the V2 head, integer Book IDs and absence of V3 columns before this work.

## Service and API layers

`services/library.py` owns bounded queries, summary mapping, independent flags, cursor validation, version conflicts, feature access and legacy-write protection. `reading_schemas.py` separates private DTOs from public `BookSchema`. `routes/library.py` reuses existing authentication, database sessions and rate limits.

| Endpoint | M1 behavior |
|---|---|
| `GET /me/reading-capabilities` | Contract 1, M1, enabled/writable status; reading actions/import still false |
| `GET /me/library` | Search/facet/cursor/limit; compact entries, counts and next cursor |
| `POST /me/library/lookup` | At most 50 positive catalogue IDs; explicit absent state; no notes/history payload |
| `GET /me/library/{id}` | Owner-only entry detail, including reserved short save context |
| `PUT /me/library/books/{book_id}` | Ensure a unique work entry; explicit flag changes require current version; no-op ensure is idempotent |
| `PATCH /me/library/{id}` | Explicit flag update with expected version |

A 409 returns a clear code/message and the owner's current state when available. A stale edit does not overwrite another device. A versioned update cannot silently recreate a removed entry. Parent rows are locked and refreshed before evaluating versions. Concurrent creation returns one user/work relationship.

Legacy `/me/books` excludes private and neither-flag entries and returns the documented lossy projection. Unenabled ordinary V2 writes keep exclusive-shelf behavior and synchronize canonical flags. Public ownership and Want counts/filtering read independent flags, so a book in both counts correctly in each.

Private responses receive `Cache-Control: private, no-store`. CORS adds PUT/PATCH to the existing exact-origin policy; production write-origin checks remain intact. A tested access-log filter removes query strings on private /me routes so personal search text is not printed by Uvicorn. Authentication/token/email algorithms and their lifetimes were not changed.

## Frontend layer

- Extends the existing `UserBooksProvider` with capability-selected legacy/V3 modes. Legacy users keep V2 loading/controls; V3 uses batched visible-book lookups and a bounded cache.
- Unknown or failed state blocks toggles and offers retry. Network/server failures during capability checking do not silently enable legacy writes. A missing capability route on an older backend can use V2 compatibility.
- Session generation is exposed from existing auth state to discard old account responses, clear private caches and scope save continuation. Cookie handling and refresh algorithms stay in the existing client.
- Cache writes preserve newer versions when an older page/lookup response arrives. Stale mutation conflicts display the current state and require a deliberate retry.
- `components/reading/LibraryPage.jsx` provides server search, All/Want/Own facets, bounded pages, current counts, cover/error/empty states, and existing catalogue navigation. Private entries can be represented without becoming shared Books; creation/workspace controls are M2.
- Own and Want buttons are independent for enabled accounts, with the same visual primitives and accessible pressed states. Legacy copy/actions remain exclusive.
- The read-only fallback keeps richer entries visible when V3 writes are disabled. Its controls explain that changes are paused rather than asking users to refresh forever.
- ISBN remains in the summary for the existing optional affiliate behavior; no payment or new monetization infrastructure is added.
- The React quality review focused on stable effect dependencies, batching, private-state lifetime and accessible controls. No server-state library, component framework or other dependency was added.

Home/navigation changes, reading transitions, notes/progress editors, Finish → Choose Next and CSV importing have not been implemented in M1. They retain their approved milestones.

## Executed verification

| Check | Observed result |
|---|---|
| M0 original backend baseline | 123 passed; 14 existing warnings; 318.26 seconds |
| M0 original frontend baseline | 64 passed; 2.0 minutes; build passed |
| Existing full backend suite plus initial M1 cases | 134 passed, 1 skipped; 14 warnings; 580.03 seconds |
| Final focused backend M1 cases | 12 passed; 14.70 seconds, including enhanced 10K/12K history fixture and canonical public counters |
| Final backend privacy/security sign-off | 24 passed; 41.69 seconds: all 13 M1 library/logging cases plus 11 existing security-setting cases |
| Migration/backfill/downgrade/recovery | 1 passed; 20.84 seconds, executed separately on fresh databases |
| Alembic model/schema comparison | No new upgrade operations detected |
| Complete browser regression run | Final run: 72 passed in 2.7 minutes, after final selectors/mobile styles |
| Final pagination refinement | 8 pilot tests passed in 43.2 seconds, including browser back/forward and Previous page after the full browser run |
| Real browser → API → PostgreSQL | 1 passed; 35.2 seconds; real test registration, two accounts, independent flags, reload persistence and cross-user 404 |
| Frontend production build | Passed through browser setup and separate build |
| Frontend lint | Passed, zero errors; 12 warnings in existing warning classes, versus 13 at baseline |

The full backend run's skipped case was the destructive migration rehearsal, which requires its own fresh database pair and **passed in its separate invocation**. The final focused suite adds/strengthens cases after that full run; these numbers are individual executed runs, not an invented combined suite result.

Baseline and intermediate failures were corrected: missing cached Playwright browser (used installed Edge); test URL isolation guard rejecting a duplicated app/test URL setting; an assertion reading an ORM object after its successful cascade deletion; theme-button and read-only-notice selector errors; lint mistaking a Playwright callback named use for a React hook. Failed runs are not counted as passes.

The backend warnings concern the existing Starlette/httpx integration, test cookie API deprecations and an intentionally incorrect signing key in the invalid-signature fixture. They do not indicate use of that short key in application configuration. Browser checks use Chromium through installed Edge; this is not an actual iPhone/Safari or newly deployed production-cookie certification.

### Large library measurement

Final fixture: 10,000 personal entries, 12,000 reading attempts, bounded private notes and realistic non-returned descriptions. Enhanced run: first page **0.399 s**, next **0.343 s**, search **0.487 s**; final security-sign-off run: **0.299 s / 0.277 s / 0.237 s** respectively. Captured first-page sequence: **six SELECTs including an expired test-owner identity read**, 25 returned entries, no per-book query loop. Actual endpoint authorization adds its normal auth queries; these are local service measurements.

The first version of facet counting repeatedly probed history and measured 13.335 seconds on a 10K fixture. It was replaced by one history aggregate. A subsequent full-suite run measured 5.051 seconds amid fixture churn; the final enhanced, separately measured run above includes SQL timing/execution plans and no JIT compilation. Local timings vary with cache/planner/disk load. These observations are not a production latency guarantee or a Neon capacity certification. Hosted cold starts and realistic multi-user measurements remain later release checks.

## Changes by responsibility

| Area | Files |
|---|---|
| Schema | `backend/models.py`, new `backend/alembic/versions/ef41a83d9012_reading_library_foundation.py` |
| Contracts/services | new `backend/reading_schemas.py`, `backend/services/library.py`; compatibility changes in `services/user_books.py`, `services/search.py` |
| HTTP/config | new `backend/routes/library.py`; `backend/main.py`, `database.py`, `.env.example` |
| Client/state | new `frontend/src/api/reading.js`; client error message handling; auth/library providers; save continuation/reader state |
| UI | new reading LibraryPage; active My Books wrapper, shared shelf controls and scoped V2 styles |
| Tests | new backend reading/migration/browser fixtures; test cleanup order adapted to RESTRICT; new browser suites/config; legacy mocks declare capability off |
| Documentation | approved references, decision record, this report and corrected Render/V3 README notes |

## QA instructions and reproducibility

1. Review this branch with V3 disabled first. The working V2 UI and exclusive Own/Want behavior should remain familiar.
2. Use a **disposable database with separate credentials**. Apply the branch's Alembic head there only. Do not use Render's production connection or the retained recovery checkpoint.
3. For a local pilot, set `READING_V3_ENABLED=true` in the backend test/dev process; an empty `READING_V3_USER_IDS` enables all accounts in that isolated environment. For selected accounts, supply comma-separated UUIDs. Restart the backend after changing settings. These settings are not added to Render here.
4. Register/sign in; save a book to Want, add Own, remove Want, reload, and confirm Own remains. Search title/author and change facets/pages; inspect ordinary discovery/book detail and preference flows too.
5. Use another account and confirm its saved state differs. Log out while a request is slow, sign in again, and check no earlier account state appears.
6. Disable V3 writes after an entry has both flags/history: its richer library should remain readable with changes paused. Legacy mutation attempts should return controlled conflicts.
7. Check keyboard focus, pressed states, retry messages, phone layout, both themes and the existing first-tap navigation.

Backend regression command remains `python -m pytest tests -q` from backend with `TEST_DATABASE_URL`, `BOOKVANE_TEST_DB_ISOLATED=yes` and a test-only SECRET_KEY. Do not also pre-set DATABASE_URL to the same test target: the fixture deliberately rejects that ambiguous setup before assigning it internally.

The migration case additionally needs fresh `MIGRATION_DATABASE_URL` and `MIGRATION_RESTORE_DATABASE_URL` targets, owned by non-superuser bookvane_v3_test on loopback; it rejects existing tables. PostgreSQL tools must be on PATH or PG_BIN_DIR. It runs the real Alembic chain and synthetic pg_dump/pg_restore.

Frontend: `npm test`, `npm run lint`; set `PLAYWRIGHT_CHANNEL=msedge` if using installed Edge. The actual-API M1 test uses `npx playwright test --config playwright.reading-integration.config.js` with the guarded fresh local browser_test database, test-only SECRET_KEY, BOOKVANE_TEST_DB_ISOLATED=yes, and the backend Python environment on PATH. Its servers bind loopback and seed only synthetic fixtures; the database must be migrated and empty before starting. It does not send email or touch the real catalogue.

## Deviations and follow-up

- Extended the established provider rather than adding a second private-state cache/provider. This preserves shared controls and avoids competing sources of state.
- Used immutable entry-ID ordering labelled Newest saved, rather than mutation-time ordering, to keep pagination stable while flags change. Signed cursors are scoped to owner/query/facet and pin the insertion upper bound.
- Page navigation uses the existing router's history rather than maintaining another cursor-history stack, so browser back/forward and Previous page stay aligned. Directly opened cursor links offer Return to first page.
- Added the small compatibility trigger to cover status-only writes during migration/backend rollout. Tested both SQL synchronization and downgrade cleanup. It does not make an old backend safe after V3 history exists.
- Implemented a read-only capability fallback for richer data when writes are disabled, as anticipated in the recovery strategy. No activation ledger or new service is needed.
- Kept private creation/reading commands and context editors for their documented milestones. This is a schema/API foundation, not a partial attempt to build Home early.

No unresolved implementation failure or product decision blocks M1 QA. M2 requires separate authorization. Before any later production migration, recheck the actual schema/data, capacity and fresh recovery point; deploy the matching compatibility-aware pair with V3 off, then obtain explicit pilot/public approval. Restoring an old database can undo valid password/session changes and new activity; it is not an ordinary feature rollback.

## Final sign-off

**M1 ready for QA and M2 authorization.** Complete browser suite: 72/72 passed; subsequent pagination-focused suite: 8/8 passed; final backend privacy/security sign-off: 24/24 passed; populated migration/recovery: 1/1 passed; actual-API browser integration: 1/1 passed; build/lint passed. Existing backend regressions passed in the 134-test combined run; the separately required migration case was not silently treated as passed when skipped there.

M1 deliberately stops at the foundation. Reading actions/private creation/Home (M2), context/explicit forget controls (M3), Finish → Choose Next (M4), mandatory importing (M5) and release verification (M6) remain. Removing both flags currently leaves the entry in All; it does not implicitly forget that entry. No production release is authorized by this report. No paid dependency/service, real catalogue import, production data mutation or public V3 enablement occurred. All generated data and backup files belong to ignored local test infrastructure.

Implementation is saved in local Git commits on the dedicated branch; it has not been pushed or deployed. The local PostgreSQL test cluster is stopped after verification; its ignored synthetic fixtures remain available for reproduction. Production and the retained Neon checkpoint were not modified.
