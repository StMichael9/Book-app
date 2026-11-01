"""The lookup queue and its worker: look a book up once, store it for everyone, then link the readers waiting on it.

The worker is one asyncio task. It sleeps until something is enqueued (or until the next retry is due), so the
database is never polled on a timer.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from models import CatalogueLookup, CatalogueLookupWaiter, UserBook
from services import catalogue_gate
from services.catalogue_gate import Accepted, Deferred, Duplicate, Rejected
from services.catalogue_resolver import OpenLibraryUnavailable, norm_title, resolve, surname

log = logging.getLogger("bookvane.catalogue.queue")
BATCH = 20
BACKOFF_SECONDS = (60, 10 * 60, 60 * 60, 24 * 60 * 60)
FAILED_RETRY = timedelta(days=30)
DEFER = timedelta(hours=1)

_loop: asyncio.AbstractEventLoop | None = None
_event: asyncio.Event | None = None


def lookup_key(isbn: str | None, title: str | None, author: str | None) -> str:
    if isbn:
        return f"isbn:{isbn}"
    digest = hashlib.sha1(f"{norm_title(title or '')}|{surname(author or '')}".encode()).hexdigest()
    return f"ta:{digest}"


def wake() -> None:
    """Tell the worker there is work. Safe from any thread; a no-op when the worker is not running."""
    if _loop is not None and _event is not None:
        _loop.call_soon_threadsafe(_event.set)


def enqueue(db: Session, *, isbn: str | None, title: str | None, author: str | None,
            user_book_id: int | None = None) -> CatalogueLookup | None:
    """Queue a lookup (once per book) and register the reader's entry as waiting. The caller commits, then calls wake()."""
    if not isbn and not (title and author):
        return None
    key = lookup_key(isbn, title, author)
    db.execute(insert(CatalogueLookup).values(key=key, isbn=isbn, title=title, author=author)
               .on_conflict_do_nothing(index_elements=["key"]))
    lookup = db.scalar(select(CatalogueLookup).where(CatalogueLookup.key == key))
    if user_book_id is not None:
        if lookup.status == "done" and lookup.result_book_id:
            link_waiters(db, lookup, lookup.result_book_id, only_entry=user_book_id)
        db.execute(insert(CatalogueLookupWaiter).values(lookup_id=lookup.id, user_book_id=user_book_id)
                   .on_conflict_do_nothing())
    return lookup


def link_waiters(db: Session, lookup: CatalogueLookup, book_id: int, only_entry: int | None = None) -> int:
    """Point waiting private entries at the catalogue book. Every reader field stays; failures change nothing."""
    query = select(UserBook).join(CatalogueLookupWaiter, CatalogueLookupWaiter.user_book_id == UserBook.id).where(
        CatalogueLookupWaiter.lookup_id == lookup.id, UserBook.book_id.is_(None))
    if only_entry is not None:
        query = select(UserBook).where(UserBook.id == only_entry, UserBook.book_id.is_(None))
    linked = 0
    for entry in db.scalars(query.with_for_update()):
        if db.scalar(select(UserBook.id).where(UserBook.user_id == entry.user_id, UserBook.book_id == book_id)):
            continue  # the reader already has this book: leave their private entry alone
        entry.book_id = book_id
        entry.version += 1
        linked += 1
    db.flush()
    return linked


def _retry(db: Session, lookup: CatalogueLookup, now: datetime) -> str:
    lookup.attempts += 1
    if lookup.attempts > len(BACKOFF_SECONDS):
        lookup.status, lookup.next_try_at = "failed", now + FAILED_RETRY
    else:
        lookup.status, lookup.next_try_at = "queued", now + timedelta(seconds=BACKOFF_SECONDS[lookup.attempts - 1])
    return lookup.status


def process(db: Session, lookup: CatalogueLookup, now: datetime | None = None) -> str:
    """Resolve, vet and store one lookup; returns its new status."""
    now = now or datetime.now(timezone.utc)
    try:
        resolution = resolve(db, lookup.isbn, lookup.title, lookup.author)
    except OpenLibraryUnavailable:
        return _retry(db, lookup, now)
    book_id = resolution.book_id
    if book_id is None and resolution.work:
        verdict = catalogue_gate.vet(db, resolution.work)
        if isinstance(verdict, Deferred):
            lookup.status, lookup.next_try_at = "queued", now + DEFER
            return lookup.status
        if isinstance(verdict, Rejected):
            catalogue_gate.log_rejection(db, resolution.work, verdict.reason)
            lookup.status = "rejected"
            return lookup.status
        book_id = verdict.book_id if isinstance(verdict, Duplicate) else catalogue_gate.promote(db, verdict.work)
    if book_id is None:
        return _retry(db, lookup, now)
    link_waiters(db, lookup, book_id)
    lookup.status, lookup.result_book_id = "done", book_id
    return lookup.status


def drain_once(factory: sessionmaker, limit: int = BATCH) -> tuple[int, float | None]:
    """Process up to `limit` due lookups. Returns (processed, seconds until the next one is due, or None)."""
    with factory() as db:
        if not catalogue_gate._capacity(db):
            return 0, DEFER.total_seconds()
        ids = list(db.scalars(select(CatalogueLookup.id).where(
            CatalogueLookup.status.in_(("queued", "failed")), CatalogueLookup.next_try_at <= func.now())
            .order_by(CatalogueLookup.next_try_at, CatalogueLookup.id).limit(limit)))
    done = 0
    for lookup_id in ids:
        with factory() as db:
            lookup = db.get(CatalogueLookup, lookup_id, with_for_update=True)
            if lookup is None or lookup.status not in ("queued", "failed"):
                continue
            try:
                process(db, lookup)
                db.commit()
                done += 1
            except Exception:  # one bad book must not stop the queue
                db.rollback()
                log.exception("lookup %s failed", lookup_id)
                with factory() as retry_db:
                    row = retry_db.get(CatalogueLookup, lookup_id)
                    if row is not None:
                        _retry(retry_db, row, datetime.now(timezone.utc))
                        retry_db.commit()
    if done or ids:
        return done or len(ids), 0.0
    with factory() as db:
        due = db.scalar(select(func.min(CatalogueLookup.next_try_at)).where(
            CatalogueLookup.status.in_(("queued", "failed"))))
        if due is None:
            return 0, None
        return 0, max(1.0, (due - datetime.now(timezone.utc)).total_seconds())


async def run_worker(factory: sessionmaker) -> None:
    """Sleep until woken (or until the next retry is due); drain; repeat. Never polls the database on a timer."""
    global _loop, _event
    _loop, _event = asyncio.get_running_loop(), asyncio.Event()
    _event.set()  # one look at startup for rows left queued by a previous process
    try:
        while True:
            await _event.wait()
            _event.clear()
            while True:
                try:
                    processed, delay = await asyncio.to_thread(drain_once, factory)
                except Exception:
                    log.exception("catalogue worker pass failed; trying again in 5 minutes")
                    processed, delay = 0, 300.0
                if processed:
                    continue
                if delay is None:
                    break
                try:
                    await asyncio.wait_for(_event.wait(), timeout=delay)
                    _event.clear()
                except asyncio.TimeoutError:
                    pass
    finally:
        _loop = _event = None
