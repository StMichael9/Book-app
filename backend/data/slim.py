"""Slim the catalogue database (T66). Dry run by default.

    python -m data.slim --mode production --dry-run [--report FILE]
    python -m data.slim --mode production --apply   [--report FILE]

Reads CATALOGUE_DATABASE_URL. Removes only rows nothing reads: `catalogue_source_aliases` rows whose canonical work is not a book
we hold (left by an import's shortlist; the importer only resolves aliases of books it holds or is about to add, and the run's
own alias table lives in the staging database). Rows of type `deleted` are kept. Nothing else is deleted: the report only
*counts* what else could go (the `catalogue_import_issues` log by code, with its size) so Michael can decide that separately.
"""
from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, text

ORPHANS = """FROM catalogue_source_aliases a WHERE a.source_type <> 'deleted'
             AND NOT EXISTS (SELECT 1 FROM books b WHERE b.source_id = a.canonical_source_id)"""
BATCH = 20_000


def delete_orphan_aliases(connection) -> int:
    """Delete in batches; returns the rows removed. The importer calls this on the catalogue database at the end of a run."""
    total = 0
    while True:
        removed = connection.execute(text(
            f"DELETE FROM catalogue_source_aliases WHERE old_source_id IN (SELECT a.old_source_id {ORPHANS} LIMIT {BATCH})"
        )).rowcount
        total += removed
        if removed < BATCH:
            return total


def report(connection) -> dict:
    orphans = connection.execute(text(f"SELECT count(*) {ORPHANS}")).scalar_one()
    total = connection.execute(text("SELECT count(*) FROM catalogue_source_aliases")).scalar_one()
    size = connection.execute(text("SELECT pg_total_relation_size('catalogue_source_aliases')")).scalar_one()
    issues = [dict(row._mapping) for row in connection.execute(text(
        "SELECT code, count(*) AS rows, sum(pg_column_size(t.*)) AS bytes FROM catalogue_import_issues t GROUP BY code ORDER BY 3 DESC"))]
    return {"orphan_aliases": orphans, "aliases_total": total, "aliases_table_bytes": size,
            # Row bytes are the table's average including indexes; deleting frees them for reuse, the file only shrinks after a rewrite.
            "orphan_alias_bytes_estimate": int(size * orphans / total) if total else 0, "issues_by_code_report_only": issues}


def markdown(data: dict) -> str:
    lines = [f"Orphan source aliases: {data['orphan_aliases']} of {data['aliases_total']} "
             f"(about {data['orphan_alias_bytes_estimate'] / 1048576:.1f} MB of {data['aliases_table_bytes'] / 1048576:.1f} MB)",
             "", "Import issue log by code (report only, nothing here is deleted):"]
    lines += [f"- {row['code']}: {row['rows']} rows, {row['bytes'] / 1048576:.1f} MB" for row in data["issues_by_code_report_only"]]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--report")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    from data.config import validate_database_target
    validate_database_target(url, args.mode)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            body = markdown(report(connection))
            if args.apply:
                body += f"\n\nRemoved {delete_orphan_aliases(connection)} orphan aliases."
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
