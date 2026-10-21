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
