# The tabbed profile (hub and public page)

Branch `ui/v3-profile-tabs`, from `origin/v3`. Rebuilds the hub and the public page around the tabbed sketch (`.impeccable/mocks/decision/tabbed.html`). Everything already built is kept: avatar, edit sheet, Make public confirm, one-time sheet, list pages and editing with Undo, list artwork and cloth, the spine shelf, type tokens. Local commit only; not pushed.

## What changed
- **Header (centred):** 96 px avatar, name (Lora, page size), "@username · reading since {year}", bio, the compact privacy pill (one line where it fits, wrapping inside the pill when narrow), then "Edit profile" as a quiet link. The public page has the same header without the pill and edit link.
- **Tabs:** Overview, Lists, Year as a real ARIA tablist (`aria-label="Profile sections"`): arrow keys move between tabs (wrapping), Home and End jump to the ends, only the selected tab is in the tab order. The state is `?tab=lists|year` (Overview is the default and has no parameter); a click pushes history so Back works, arrow keys replace it. The selected tab is a white pill on a wash track; labels never wrap (padding shrinks first, then the track scrolls).
- **Overview:** "Your {year} so far" with three big figures in Lora (books finished, pages, biggest month as a short name), then "Lists": up to three rows (spine art, name, "N books · private/shared") and "See all lists" (opens the Lists tab) when there are more. **Empty year:** one line, "Your {year} starts with your first finished book.", no figures and no zeros.
- **Lists tab:** the card grid and "+ New list", and the empty-lists line.
- **Year tab:** the sentence, spine shelf and genre line. **Empty year:** a baseline with month letters (about 40 px in all) and "Finish a book this year and it'll show up here.", not a tall empty shelf.
- **Account rows** (Account settings, Sign out) stay under the tab panel on every tab.
- **Public `/u/{handle}`:** the same tabs; Overview figures in the third person (labels "finished", "pages", "biggest month"); public lists only; the guest line last.
- **Desktop:** the header and tabs are centred in a 720 px column; the panels go up to 880 px.

## Copy I added (not in the brief): please check
- Empty public year: "Their {year} starts with their first finished book." (Overview and Year tab).
- Public profile with no public lists, Lists tab: "No public lists yet."

## Tests
`tests/profile.spec.js` (mocked, 46): tab keyboard behaviour (arrows, wrapping, Home/End, roving tab order), URL state (push on click, replace on arrows, Back, linked tab, unknown value), the Overview figures and the three-row limit with "See all lists", the empty-year Overview and Year tab (no zeros, short baseline), tabs not wrapping at 320 px and 200% text, the centred header and pill, Account rows last on every tab, and the public tabs (third-person figures, no owner controls, guest line last, empty public year).

## Existing assertions changed (`profile.spec.js`)
- The hub's year, shelf, year-sentence, spine-count and "every spine" tests open `/profile?tab=year` (they read the hub directly before).
- The list-card, artwork, cloth, two-across, 50-list-limit and wide-screen tests open `/profile?tab=lists`; the wide-screen test now clicks the Lists and Year tabs for the 120 px artwork and the 140 px shelf.
- The avatar test expects the hub avatar at 96 px (was 68) with a 42 px glyph (was 30).
- The empty-year test also expects the short baseline (shelf under 12 px, panel under 150 px).
- The privacy pill test now checks a centred compact pill (was the two-row phone pill); the Edit profile test checks it is centred (was left aligned with the name).
- The public-profile test reads the third-person figures on the Overview (the full sentence is on the Year tab).
- The old hub screenshot test is replaced by one that writes the tab matrix to `.bv-shots/profile-tabs/`.

## Result
Full suite: 456 passed, 3 skipped, 0 failed. Lint 13 warnings (unchanged).

## Screenshots
`.bv-shots/profile-tabs/` (not committed): Overview, Lists and Year with data and empty (Overview and Year; Lists with data and no lists), at 375 and 1440, light and dark; the public Overview, Lists and Year; and the three owner tabs with data at 375 with 200% text.
