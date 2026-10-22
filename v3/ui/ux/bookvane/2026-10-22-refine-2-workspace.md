# V3 refinement, phase 2: reading workspace hierarchy

22 October 2026. Branch `ui/v3-refine-2-workspace`, **stacked on phase 1** (`ui/v3-refine-1-foundations`, PR #35), as Michael chose. Merge #35 first. This PR's own changes are the commits after `b9c459a`.

## Decisions applied (approved by Michael in chat)

- "Stop reading" moves out of the main reading card into Manage this book, without a confirmation step. It can be undone with Mark as reading.
- Manage and history wording as proposed:

| Before | After |
|---|---|
| Your copy for the new reading (optional) | Which copy are you reading? (optional) |
| Catalogue preferred edition | The catalogue's edition |
| Saved progress keeps this copy's page total even if catalogue metadata changes. | Progress uses this copy's page count, even if catalogue details change later. |
| Record a past finish / Record a past stop | Log an earlier read I finished / Log an earlier read I stopped |
| …Forgetting a book removes its entire private record. | …Forget this book removes everything you've saved about it. |
| Correct this reading (history) | Edit dates and progress |
| Delete this reading record | Delete this reading |
| Correct progress or dates (finished book) | Edit dates and progress |
| (new, in Manage while reading or paused) | Stop reading this book, with help: "For a book you've put down for good. You can mark it as reading again later; your progress and note stay." |

## Changes

**Four chunks**
1. The book.
2. My reading, as the card on the right at desktop width.
3. My note, directly under the book. The dead gap under the book card at 1440 is gone: the reading card spans the book and note rows.
4. **More about this reading**: one quiet group holding About this book (now an `h3`), Reading history, Imported sources and Manage.
   - History and Manage summaries are 17px sans rows separated by hairlines. They were previously 24px Lora bordered cards that outranked the note.

**Reading actions**
- The reading card's state actions are now Pause/Resume and Finish only.
- Stop reading is inside Manage while a reading is active or paused.

**About this book**
- The synopsis starts at two lines.
- Show more appears only when text is actually clipped (measured with ResizeObserver), and sits flush with the text.

**Phone order (DOM order)**
- Book, My reading, My note, the Next preview, then More about this reading.
- The Next preview previously came after Manage. The keyed Next controller still moves for Finish without remounting.

**Editors**
- Save and Close share one row; on phones Save is full width with Close beside it.
- Save now sits outside the disabled fieldset with an explicit `readOnly || pending` guard, so Close keeps working while changes are paused.

**Accessibility**
- History row buttons now name the reading they act on, for example "Edit dates and progress: Finished, 2025-01-02 to 2025-02-03". Previously every row had identical names.

**Unchanged**
- Requests, captured versions, draft identity and keys, lazy history loading, removal dialogs and finish flow logic.

## Verification (executed on this branch)

| Check | Result |
|---|---|
| `npm run lint` | Exit 0, 12 warnings (unchanged) |
| `npm run build` | Passed |
| Full mocked suite (Edge) | **280 passed / 3 failed** (14.9 min). The 3 failures used exact names for the history memory button, which now carries reading context. Tests updated; the exact 3 re-run: **3 passed** |
| Impeccable detector, changed `.jsx` | 0 findings (regex-only scan) |
| Fixture screenshots, 390/1440 in light and dark | `assets/refine-2-workspace/`. These come from the existing book-first workspace test with `screenshot: on`; synthetic fixtures, no covers |

The full suite was not re-run after the final 3-test fix. Live API journeys, WebKit and physical devices were not run.

## Test changes

- Renamed controls, matched by prefix where names now carry reading context:
  - `/^Edit dates and progress: /`
  - `/^Delete this reading: /`
  - `/^Note and reaction: /`
  - `/^View reading memory: /`
- "Log an earlier read I finished" and "Stop reading this book".
- Paused keyboard order without Stop reading.
- The 320px keyboard-order test now follows the new phone order (reading actions → My note → Next preview). It also asserts that Stop reading is no longer in the reading card.

## Next

Phase 3 (covers and My Books) uses the decisions already approved: typographic jackets, grid kept. Phase 4 changes the finish moment, which still renders the existing two-heading chooser for now.
