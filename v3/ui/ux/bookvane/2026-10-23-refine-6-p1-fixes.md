# V3 refinement follow-up: P1 fixes from the re-critique

23 October 2026. Branch `ui/v3-refine-6-p1-fixes`, **stacked on phase 5** (PR #41). Merge #41 first.

The re-critique of the phase 1–5 candidate scored 27/40 and raised two P1s. Michael approved these fixes:

## 1. Finished and stopped books have no primary action

- **Read it again** is now a secondary button, with its own help line directly under it: "Starts a new reading. This one stays in Reading history."
- **Mark as reading** becomes a quiet inline link: "Still reading it? Mark as reading". It keeps its accessible name, its 44px target and its existing command, version guard and focus behaviour.
- Previously the filled primary "Mark as reading" (effectively an undo) outranked the finish moment, and the help text sat under the wrong button.

## 2. Text follows the browser's font-size setting

- **The change:** all 158 px font sizes in `styles/ui-v2/*.css` (`font-size` and the size in `font:` shorthands) are now rem, one for one at a 16px root (e.g. 17px → 1.0625rem).
- **What stays px:** the cover-jacket text, which deliberately scales with each cover's width (`clamp(…cqi…)`). Spacing, letter-spacing and target sizes are unchanged.
- **Before:** a reader who raised the browser's default font size saw no change. A check on the old build confirms it: with the root at 200%, `.bv-root` stayed 16px and h1 stayed 32px.

## Verification (executed)

**No visual change at default size.** I captured 58 fixture screenshots (14 tests: library review, workspace, landing, Home/My Books) before and after:
- **52 were byte-identical.**
- **6 differed.** A second capture of the new branch showed that 6 files vary between identical runs (cover-image load timing). Of the 3 that still differed from the baseline:
  - one differs only by invisible anti-aliasing (nothing shows in a difference image at a 10% threshold);
  - one differs only where a cover image loaded differently;
  - the third is a landing capture of the same kind.
- No text or layout moved.

**New test:** `browser default font size scales text and the layout holds` at 320 and 390 (`reader-flows.spec.js`). With the root at 200%, it checks that:
- body and h1 sizes double;
- there's no horizontal overflow;
- the phone navigation stays on one row;
- shelf buttons remain visible.

**Updated tests:** three `reading-corrections` assertions now expect Mark as reading to be quiet. One also asserts that "Read it again" is secondary and that the reading actions contain no primary button.

**Full mocked suite (Edge): 288 passed, 0 failed.**

**Lint and build:**
- Lint exits 0 with 12 warnings. The first run showed 13: an unused `app` fixture parameter in the new test, which needs the fixture for its mocked API, so it's now `app: _app`. Lint was re-run afterwards; the full suite was not.
- Build passes.

**Screenshot:** `assets/refine-6-p1-fixes/finished-book-light-390.png`.

**Not run:** WebKit, physical devices, real API journeys, or a real browser font-setting change. The test sets the root font size, which is what that setting does.
