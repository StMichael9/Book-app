# November 5: Foundations (Phase A)

Branch `ui/v3-foundations`, local commits only (not pushed).

## What changed
- Legacy UI deleted (it was unreachable; `main.jsx` renders only `ui-v2/BookvaneApp.jsx`): `src/App.jsx`, `App.css`; `components/{AuthForm,BookCard,BookDetailPage,BookStatusControl,BrowseShelf,CuratedShelves,EmptyState,Header,Hero,LandingPage,MyBooksPage,Pagination,PasswordRecoveryPage,PreferencesPage,ProtectedRoute,ResultsList,ScrollToTop}.jsx`; `components/SearchBar/{AutocompleteInput,SearchBar}.jsx`; `data/browseShelves.js`; `hooks/useDebounce.js`; `api/autocomplete.js`; `api/emailSignups.js`; `styles/{components,layout,mobile,my-books,browse-shelves}.css`. `ShareBookButton.jsx` now uses `Button variant="secondary"` and `.bv-share-error`.
- One shelf wording: buttons "Want to read" / "I own it", status "Owned" ("Saved" removed).
- Eyebrow on the landing only. Type-scale tokens (`--bv-fs-small`, `--bv-fs-display`), cloth ink and spine tokens replace literals. One shared link rule and field selector. One reduced-motion block; transitions use ease-out.
- Gated before/after screenshot matrix (`FOUNDATIONS_SHOTS`), skipped by default.

## Item 3 (one cover frame)
Every book image goes through `BookCover` except `profile/ListArt.jsx`. It stays: its thumbnails are decorative (`aria-hidden`), use the same `coverSrc`/`coverFallback` pipeline, and fall back to a bookcloth spine because a jacket with title text is unreadable at thumbnail size. "Cover unavailable" appears only in `aria-label`s.

## Tests
Lint 5 warnings (baseline 13), build passes. Mocked suite (msedge): 450 passed, 2 failed, 4 skipped. The 2 failures were an assertion that needed the new accessible name; fixed, and re-run passes (2/2).
Changed assertion: `critical-flows.spec.js:271` button name is now "I own it: Add Test-only Fantasy to Owned" (the visible label is part of the name).

## Screenshots
`.bv-shots/foundations/{before,after}/` — landing, browse, book, My Books, workspace, home, import start, login at 390 and 1440, light and dark (32 each).
