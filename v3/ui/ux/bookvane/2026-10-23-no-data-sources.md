# Reader copy never names data sources

23 October 2026. Branch `ui/v3-no-data-sources`, **stacked on #48** (`ui/v3-my-data-export`). Michael's rule, relayed by the Lead Developer, is that readers must never see where book data comes from. Michael approved this exact list.

## Changed: where book data comes from

| Where | Before | After |
|---|---|---|
| Next-read reason | From the shared catalogue. | Something new to explore. |
| Next-read reason | Catalogue lists N pages. Your copy may differ. | About N pages. Your copy may differ. |
| Next-read "Explore something new" help | New choices from the catalogue. Books with a reading history stay out. | New books to explore. Books you've already read or started stay out. |
| Next-read filters | No reliable catalogue page counts… / …only known catalogue lengths. | Page counts aren't available for these books. / …only includes books with a known length. |
| Next-read empty states | …explore another source. / …explicitly explore the catalogue. / No catalogue books match… | …try the other choice. / …explore something new. / No new books match… |
| Reading page About | Catalogue: N pages · your copy may differ / Full catalogue details | About N pages · your copy may differ / Full book details |
| Manage copy picker | The catalogue's edition / …even if catalogue details change later. | The standard edition / …even if book details change later. |
| Add a private book | This private entry won't change the shared catalogue. Covers are supplied by the catalogue, not uploaded. | This book stays private to your library. |
| Forget dialog | Other readers, the shared catalogue and your discovery subjects will not change. | Other readers' libraries and your discovery subjects won't change. |
| My Data JSON copy | your saved catalogue and private books | your saved books, including private ones |

## Changed: the reader's own imported data

Goodreads and StoryGraph names are kept, because readers need to know which export to bring. "Source" wording goes:

- **Reading page section:** "Imported source details (n) · private" becomes **"From your import (n) · private"**. Its labels become Imported rating / review / private note and Import limitations. "Other imported values", "Delete this imported context" and "More imports" replace the source wording.
- **Import preview:** "Source information" becomes **"From your file"**, with "Owned / Want to read in your file", "Rating in your file", "Labels in your file (private)", "Reading information in your file" and "Values in your file needing care".

## Kept on purpose

- **Privacy page:** it still discloses Render, Neon, Resend and Open Library covers. It's a required disclosure, so it must stay accurate.
- **"Catalogue":** the word stays where it means Bookvane's own collection (Discover, import matching), as Michael decided.
- **Extended catalogue (Turso) screens:** these stay off and are hidden by capability. That code is the Lead's.

## Verification

| Check | Result |
|---|---|
| New guard test: `reader screens never name data sources` | Passed. It opens every disclosure on Home, My Books, a reading page and My Data, then checks the text against /shared catalogue\|catalogue lists\|catalogue details\|Open Library\|openlibrary\|Turso\|external catalogue/. It would have failed on the old copy ("Full catalogue details"). |
| Updated tests | Four `reading-lifecycle` metadata assertions now expect "About 999 pages". The live import spec now uses the new section name; it was not executed. |
| Full mocked suite (Edge), first run | 300 passed, 5 failed, taking 2.9 h because the machine was slowed or suspended. Four failures were the expected wording changes. The fifth was a large-TSV import wait that then passed unchanged. All 5 passed on re-run. |
| Clean full run, under the 5189 lock | **305 passed, 0 failed** (9.5 min) |
| Lint / build | Exit 0, 12 warnings / passed |
