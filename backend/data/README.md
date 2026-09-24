# Catalogue ingestion

The importer streams dated Open Library works, authors, and editions TSV/gzip
dumps directly into PostgreSQL. It does not read or produce catalogue JSON,
CSV, or downloaded dump files. `clean.py` contains pure normalization and
streaming functions; `load.py` batches writes and tracks the resume point.

## Before an import

The target database must already have the `c74a8be41209` migration. Audit and
back up the catalogue before applying migrations. The import workflow does
**not** run migrations: this branch includes other changes that must be
reviewed separately. Do not run the import against the production database
while developing or testing. Tests require a separate local database whose
name contains `test`, different credentials, and
`BOOKVANE_TEST_DB_ISOLATED=yes`.

For a future approved production run, configure the GitHub Actions environment
`catalogue-production` with the `CATALOGUE_DATABASE_URL` secret pointing to
the prepared Neon database and `CATALOGUE_USER_AGENT` variable including a
contact email, for example `BookvaneImport (contact@example.org)`. Protect
that environment if you want a manual approval gate. Start the workflow
manually with the three dated dump URLs from
[Open Library](https://openlibrary.org/developers/dumps). Reuse the same
`run_id`, URLs, category map, and `max_books` to resume. The workflow does
not run on a schedule and does not change the app deployment.

The default 450 MiB database threshold is a stop gate, not a promise that a
100K-book catalogue fits the Neon free allowance. Staging rows and indexes
also consume space. Measure real storage and change the threshold only within
the actual database capacity. The stream re-reads compressed data up to its
committed line on resume, so a late interruption costs network time. Each
processed batch and its checkpoint are committed together. A completed run
truncates its staging tables in one transaction but retains its small progress summary.

Books remain work-level records. `source_id` is the Open Library work key.
Page count and validated ISBN-13 come from one chosen edition. Missing source
metadata does not erase existing populated fields. Legacy books without a
source ID are matched by unique title and primary author; ambiguous matches
are logged and left for manual review. Existing Book IDs and Own/Want rows
are never deleted by this import.
