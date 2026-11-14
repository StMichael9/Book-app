# November 14: Speed S1, start account requests together

Branch `ui/v3-parallel-start`, cut from origin/v3 (`efbff1c`). Frontend only: no backend change, no new dependency, no visual or copy change.

## What changed

When the "signed in last time" hint is set, `AuthContext.checkSession` also calls `startEarly(generation)` (`src/api/earlyStart.js`) in the same tick as `/auth/refresh`. It starts, through the request cache and under exactly the keys the pages use:

- always: profile, reading capabilities;
- `/` and `/home`: home, library shelf, stats, Up next;
- `/my-books`: the first library page for the address; `/browse`: the signed-in `/books` request for the address; `/my-books/{id}`: the workspace; `/book/{id}`: the book and its saved-status check.

No hint (a guest, or a first visit): nothing starts, exactly as before.

- Keys now come from one place (`earlyStart.js`, `browseQuery.js`, `libraryKey`); the pages, contexts and pre-warmers import them.
- `ProfileContext` and `UserBooksContext` read capabilities and profile cache-first (`earlyOrRequest`), and the lookup for one book joins the early one. Their public shape is unchanged. A reload or retry always asks again.
- `useRequest` takes an early answer once, for its first read, instead of asking again; later visits revalidate as before.
- `apiRequest` marks early requests as speculative: on a 401 they still wait for the shared refresh and retry once, but do not announce `bookvane:session-expired` (the account check already decides). A 401, 403 or 404 shows nothing.
- Nothing is rendered before the account check answers: RequireAccount and ReadingGate are untouched.

## Account separation

Keys contain the session generation; every login, logout and expiry clears the request cache and bumps it; an early request that finishes after a clear is never stored (tests in `request-cache.test.mjs`). Memory only. Failed early requests store nothing.

## Numbers (same spec, 300 ms per call, best of 5)

| Page | Stages before | Stages after | Content before | Content after |
|---|---|---|---|---|
| `/home` | 4 | 1 | 1695 ms | 674 ms |
| `/my-books` | 3 | 1 | 1453 ms | 652 ms |
| `/browse`, signed in | 2 | 1 | 1270 ms | 823 ms |
| `/book/{id}` | 3 | 1 | 1378 ms | 620 ms |
| `/my-books/{entryId}` | 3 | 1 | 1460 ms | 679 ms |

"Before" is origin/v3 measured with the same (updated) spec. `speed-baseline.json` holds the highest of three update runs.

## Measurement change (speed-baseline.spec.js)

The spec used to find "content visible" with Playwright polling, which noticed it about 300 ms late. That was long enough for Home's background workspace warm-up, which no reader waits for, to count as a stage. The page now stamps the moment itself on each animation frame. The stage rule is unchanged.

## Tests

`tests/parallel-start.spec.js` (11): every early request starts before `/auth/refresh` answers and is made once (Home, My Books, Discover, book page, workspace); guest with no hint makes no `/me` requests; expired session (one calm sign-out, no duplicate expiry, hint cleared); expired access cookie with refresh working (each endpoint at most twice, ends 200); server unreachable; older service; sign out then another account signs in. Seven of these failed before the change for the stated reason (not started early).

Two older specs (`critical-flows`, `reader-flows`) have older-service mocks; they now answer the early library requests with 404 instead of recording them as unhandled.

## For the Lead Dev

Early requests run beside `/auth/refresh`. This is safe only if refreshing does not invalidate an access token already issued (no token version or jti check on the access cookie). Please confirm in `backend/auth`.
