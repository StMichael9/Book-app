# Every saved book has a description, and "why I saved it" (T28)

Branch `ui/v3-book-descriptions`, from `origin/v3`. Built against the T27 contract with mocks: list entries carry `snippet` and `save_note`, and the library-entry PATCH takes `save_note` guarded by `expected_version`. **Mock-only until T27 lands on v3; a real-API pass is still to do.**

## What changed
- **My Books card:** one line under the author: the reader's `save_note` in italics, else `snippet`, two lines at most, nothing if both are empty. Clicking it opens the book like the title. It is not a second tab stop; the title link carries it as its description.
- **"Why this one? (only you see this)":** an inline field under the shelf buttons on the full book page, right after a successful Want to read by a signed-in reader, only when the saved entry has no `save_note`. Save and Skip; Esc skips. Focus goes to the field, then back to the Want button. A failed save shows "We couldn’t save that. Try again." and the book stays saved. Asked once per book id (kept in `localStorage`, wrapped in try/catch) so Skip, Esc or Save never brings it back. Not offered for Owned, on cards, on Discover or Home, for guests, or after the guest sign-up continuation.
- **Reading page:** "Why I saved this book" opens by itself when there is a note (the reader can still close it); the empty state keeps its quiet button.
- **Private books:** readers never type descriptions. The "No description or edition details have been confirmed" line is gone; a private book shows its description when the server has filled one in, and nothing (no placeholder, no heading) when it has not.
- **Polish:** the profile sheet uses the lucide Check icon (`aria-hidden`) instead of a text tick. While the outage banner shows, Want and Own are disabled with the visible hint "Saving is paused for now" (linked with `aria-describedby`).

## Tests
`tests/book-descriptions.spec.js` (mocked): the card shows note, snippet or nothing; two-line clamp; no extra tab stop; the prompt once after Want, Skip, Esc, focus return, not for Owned, not when a note exists, not on cards; Save sends `save_note` with `expected_version`; a failed save keeps the book saved; no re-ask after remove, re-add and reload; the note shows on the card after reload; the reading page opens the reason when there is a note; a private book with no description shows no description line; outage disables Want and Own; the sheet uses an icon. Screenshots (`BOOK_SHOTS=1`) are written to `frontend/node_modules/.bv-preview/descriptions/` and not committed.

## Existing assertions changed
- `reader-flows.spec.js`: two tests that fail a write on purpose (failed writes keep the prior status; a different shelf after a continuation failure) now click "Check again" before retrying, because Want and Own stay disabled while the outage banner shows. The mock gained a `/health` handler.
- `auth-data.spec.js` (a refresh outage does not silently sign out): Owned is now asserted disabled while the banner shows, then enabled after "Check again".
- `reading-lifecycle.spec.js` (private books never request public metadata): "No description is available for this private book." is now asserted absent.

## Result
Full run before those four test updates: 415 passed, 2 skipped, 4 failed (exactly the four above). After the updates the three files that hold them were re-run: 128 passed. Lint 13 warnings (one was already on v3 before this branch).
