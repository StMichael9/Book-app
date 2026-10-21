# Home and My Books: distinct reader tasks

October 18, 2026. Follow-up to the approved reader-flow refactor (PR #18), prompted by Michael's observation that Home and My Books felt interchangeable.

## Result

Home is a reading desk. It presents the existing current-reading summaries as a single vertical list with prominent Continue links and optional saved progress. A native progress indicator appears only when the saved progress has a known denominator; unknown totals remain text, and missing progress remains untracked. Each concurrent reading has equal emphasis. Continue opens the existing workspace and performs no write.

Next Read uses compact candidate rows alongside the desk on desktop, below it on phones/tablets. Its existing Want-first behavior, explicit catalogue choice, filters, guarded Start, rotation, read-only state and Finish integration are unchanged. Home no longer repeats Want-library and missing-book shortcuts or links to an already fully displayed current-reading list. Paused books and additional current readings retain direct recovery paths. Empty Home retains its existing discovery/import entry points.

My Books remains the collection: title/author search, independent Own/Want filters, current/historical reading facets, saved-book grid, import and missing-book tools, pagination and empty-page recovery. Its heading describes finding/organizing/revisiting books. The repeated Find more books link was consolidated. Current-reading cards do not appear here.

The existing palette, fonts, routes, API requests, capabilities, auth/session guards, versions, drafts and reading lifecycle are retained. No external-book lookup was implemented; that proposal remains separate.

## File boundaries

- Presentation: `ReadingPages.jsx` (Home only), `ReadingCards.jsx` (current-reading card only), `LibraryPage.jsx`, and `reading-home.css`.
- Focused regression additions: existing `reading-lifecycle.spec.js` and `next-read.spec.js` fixtures.
- Reserved entry point/legacy App, backend, API clients, providers, dependencies and hosting are untouched.

## Acceptance

The new checks exercise both themes at 320, 390 and 1440 px, multiple concurrent and private readings, known versus unknown progress, complete-count/paused navigation, collection-only search/filters/import/missing-book actions, desktop side-by-side versus mobile stacked choices, overflow, and keyboard Continue without writes. Existing lifecycle/library/Next Read regressions cover the retained commands, failures, stale versions, pending starts, lost responses, read-only and session boundaries.

Executed verification:

- The three focused lifecycle/library/Next Read suites: **83 passed, zero failures, 6.7 minutes**, against the first production build of this change.
- After visual review, CSS-only refinements made unsupported-Next-Read layouts span the full desk width, removed clipped fallback-cover captions and tightened candidate rows. A fresh production build and **four overlapping layout/task checks passed, zero failures, 52.3 seconds**, covering both themes and 320/390/1440 px on the final CSS. These are not 87 unique tests.
- Final lint passed with the same 12 existing warnings. `git diff --check` passed. Desktop and mobile fixture captures were visually inspected.

These tests use local Chromium with isolated in-memory API fixtures; they do not establish independent Safari/physical-device, hosted, real-backend or native-export acceptance. Those existing release gates remain open. No database, real account, provider or production service was contacted. Existing Safari jump-fix status is not reopened by this report; regression acceptance of the new layout is a separate scope.

Local evidence: `/workspace/deliverables/v3-home-library-separation-tests.log`, `v3-home-library-final-layout.log`, `v3-home-library-lint.log`, and `home-library-final-results/`. Screenshot books and responses are fixtures, not live catalogue/user records.
