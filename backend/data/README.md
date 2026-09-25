# Bookvane catalogue ingestion

This importer streams pinned Open Library works, authors, editions, redirects,
and deletes dumps directly into bounded PostgreSQL batches. It does not save
catalogue dumps, JSON, or CSV files locally. `clean.py` normalizes records;
`load.py` selects, merges, checkpoints, and reports. It does not change the
frontend, authentication, hosting, or user Own/Want relationships.

## Safety gates

- The first intended production target is **50,000 total Book rows**, including
  all existing rows. `target_books` is configurable and has no fixed ceiling.
- Development and automated tests use a disposable local PostgreSQL database
  with a name containing `test`, `TEST_DATABASE_URL`, and
  `BOOKVANE_TEST_DB_ISOLATED=yes`. Never point these at Neon production.
- The production command additionally requires `CATALOGUE_IMPORT_PRODUCTION=yes`
  and a Neon URL. The workflow is manual, one checkpointed phase per dispatch;
  there is no scheduled import.
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

## Resume and reports

Each data batch and line checkpoint commit together. Resume with the same
run ID, dump URLs, target, weights, and taxonomy. A resumed gzip stream must
re-read its compressed prefix; no complete dump is stored locally. Transient
network failures retry with capped exponential backoff. One job runs one phase,
so the workflow can be dispatched repeatedly within GitHub's runner limit.
If a single dump phase still exceeds that limit, review throughput and the
execution method rather than assuming a larger free runner.

After completion or a capacity pause, the `catalogue_import_runs.report` JSON
records total/source-identified books, category allocation, coverage counts,
author/edition counts, database size, table/index bytes, peak staging usage,
and issue counts. Detailed unresolved cases live in
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
