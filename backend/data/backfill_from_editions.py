"""Fill missing book fields from the editions already stored. A dry run unless --apply is given.

python -m data.backfill_from_editions --database-url URL [--apply]

Only missing fields are filled (NULL, or for the cover also blank), never overwritten:
  published_year   the earliest 4-digit year (1400 to this year) in the editions' publication dates
  page_count       the median of positive edition page counts, English editions first
  cover_image_url  the preferred edition's cover, else the first edition with a cover
The database is always named explicitly: DATABASE_URL is never read. Reruns change nothing.
"""
from __future__ import annotations

import argparse
import math
import re
import statistics
from datetime import date

from sqlalchemy import create_engine, text

FIELDS = ("published_year", "page_count", "cover_image_url")
BLANK_CHARS = "chr(32) || chr(9) || chr(13) || chr(10)"  # space, tab, CR, LF: what counts as blank, as in is_complete
YEAR = re.compile(r"(?<!\d)(\d{4})(?!\d)")
ENGLISH = "/languages/eng"


def _years(value) -> list[int]:
    if not isinstance(value, str):
        return []
    return [year for year in map(int, YEAR.findall(value)) if 1400 <= year <= date.today().year]


def _usable(cover) -> bool:
    return isinstance(cover, str) and bool(cover.strip())


def _fills(book, editions) -> dict:
    fills = {}
    if book["published_year"] is None:
        years = [year for edition in editions for year in _years(edition["publication_date"])]
        if years:
            fills["published_year"] = min(years)
    if book["page_count"] is None:
        counts = [(edition["page_count"], ENGLISH in (edition["languages"] or [])) for edition in editions
                  if isinstance(edition["page_count"], int) and edition["page_count"] > 0]
        pool = [count for count, english in counts if english] or [count for count, _ in counts]
        if pool:
            fills["page_count"] = math.floor(statistics.median(pool) + 0.5)
    if not _usable(book["cover_image_url"]):
        by_id = {edition["id"]: edition for edition in editions}
        preferred = by_id.get(book["preferred_edition_id"])
        cover = preferred["cover_image_url"] if preferred and _usable(preferred["cover_image_url"]) else next(
            (edition["cover_image_url"] for edition in editions if _usable(edition["cover_image_url"])), None)
        if cover:
            fills["cover_image_url"] = cover
    return fills


def _complete(book, fills) -> bool:
    merged = {field: fills.get(field, book[field]) for field in FIELDS}
    return bool(_usable(merged["cover_image_url"]) and book["description"] and book["description"].strip()
                and merged["page_count"] and merged["page_count"] > 0 and merged["published_year"] is not None)


def _totals(connection) -> tuple[int, int]:
    return tuple(connection.execute(text(
        "SELECT count(*) FILTER (WHERE is_complete), "
        "count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM book_authors WHERE book_authors.book_id = books.id)) FROM books")).one())


def backfill(database_url: str, *, apply: bool = False, batch_size: int = 1000) -> dict:
    engine = create_engine(database_url)
    filled = dict.fromkeys(FIELDS, 0)
    changed = newly_complete = 0
    try:
        with engine.connect() as connection:
            complete_before, without_authors = _totals(connection)
        last = 0
        while True:
            with engine.begin() as connection:
                books = [dict(row) for row in connection.execute(text(
                    "SELECT id, cover_image_url, description, page_count, published_year, preferred_edition_id, is_complete "
                    "FROM books WHERE id > :last AND (published_year IS NULL OR page_count IS NULL OR cover_image_url IS NULL "
                    f"OR btrim(cover_image_url, {BLANK_CHARS}) = '') ORDER BY id LIMIT :size"), {"last": last, "size": batch_size}).mappings()]
                if not books:
                    break
                last = books[-1]["id"]
                editions: dict[int, list] = {}
                for row in connection.execute(text(
                        "SELECT id, book_id, publication_date, page_count, languages, cover_image_url FROM editions "
                        "WHERE book_id = ANY(:ids) ORDER BY id"), {"ids": [book["id"] for book in books]}).mappings():
                    editions.setdefault(row["book_id"], []).append(dict(row))
                updates = []
                for book in books:
                    fills = _fills(book, editions.get(book["id"], []))
                    if not fills:
                        continue
                    changed += 1
                    for field in fills:
                        filled[field] += 1
                    newly_complete += int(not book["is_complete"] and _complete(book, fills))
                    updates.append({"id": book["id"], **{field: fills.get(field) for field in FIELDS}})
                if apply and updates:
                    # A missing value (NULL, or a blank cover) is the only thing ever filled; anything written
                    # since the read is kept, and a blank cover with nothing to replace it stays as it was.
                    connection.execute(text(
                        "UPDATE books SET published_year = COALESCE(published_year, :published_year), "
                        "page_count = COALESCE(page_count, :page_count), "
                        "cover_image_url = CASE WHEN CAST(:cover_image_url AS text) IS NOT NULL AND (cover_image_url IS NULL "
                        f"OR btrim(cover_image_url, {BLANK_CHARS}) = '') THEN :cover_image_url ELSE cover_image_url END "
                        "WHERE id = :id"), updates)
        with engine.connect() as connection:
            complete_after = _totals(connection)[0] if apply else complete_before + newly_complete
    finally:
        engine.dispose()
    return {"filled": filled, "books_changed": changed, "complete_before": complete_before, "complete_after": complete_after,
            "books_without_authors": without_authors, "applied": apply}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", required=True, help="Target database; DATABASE_URL is never used")
    parser.add_argument("--apply", action="store_true", help="Write the fills; without it nothing is written")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    report = backfill(args.database_url, apply=args.apply, batch_size=args.batch_size)
    print("Applied." if report["applied"] else "Dry run: nothing was written (complete_after is predicted). Use --apply to write.")
    for name in ("books_changed", "complete_before", "complete_after", "books_without_authors"):
        print(f"{name}: {report[name]}")
    for field, count in report["filled"].items():
        print(f"filled {field}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
