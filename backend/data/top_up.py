"""Nightly top-up (T49): add a few hundred of Open Library's trending and most-read books, once the catch-up is done.

    CATALOGUE_DATABASE_URL=... python -m data.top_up [--limit 400] [--dry-run] [--refresh-popularity] [--retry-failed]

Every book goes through the same steps as a reader's pick: its search result is checked against the gate's shape rules, then
`catalogue_gate.vet` (Open Library data only; cover, author, year and pages; no derivative; no duplicate; the daily cap and the
storage guard), then `promote`. About a thousand polite requests a night (3 a second, the resolver's own limiter).
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter

from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session

from data import clean
from data.taxonomy import GENRES, SUBJECT_ALIASES
from models import Book, CatalogueLookup
from services import catalogue_gate, catalogue_resolver, combined_search
from services.catalogue_resolver import OpenLibraryUnavailable

log = logging.getLogger("bookvane.catalogue")
DEFAULT_LIMIT = 400
MAX_LIMIT = 500
PER_GENRE = 50
FIELDS = combined_search.FIELDS
TIMEOUT = 8


def _search(params: dict) -> list[dict]:
    try:
        data = catalogue_resolver.ol_get("/search.json", {**params, "fields": FIELDS}, timeout=TIMEOUT)
    except OpenLibraryUnavailable:
        return []
    return [doc for doc in (data or {}).get("docs", []) if isinstance(doc, dict)]


def trending_docs() -> list[dict]:
    """This week's trending works, completed with the fields the gate needs (the trending list lacks page counts)."""
    try:
        data = catalogue_resolver.ol_get("/trending/weekly.json", {"limit": 100}, timeout=TIMEOUT)
    except OpenLibraryUnavailable:
        return []
    keys = [work.get("key") for work in (data or {}).get("works", []) if isinstance(work, dict) and clean.work_key(work.get("key"))]
    docs: list[dict] = []
    for start in range(0, len(keys), 25):
        group = " OR ".join(keys[start:start + 25])
        docs += _search({"q": f"key:({group})", "limit": 25})
    return docs


def genre_docs(per_genre: int = PER_GENRE):
    """The most-read works for each of the 28 genres, one search each, most read first."""
    for key, _label, _group in GENRES:
        subject = SUBJECT_ALIASES[key][0]
        yield _search({"q": f'subject:"{subject}"', "sort": "readinglog", "limit": per_genre})


def _batches():
    yield trending_docs()
    yield from genre_docs()


def top_up(db: Session, limit: int = DEFAULT_LIMIT, dry_run: bool = False, batches=None) -> dict:
    """Add up to `limit` new books. Returns counts only."""
    limit = max(1, min(limit, MAX_LIMIT))
    report = Counter()
    seen: set[str] = set()
    for docs in (batches if batches is not None else _batches()):
        for doc in docs:
            key = clean.work_key(doc.get("key"))
            if not key or key in seen:
                continue
            seen.add(key)
            report["seen"] += 1
            if combined_search._passes_gate(doc) is None:
                report["not_listable"] += 1
                continue
            if catalogue_resolver.book_for_work_key(db, key):
                report["already_held"] += 1
                continue
            try:
                work = catalogue_resolver.work_by_key(db, key, timeout=TIMEOUT, doc=doc)
            except OpenLibraryUnavailable:
                report["unavailable"] += 1
                continue
            verdict = catalogue_gate.vet(db, work)
            if isinstance(verdict, catalogue_gate.Duplicate):
                report["already_held"] += 1
            elif isinstance(verdict, catalogue_gate.Rejected):
                report["rejected_" + verdict.reason] += 1
                if not dry_run:
                    catalogue_gate.log_rejection(db, work, verdict.reason)
                    db.commit()
            elif isinstance(verdict, catalogue_gate.Deferred):
                report["stopped_" + verdict.reason] += 1
                return dict(report)               # the daily cap or the storage guard: stop, never push past it
            else:
                report["added"] += 1
                if not dry_run:
                    catalogue_gate.promote(db, verdict.work)
                    db.commit()
                if report["added"] >= limit:
                    return dict(report)
    return dict(report)


def refresh_popularity(db: Session, limit: int = 2000) -> dict:
    """Monthly: re-read reading-log and ratings counts for the books without a score first, then the most popular."""
    books = db.execute(select(Book.source_id, Book.popularity).where(Book.source_id.is_not(None))
                       .order_by(Book.popularity.is_(None).desc(), Book.popularity.desc().nulls_last(), Book.id).limit(limit)).all()
    changed = 0
    for start in range(0, len(books), 25):
        group = books[start:start + 25]
        keys = {key for key, _ in group}
        docs = _search({"q": "key:(" + " OR ".join(sorted(keys)) + ")", "limit": 25})
        old = dict(group)
        for doc in docs:
            key = doc.get("key")
            if key not in old:
                continue
            work = catalogue_resolver.work_from_doc(doc, None)
            new = work["popularity"]
            if old[key] is None or abs(new - old[key]) > 0.05:
                db.execute(update(Book).where(Book.source_id == key).values(popularity=new))
                changed += 1
    db.commit()
    return {"checked": len(books), "changed": changed}


def retry_failed(db: Session) -> dict:
    """Monthly: give lookups that gave up another go (the lookup worker picks them up)."""
    result = db.execute(update(CatalogueLookup).where(CatalogueLookup.status == "failed")
                        .values(status="queued", attempts=0, next_try_at=func.now()))
    db.commit()
    return {"requeued": result.rowcount or 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--refresh-popularity", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            print("top-up:", top_up(db, args.limit, args.dry_run))
            if args.refresh_popularity:
                print("popularity refresh:", refresh_popularity(db))
            if args.retry_failed:
                print("retry failed lookups:", retry_failed(db))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
