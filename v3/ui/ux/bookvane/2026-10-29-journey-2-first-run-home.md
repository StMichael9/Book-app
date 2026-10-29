# V3 journey overhaul, PR 2: first-run Home

29 October 2026. Branch `ui/v3-first-run-home`, from `origin/v3` (2e985f9, which includes PR 1). Phase 2 of `v3-journey-conversion-plan.md`.

## Behaviour

On `/home`, when an account has **no books at all**, the page shows a first-run state instead of "Pick up where you left off.":

- Heading: "Welcome. Let’s fill your first shelf."
- **Pick a few books:** 10 covers from the public `/books` first page, in the landing's first-impression order (covered, plain-title books first), with the existing one-tap Want / Own buttons.
- **Import from Goodreads or StoryGraph:** a link to `/my-books/import`, shown only when the `library_import` capability is on and the library is writable.
- **Tell us what you like (optional):** a link to `/preferences`.
- After 3 saved picks: "Your shelf is started." with **Open My Books**.

Registrations with no saved-book intent already land on `/home`, so they see this.

**How "no books" is decided:** Home asks `/me/library` for its counts only when nothing is reading or paused. If the total is 0 the first-run page shows. It then stays for the rest of that visit, so saving a first book doesn't swap the page under the reader. An account with any saved book, even only Want to read, keeps the usual Home. If the count can't be fetched, the usual Home still shows when the check finishes with an error.

**Also:** `firstImpressionOrder` moved from `DiscoveryPages.jsx` to `ui-v2/data.js` so both pages share it (no behaviour change).

## Verification (executed)

New file `tests/first-run-home.spec.js` (added to the Playwright config), red first, then green:
- empty account: welcome heading, usual heading gone, 10 cards, the uncovered non-English-title book is not first, preferences link, no import link, no writes;
- import link appears only when library import is on;
- three saves show "Your shelf is started." and a My Books link (and not before);
- an account with a Want book keeps the usual Home.

Lint exit 0, 12 warnings (unchanged). Build passes. Full mocked suite result is in the PR body. Screenshots (390 and 1440, light and dark) were taken for review and are not committed.

**Not run:** WebKit, devices, real API.
