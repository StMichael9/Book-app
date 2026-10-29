# V3 import redesign: one calm path

29 October 2026. Branch `ui/v3-import-redesign`, from `origin/v3` (bf5aa08). Priority item in the journey brief; import is on for every signed-in reader and the old page was too heavy.

## What changed (UI only; import logic and API calls are unchanged)

1. **Start screen.** Heading "Import from Goodreads or StoryGraph", the lead line from the brief, two cards (Goodreads, StoryGraph) with numbered export steps and the existing export links, then one file control, "Choose your export file (.csv)". **Picking a file starts the check straight away.** "Check my library" shows only when column questions need answering (the questions are unchanged).
   Everything else is in one collapsed "Other ways to import and options": text encoding, paste a list, Bookvane CSV v1 / template, export my Bookvane library, advanced import privacy.
   Saved imports are one line above the cards: "You have an import in progress… Continue" (or "Your last import… View results" for a finished one, so past results stay reachable).
2. **Working.** One plain heading per phase (Reading your file, Finding your books, Checking for duplicates, Adding your books), "N of M" with a `<progress>` bar, Pause, a quiet Cancel, and "You can pause and come back later. Books already added stay." The four-step journey strip is gone.
3. **Preview.** "Ready to add your books", a summary from `run.summary` (books in your file, match books on Bookvane, added as your own entries, already in your library, need a choice), the primary button **Add everything I don’t have yet** (confirm with `accept_warnings`, `approve_private`, `skip_unresolved` all true) and **Review conflicts (N)** with N = review + invalid, hidden at 0. The row list and the three checkboxes with **Confirm import** now live inside that panel; the list is the only-review view.
4. **Done.** "Brought home N books." (`summary.applied.added_entries`), "N left for you to review" after the one-click path or "N skipped" after hand decisions (`dispositions.skipped`), **Pick what to read next →** and **Open My Books**, a quiet "Download your results (CSV)", and "Your results" (the row list) folded below. `completed_with_issues` shares the layout. Cancelled and expired keep their own headings.
5. **Copy.** Row cards no longer show disposition or error codes, "catalogue", "book group" or "proposal" wording: a plain label (Ready, Needs a choice, Skipped, Added) and sentences such as "Matches X" and "Will be added as your own entry, private to you".

## Please check

- "books in your file" uses `summary.distinct_targets` (falls back to `row_count`); the brief didn't name a field.
- Progress "N of M" uses `analyze_cursor` / `group_cursor` of `row_count`; uploading and applying show an indeterminate bar, since I couldn't confirm a total for them.
- A paused upload (reselect-the-same-file) keeps its "Resume upload" button and gets a Cancel button on the start screen.
- I removed `ImportJourney.jsx` and its CSS.

## Existing assertions changed (`tests/library-import.spec.js`, `tests/extended-catalogue.spec.js`)

Headings ("Bring your library" → "Import from Goodreads or StoryGraph"; "Review your library" → "Ready to add your books"); file label; "Check my library" clicks removed (auto-start); confirm path uses the one-click button; paste and privacy tests open the options details first; saved-import buttons are now "Continue" / "View results"; the cancelled-run text and the recheck status text; the old position assertion for the preview and the journey-strip assertion were dropped.

## Verification (executed)

New tests: start screen and folded options (and no banned words), one-click confirm with all three flags and the summary, Review conflicts (rows and checkboxes inside, hidden at 0), working screen with N of M and a progress bar, the done screen's "left for you to review" vs "skipped". Lint 12 warnings, build passes; full suite result in the PR body. Screenshots at 390 and 1440, light and dark, are not committed.

**Not run:** real files from Goodreads or StoryGraph, WebKit, devices.
