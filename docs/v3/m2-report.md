# M2 — reading lifecycle, private fallback and Home

Branch: `codex/v3-m2-reading-lifecycle`, from accepted `v3` merge `5942faf15643475e1bd40577e49e2794d5d1c5ee` (M1 PR #12). M3 remains unauthorized. No production deployment, database connection change, catalogue import or paid service.

## Implementation

- Data layer: reuses the M1 UserBook/ReadingAttempt/Edition schema and existing Alembic head `ef41a83d9012`. No new migration or schema redesign. Own/Want, IDs, preferences and catalogue identities remain intact.
- Domain layer: `services/reading.py` implements owner-scoped parent-row locking, expected versions, immutable creation fingerprints and client UUID replay, one active/paused read per entry, and multiple concurrently read books. Start clears the current Want flag only; finish/stop preserve ownership and subsequent explicit Want changes. Reopen corrects the same record and clears its end date; reread creates another record. Unknown dates stay unknown. Optional page/percent progress supports downward corrections and does not automatically finish at 100%.
- Edition context: selects a work-scoped edition, optionally preferred, and saves source/format/page context. Existing edition deletion clears its reference without erasing the snapshot. The reader may correct their copy's total pages independently of later catalogue updates. No ISBN, cover or external API workflow changed.
- Private fallback: per-user title/optional author, stable creation request UUID, explicit duplicate suggestions (up to five), never name-based merging or new shared Book/Author records. No images/URLs uploaded. Separate same-named private entries remain allowed after confirmation.
- API: extends `reading_schemas.py`, adds focused `routes/reading.py`, and adds private-match suggestions before the existing dynamic library route. New routes inherit auth, write-origin controls, rate limits and private no-store handling. All owner checks are server-derived.
- Frontend: capability-gated Home, workspace, private form, progress/date editor and bounded reading history in `ReadingPages.jsx`. Uses the existing design primitives and provider, not another cache framework. Home shows at most three current reads; library links lead to full reading/work history. New accounts default to Home only when supported; V2/old backends retain their library fallback. Existing return-to and save intent win over the default.
- Navigation: pilot Home / Discover / My Books / You; existing V2 navigation stays unchanged while disabled. Anonymous start intent is supported by explicit protected deep links (`/my-books/start/:bookId`), preserved through sign-in/registration. V3 start controls are not advertised to anonymous users during the disabled/pilot phase. An existing reading/history deep link opens that history, never silently creates a reread.
- Failure recovery: progress drafts keep their original expected version after conflicts; close/reload explicitly refreshes before reapplying. Retry-safe starts recover from a lost committed response. Read-only accounts retain their history. Every new multi-step client command checks that its initiating session is still current before continuing.

## Necessary client safety correction

M2 adds a small epoch guard to the existing API client: a 401 from an operation begun before login/logout/reset must not rotate the new account's session, replay a write under its cookies, or expire its UI. This extends the existing session-change serialization without changing cookie names, token lifetimes, authentication services, server auth logic or infrastructure. The earlier M1 late-401 test now asserts no cross-session refresh/replay; a separate browser case covers a delayed write. In-session automatic refresh remains covered by existing regressions.

## Bounded access and preservation

Home joins only three active entries plus grouped counts, with batched author loading. History replaces one page at a time (25 default, 100 maximum). Its UUID cursor resolves only inside the authenticated entry, then uses immutable creation-time/UUID keyset ordering; an invalid/deleted cursor offers first-page recovery. Library signed cursor behavior is unchanged. Detail includes at most five edition options, not the entire catalogue or history. Notes/reactions remain stored but their editors belong to M3; no new notes cache or local storage is added.

## Verification

Executed implementation verification, October 14–15, 2026:

| Check | Actual result | Boundary |
| --- | --- | --- |
| Full backend regression suite, excluding the separate migration/restore file | **153 passed**, 14 existing warnings, 831.58 s | Includes the M2 lifecycle cases; not 153 additional tests beyond them |
| Final strengthened M2 lifecycle file | **17 passed**, one existing TestClient deprecation warning, 9.11 s | Includes concurrent identical/different start requests, owner isolation, private catalogue invariance, and bounded Home SELECT count |
| Full frontend regression suite | **99 passed**, 7.8 min | Browser tests with intercepted local API responses; includes late cross-account write-401 protection and existing V2/M1 regressions |
| Real Edge → FastAPI → PostgreSQL integration | **4 passed**, 43.8 s, final extended run | Separate, fresh migrated database per run; includes workspace editor reset; no external catalogue, auth provider, or email service |
| Schema alignment | **Alembic check passed**, no new upgrade operations | Existing head `ef41a83d9012`; M2 adds no migration |
| Backend module compilation | **Passed** | New router/service/schemas |
| Frontend lint / production build | **Passed**; 12 existing lint warnings, no errors | No added dependencies; final routing correction also rebuilt by the live suite |
| Patch whitespace check | **Passed** | No generated build/runtime files intended for Git |

The full regression run preceded the final strengthened assertions; those assertions then passed in the focused 17-case rerun. They are overlapping evidence, not separate totals to add together. The full frontend suite preceded the final workspace route-key correction; that correction receives its own real-browser regression rather than claiming the earlier 99-case run tested it.

Live journeys cover registration and independent Own/Want, two-account isolation, optional progress and conflict-draft recovery, pause/reload/resume/finish/DNF/reopen/reread, Home failure/retry, private Unicode books and unknown historical dates, explicit duplicate suggestions, guest start through registration, and a lost response after a committed start. Reload or a history deep link must not manufacture a reread. The final browser extension also checks that a client-side workspace change discards the previous book's editor. Home was checked at 320/390/1440 px; light/dark phone captures were inspected. This is Edge with resized viewports, not a physical-phone certification.

Test targets are local under `127.0.0.1:55433`, using the non-superuser `bookvane_v3_test` role: `bookvane_v3_m2_test` for the guarded regression harness, and fresh `bookvane_v3_m2[_r2/_r3]_browser_test` databases for live journeys. Regression fixtures intentionally reset their explicitly disposable target; populated independent QA targets are never reused or cleared. All book/account fixtures are synthetic local test data, not imported or production catalogue data. No Neon/production credentials, hosted migrations, real resets/emails, production load, real imports, or physical-device tests were used. The independent M1 migration/backfill/restore pass remains M1 evidence, not a newly claimed M2 recovery test.

An interrupted final-check attempt was not executed when approval review hit a usage limit. On continuation, the normal approval path succeeded and the final lifecycle, lint and build checks above actually ran. The local test cluster required ordinary crash recovery after the interrupted session; it recovered successfully, and no existing QA database was modified.

After the final browser run, Alembic alignment and lint were checked again successfully. Browser/API listeners were gone, and the exact local cluster started for these checks was stopped cleanly; synthetic databases were retained.

## Acceptance and remaining review

- Full lifecycle, concurrent different books, corrections versus rereads, optional progress/dates, unchanged ownership, and retry-safe creation: implemented and covered by executed backend/live checks.
- Edition context survives catalogue edition deletion: covered by the lifecycle test; no catalogue importer code changed.
- Current reading survives reload/login; missing catalogue records can use private entries; Home and history access stay bounded: implemented and covered. Home query-count assertions check query shape, not production load capacity.
- V2/old-backend/disabled compatibility and cross-account request handling: existing regressions executed alongside the M2 client guard tests. No auth service, public Book schema, preference model, hosting, or catalogue changes.
- Independent M2 QA is still required before integration. No new confirmed M2 blocker remains from implementation testing, but that is not an independent QA GO or a complete-V3 release claim.
- Intentional deferrals are the already-approved later milestones: private context/deletion/export, Finish → Choose Next, CSV library importing, and public release/hosted checks. They were not silently dropped or presented as finished.

React quality guidance informed session-safe effects and reuse of the established components; full-flow verification guidance informed the real browser/API/database journeys. Neither introduced another platform or infrastructure dependency.

## Review boundary

Implementation tests are not independent M2 QA or production certification. M2 goes through its own PR into `v3` after review; no direct integration-branch implementation commits. M3 context/deletion/export, M4 Finish → Choose Next, mandatory M5 Goodreads/StoryGraph/Bookvane importing and M6 public release checks remain separate. Home intentionally has only the M2 current-reading section; it does not pretend that Next Read/importing are finished.
