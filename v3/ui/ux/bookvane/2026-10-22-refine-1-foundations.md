# V3 refinement, phase 1: foundations and accessibility

22 October 2026. Branch `ui/v3-refine-1-foundations` from `origin/v3` at `b89da9f`. This is the first of five phased refinement PRs, following the Impeccable critique of the same day (27/40, Acceptable). This phase is a refinement, not a redesign. The light palette, typefaces, destinations, API and behaviour are unchanged.

## Decisions applied (approved by Michael in chat)

- Refinement of the approved identity; dark-theme tokens may be tuned, light values stay.
- Shelf wording: "Want to read" / "I own it" on full buttons, "Want to read" / "Owned" as labels. Compact cards (Discover and library grids on phones) keep "Want" / "Own" for width. Their accessible names always carry the full wording and the book title.
- Eyebrow labels remain only in the landing hero.

## Changes

**Enlarged text and phone layout**
- Headings and buttons use `overflow-wrap: break-word` instead of `anywhere`. With 200% text, "My Books" no longer splits mid-word ("My / Bo / oks").
- The library heading wraps the import button under the title when space runs out.
- Phone navigation stays on one row at any text size, with equal columns.
  - At extreme sizes a label shortens with an ellipsis instead of the nav growing to a 2×2 block of about 150px.
  - This deliberately changes the earlier design, which let the nav wrap. The `independent review` test now asserts one row and unwrapped labels.
- Signed-in phone headers show the theme toggle. Guests still reach it from You.
- Library filter buttons stretch to equal heights when "Want to read" wraps.

**Dark mode and button states**
- Dark `--bv-green` changes from `#8fa89b` to `#a9c9b3`. Primary buttons and links read as active instead of washed out. Text on the fill keeps more than 9:1 contrast.
- Selected toggles (`bv-button--saved`) get a 2px green ring and a green check icon, with ink text in dark mode. Discover subject chips use this selected style with `aria-pressed`, instead of a filled primary button.
- Disabled buttons are flat and outlined with muted text, so they never resemble an available primary button. The old opacity-only treatment now applies only to inputs.
- Button roles are documented in `bookvane.css`.

**Wording and labels**
- Shelf buttons, library filters, workspace flags (with a check when on), Next-read copy, filter dialog, announcements and the sign-up prompt all use the Want to read / Owned vocabulary.
- "Bring Your Library" becomes "Bring your library".

**Eyebrows**
- Removed from login, Home, the workspace, preferences, account, reading data, private-book and import pages, and the legacy V2 My Books.
- The current-reading card's "Reading" label becomes a plain status line.

**Accessibility**
- Discover and library cards: the cover link is now `tabIndex={-1}`, so keyboard users get one stop per book (the title). Pointer and touch still open the book from the cover. The cover link keeps its accessible name, so screen-reader virtual browsing still lists it.
- Book and workspace pages name the browser tab after the book (`useDocumentTitle` in `ui-v2/data.js`).
- While an editor is open, reading actions show and announce "Save or close the open editor to use these actions."

## Verification (executed on this branch)

| Check | Result |
|---|---|
| `npm run lint` | Exit 0, 12 warnings (same count as `origin/v3`; one new warning from exporting a hook out of `primitives.jsx` was removed by moving it to `data.js`) |
| `npm run build` | Passed |
| Full mocked suite (`playwright.config.js`, system Edge) | First run: **242 passed / 41 failed**. Failures were accessible-name and copy assertions changed by the wording pass, one dark-colour assertion, and a real phone layout gap (unequal filter heights). Tests updated, CSS fixed. Final complete run: **283 passed, 0 failed (8.4 min)** |
| `npm run test:mobile` | Chromium phone: **7 passed**. WebKit phone: **7 not run**, WebKit isn't installed on this machine (`npx playwright install webkit` needed). Not a pass. |
| Impeccable detector, changed `.jsx` files | 0 findings (regex-only scan, an undercount) |
| Impeccable URL scans, guest pages at 1280 and 390 | `/`: 1 `hero-eyebrow-chip` (the landing eyebrow kept by decision). `/browse` 390: 1 advisory straggler (copy, phase 5). `/book/4`, `/login`: clean. `/login`'s earlier `kicker-above-heading` warning is gone. |
| Live guest check (worktree preview proxied to the local dev API) | Dark `/browse` and `/book/4` at 390; 200% text at 320/375 keeps one nav row with no horizontal overflow; tab title shows the book. Screenshot: `assets/refine-1-foundations/book-detail-dark-390-after.jpg` |

Not verified here: signed-in screens live (the seeded password could not be read in this session; signed-in coverage is the mocked suite), real API/database journeys, WebKit/Safari, physical devices.

## Test changes

Tests were updated only where they asserted wording this phase intentionally changed:
- "Add/Remove X to/from Want" → "… Want to read".
- "… Own" → "… Owned"; full-size own button: "I own it: Add X to Owned".
- Workspace flags "Want"/"Own" → "Want to read"/"I own it".
- "Bring Your Library", "My Want books", "Only books I marked Own".
- Dark primary colour value.

The phone nav label test now checks a single unwrapped row instead of a single text rect. Live-API specs (`*-live.spec.js`, `live-local-auth.spec.js`) received the same mechanical name updates but were not executed.

## For the Lead Developer

- Review the one-row navigation tradeoff (ellipsis at extreme text sizes vs the previous 2×2 wrap).
- Shared files touched: `primitives.jsx` (ShelfActions names, BookCard), `ReaderContext.jsx` (announcement copy only), `ReadingPages.jsx` (flag labels, editor hint, title). No state, request or version logic changed.
- Next phase (workspace hierarchy) starts from `v3` after this merges, and needs two decisions first: where "Stop reading" goes, and the new Manage wording.
