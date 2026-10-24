# V3 refinement, phase 3: cover jackets and My Books

22 October 2026. Branch `ui/v3-refine-3-covers`, **stacked on phase 2** (PR #37, itself on #35). Merge #35, then #37, then this.

## Decisions applied (approved by Michael)

- Typographic jackets replace the grey "Cover unavailable" tile. The cover grid stays.

## Changes

**Typographic jacket** (`BookCover` in `primitives.jsx`, styles in `bookvane.css`)
- Books without artwork, or whose image fails to load, show:
  - the title in Lora;
  - the author in small caps under a hairline;
  - a spine band and rule on the left.
- **Tint:** one of five palette tints (sage, ivory, rust wash, forest, ink), built from the existing `--bv-*` tokens, so both themes follow automatically. A stable hash of the title picks the tint, so a book looks the same everywhere.
- **Sizing:** type scales with each cover's own width through a container query.
  - Below 96px only the title shows (Next thumbnails, Home).
  - Below 48px only the tint and spine show (sign-up prompt thumbnail).
- **Accessibility:** the accessible name stays "Cover unavailable for {title}"; the visible "Cover unavailable" text is gone.
- **Cleanup:** removed about 30 per-context CSS rules that used to hide or resize parts of the old fallback.

**My Books cards** (`ReadingCards.jsx`)
- Every card ends with one status line: the reading state leads in green, followed by the independent shelves in muted text, e.g. "Reading · Want to read · Owned" or "Want to read · Private book".
- The line is plain text, so on narrow cards it wraps between words and a separator never starts a line.
- It replaces the earlier split between a state row above the title and a help line below.
- Older capability paths still show their shelf buttons.

**More filters**
- The toggle now looks like a control in the filter-pill family: bordered, with a chevron that turns when open, instead of the browser's default triangle.

**Discover chips**
- On phones the scrolling subject row fades at its right edge, so it's clear more subjects scroll into view.

**Workspace subjects**
- Non-interactive subjects in About this book read as a short text line ("Classics · Adventure") instead of chip-shaped spans that looked clickable.
- The book page's subject *links* are unchanged.

## Verification (executed on this branch)

| Check | Result |
|---|---|
| `npm run lint` / `npm run build` | Exit 0, 12 warnings (unchanged) / passed |
| Full mocked suite (Edge), first complete run | **283 passed, 0 failed** (11.4 min) |
| After the status-line wording fix: library, corrections and lifecycle specs | **134 passed** |
| Final full suite on the final code | **282 passed / 1 failed**. The failure was `minimalist closed stale note keeps its version…`: a 5 s focus poll after "Load saved version". The same test then passed **3 of 3 unchanged re-runs**, and passed in the 134-test run and in phase 2's full run. Recorded as intermittent; cause not established. |
| Impeccable detector, changed `.jsx` | 0 findings (regex-only) |
| Live check (local preview of this branch) | Discover at 390 dark: the chip fade shows. My Books at 390 dark with a real local account (an existing session cookie on `localhost`; nothing was clicked or changed): jackets sit naturally beside real covers. That screenshot isn't committed because it shows local account data. |
| Fixture screenshots | `assets/refine-3-covers/`: My Books 1440 light and 390 dark, workspace 1440 light and 390 dark |

**Test change:** the library review test previously asserted that fallback titles were *hidden*. It now asserts that the jacket shows the title, carries a tint class, and has no visible "Cover unavailable" text.

Not run: WebKit, physical devices, real API journeys.
