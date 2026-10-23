"""Load extracted title aliases into book_title_aliases. A dry run unless --apply is given.

python -m data.load_title_aliases --database-url URL --input aliases.jsonl [--apply --max-database-mb 400]

The database is always named explicitly: DATABASE_URL is never read. Rerunning is safe and resumes
after any interruption, because each alias is inserted with ON CONFLICT DO NOTHING in its own batch.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

MAX_TITLE_CHARS = 500


class DatabaseTooLarge(RuntimeError):
    pass


def _rows(path: Path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield line


def _parse(line: str) -> dict | None:
    try:
        data = json.loads(line)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("work"), str) or not isinstance(data.get("title"), str):
        return None
    title = " ".join(data["title"].split())
    language = data.get("language")
    if isinstance(language, str):
        language = language.removeprefix("/languages/").strip() or None
    elif language is not None:
        return None
    if not title or len(title) > MAX_TITLE_CHARS or (language is not None and len(language) > 8):
        return None
    return {"work": data["work"], "title": title, "language": language}


def _resolve(connection, works: set[str]) -> dict[str, tuple[int, str]]:
    """Map work keys to (book id, book title), following one redirect hop for retired work keys."""
    keys = list(works)
    found = {row[0]: (row[1], row[2]) for row in connection.execute(
        text("SELECT source_id, id, title FROM books WHERE source_id = ANY(:keys)"), {"keys": keys})}
    missing = [key for key in keys if key not in found]
    if missing:
        redirects = dict(connection.execute(text(
            "SELECT old_source_id, canonical_source_id FROM catalogue_source_aliases "
            "WHERE old_source_id = ANY(:keys) AND source_type = 'redirect'"), {"keys": missing}).all())
        if redirects:
            canonical = {row[0]: (row[1], row[2]) for row in connection.execute(
                text("SELECT source_id, id, title FROM books WHERE source_id = ANY(:keys)"),
                {"keys": list(set(redirects.values()))})}
            found.update({old: canonical[new] for old, new in redirects.items() if new in canonical})
    return found


def _flush(connection, batch: list[dict], state: dict, apply: bool) -> None:
    resolved = _resolve(connection, {row["work"] for row in batch})
    candidates = []
    for row in batch:
        book = resolved.get(row["work"])
        if book is None:
            state["unknown_works"] += 1
            continue
        book_id, book_title = book
        state["matched"].add(book_id)
        identity = (book_id, row["title"].lower())
        if row["title"].lower() == book_title.lower() or identity in state["seen"]:
            state["skipped_duplicate"] += 1
            continue
        state["seen"].add(identity)
        candidates.append((book_id, row))
    if not candidates:
        return
    if apply:
        inserted = connection.execute(text(
            "INSERT INTO book_title_aliases (book_id, title, language, source) "
            "SELECT t.book_id, t.title, t.language, 'openlibrary_edition' "
            "FROM unnest(CAST(:ids AS integer[]), CAST(:titles AS text[]), CAST(:languages AS varchar[])) "
            "AS t(book_id, title, language) ON CONFLICT (book_id, lower(title)) DO NOTHING RETURNING id"),
            {"ids": [book_id for book_id, _ in candidates], "titles": [row["title"] for _, row in candidates],
             "languages": [row["language"] for _, row in candidates]}).all()
        state["new_aliases"] += len(inserted)
        state["skipped_duplicate"] += len(candidates) - len(inserted)
    else:
        existing = set(connection.execute(
            text("SELECT book_id, lower(title) FROM book_title_aliases WHERE book_id = ANY(:ids)"),
            {"ids": list({book_id for book_id, _ in candidates})}).all())
        fresh = [item for item in candidates if (item[0], item[1]["title"].lower()) not in existing]
        state["new_aliases"] += len(fresh)
        state["skipped_duplicate"] += len(candidates) - len(fresh)


def load(database_url: str, input_path: Path, *, apply: bool = False, max_database_mb: int | None = None,
         batch_size: int = 1000) -> dict:
    engine = create_engine(database_url)
    state = {"matched": set(), "seen": set(), "new_aliases": 0, "skipped_duplicate": 0, "unknown_works": 0, "invalid_rows": 0}
    try:
        if apply:
            if max_database_mb is None:
                raise ValueError("--max-database-mb is required with --apply")
            with engine.connect() as connection:
                size = float(connection.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
            if size > max_database_mb:
                raise DatabaseTooLarge(f"Database is {size:.0f} MB, above the {max_database_mb} MB limit; nothing was written")
        batch: list[dict] = []
        for line in _rows(Path(input_path)):
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
    finally:
        engine.dispose()
    return {"matched_works": len(state["matched"]), "new_aliases": state["new_aliases"],
            "skipped_duplicate": state["skipped_duplicate"], "unknown_works": state["unknown_works"],
            "invalid_rows": state["invalid_rows"], "applied": apply}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", required=True, help="Target database; DATABASE_URL is never used")
    parser.add_argument("--input", type=Path, required=True, help="JSONL from data.extract_title_aliases")
    parser.add_argument("--apply", action="store_true", help="Write the aliases; without it nothing is written")
    parser.add_argument("--max-database-mb", type=int, help="Refuse to apply when the database is larger than this")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.apply and args.max_database_mb is None:
        parser.error("--apply requires --max-database-mb")
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    try:
        counts = load(args.database_url, args.input, apply=args.apply, max_database_mb=args.max_database_mb,
                      batch_size=args.batch_size)
    except DatabaseTooLarge as error:
        print(f"Refused: {error}", file=sys.stderr)
        return 2
    print(("Applied." if counts["applied"] else "Dry run: nothing was written. Use --apply to write.")
          + "\n" + "\n".join(f"{name}: {value}" for name, value in counts.items() if name != "applied"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
