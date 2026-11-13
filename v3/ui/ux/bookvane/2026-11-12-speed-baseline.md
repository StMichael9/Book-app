# November 12: Speed S0, a repeatable speed baseline

Tests and this note only. Nothing under `frontend/src/` changed. Spec: `frontend/tests/speed-baseline.spec.js` (registered in `playwright.config.js`); numbers: `frontend/tests/speed-baseline.json`.

## How it measures

Every API call is mocked and answered after a fixed 300 ms, so the numbers depend on how many requests the app makes one after another, not on the network. The signed-in hint is set like the other specs set it, and `/auth/refresh` answers 200. Each page is loaded five times from a blank page; the best run counts (a busy machine can only slow a load or add a false stage).

- **stages:** requests in a row that had to finish before the main content showed. A request is in stage N+1 when it started after a stage-N request ended.
- **content time:** ms from navigation start to the main content being visible (found with fast polling, not `expect`'s backing-off poll).
- The spec fails if a run has more stages than the file, or a content time more than 250 ms over it. To lower the numbers after speed work: delete the JSON and run three times with `UPDATE_SPEED_BASELINE=1` (it keeps the highest of the runs). `SPEED_TIMELINE=1` prints each call's start and end for one load.

## Baseline (300 ms per call)

| Page | Main content visible when | Stages | Content time |
|---|---|---|---|
| `/home` | Reading now and Up next headings | 4 | 1842 ms |
| `/my-books` | the first library card | 3 | 1539 ms |
| `/browse`, signed in | the first card from the live response | 2 | 1314 ms |
| `/book/{id}`, direct URL | the title, and Want to read enabled | 3 | 1394 ms |
| `/my-books/{entryId}`, direct URL | the My reading panel | 3 | 1550 ms |

Machine noise is about +/-100 ms on content time. One run in some batches showed one extra stage on Home; the file holds the highest of three update runs.

## Request map (what starts each request, and what it waits for)

All line numbers are in `frontend/src/`.

**Every signed-in page**
1. `POST /auth/refresh`: `refreshSession()` in `hooks/AuthContext.jsx:41`, from the startup effect at `:65`. Waits for nothing.
2. `GET /me/reading-capabilities`: `hooks/UserBooksContext.jsx:85`. Waits for `auth.isAuthenticated` (`:83`), so it starts after the refresh answers.
3. `GET /me/profile`: `components/profile/ProfileContext.jsx:15`. Waits for `auth.isAuthenticated` (key at `:8`). Starts together with capabilities.
4. `GET /genres`: `components/ui-v2/useGenres.js:10`. Starts when the first component that uses `useGenres` mounts; waits for nothing. `GET /autocomplete/tags/batch` (`useGenres.js:12`) follows only when the list has no tag ids.
5. `GET /me/home` and `GET /me/library?...` on pages that are not Home: `ui-v2/pagePrefetch.js:30` and `:36` (`usePageWarmers`, mounted in `BookvaneApp.jsx:49`). They wait for `ready`: authenticated, `library.readingActions` and the library context no longer loading (`pagePrefetch.js:20`), so they start after capabilities. On Home only `/me/home` is warmed.
6. `GET /me/library/{id}/reading` for the first three entries: `warmWorkspaces`, `pagePrefetch.js:24`. Waits for the page that warms them (home or library) to answer.

**`/home`** (4 stages: refresh; profile and capabilities; `/me/home`; library, workspace, stats and up-next together)
- `/me/home`: `getReadingHome` in `components/reading/home/HomePage.jsx:47`; the page renders after the library context finished loading.
- `/me/library?facet=all...&limit=100`: `HomePage.jsx:50`, enabled only when `/me/home` has data.
- `/me/stats` and `/me/up-next`: `HomePage.jsx:54` and `:55`, enabled when `/me/home` has data (and the library is not empty).
- `/me/library/{id}/reading`: warmed from `/me/home`'s current reads (`pagePrefetch.js:30`).

**`/my-books`** (3 stages: refresh; profile and capabilities; library, home and genres)
- `/me/library?q=&facet=all&sort=added&limit=24`: `components/reading/LibraryPage.jsx:81`, after the library context is ready.
- `/me/home`: warm (`pagePrefetch.js:30`). The first three workspaces are warmed after the library answers (`:24`), after the content showed.
- `/genres`: `useGenres` in `LibraryPage.jsx:56`.

**`/browse`, signed in** (2 stages: refresh; `/books` with profile and capabilities)
- `/books?sort=popular&page=1&size=20`: `components/ui-v2/DiscoveryPages.jsx:126`. Waits only for `!auth.isLoading`, i.e. for the refresh to answer (on the live site this was about 0.9 s).
- `/genres`: `GenrePicker` via `useGenres` (`useGenres.js:10`), starts at once.
- `/books/{id}` for cards in view: book-card prefetch (`prefetchBook`, `ui-v2/primitives.jsx:190`, queued in `ui-v2/data.js`), starts at once for the snapshot cards and again for live ones.
- `/me/home`, `/me/library`, `POST /me/library/lookup`: warmers plus `ui-v2/primitives.jsx:115` (`loadVisibleBooks`, waits for `auth.isAuthenticated && mode === "v3"`).

**`/book/{id}`, direct** (3 stages: refresh; capabilities; lookup)
- `GET /books/{id}`: `DiscoveryPages.jsx:242` (`getBookById`). Waits for nothing.
- `GET /books/{id}/description`: `components/ui-v2/BookAbout.jsx:8`. Waits for nothing.
- `POST /me/library/lookup`: `primitives.jsx:115`, waits for capabilities (mode `v3`). The Want to read button stays disabled until it answers, which is why this page is three stages deep even though the book arrives in one.

**`/my-books/{entryId}`, direct** (3 stages: refresh; capabilities; workspace)
- `GET /me/library/{id}/reading`: `components/reading/ReadingPages.jsx:112`, after the library context is ready.
- `/me/home` and `/me/library?...limit=24`: warmers (`pagePrefetch.js:30`, `:36`), not needed by this page, started in the same stage.
- `/books/{id}`, `/books/{id}/description`, `/genres`, `/me/up-next`: `ReadingBookContext.jsx:45` and the "More about this reading" panel, after the workspace has the book id.

## Interaction checks (all `test.fixme`; they fail today, S2 turns them on)

Each was run once before being marked `fixme`, with the mock answering `/me/library`, `/books` and the save after 800 ms:

| Check | Result today |
|---|---|
| `switching a My Books tab shows the new results within 100 ms` | Fails: within 100 ms the page still shows 4 cards, not the 1 Want to read book (the old results stay on screen, dimmed, until the answer arrives). |
| `Owned only shows the new results within 100 ms` | Fails: 4 cards where 3 were expected after 100 ms. |
| `Want to read shows as saved within 100 ms while the save is still pending` | Fails: the button's `aria-pressed` is still `false` after 100 ms. |
| `changing the Discover genre keeps the previous results on screen until the new ones arrive` | Fails: at the 100 ms sample the previous results are no longer on screen. |

## Console snippet (documentation only, not shipped)

Paste on the live site while signed in. It prints each request's path (digits replaced with `N`), start and duration from the browser's Resource Timing. No bodies, no account data. Reload with the console open, then paste after the page settles.

```js
performance.getEntriesByType("resource")
  .filter(e => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest")
  .map(e => ({ path: new URL(e.name).pathname.replace(/\d+/g, "N"), startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) }))
  .sort((a, b) => a.startMs - b.startMs)
  .forEach(e => console.log(`${String(e.startMs).padStart(5)} ms  +${String(e.durationMs).padStart(4)} ms  ${e.path}`));
```
