"""Load the extracted description / year / page count / cover into books. A dry run unless --apply is given.

python -m data.load_catalogue_backfill --database-url URL --input backfill.jsonl [--apply --max-database-mb 400]

Only missing fields are filled (NULL, or for description and cover also blank), never overwritten. The database is
always named explicitly: DATABASE_URL is never read. Works are matched by books.source_id, following one recorded
redirect for retired work keys. Rerunning changes nothing.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import create_engine, text

from data import clean
from data.load_title_aliases import DatabaseTooLarge, resolve_works

FIELDS = ("description", "published_year", "page_count", "cover_image_url")
BLANK_CHARS = "chr(32) || chr(9) || chr(13) || chr(10)"  # space, tab, CR, LF: what counts as blank, as in is_complete
MAX_DESCRIPTION_CHARS = 5000
MIN_YEAR = 1400
MAX_PAGES = 100000


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse(line: str) -> dict | None:
    """A row's work key and its valid fields, or None when the row cannot be used at all."""
    try:
        data = json.loads(line)
    except ValueError:
        return None
    work = clean.work_key(data.get("work")) if isinstance(data, dict) else None
    if not work:
        return None
    fields = {}
    description = data.get("description")
    if isinstance(description, str) and description.strip() and len(description) <= MAX_DESCRIPTION_CHARS:
        fields["description"] = description.strip()
    year = data.get("first_publish_year")
    if _is_int(year) and MIN_YEAR <= year <= date.today().year:
        fields["published_year"] = year
    pages = data.get("page_count")
    if _is_int(pages) and 0 < pages <= MAX_PAGES:
        fields["page_count"] = pages
    cover = clean.cover_url(data.get("cover_id"))
    if cover:
        fields["cover_image_url"] = cover
    return {"work": work, "fields": fields} if fields else None


def _blank(value) -> bool:
    return value is None or not value.strip(" \t\r\n")


def _missing(book: dict, field: str) -> bool:
    return _blank(book[field]) if field in ("description", "cover_image_url") else book[field] is None


def _complete(book: dict) -> bool:
    return bool(not _blank(book["cover_image_url"]) and not _blank(book["description"])
                and book["page_count"] and book["page_count"] > 0 and book["published_year"] is not None)


def _flush(connection, batch: list[dict], state: dict, apply: bool) -> None:
    resolved = resolve_works(connection, {row["work"] for row in batch})
    ids = list({book_id for book_id, _ in resolved.values()})
    current = {}
    if ids:
        current = {row["id"]: dict(row) for row in connection.execute(text(
            "SELECT id, description, page_count, published_year, cover_image_url, is_complete FROM books WHERE id = ANY(:ids)"),
            {"ids": ids}).mappings()}
    updates = {}
    for row in batch:
        if row["work"] not in resolved:
            state["unknown_works"] += 1
            continue
        book_id = resolved[row["work"]][0]
        state["matched"].add(book_id)
        # State from earlier rows and batches wins over a dry run's unchanged database rows.
        book = state["merged"].setdefault(book_id, current[book_id])
        state["was_complete"].setdefault(book_id, current[book_id]["is_complete"])
        for field, value in row["fields"].items():
            if _missing(book, field):
                book[field] = value
                book["_changed"] = True
                state["filled"][field] += 1
                updates.setdefault(book_id, {})[field] = value
    if apply and updates:
        connection.execute(text(
            "UPDATE books SET "
            f"description = CASE WHEN CAST(:description AS text) IS NOT NULL AND (description IS NULL OR btrim(description, {BLANK_CHARS}) = '') "
            "THEN :description ELSE description END, "
            "published_year = COALESCE(published_year, :published_year), page_count = COALESCE(page_count, :page_count), "
            "cover_image_url = CASE WHEN CAST(:cover_image_url AS text) IS NOT NULL AND (cover_image_url IS NULL "
            f"OR btrim(cover_image_url, {BLANK_CHARS}) = '') THEN :cover_image_url ELSE cover_image_url END WHERE id = :id"),
            [{"id": book_id, **{field: fields.get(field) for field in FIELDS}} for book_id, fields in updates.items()])


def _complete_total(connection) -> int:
    return connection.execute(text("SELECT count(*) FILTER (WHERE is_complete) FROM books")).scalar_one()


def load(database_url: str, input_path: Path, *, apply: bool = False, max_database_mb: int | None = None,
         batch_size: int = 1000) -> dict:
    engine = create_engine(database_url)
    state = {"matched": set(), "merged": {}, "was_complete": {}, "filled": dict.fromkeys(FIELDS, 0),
             "unknown_works": 0, "invalid_rows": 0}
    try:
        if apply:
            if max_database_mb is None:
                raise ValueError("--max-database-mb is required with --apply")
            with engine.connect() as connection:
                size = float(connection.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
            if size > max_database_mb:
                raise DatabaseTooLarge(f"Database is {size:.0f} MB, above the {max_database_mb} MB limit; nothing was written")
        with engine.connect() as connection:
            complete_before = _complete_total(connection)
        batch: list[dict] = []
        with Path(input_path).open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = _parse(line)
                if row is None:
                    state["invalid_rows"] += 1
                    continue
                batch.append(row)
                if len(batch) >= batch_size:
                    with engine.begin() as connection:
                        _flush(connection, batch, state, apply)
                    batch = []
        if batch:
            with engine.begin() as connection:
                _flush(connection, batch, state, apply)
        with engine.connect() as connection:
            if apply:
                complete_after = _complete_total(connection)
            else:
                complete_after = complete_before + sum(1 for book_id, book in state["merged"].items()
                                                       if not state["was_complete"][book_id] and _complete(book))
    finally:
        engine.dispose()
    changed = sum(1 for book in state["merged"].values() if book.get("_changed"))
    return {"filled": state["filled"], "books_changed": changed, "matched_works": len(state["matched"]),
            "unknown_works": state["unknown_works"], "invalid_rows": state["invalid_rows"],
            "complete_before": complete_before, "complete_after": complete_after, "applied": apply}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", required=True, help="Target database; DATABASE_URL is never used")
    parser.add_argument("--input", type=Path, required=True, help="JSONL from data.extract_catalogue_backfill")
    parser.add_argument("--apply", action="store_true", help="Write the fills; without it nothing is written")
    parser.add_argument("--max-database-mb", type=int, help="Refuse to apply when the database is larger than this")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.apply and args.max_database_mb is None:
        parser.error("--apply requires --max-database-mb")
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    try:
        report = load(args.database_url, args.input, apply=args.apply, max_database_mb=args.max_database_mb,
                      batch_size=args.batch_size)
    except DatabaseTooLarge as error:
        print(f"Refused: {error}", file=sys.stderr)
        return 2
    print("Applied." if report["applied"] else "Dry run: nothing was written (complete_after is predicted). Use --apply to write.")
    for name in ("matched_works", "unknown_works", "invalid_rows", "complete_before", "complete_after"):
        print(f"{name}: {report[name]}")
    for field, count in report["filled"].items():
        print(f"filled {field}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
