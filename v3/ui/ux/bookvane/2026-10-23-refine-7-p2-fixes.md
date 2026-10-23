# V3 refinement follow-up: P2 fixes from the re-critique

23 October 2026. Branch `ui/v3-refine-7-p2-fixes`, **stacked on #42** (which sits on #41). Approved by Michael.

## 1. Forget reads as destructive

- In Manage this book, **Forget this book** now sits apart: a hairline and space above it, outlined in the danger colour (`bv-button--danger-outline`), with its help line.
- The final confirmations ("Forget book and history", "Delete this reading") use a filled danger button (`bv-button--danger`). Cancel stays "Keep it".
- Disabled danger buttons follow the existing flat, outlined disabled style.

## 2. Vocabulary sweep

- **Own/Want → Want to read / Owned** in the remaining help, dialog, data and import copy:
  - `AccountPages` sign-up intent
  - extended catalogue confirm
  - `ReadingDataControls` (dialogs, download, removal help)
  - `ImportedSources`
  - `LibraryImportPage` (source values, confirmation, export)
  - `LibraryPage` empty state
  - `NextReadSection` empty choices
- **"Reading record" → "reading"**: dialog title "Delete this reading?", confirm "Delete this reading", "No readings on this page.", reread dialog "This starts a new reading of this book."
- **Workspace flags now read Want to read, then I own it**, matching the book page and cards.

## 3. Discover first screen

- **Cover placeholder:**
  - While a cover image loads, the book's typographic jacket stands in, and the image fades in when it arrives (200 ms; off with reduced motion).
  - A failed image still falls back to the jacket, with the existing "Cover unavailable for …" name.
  - Loading placeholders use `bv-cover-placeholder`, not `bv-cover-fallback`, so counts of missing covers are unchanged.
- **Ranking:**
  - Guests browsing Discover without a search get the landing's first-impression order within each page: covered books with plain titles first, catalogue order otherwise.
  - Signed-in readers keep server order, which puts their preferred subjects first (`services/search.py`).
  - The scope (guests only) is Michael's decision.

## Verification (executed)

| Check | Result |
|---|---|
| New: guest Discover order and slow-cover placeholder | Passed. Order is Slow cover, Ἰλιάς, No cover yet. The placeholder shows while the image is held (image opacity 0), then the placeholder is removed and the image is visible. |
| New assertion: delete-reading confirm has `bv-button--danger` | Passed |
| Updated tests | Copy ("Owned marks", "Delete this reading"); flag order in the paused keyboard and draft tests |
| Full mocked suite (Edge) | **289 passed, 0 failed** |
| Lint / build | Exit 0, 12 warnings (unchanged) / passed |

**Not run:** WebKit, physical devices, real API journeys.

**Lead coordination:** none of these edits touch T4's live-date call sites (`create`, `changeState`, discovery start, `startChoice`).
