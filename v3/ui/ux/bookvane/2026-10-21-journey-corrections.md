# V3: import, reading correction and missing-book search

Implementation handoff, 21 October 2026. UI-only correction work in the isolated worktree `/workspace/Book-app-ui-journey`, feature `codex/v3-ui-journey-corrections`. This is a review candidate, not a release or deployment certification.

## Dependencies and ownership

- Catalogue dependency: draft PR #23, `codex/v3-catalogue-lookup`, frozen backend head `94a88498fa1a85ae93c64363d5e840e264377934`.
- Existing UI dependency: draft PR #22, `codex/v3-ux-simplification`, head `49c752f0ab4d09506f68bec27dd691b47c35225a` (last application change `3b6ad22068420b68ea3f1aae636400d2e57d24c4`).
- Both dependencies are incorporated into this separate feature branch. Draft [PR #24](https://github.com/StMichael9/Book-app/pull/24) targets the catalogue feature branch to expose the dependent UI integration. Neither dependency's branch or checkout was edited. The PR therefore includes PR #22's UI relative to the catalogue branch; it is not just the final correction commit.
- The one merge conflict in ReadingPages was resolved using the newer PR #22 workspace and preserving catalogue cover metadata. Covers were also retained in the active workspace identity and compact Next Read factory, not just retained legacy helpers.
- Catalogue matching/replay/UUID/cap fixes remain owned by the lead. Their reported backend and browser results are inherited evidence only, not new UI acceptance here.
- Do not merge the overlapping UI PRs independently. The lead must reconcile the feature tree and integration order before any merge. Shared `v3`, main, the reserved main.jsx entry file and production have not been changed by this correction pass.

## What changed

### One book versus a library file

My Books keeps **Bring Your Library**, now visibly described as **CSV / TSV import**. Home and Account also describe that format. The title/author form is explicitly **Add one book manually** and offers the file-import route before the fields when import is available and writable.

The import page states that it handles many books from CSV or TSV. Selecting `.xls` or `.xlsx` gives a direct instruction to export as CSV/TSV before any inspection/upload request. No native Excel support is claimed or implemented. Existing 20 MiB / 20,000-row limits, mapping, uncertainty review, confirmation, saved import/resume, seven-day expiry and partial cancellation semantics remain unchanged. This does not certify current native Goodreads/StoryGraph exports.

### Undo finish versus rereading

A finished workspace offers **Undo finish** visibly with the reading controls. It PATCHes the existing reading ID with its captured expected version and `state: reading`. The backend clears the end date; it does not create a second attempt. The original start, note, reaction, progress and independent Own/Want flags retain their existing contract.

**Read it again** is separate. A native confirmation explains that a new reading record will be created and earlier history retained. Only **Start a new reading** sends the existing PUT. Its request UUID and captured entry version survive a retry within the same confirmation. Failure/conflict keeps the dialog and history visible; no blanket retry or silent version rebasing is added. Cancel/Escape makes no write and restores focus. Pending confirmation cannot be dismissed or submitted twice. Successful explicit actions announce the result and return focus to the reading status if the user has not moved elsewhere.

Stopped readings have a visible **Reopen this reading** alongside the same genuine-reread confirmation. Earlier historical records remain correctable; reopening a historical record is not offered while another record for that entry is active.

**Reading history** remains the existing single lazy disclosure; there is no duplicate history shortcut in the reading controls. If an active reread and earlier finished/stopped records exist, it explains recovery from a mistaken new read: review and explicitly delete only that mistaken record through the existing scoped destructive confirmation, then reopen the earlier record. The dates identify the selected record; its notes/progress deletion and preservation of other records are explicit. No records are cleaned up automatically and no founder/account data was inspected or modified. This is deliberately not an unapproved multi-write automatic “undo reread” transaction.

Finished/Stopped collection views now explain that they include books with historical finished/stopped readings. A currently active reread can truthfully appear in Finished and Reading. Cards say **Reading now**, with **Finished before** / **Stopped before** when the selected historical facet warrants it. Counts and server filtering are unchanged. This does not establish that the founder has duplicate library entry IDs; a genuine distinct-entry duplication needs identity evidence and lead/backend review.

### One search and a useful manual fallback

Additional matching runs automatically after the local catalogue search completes successfully, under the existing authenticated capability and unfiltered-search rules. Subject, Own/Want and exclude-owned queries do not mix unclassified additional books into their results. There is no provider-selection step or provider search button.

An eligible locally empty search shows **Checking more books…** while lookup is pending. Matches replace that status; **No books found** appears only when both sources successfully return empty. An unavailable/invalid lookup gives truthful unavailable feedback, retains local results and offers ordinary Retry/manual recovery. A local request failure is resolved before any additional lookup. Combined-search totals are suppressed rather than inventing a combined count. During a slow account-capability check, an empty local result stays at **Finishing your search…**; a capability failure explains that additional books could not be checked. Feature-off and filtered searches keep the normal local results/empty states. Local catalogue paging remains available.

**Add a private book** carries the searched title and author into the manual form through a bounded, document-only, account-generation-scoped memory map. Browser history carries an opaque key, not those field values. No localStorage/sessionStorage draft, note, reading history, account identifier or backend write is introduced. Reload/new tab/account departure discard this optional prefill. A valid same-document prefill offers **Back to search**. Fresh direct links remain blank.

Each selected additional book now mounts its own confirmation command state. A failed save for A followed by Cancel → Review B does not show A's error in B's dialog (ECL-QA005). Retries within the same selection retain their UUID; a different review gets a new one. The existing review/confirm-before-private-Want contract is preserved.

## Architecture and boundaries

| Area | Files / existing contracts |
| --- | --- |
| Reading correction and reread | `ReadingPages.jsx`; existing `updateReadingAttempt`, `createReadingAttempt`, `ReadingEditor`, `ReadingRemovalDialog`, NativeDialog and command/session guards. |
| Import discoverability | `LibraryPage.jsx`, `ReadingPages.jsx`, `AccountPages.jsx`, `imports/LibraryImportPage.jsx`; existing capability/read-only gating and importer contracts. |
| Search and per-selection feedback | `DiscoveryPages.jsx`, `ExtendedCatalogue.jsx`; existing local catalogue and `/me/catalogue/search` / `/me/catalogue/select` APIs. |
| Private fallback memory | `LibraryNavigationProvider.jsx`, keyed private route in `BookvaneApp.jsx`; bounded account-scoped in-memory values only. |
| Current versus historical labels | `LibraryPage.jsx`, `ReadingCards.jsx`; existing API reading state and historical facets, no invented history fetch. |
| Visual styling | One compact import-link style in the existing reading stylesheet; existing palette, typography and four-destination navigation. |

No dependencies, schema, auth protocol, catalogue persistence policy, backend service or hosting change was authored by this correction pass. Backend files included in ancestry come from PR #23, not new UI backend work. Existing in-memory version-safe note/progress drafts and library return context remain in place.

## Verification ledger

Final application source frozen at `48acfa767dcec8c385724ca7e8556b2e5fbd2233` for the verification run. New tests are included in the standard Playwright selection as well as the bounded `playwright.journey.config.js` configuration.

All new executions use synthetic, in-memory API responses and local preview. No real database, Neon, live metadata provider, email, catalogue writes or owner account was contacted. Mobile results are Chromium viewport/keyboard checks, not physical Safari acceptance. Live API/PostgreSQL test selectors were updated for the new labels/confirmation but those live tests were not executed.

- Exploratory run: 15 passed / 3 failed (18, 3.3 minutes). Two failures were new test-fixture selectors; the third exposed Cancel focus restoration when its reread trigger was disabled. The trigger is now retained and the dialog supplies native inertness. Changes were made during exploration, so this is not a frozen-candidate result. Original log is retained as `evidence/journey-corrections-2026-10-21/exploratory.log`.
- An initial clean-run request was not executed because automatic approval review hit a usage limit. The owner then asked to continue; the same authorized test command was resubmitted through normal review.
- Intermediate frozen `cc1bf85` run was stopped for the bounded capability-state correction and removal of the redundant history shortcut: **47 passed / 4 failed / 1 interrupted / 47 not run** of 99 (6.7 minutes). Failures were the account fixture refreshing straight back into the old account, an outdated historical-facet copy assertion, and two keyboard-order assertions encountering the new redundant shortcut. The fixture now exercises standard same-document expiry and visible login; the copy expectation is updated; the extra shortcut is removed rather than adding another focus stop. This is not a completed green run. Original log: `evidence/journey-corrections-2026-10-21/intermediate-cc1bf85.log`.
- Lint after correcting three new test-only unused-variable warnings exits 0 with the **12 existing warnings**, no new warning.
- Completed broad run at `48acfa7`: **100 passed / 2 failed**, all **102** selected browser checks executed (**9.1 minutes**, one Chromium worker). The two failures were older light/dark card assertions still expecting `Reading` instead of the deliberately clearer `Reading now`. This is not described as a clean full-suite pass. Log: `evidence/journey-corrections-2026-10-21/broad-48acfa7.log`.
- Test-only follow-up `a13a82905780d8eeeb05b70d6815358c66d87663` corrects those labels and includes the new label in the unknown-state exclusion assertion. **3/3 focused checks passed (16.3 seconds)**: both corrected light/dark checks plus current-reread/historical-Finished identity. Application sources match `48acfa7` byte for byte; no application change or weakened identity/version assertion was made for this retest. Log: `label-retest-a13a829.log`. Original failures and raw trace hashes/locations remain in `failure-traces.json`.
- **6/6 public book-details cache checks passed (0.4 seconds)** on the integrated tree: request deduplication, expiry, failed/malformed retry, bounded entries and public-field whitelist. Log: `cache.log`.
- Production-entry builds passed in the broad and focused runs. Final lint exits 0 with the 12 existing warnings. No second complete 102-case run was performed after the test-only label update; no all-application/auth/physical-device certification is claimed.
- Both-theme keyboard/text reflow and underlying note/progress/privacy/Finish flows are covered by the completed selection. New correction checks cover 320/390/1440px, explicit pending/cancel/version/error states, multiple historical readings and a scoped accidental-reread recovery. New catalogue checks cover combined loading/empty/capability failure, per-selection error isolation, prefill expiry/account boundaries and integrated cover factories. CSV/TSV Unicode parsing, bounded batches, resume, explicit confirmation and partial-cancel totals also passed.
- Two synthetic finished-book captures were visually inspected at 390 and 1440px. See `assets/journey-corrections-2026-10-21/` and the `screenshots.json` hash/dimensions manifest. These are application fixture captures, not generated artwork or real-user sessions.
- Cleanup verified: preview port 5197 closed; no active test/preview node processes for this worktree. No database process was started. See `cleanup.json`.

## Manual and independent QA handoff

1. My Books → Bring Your Library: CSV/TSV format is visible without opening a form. Direct manual entry clearly handles one book and offers import. Verify supported CSV/TSV, Unicode and resumable import behavior. XLSX explains conversion and makes no upload/inspection call.
2. Finished → Undo finish: PATCH the same attempt; unchanged entry ID, start/context/other readings and flags; end date cleared. No PUT/new record. Failure and stale version must not change/hide records.
3. Finished/Stopped → Read it again: Cancel/Escape no writes and focus returns; explicit Start creates exactly one new attempt on the same entry, previous histories remain; existing Start semantics preserve Own and clear Want. Pending and conflict behavior stays safe.
4. An accidental active reread with multiple older records: inspect dates, Cancel deletion, then explicitly remove only that attempt and undo the preceding finish. Other records/flags persist. Never perform this on the founder's account as test cleanup.
5. Finished view with a current reread: one card per entry, current/history labels clear, no claim that facets are mutually exclusive. Separately inspect entry/book IDs if actual duplicate entries are suspected.
6. Local empty → held additional search → match/empty/unavailable, and local failure → Retry. No premature empty state above matches. Feature-off and subject/shelf-filter cases make zero additional requests.
7. A fails confirmation → Cancel → Review B: clean B dialog, no inherited error; a retry of A keeps its request identity. Pending selection cannot disappear due to Cancel/Escape.
8. Slow capability checks do not show a final empty state before additional lookup is known; failure gives truthful incomplete-search feedback. Manual fallback preserves title/author and search return; refresh/new tab/account expiry → different login cannot replay the previous account's prefill. Old opaque history keys resolve to no draft.
9. Integrated covers in workspace, personal cards and Next Read; configured and missing covers; 320/390/1440px, keyboard focus/confirmation/history, mobile fixed navigation and enlarged text. Retest on a physical iPhone with current candidate before claiming device acceptance.

Independent QA, current native exports, physical-phone/hosted acceptance, migrations/feature rollout and broader public-release gates remain separate. No merge/deployment/public GO is supplied by these browser fixtures.


## Confirmed local backend/schema mismatch: repair verification pending

After the UI handoff, Michael reported that `http://localhost:5173/my-books` does not load. His supplied backend traceback confirms **GET /me/library → 500**, with `psycopg2.errors.UndefinedColumn: column user_books.private_catalogue does not exist` at `LibraryService.page()` executing the mapped library query. The backend started successfully with `uv run fastapi dev`; the earlier corrected CLI typo is not this failure. The real runtime database is missing a required column. The exact current Alembic revision/DB target and successful repair remain unverified; browser fixture passes did not certify that environment.

The combined branch includes the catalogue backend's migration **`a17d09c25ef1`**, after **`f5c12a608de3`**. It adds `user_books.private_catalogue`; the current ORM and library DTO read that column unconditionally. If the backend is running these models against the earlier schema, library queries can fail with an undefined-column error even with external lookup disabled. A backend running with automatic reload from the same checkout may pick up those models when switching branches. The missing-column failure is now confirmed by the runtime trace; the exact migration state/target still must be checked.

The local-test instructions should have called out this prerequisite more clearly. Confirm the actual frontend/backend refs, API target, database revision and failing `/me/reading-capabilities` / `/me/library` response first. Do not infer data loss or a verified database target from the missing-column exception. If the approved development target is still at f5c, use the existing a17 migration through the established workflow. If Alembic already reports a17, investigate drift/wrong connection; do not stamp or improvise a manual column fix. The existing compatible V3 backend can serve the refreshed frontend while the catalogue backend rollout remains separately gated; new lookup UI stays hidden when its capability is off.

The lead was updated through PR #23 comments [handoff](https://github.com/StMichael9/Book-app/pull/23#issuecomment-6326567815) and [local URL/schema dependency](https://github.com/StMichael9/Book-app/pull/23#issuecomment-6326584418). The sanitized confirmed exception and migration ownership were also posted in a subsequent PR #23 comment. No direct chat-send capability or response from the lead is available in this review. No database command, migration, reset, live account request, application edit or deployment was performed here. The lead owns schema alignment/target verification and the subsequent real local library-load retest. No success or issue closure is claimed yet.

## Test branch

```sh
git fetch origin
git switch --track origin/codex/v3-ui-journey-corrections
```

If the local branch already exists, switch to it and use `git pull --ff-only origin codex/v3-ui-journey-corrections`. Continue with the existing approved local backend/frontend setup. Catalogue visibility still depends on the backend capability; this UI pass does not enable it, migrate data or replace the catalogue rollout checklist. The branch contains both dependencies, but shared `v3` and production remain unchanged.
