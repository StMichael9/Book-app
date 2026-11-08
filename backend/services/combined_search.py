"""One combined search (T45): books Open Library knows that we do not hold yet, shaped like our own book cards.

`more` is read-only and never raises: any Open Library trouble is simply "nothing more". `resolve_key` stores one chosen work
through the same gate as every other entry point. Readers never call Open Library; they never see where a result came from.
"""
from __future__ import annotations

import threading
import time
import unicodedata
from collections import OrderedDict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from data import clean
from data.popularity import popularity_score
from models import Book, CatalogueSourceAlias, EditionISBN
from services import catalogue_gate, catalogue_resolver
from services.catalogue_resolver import OpenLibraryUnavailable

SEARCH_TIMEOUT = 1.5
CACHE_SECONDS = 24 * 3600
CACHE_LIMIT = 500
RESOLVES_PER_HOUR = 20
GUEST_RESOLVES_PER_HOUR = 10
GUEST_RESOLVES_PER_DAY = 300
FIELDS = ("key,title,author_name,author_key,cover_i,first_publish_year,number_of_pages_median,readinglog_count,"
          "ratings_count,subject,isbn,edition_key")

_cache: "OrderedDict[tuple, tuple[float, list[dict]]]" = OrderedDict()
_cache_lock = threading.Lock()
_resolves: dict = {}
_resolves_lock = threading.Lock()
_guest_day = {"day": None, "count": 0}


def clear() -> None:
    with _cache_lock:
        _cache.clear()
    with _resolves_lock:
        _resolves.clear()
        _guest_day.update(day=None, count=0)


def _norm(value: str | None) -> str:
    return " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())


def _query(book: str | None, author: str | None) -> str | None:
    parts = []
    if book and book.strip():
        parts.append('title:"%s"' % book.strip().replace('"', " "))
    if author and author.strip():
        parts.append('author:"%s"' % author.strip().replace('"', " "))
    return " ".join(parts) or None


def _count(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _passes_gate(doc: dict) -> dict | None:
    """The card for a search result that would pass the gate, else None (no cover, author, year or pages; a derivative)."""
    key = clean.work_key(doc.get("key"))
    title = clean._text(doc.get("title"))
    authors = catalogue_gate.unique_authors([n for n in doc.get("author_name") or [] if isinstance(n, str)])
    cover = clean.cover_url(doc.get("cover_i"))
    year = clean.year(doc.get("first_publish_year"))
    pages = clean.page_count(doc.get("number_of_pages_median"))
    if not (key and title and authors and cover and year and pages):
        return None
    if catalogue_gate._DERIVATIVE.search(title) or catalogue_gate._PLACEHOLDER.match(title):
        return None
    isbns = [valid for value in (doc.get("isbn") or [])[:40] if (valid := clean.isbn13(value))][:10]
    return {"work_key": key, "title": title, "authors": authors[:3], "cover_url": cover, "published_year": year,
            "page_count": pages, "popularity": round(popularity_score(_count(doc.get("readinglog_count")),
                                                                      _count(doc.get("ratings_count"))), 4),
            "isbns": isbns}


def _live(book: str | None, author: str | None) -> list[dict]:
    key = (_norm(book), _norm(author))
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            _cache.move_to_end(key)
            return hit[1]
    q = _query(book, author)
    if not q:
        return []
    try:
        data = catalogue_resolver.ol_get("/search.json", {"q": q, "fields": FIELDS, "limit": 20}, timeout=SEARCH_TIMEOUT)
    except Exception:  # noqa: BLE001 - search must never fail a page; Open Library trouble is "nothing more"
        return []
    docs = data.get("docs") if isinstance(data, dict) else None
    cards = [card for doc in docs or [] if isinstance(doc, dict) and (card := _passes_gate(doc))]
    with _cache_lock:
        _cache[key] = (now, cards)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)
    return cards


def more(db: Session, book: str | None, author: str | None) -> list[dict]:
    """Open Library results we do not hold: no work key, alias or ISBN in common with a book we already have."""
    cards = _live(book, author)
    if not cards:
        return []
    keys = {card["work_key"] for card in cards}
    isbns = {isbn for card in cards for isbn in card["isbns"]}
    held = set(db.scalars(select(Book.source_id).where(Book.source_id.in_(keys))))
    held |= set(db.scalars(select(CatalogueSourceAlias.old_source_id).where(CatalogueSourceAlias.old_source_id.in_(keys))))
    held_isbns: set = set()
    if isbns:
        held_isbns = set(db.scalars(select(EditionISBN.isbn13).where(EditionISBN.isbn13.in_(isbns))))
        held_isbns |= set(db.scalars(select(Book.isbn13).where(Book.isbn13.in_(isbns))))
    wanted = _norm(book)
    result = [{key: value for key, value in card.items() if key != "isbns"} for card in cards
              if card["work_key"] not in held and not (set(card["isbns"]) & held_isbns)]
    result.sort(key=lambda card: (_norm(card["title"]) != wanted, -card["popularity"], card["work_key"]))
    return result


def _allow_resolve(who, per_hour: int) -> bool:
    now = time.monotonic()
    with _resolves_lock:
        recent = [t for t in _resolves.get(who, []) if now - t < 3600]
        allowed = len(recent) < per_hour
        if allowed:
            recent.append(now)
        _resolves[who] = recent
        return allowed


def _allow_guest_today() -> bool:
    """One ceiling across every signed-out reader, per UTC day."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    with _resolves_lock:
        if _guest_day["day"] != today:
            _guest_day.update(day=today, count=0)
        if _guest_day["count"] >= GUEST_RESOLVES_PER_DAY:
            return False
        _guest_day["count"] += 1
        return True


def resolve_key(db: Session, user_id, work_key: str, client_ip: str | None = None) -> int:
    """The book id for one Open Library work, storing it first if it passes the gate."""
    key = clean.work_key(work_key)
    if not key:
        raise HTTPException(422, detail={"code": "not_listable"})
    if book_id := catalogue_resolver.book_for_work_key(db, key):
        return book_id
    if user_id is not None:
        if not _allow_resolve(("user", user_id), RESOLVES_PER_HOUR):
            raise HTTPException(429, detail={"code": "too_many_resolves"})
    else:
        if not _allow_resolve(("ip", client_ip or "unknown"), GUEST_RESOLVES_PER_HOUR):
            raise HTTPException(429, detail={"code": "too_many_resolves"})
        if not _allow_guest_today():
            raise HTTPException(429, detail={"code": "resolve_ceiling"})
    try:
        work = catalogue_resolver.work_by_key(db, key, timeout=SEARCH_TIMEOUT)
    except OpenLibraryUnavailable:
        raise HTTPException(503, detail={"code": "try_again"}) from None
    if work is None:
        raise HTTPException(422, detail={"code": "not_listable"})
    verdict = catalogue_gate.vet(db, work)
    if isinstance(verdict, catalogue_gate.Duplicate):
        return verdict.book_id
    if isinstance(verdict, catalogue_gate.Rejected):
        catalogue_gate.log_rejection(db, work, verdict.reason)
        db.commit()
        raise HTTPException(422, detail={"code": "not_listable"})
    if isinstance(verdict, catalogue_gate.Deferred):
        raise HTTPException(503, detail={"code": "try_again"})
    book_id = catalogue_gate.promote(db, verdict.work)
    db.commit()
    return book_id
