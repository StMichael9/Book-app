# Current reading shelves

Owner-requested correction, 21 October 2026.

## Problem and contract change

Previously Reading/Paused/Finished/Stopped filters matched any historical attempt. A genuine reread therefore appeared in both Reading and Finished, even though the library contained one saved entry. Earlier UI corrections explained that overlap rather than removing it. The owner has requested one obvious current status and a simple Finished → Reading action.

Status shelves and their counts now use exactly the same selected attempt as the workspace: an active reading/paused attempt first, otherwise the latest created attempt, with ID as deterministic tie-breaker. A saved entry belongs to at most one status shelf. Prior finished/stopped readings remain in the book's history, export and underlying records. Own/Want are independent flags and may still overlap status shelves intentionally.

This changes filter/count semantics, not stored data. No migration, history deletion, automatic merging of distinct entries, new dependency or caching behavior is introduced. Similar titles/editions/private records are not silently merged.

Mark as reading reopens the current finished/stopped attempt with PATCH and the captured entry version. It does not create another saved entry or reading attempt. A deliberate reread remains a separate confirmed action that creates a new attempt on the existing entry, preserving older attempts. Existing stale-version/active-reading safeguards apply.

## Verification

New real API/database regressions cover shared and private entries, same-attempt finish/reopen, deliberate reread, pause and DNF, consistent counts/filter results, one saved entry, unchanged note/ownership and preserved historical records. Existing 10K-entry/12K-attempt benchmark now expects 8K current Finished and 2K current Reading instead of overlapping 10K/2K counts.

A separate fresh migrated localhost database and browser regression exercise registration, the same catalogue book, Finish, Mark as reading, reload and both shelf views at phone/desktop widths without API mocks. Execution outcomes are recorded separately; test definitions alone are not evidence of passing.

Production deployment, real-user record changes, external catalogue activation and caching are outside this correction.

## Executed results

- Full backend suite: **288 passed, 3 skipped, 14 warnings**, 721.31s, fully migrated disposable local PostgreSQL. The three skips require separate fresh migration/restore targets or opt-in import-scale configuration; they were not executed or counted as passes. Focused library/lifecycle run separately passed 32 tests, including 10K entries/12K attempts.
- Combined correction/lifecycle Chromium UI suite: **80 passed**, 4.8m, synthetic API fixtures, both themes and phone/desktop cases. Production frontend build completed for the run.
- Real browser → FastAPI → freshly migrated disposable PostgreSQL: **2 passed**, 28.2s. Synthetic private phone and shared desktop copies of The Psychology of Money exercised Finish → Mark as reading → reload, same entry and attempt IDs, one history item, preserved ownership, Finished zero / Reading one / All one. A subsequent genuine reread retained the original finished attempt and a second active reading without returning the book to Finished. No API route mocks.
- Independent backend QA source review found no blocker. UI lead independently executed 14 correction cases; its larger scoped run initially had one timeout, which passed unchanged on rerun. That original result remains in the UI evidence; the lead's final combined 80-case run above passed in full.

Two initial real-browser runs failed during setup with 401 responses before feature actions. Trace inspection established the cause: a loose URL regex matched `/register?returnTo=/my-books` before login completed. The second attempt changing request transport did not fix it. The final harness instead waits for the exact pathname and authenticated My Books heading, and uses the original request client. No authentication application change was needed. Failed-run databases and traces are retained locally, not erased or represented as passing.

Fresh browser databases were migrated through existing Alembic head a17d09c25ef1; no new migration is part of this fix. A read-only check on the previously verified development target confirmed the reported failure pattern is a single saved entry with finished and active history, not duplicate saved rows. No real-user records were mutated. Browser captures were inspected for the reopened phone workspace.
