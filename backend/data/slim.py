"""Slim the catalogue database (T66). Dry run by default.

    python -m data.slim --mode production --dry-run [--report FILE]
    python -m data.slim --mode production --apply   [--report FILE]

Reads CATALOGUE_DATABASE_URL. Removes only rows nothing reads: `catalogue_source_aliases` rows whose canonical work is not a book
we hold (left by an import's shortlist; the importer only resolves aliases of books it holds or is about to add, and the run's
own alias table lives in the staging database). Rows of type `deleted` are kept.

Michael chose (20 Nov) to also trim two undo logs and to keep three editions per book:
- `catalogue_import_issues` rows with code `clean_book` and `reclean_description` ONLY (the undo notes of cleans already
  applied). Every other code is left alone and only counted. Deleting them ends the undo of those cleans.
- editions beyond three per book (`data.staging.select_useful_editions` decides which three), with their ISBN rows. An edition
  is never dropped when a book's preferred_edition_id, a reading attempt, or a library import plan points at it.
"""
from __future__ import annotations

import argparse
import os

from data.staging import MAX_EDITIONS_PER_BOOK, select_useful_editions
from sqlalchemy import create_engine, text

ORPHANS = """FROM catalogue_source_aliases a WHERE a.source_type <> 'deleted'
             AND NOT EXISTS (SELECT 1 FROM books b WHERE b.source_id = a.canonical_source_id)"""
BATCH = 20_000
UNDO_CODES = ("clean_book", "reclean_description")
EDITION_BATCH = 500


def protected_edition_ids(connection, edition_ids) -> set[int]:
    """Edition ids (of `edition_ids`) that something points at: a book's preferred edition, a reading attempt, or a library import
    plan. `connection` may be a Session or a Connection."""
    ids = list(edition_ids)
    if not ids:
        return set()
    rows = connection.execute(text("""
        SELECT id FROM editions WHERE id = ANY(:ids) AND (
            id IN (SELECT preferred_edition_id FROM books WHERE preferred_edition_id = ANY(:ids))
            OR id IN (SELECT edition_id FROM reading_attempts WHERE edition_id = ANY(:ids))
            OR id IN (SELECT (plan->>'edition_id')::int FROM library_import_rows
                      WHERE plan ? 'edition_id' AND (plan->>'edition_id') ~ '^[0-9]+$'))
    """), {"ids": ids})
    return {row[0] for row in rows}


def _quality(edition: dict) -> int:
    return 100 * ("/languages/eng" in edition["languages"]) + 10 * bool(edition["isbns"]) + 5 * bool(edition["page_count"])


def plan_edition_trim(connection, book_ids: list[int], limit: int = MAX_EDITIONS_PER_BOOK) -> dict[int, list[int]]:
    """For the given books: {book_id: [edition ids to drop]} (only books with more editions than `limit`)."""
    rows = connection.execute(text("""
        SELECT e.id, e.book_id, e.source_id, e.page_count, e.languages, e.publication_date, e.publishers, e.physical_format,
               e.cover_image_url, coalesce((SELECT array_agg(i.isbn13 ORDER BY i.isbn13) FROM edition_isbns i WHERE i.edition_id = e.id),
                                           '{}') AS isbns
        FROM editions e WHERE e.book_id = ANY(:ids) ORDER BY e.book_id, e.id"""), {"ids": book_ids}).mappings().all()
    by_book: dict[int, list[dict]] = {}
    for row in rows:
        item = dict(row)
        item["edition_key"] = row["source_id"]
        item["isbns"] = [{"isbn13": isbn} for isbn in row["isbns"]]
        item["quality"] = _quality(item)
        by_book.setdefault(row["book_id"], []).append(item)
    protected = protected_edition_ids(connection, [item["id"] for items in by_book.values() for item in items])
    plan: dict[int, list[int]] = {}
    for book_id, items in by_book.items():
        if len(items) <= limit:
            continue
        keep = tuple(item["edition_key"] for item in items if item["id"] in protected)
        kept = {item["edition_key"] for item in select_useful_editions(items, limit, keep=keep)}
        drop = [item["id"] for item in items if item["edition_key"] not in kept]
        if drop:
            plan[book_id] = drop
    return plan


def trim_editions(connection, *, apply: bool, limit: int = MAX_EDITIONS_PER_BOOK, samples: int = 5) -> dict:
    """Walk the books with more than `limit` editions in id order; with apply, delete the surplus editions (their ISBN rows go with
    them by cascade) and report the counts."""
    book_ids = [row[0] for row in connection.execute(text(
        "SELECT book_id FROM editions GROUP BY book_id HAVING count(*) > :limit ORDER BY book_id"), {"limit": limit})]
    dropped_editions = dropped_isbns = 0
    examples = []
    for start in range(0, len(book_ids), EDITION_BATCH):
        plan = plan_edition_trim(connection, book_ids[start:start + EDITION_BATCH], limit)
        drop_ids = [edition_id for ids in plan.values() for edition_id in ids]
        if not drop_ids:
            continue
        dropped_editions += len(drop_ids)
        dropped_isbns += connection.execute(text("SELECT count(*) FROM edition_isbns WHERE edition_id = ANY(:ids)"),
                                            {"ids": drop_ids}).scalar_one()
        if len(examples) < samples:
            examples += [{"book_id": book_id, "dropped_edition_ids": ids} for book_id, ids in list(plan.items())[:samples - len(examples)]]
        if apply:
            connection.execute(text("DELETE FROM editions WHERE id = ANY(:ids)"), {"ids": drop_ids})
    return {"books_over_limit": len(book_ids), "editions_dropped": dropped_editions, "isbn_rows_dropped": dropped_isbns,
            "examples": examples}


def delete_undo_logs(connection) -> int:
    total = 0
    while True:
        removed = connection.execute(text(
            "DELETE FROM catalogue_import_issues WHERE id IN (SELECT id FROM catalogue_import_issues WHERE code = ANY(:codes) LIMIT :n)"),
            {"codes": list(UNDO_CODES), "n": BATCH}).rowcount
        total += removed
        if removed < BATCH:
            return total


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
    edition_rows = connection.execute(text("SELECT count(*) FROM editions")).scalar_one()
    edition_bytes = connection.execute(text(
        "SELECT pg_total_relation_size('editions') + pg_total_relation_size('edition_isbns')")).scalar_one()
    trim = trim_editions(connection, apply=False)
    return {"orphan_aliases": orphans, "aliases_total": total, "aliases_table_bytes": size,
            # Row bytes are the table's average including indexes; deleting frees them for reuse, the file only shrinks after a rewrite.
            "orphan_alias_bytes_estimate": int(size * orphans / total) if total else 0,
            "issues_by_code": issues,
            "undo_logs": [row for row in issues if row["code"] in UNDO_CODES],
            "editions": trim | {"editions_total": edition_rows, "editions_and_isbns_bytes": edition_bytes,
                                "bytes_estimate": int(edition_bytes * trim["editions_dropped"] / edition_rows) if edition_rows else 0}}


def markdown(data: dict) -> str:
    mb = 1048576
    undo_rows, undo_bytes = sum(r["rows"] for r in data["undo_logs"]), sum(r["bytes"] for r in data["undo_logs"])
    ed = data["editions"]
    lines = [f"Orphan source aliases: {data['orphan_aliases']} of {data['aliases_total']} "
             f"(about {data['orphan_alias_bytes_estimate'] / mb:.1f} MB of {data['aliases_table_bytes'] / mb:.1f} MB)",
             f"Undo logs ({', '.join(UNDO_CODES)}): {undo_rows} rows, {undo_bytes / mb:.1f} MB (row bytes)",
             f"Editions over the limit of {MAX_EDITIONS_PER_BOOK}: {ed['books_over_limit']} books, {ed['editions_dropped']} editions "
             f"and {ed['isbn_rows_dropped']} ISBN rows would go, about {ed['bytes_estimate'] / mb:.1f} MB of {ed['editions_and_isbns_bytes'] / mb:.1f} MB",
             "", "Import issue log by code (only the undo codes above are ever deleted):"]
    lines += [f"- {row['code']}: {row['rows']} rows, {row['bytes'] / mb:.1f} MB" for row in data["issues_by_code"]]
    return chr(10).join(lines)


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
                aliases = delete_orphan_aliases(connection)
                undo = delete_undo_logs(connection)
                editions = trim_editions(connection, apply=True)["editions_dropped"]
                body += f"\n\nRemoved {aliases} orphan aliases, {undo} undo-log rows and {editions} editions."
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
