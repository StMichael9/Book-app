# Current reading status: UI handoff

21 October 2026. Draft [PR #25](https://github.com/StMichael9/Book-app/pull/25), branch `codex/v3-current-reading-status-ui`, application and test commit `7607142281a037398f807ede3a4dc2101e1c31b1`, based on accepted v3 `57716b47d03d046bd2b7e5d6f77105a5a98c5eca`.

## Behavior and ownership

- Finished and stopped workspaces offer primary **Mark as reading**. It PATCHes the same attempt with the captured entry version and `state: reading`. It creates neither a saved entry nor a reread. Existing errors/version guards remain; no automatic retry or stale-version rebase.
- Secondary **Read it again** still requires explicit confirmation before creating a new attempt. Cancel/Escape make no write. Existing history, notes/progress, independent Own/Want flags and scoped deletion controls remain.
- Removed historical-overlap explanations and Finished-before/Stopped-before badges. Cards display the supplied current/latest state; filtered views point to earlier readings inside each book's Reading history. No client-side result filtering or count rewriting.
- Production changes are limited to `ReadingPages.jsx`, `LibraryPage.jsx` and `ReadingCards.jsx`. Mocked tests are in `reading-corrections.spec.js` and `reading-lifecycle.spec.js`; the old overlap-copy assertion is replaced.
- **Companion backend required:** lead-owned `codex/v3-current-reading-shelves` at `b321bf1` makes status facets/counts mutually exclusive by current/latest state while preserving every history record. It is not included in this UI branch. Own/Want remain independent flags. Do not claim that the overlap is resolved from this frontend alone.

This supersedes the overlap explanation and Undo finish/Reopen wording in the earlier journey-corrections report; that report's original execution evidence remains historical. Old PR24 is untouched. No redesign, caching work, API/schema change, account data modification, migration, merge or deployment was performed here.

## Verification executed here

Exact application/test commit: `7607142`. Production entry build passed through the isolated Playwright configuration. Lint passed with 12 existing warnings and no errors.

Focused system-Chromium browser run used only wholly in-memory API fixtures, one worker, local preview5197. **22/23 passed in 2.3 minutes.** All 14 reading-correction cases passed: 390/1440 Finish → Mark as reading; same attempt/entry and captured version; preserved earlier reads/context/flags; current-state facets; latest stopped state; failure/stale/read-only; genuine reread confirmation, pending guards and mistaken-reread recovery. Eight selected lifecycle layout, enlarged-text, keyboard, state-label and light-reader cases also passed.

The remaining existing dark active-reader journey timed out at its My Books card assertion while the snapshot still showed Loading books (0 vs 3). Its **exact unchanged narrow rerun passed, 1/1 in 33.5 seconds**. No assertion, source or timeout was changed to obtain that pass. The initial failure is retained; this is not a clean first-run 23/23 claim. Logs are under `evidence/2026-10-21-current-reading-status/`.

The selected tests exercised light/dark layouts and phone/desktop widths; screenshots of the new primary action at390/1440 were visually reviewed. No physical Safari or new WebKit certification is claimed.

Command selection: `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test -c playwright.journey.config.js tests/reading-corrections.spec.js tests/reading-lifecycle.spec.js --grep 'Mark as reading|current Reading entry|reread|read-only workspace|historical finished|current-state facets|library cards display|editorial workspace is book-first|editorial workspace phone text enlargement|zero-friction active reader journey|latest stopped reading' --reporter=line`.

## Integration acceptance owned by the lead

Combine with `b321bf1`, then run the lead's synthetic real API/database journey in `reading-shelf-live.spec.js` at390/1440: one saved entry with older finished history/current reading; Finished excludes it and Reading includes it before and after reload; Finish → **Mark as reading** reuses the exact attempt; no new records; counts match current/latest state; all history/context and Own/Want remain. Include a genuine confirmed reread separately. Existing backend32pass is lead-reported evidence, not a new execution here. No real account inspection is needed.

Lead owns the final live/regression result and integration. This UI handoff supplies no public-release or deployment signoff.
