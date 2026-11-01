"""One-off: queue existing private entries for the Open Library look-up (T31).

    python -m data.enqueue_private_entries --dry-run     # counts only, writes nothing
    python -m data.enqueue_private_entries               # enqueue; the web process worker picks the rows up

Run on production only with Michael's approval, after a Neon quota check. Entries already waiting on a look-up are
skipped, so it can be run again safely.
"""
from __future__ import annotations

import argparse

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from models import CatalogueLookupWaiter, UserBook


def backfill(db: Session, dry_run: bool = True, limit: int | None = None, batch: int = 500) -> dict:
    from services import catalogue_queue
    waiting = exists().where(CatalogueLookupWaiter.user_book_id == UserBook.id)
    query = (select(UserBook.id, UserBook.private_title, UserBook.private_author, UserBook.private_catalogue)
             .where(UserBook.book_id.is_(None), UserBook.private_title.is_not(None), ~waiting).order_by(UserBook.id))
    rows = db.execute(query.limit(limit) if limit else query).all()
    counts = {"candidates": len(rows), "queued": 0, "skipped_nothing_to_search": 0}
    for entry_id, title, author, catalogue in rows:
        isbn = (catalogue or {}).get("isbn") if isinstance(catalogue, dict) else None
        if not isbn and not (title and author):
            counts["skipped_nothing_to_search"] += 1
            continue
        if not dry_run:
            catalogue_queue.enqueue(db, isbn=isbn, title=title, author=author, user_book_id=entry_id)
        counts["queued"] += 1
        if not dry_run and counts["queued"] % batch == 0:
            db.commit()
    if not dry_run:
        db.commit()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="count only; write nothing")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    from database import SessionLocal
    with SessionLocal() as db:
        print(backfill(db, dry_run=args.dry_run, limit=args.limit))


if __name__ == "__main__":
    main()
