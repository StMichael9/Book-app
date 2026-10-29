# V3 journey overhaul, PR 1: quick wins

28 October 2026. Branch `ui/v3-journey-quick-wins`, from `origin/v3` (f9336bd). Phase 1 of `v3-journey-conversion-plan.md`; approved copy used verbatim.

## What changed

1. **Guest no-results panel** (Discover empty state, guest with a title or author search): "Can’t find it here? With a free account you can add any book to your library yourself." **Create free account** goes to `/register?src=noresults&returnTo=<current search>`; **Sign in** carries the same return. The existing tips stay. It never mentions looking further. Signed-in readers see no panel.
2. **Trust copy:**
   - Register pending-book card: "Saves to Want to read as soon as your account is ready." (the sign-in page keeps "after you sign in", which is accurate there).
   - Under Create account: "Free. Your library is private. We only email you for password resets." and a Privacy link.
   - Save dialog: "Free · private · takes a moment".
3. **Landing:**
   - Hero help line: "Free. Private. No account needed to explore."
   - **Join free** in the landing header; phone guests get a **Discover** link there (the landing has no mobile nav).
   - `?src=landing` on the landing register links (header, hero, bottom banner); `src=saveprompt` on the save dialog's link.
4. **Get a copy:**
   - Book page link text is "Find it at Bookshop.org".
   - A quiet "Get a copy" link with an external-link icon on next-read cards (the preview and the full cards), using `bookshopAffiliateUrl`, `rel="noopener noreferrer sponsored"`, the line "Bookvane may earn a small commission." and the accessible name "Get a copy of {title}, opens Bookshop.org in a new tab". Nothing shows without an affiliate ID, and not for private books.
5. **Fixes:** `/discover` redirects to `/browse`; book description width is `70ch`; the 404 copy for guests no longer mentions a library ("Try discovery to find your next book."; signed-in copy unchanged).

## Needs your decision

- **Finish moment:** the brief asks for "Get a copy" "in the finish moment under a 'What's next?' line". The finish moment doesn't know the next pick; the "Next after this" preview right below it already shows the top Want-list pick, and that preview now carries the link. I didn't add a separate "What's next?" block. Tell me if you want one.
- **Save dialog focus:** closing it (Escape or Keep browsing) already returns focus to the Want to read button, so a test now guards it but there was no code to fix.
- **Dialog cover thumbnail:** I could not reproduce a blank thumbnail at 1440 with a cover present; the fixture screenshots show it.

## Existing assertions changed

- `reader-flows.spec.js` landing test: help line is now "Free. Private. No account needed to explore."
- `get-a-copy.spec.js`: the book page link name is now "Find it at Bookshop.org".
- `critical-flows.spec.js` phone landing test: the register and login URLs now end in `?src=landing`.

## Verification (executed)

New tests, red first (8 failed on the old behaviour), then green:
- guest no-results panel, links and `src`, and none when signed in;
- register trust copy, Privacy link, `src=saveprompt`, focus return;
- landing help line, Join free, `src=landing` on all three links, phone Discover link;
- `/discover` redirect and the guest 404 copy;
- description width ≤ 70ch;
- next-read Get a copy (link, target, rel, disclosure, accessible name), and none without an affiliate ID.

Lint exit 0, 12 warnings (unchanged). Build passes. Full mocked suite: 365 passed and 1 failed on the first run; the one failure was the `?src=landing` URL assertion above, fixed and re-run green (366 of 366 in total).

Screenshots (390 and 1440, light and dark; landing, no-results, save dialog, register) were taken for review and are not committed.

**Not run:** WebKit, devices, real API. Phase 0 beacons are not started (waiting for Michael and the Lead).
