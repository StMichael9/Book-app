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

- **Review fixes:** the reader's note on a card now really slants (the bundled fonts have no italic face and the app sets `font-synthesis: none`, so the note switches synthesis back on; the test checks `font-style` and `font-synthesis-style`, and that the snippet stays upright). While the "Why this one?" prompt is open, the "Added to Want to read." toast is drawn off-screen but still announced; it returns to normal afterwards.

## Existing assertions changed
- `reader-flows.spec.js`: two tests that fail a write on purpose (failed writes keep the prior status; a different shelf after a continuation failure) now click "Check again" before retrying, because Want and Own stay disabled while the outage banner shows. The mock gained a `/health` handler.
- `auth-data.spec.js` (a refresh outage does not silently sign out): Owned is now asserted disabled while the banner shows, then enabled after "Check again".
- `reading-lifecycle.spec.js` (private books never request public metadata): "No description is available for this private book." is now asserted absent.

## Result
Full run before those four test updates: 415 passed, 2 skipped, 4 failed (exactly the four above). After the updates the three files that hold them were re-run: 128 passed. Lint 13 warnings (one was already on v3 before this branch).

## T33: catalogue on demand (UI)
Same branch and PR as T28. Mocks only until T30 and T31 are on v3.
- **Card line:** only the reader's note or `snippet`; a card never shows any other description text (test added).
- **Book page description:** `GET /books/{id}/description` (catalogue) or `GET /me/library/{entry_id}/description` (private entry) answers `{text, source, link?}`. Until it answers the page shows the description it already has (no placeholder flash); `text: null` shows nothing (not even the "About this book" heading); a failed or unusable answer behaves exactly as before.
- **Google:** the full text exactly as sent, rendered as plain text with line breaks kept (`white-space: pre-line`), no clamp, no "Show more", then a muted "Description from Google Books" link to `link` (https only; `target="_blank" rel="noopener noreferrer"`, accessible name "Description from Google Books (opens in a new tab)"). The credit wording is the single constant `GOOGLE_CREDIT` in `descriptionCredit.js`; Michael approved it. Open Library or null source shows no credit. Google text appears wherever the description appears (book page and the reading page), always with its credit.
- **Import page:** after an import completes, `GET /me/library/imports/{run_id}/enrichment` (`{pending, upgraded}`) is checked every 5 s while `pending > 0` and the tab is visible. A polite live region says "Finding covers and descriptions for N books…" ("1 book" when one), and disappears at 0. Any error stops the checking silently. When `upgraded` goes up, the library is refreshed quietly (its refresh counter is shown as `data-library-revision` on the page root so tests can see it; it has no visual effect).
- **Existing mocks:** eleven older specs gained a 404 answer for the two new description paths and the enrichment path, so they keep the old behaviour.
- **Tests:** google full text with credit link, no clamp and no markup; openlibrary without credit; null shows nothing; the page's own text stays until the answer; failed answer falls back; private entry Google text; the card never shows other description text; enrichment counts down, refreshes on upgrades, hides at 0 and stops polling; a failing check stops quietly. Screenshots (`BOOK_SHOTS=1`): `google-*` and `import-*` in `frontend/node_modules/.bv-preview/descriptions/`.

## Result (T28 + T33)
Full run: 425 passed, 3 skipped, 4 failed. Two were the new line-break test run against a build made before its code change and the profile mock lacking the new description path; both fixed, and the affected specs re-run (profile, book-descriptions, reading-lifecycle, critical-flows: 166 passed, 2 skipped). `instant-books` "snapshot books stay and the page works when the API fails" failed once and passed 36 of 36 on a repeat run (a flake). Description text from every source is rendered as plain text with `white-space: pre-line`; a literal `<b>` shows as text. Lint 13 (no additions).
