# V3 refinement, phase 4: the finish moment

22 October 2026. Branch `ui/v3-refine-4-finish`, **stacked on phase 3** (#39 → #37 → #35). Merge in order: #35, #37, #39, then this.

## Decision applied (approved by Michael)

Finishing a book gets a calm acknowledgement first. A quiet, collapsed next-read suggestion follows, and the full chooser opens only on request.

## Changes

**The finish moment** (`FinishMoment` in `ReadingPages.jsx`)
- After a saved Finish, it sits between the book and My note:
  - **"You finished {title}."** (Lora heading; receives focus);
  - the read dates when recorded ("Read Jan 2, 2026 – Feb 3, 2026", or "Finished …" when only the end date is known; nothing when neither is recorded);
  - "No rating or review needed. If something stayed with you, you can keep it here, privately.";
  - **Leave a closing note**, which opens the existing note editor. It shows only when private notes are available and this reading has no note yet.
- The two old headings, "Reading saved." and "What would you like to read next?", no longer appear together.
- It now appears whenever a Finish is saved. Previously the finish UI depended on the Next-read capability.
- The moment disappears when the reading changes state (e.g. **Mark as reading**) or the page reloads.
- **Deviation from the plan:** the moment doesn't repeat "Mark as reading". The reading card beside it already offers it as its primary action, and two identical buttons would compete.

**Next read after a finish** (`NextReadSection.jsx`)
- The same keyed controller stays where it always is (after My note), with the same request session and no remount.
- A finish resets it to the quiet one-book Want to read preview, collapsing it if choices were open.
- "Explore more choices" opens the full chooser, and "Back to this reading" collapses it again. That button is disabled while a Start is pending, the same guard "Not now" used to have.
- Removed "Not now" and the finish-specific headings and layout (`bv-finish-choices`).
- "From your Want to read list." now appears only when there is a book to show.

**Unchanged:** finish commands, captured versions, exclusion rules, source reset to Want on finish, and start/pending guards.

## Verification (executed on this branch)

| Check | Result |
|---|---|
| `npm run lint` / `npm run build` | Exit 0, 12 warnings (unchanged) / passed |
| Full mocked suite (Edge) | **283 passed, 0 failed** (10.4 min) |
| Impeccable detector, changed `.jsx` | 0 findings (regex-only) |
| Fixture screenshots | `assets/refine-4-finish/`: 390 light/dark, 320 light, from the existing finish-order test |

## Test changes

The finish-flow tests in `next-read.spec.js` and `reading-lifecycle.spec.js` now assert the new flow, keeping each guarantee they protected:

- **Focus:** the "You finished …" heading receives focus.
- **Preview:** the one-book Next preview is shown, and no chooser region opens on its own.
- **Request reuse:** expanding the preview shows the same session's Want choices, with one session ID and no duplicate book-detail request.
- **Pending start:** a pending start disables "Back to this reading" (previously "Not now"), and the finish moment stays visible.
- **Failed or malformed choices:** the preview says "Your reading is unchanged", and the finish stays saved.
- **Failed finish:** no finish moment appears.
- **Reload:** the moment disappears after a reload.
- **Existing note:** "Leave a closing note" isn't offered when a note already exists.

`reading-library-live.spec.js` got the same update but was not executed.

**Not run:** WebKit, physical devices, real API journeys.

## Noted, not changed

With private notes switched off (no My note section), the desktop dead gap under the book card from before phase 2 returns, because there is nothing to sit in the book's second row. This doesn't affect the default V3 configuration, where private context is on; it's a candidate for the phase 5 polish pass.
