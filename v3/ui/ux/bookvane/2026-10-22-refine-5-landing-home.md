# V3 refinement, phase 5: landing, Home and copy

22 October 2026. Branch `ui/v3-refine-5-landing-home` from `v3` at `0a4d041`, which already contains phases 1–4.

## Decisions applied (approved by Michael)

- **Landing books** are chosen by rule, not by catalogue ID, because IDs differ between the local seed and production. The API exposes no stable work key.
- **Landing closing banner:** "Your next book is waiting." / "Bookvane is free. Save what catches your eye, track what you're reading, and keep notes only you can see." / **Start your free library** (guests; signed-in readers still see "Open your library").
- **Empty Home import line:** "Have a reading history somewhere else? Bring your library from a CSV or TSV file." No Goodreads/StoryGraph names until the R1 native-export gate passes.
- **Home heading:** keep the h1 and the "Your current reading" section heading; drop the descriptive line between them.

## Changes

**Landing** (`DiscoveryPages.jsx`, `WelcomePage`)
- It requests one page of 30 books instead of 10, still one request.
- It ranks them: books with a cover and a plain English-alphabet title first, then the rest, keeping catalogue order within each group. "Plain" means printable ASCII plus typographic quotes and dashes.
- The hero shows the first 3; the "Open a new chapter" row shows the next 5, so they never repeat.
- A catalogue of fewer than 8 books shows the first 5 in the row, repeating the hero rather than leaving a sparse row.
- This keeps titles such as "Ὀδύσσεια" or "Hrabě Monte Cristo…" out of the first impression. It cannot judge cover darkness: an all-black endpaper cover still qualifies.
- The benefit titles are now 19px sans, so "Make room for your reading life." anchors the section.
- The closing banner has the new copy.

**Home** (`ReadingPages.jsx`)
- The descriptive line under the h1 is removed.
- **Empty state:**
  - With no paused books, **Find a book** (Discover) is now the primary action and "Choose from My Books" the secondary.
  - With paused books, "Open paused books" stays primary.
  - The import line is softened as approved.

**Book page:** Want to read / I own it now come straight after the author, before the subject links and metadata, so they're on a phone's first screen. Keyboard order matches.

**Polish**
- Short intro lines under page and section headings use `text-wrap: pretty`. This addresses the detector's earlier straggler advisory on `/browse`.
- With private notes switched off (no My note row), the workspace's secondary group moves up instead of leaving the desktop gap noted in phase 4.

## Verification (executed on this branch)

| Check | Result |
|---|---|
| `npm run lint` / `npm run build` | Exit 0, 12 warnings (unchanged) / passed |
| New test | `landing prefers covered, plain-English titles and never repeats hero books in the row`. Its first full-suite run failed because the test read the hero before books loaded (empty array). I added load waits to the test; it then passed 3/3 alone. |
| Full mocked suite (Edge), final | **286 passed, 0 failed** (10.0 min) |
| Impeccable detector, changed `.jsx` | 0 findings |
| Fixture screenshots | `assets/refine-5-landing-home/`: landing at 1440 light and 390 dark (the fixture catalogue has 5 books, so the row uses the small-catalogue fallback) |

**Not run:** WebKit, physical devices, real API journeys.
