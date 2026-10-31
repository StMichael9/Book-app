# Import: an unfinished import no longer dead-ends

29 October 2026. Branch `ui/v3-import-active-run`, from `origin/v3` (787a1eb). Urgent fix after the import redesign.

- **Waiting box:** if the reader has an unfinished import, the start screen shows "You have an import from <date> ready to review." (or "waiting") with **Continue** (opens it in the right screen) and a quiet **Start over** (asks "Start over? Books already added stay in your library.", then cancels the old run and shows the cards). The file picker is hidden while one is waiting.
- **409 on start:** loads the saved imports and shows the same box, with no error.
- **Plain errors:** unknown or server failures say "Something went wrong on our side. Your library hasn’t changed — try again." with a **Try again** button. The "paused / checkpoint" message is gone, and "committed", "staging", "batch" and "acknowledged" were removed from reader-facing import copy (page and API messages).
- **Tests** (`tests/library-import.spec.js`): waiting run shows Continue and reaches the preview; Start over asks, cancels and returns to the cards; a 409 on start shows the box and no alert; a 500 shows the friendly message and Try again; the banned-words check now includes checkpoint, committed, staging and batch. One assertion changed: the saved-import text is now "You have an import … waiting."
- Lint 12 warnings, build passes, import and extended-catalogue specs 39/39. Full suite result: see the report.

## Added on the Lead's and Michael's instruction (same PR)

- **Four choices only:** Goodreads, StoryGraph, CSV / spreadsheet (with the template) and Export my Bookvane library sit plainly on the page. Removed: the text-encoding selector (UTF-8 is tried first and windows-1252 used if the file isn’t valid UTF-8, with no question), "Paste a book list", "Advanced import privacy" and the "Forget removed import markers" button and dialog, and the "Other ways…" disclosure. Backend routes are untouched.
- **Books you removed earlier:** rows with `plan.kind == "removed"` are counted out of "Review conflicts (N)" and shown on their own line, "N books you removed earlier are in this file", with **Skip them** (default) and **Add them back**. Add them back sends the existing per-row `match` decision with the top Bookvane candidate before confirming; rows with no candidate stay skipped and say "M couldn’t be added back".
- **Tests:** deleted the paste and forget-markers tests; added start-screen four-choices, windows-1252 detection, and the three removed-book paths.
