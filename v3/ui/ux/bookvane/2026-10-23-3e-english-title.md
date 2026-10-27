# V3 release fix 3e: English-title subtitle

23 October 2026. Branch `ui/v3-english-title`, **stacked on #49 (on #48)**. Michael approved the design.

## Behaviour

Catalogue books whose stored title differs from their English title show the English title as a quiet second line directly under the title: muted colour, Source Sans, regular weight, `lang="en"`.

- **Rule:** shown only when `english_title` is a non-empty string that differs from the displayed title, compared trimmed and case-insensitively. Otherwise nothing renders (no empty element, no gap). One helper, `englishTitle(book)` in `ui-v2/data.js`; a small `EnglishTitle` component in `ui-v2/primitives.jsx` renders it.
- **Where** (class `bv-english-title`):
  - Discover and landing cards (`BookCard`): after the title, before the author, 0.875rem.
  - Book page (`BookPage`): after the heading, before any subtitle line, 1.125rem.
  - My Books cards (`LibraryEntryCard`, from `entry.book`): 0.875rem.
  - Reading page (`ReadingBookIdentity`): after the heading, before the author, 1.125rem.
- **Private books** (`entry.book == null`) never have one.
- **Spacing:** 2 to 4px between title, English title and author, so they read as one group. Styles are in `refinement.css`, with rem and `--bv-*` tokens only.
- **Also changed:** `getBookById` (`api/books.js`) keeps an explicit list of response fields for the book-detail cache, so `english_title` was dropped on `/books/:id`. It is now in that list. Without it the book page could never show the line.
- **BCE years (display only, Michael approved):** `formatYear(year)` in `ui-v2/data.js` shows a negative year as "700 BCE" and any other as is. Used on the book page "Published" line and the reading page About line. No change to data, API or sorting.
- **Not changed:** copy, headings, accessible names, ranking. The Current reading card on My Books home isn't in the brief's list and was left alone.
- Today the API returns `english_title: null` everywhere until titles are loaded, so with real data nothing changes yet.

## Verification (executed)

| Check | Result |
|---|---|
| New: Discover cards and book page (reader-flows) | Red first (no `.bv-english-title`), then green. Different title shows the line with `lang="en"`; null, empty, and case-only or whitespace-only matches render none. |
| New: My Books cards and reading page (reading-library) | Red first, then green. Same cases, plus a private entry shows none. |
| `book-details-cache.test.mjs` | 6/6 pass |
| Lint / build | Exit 0, 12 warnings (unchanged) / passed |
| Full mocked suite (Edge) | **307 passed, 0 failed** (9.5 min, under the 5189 lock) |

Screenshots (390 and 1440, light and dark; Discover card and book page, "Ὀδύσσεια" / "The Odyssey") were taken for review and are not committed.

**Not run:** WebKit, physical devices, real API.
