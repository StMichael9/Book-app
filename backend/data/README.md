# Bookvane catalogue ingestion

This importer streams pinned Open Library works, authors, editions, redirects,
and deletes dumps directly into bounded PostgreSQL batches. It does not save
catalogue dumps, JSON, or CSV files locally. `load.py` remains the command and
phase driver; `clean.py` remains the normalization compatibility entry point.
`sources.py` discovers and streams dumps; `taxonomy.py` holds reviewed mappings;
`config.py` pins options and run state; `staging.py`, `selection.py`, and
`merge.py` contain the corresponding catalogue operations; `reporting.py`
owns storage checks, issues, and reports. It does not change the
frontend, authentication, hosting, or user Own/Want relationships.

## Safety gates

- The first intended production target is **50,000 total Book rows**, including
  all existing rows. `target_books` is configurable and has no fixed ceiling.
- Development and automated tests use a disposable local PostgreSQL database
  with a name containing `test`, `TEST_DATABASE_URL`, and
  `BOOKVANE_TEST_DB_ISOLATED=yes`. Never point these at Neon production.
- The production command additionally requires `CATALOGUE_IMPORT_PRODUCTION=yes`
  and a Neon URL. The workflow has one manual start and no scheduled import.
  It runs all phases, dispatching a continuation only when its soft time budget
  ends after a committed checkpoint. A capacity pause or source-integrity
  failure stops it rather than automatically replaying or overriding safeguards.
- The importer does **not** run migrations. Audit the migration chain and the
  production schema, take a backup, and obtain a separate production approval
  before applying migrations or running the import.
- GitHub permits manual dispatch only for workflows present on the default
  branch. This workflow remains on `v2-codex` and therefore cannot be used for
  production until the branch/deployment decision is separately approved.
- A 400 MiB database-size guard pauses the run and releases staging. It is a
  safety threshold, not a promise that Neon Free fits 50K books.

## Selection and preservation

Equal percentage weights are calculated from the configured category names;
optional weights must cover exactly the same names and sum to 100. Existing
Book rows reserve capacity, while eligible source-identified and corroborated
legacy records are refreshed without consuming new-row slots. Works are ranked
by cover, description, and year completeness, then a stable work-key hash.
Authors are resolved before selection. The importer allocates a work to one
quota category, retains its other accurate tags, redistributes shortfalls, and
reports them. Shortlist exhaustion widens the shortlist and replays the pinned
works dump. Nothing is chosen merely because it occurred first in the dump.

Legacy books are linked to source IDs only when title and primary author match
uniquely **and** a validated ISBN or Open Library cover ID corroborates the
match. Ambiguities remain untouched. Existing Book IDs, Own/Want links, and
preference IDs are retained. Source-managed fields and relationships can be
reconciled on later snapshots; populated legacy fields and links are preserved.
Open Library deletes do not delete books. Redirect conflicts are reported, not
merged automatically.

Up to five useful editions per work are stored by edition ID, including all
validated ISBN-13 values and validated conversions from ISBN-10. The existing
work-level ISBN/page fields come from a preferred edition when no conflicting
legacy value exists. The edition model is not exposed as a new V2 feature.
Existing V2-visible tag IDs stay visible; newly imported classifications are
kept out of current book responses and autocomplete. Historical-fiction
search remains compatible with the earlier `history` filter.

## Starting and resuming

The GitHub Actions manual form requires only a snapshot (`auto` or a date),
`target_books` (default 50,000), and optional percentage weights. `auto`
searches the Open Library export collection, inspects candidate item metadata,
and chooses the newest item with all five matching dated files, plausible sizes,
and published MD5 hashes. It does not assume that the current month exists.
The exact URLs, sizes, hashes, weights, target, and guard are saved on the run.
The selected snapshot and files are logged before ingestion. An explicit date
fails closed if its item is incomplete.

For a local **disposable test database only**, set `CATALOGUE_DATABASE_URL`,
`TEST_DATABASE_URL`, `BOOKVANE_TEST_DB_ISOLATED=yes`, and an identified
`CATALOGUE_USER_AGENT`, then run from `backend`:

```powershell
python -m data.load --mode test --snapshot auto --target-books 10000
```

Resume with `python -m data.load --mode test --run-id <reported-run-id>`.
The five old URL flags remain available for isolated test fixtures and for
resuming an unfinished pre-pinning run with its original inputs; they cannot
create a new production run. New production runs always resolve a verified
dated snapshot. Do not run imports
against the application database while developing.

## Resume and reports

Each data batch and line checkpoint commit together. Resume loads the original
URLs and options from PostgreSQL; it never discovers a newer snapshot. A
resumed gzip stream must re-read its compressed prefix. Compressed bytes are
hashed and counted during that same pass, including the prefix, and checked
against Internet Archive metadata only at EOF. There is no second download
solely for verification. An interrupted pass is not marked verified. Transient
network failures retry with capped exponential backoff. If a whole job makes
no committed progress, it fails instead of self-dispatching forever. GitHub
environment reviewer settings may still require approval for each continuation;
the workflow does not bypass those protections.

After completion or a capacity pause, the `catalogue_import_runs.report` JSON
records total/source-identified books, category allocation, coverage counts,
author/edition counts, database size, table/index bytes, peak staging usage,
verified dump hashes, and issue counts. Detailed unresolved cases live in
`catalogue_import_issues`; aggregate skipped-record counts are in the report.
Staging is released after the report is saved.
Measure search/autocomplete/pagination latency and connection use separately
against realistic isolated datasets before production and against the real
50K catalogue afterward. **Never automatically continue to 100K.**

Open Library's [monthly dumps](https://openlibrary.org/developers/dumps)
are the bulk source. Use dated URLs from one snapshot and an identified contact
User-Agent; do not make per-book API calls for the bulk import. Before a
production selection, sample that pinned works dump and check the frequency
of each reviewed exact mood/theme phrase. No such pinned-dump validation has
been performed by the isolated synthetic tests.
