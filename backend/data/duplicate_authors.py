"""Report authors who share a normalised name and are both linked to the same book (T71). Read-only: nothing is merged.

    python -m data.duplicate_authors --mode production [--samples 30] [--report FILE]

Reads CATALOGUE_DATABASE_URL. The classic case is a book listing "Charles Dickens" twice under two Open Library author keys.
The name is normalised by lower-casing and treating every run of non-letter, non-digit characters as one space. One statement
for the pairs, one for the totals; the report carries counts and sample names only. Merging them is a separate decision.
"""
from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

NORMAL = r"btrim(regexp_replace(lower(a.name), '[^[\:alnum\:]]+', ' ', 'g'))"

PAIRS = text(f"""
    SELECT a1.id AS first_id, a1.name AS first_name, a1.source_id AS first_key,
           a2.id AS second_id, a2.name AS second_name, a2.source_id AS second_key, ba1.book_id AS book_id
    FROM book_authors ba1
    JOIN book_authors ba2 ON ba2.book_id = ba1.book_id AND ba2.author_id > ba1.author_id
    JOIN authors a1 ON a1.id = ba1.author_id
    JOIN authors a2 ON a2.id = ba2.author_id
    WHERE {NORMAL.replace('a.name', 'a1.name')} = {NORMAL.replace('a.name', 'a2.name')}
      AND {NORMAL.replace('a.name', 'a1.name')} <> ''
""")


def report(db: Session, samples: int = 30) -> dict:
    rows = db.execute(PAIRS).all()
    groups: dict[tuple[int, int], dict] = {}
    for row in rows:
        entry = groups.setdefault((row.first_id, row.second_id), {
            "first": (row.first_id, row.first_name, row.first_key), "second": (row.second_id, row.second_name, row.second_key),
            "books": 0})
        entry["books"] += 1
    ordered = sorted(groups.values(), key=lambda item: (-item["books"], item["first"][0]))
    return {"pairs": len(groups), "books": len({row.book_id for row in rows}),
            "authors": len({value for key in groups for value in key}), "samples": ordered[:samples]}


def markdown(result: dict) -> str:
    lines = ["# Same-name authors linked to the same book", "", "Report only; nothing is merged.", "",
             f"- Author pairs: {result['pairs']}", f"- Authors involved: {result['authors']}",
             f"- Books affected: {result['books']}", "", "## Largest pairs", ""]
    for item in result["samples"]:
        (a_id, a_name, a_key), (b_id, b_name, b_key) = item["first"], item["second"]
        lines.append(f"- {a_name} (#{a_id} {a_key}) and {b_name} (#{b_id} {b_key}): {item['books']} shared book(s)")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--report")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    from data.config import validate_database_target
    validate_database_target(url, args.mode)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            body = markdown(report(db, args.samples))
            db.rollback()
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
