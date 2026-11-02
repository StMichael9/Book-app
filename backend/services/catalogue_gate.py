"""The vetting gate: only a complete, clean Open Library work is stored in the shared catalogue.

`vet` decides; `promote` stores an accepted work. Rejections are logged with a reason code only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from data import clean
from data.staging import DERIVATIVE_PATTERN
from database import settings
from models import Author, Book, CatalogueImportIssue, Edition, EditionISBN, Tag, TagType, book_authors, book_tags
from services import catalogue_cache
from services.catalogue_resolver import (
    author_names_match, book_for_isbn, book_for_work_key, books_for_title,
)

ADDED_VIA = "reader_backfill"
_DERIVATIVE = re.compile(DERIVATIVE_PATTERN, re.IGNORECASE)
_PLACEHOLDER = re.compile(r"^(untitled|unknown|n/?a|none|title)$", re.IGNORECASE)
_FIELD_BITS = {"title": 1, "description": 2, "published_year": 4, "cover_image_url": 8, "isbn13": 16, "page_count": 32}


@dataclass
class Accepted:
    work: dict


@dataclass
class Duplicate:
    book_id: int


@dataclass
class Rejected:
    reason: str


@dataclass
class Deferred:
    reason: str


def _capacity(db: Session) -> bool:
    """False when the database is near its size guard: the worker then pauses instead of growing it."""
    size_mb = float(db.scalar(text("SELECT pg_database_size(current_database()) / 1048576.0")))
    return size_mb < settings.library_import_max_database_mb


def promoted_today(db: Session) -> int:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(select(func.count()).select_from(Book).where(Book.added_via == ADDED_VIA, Book.added_at >= start)) or 0


def unique_authors(names: list[str]) -> list[str]:
    seen, result = set(), []
    for name in names:
        cleaned = clean._text(name, 225)
        key = " ".join(re.findall(r"[^\W_]+", cleaned.casefold())) if cleaned else ""
        if key and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def _existing(db: Session, work: dict, authors: list[str]) -> int | None:
    if work.get("source_id") and (book_id := book_for_work_key(db, work["source_id"])):
        return book_id
    for isbn in work.get("isbns") or []:
        if book_id := book_for_isbn(db, isbn):
            return book_id
    if work.get("title") and authors:
        matches = [book_id for book_id in books_for_title(db, work["title"], authors[0])]
        if len(matches) == 1 and author_names_match(authors[0], authors):
            return matches[0]
    return None


def vet(db: Session, work: dict):
    """Accepted(cleaned work) | Duplicate(book_id) | Rejected(reason) | Deferred(reason, try again later)."""
    key = clean.work_key(work.get("source_id"))
    if not key:
        return Rejected("not_open_library")
    title = clean._text(work.get("title"))
    authors = unique_authors(work.get("authors") or [])
    if duplicate := _existing(db, {**work, "source_id": key}, authors):
        return Duplicate(duplicate)
    if not title or _PLACEHOLDER.match(title) or re.fullmatch(r"[0-9Xx\- ]{9,17}", title):
        return Rejected("bad_title")
    if not authors:
        return Rejected("no_author")
    if any(_PLACEHOLDER.match(name) for name in authors):
        return Rejected("bad_author")
    if _DERIVATIVE.search(title):
        return Rejected("derivative")
    if not work.get("cover_image_url"):
        return Rejected("no_cover")
    if not work.get("published_year"):
        return Rejected("no_year")
    if not work.get("page_count"):
        return Rejected("no_pages")
    if promoted_today(db) >= settings.catalogue_promote_daily_cap or not _capacity(db):
        return Deferred("daily_cap" if promoted_today(db) >= settings.catalogue_promote_daily_cap else "capacity")
    return Accepted({**work, "source_id": key, "title": title, "authors": authors,
                     "description": clean.description(work.get("description"))})


def log_rejection(db: Session, work: dict, reason: str) -> None:
    """Reason codes only: no title, author or reader information is stored."""
    db.add(CatalogueImportIssue(run_id=None, code="gate_reject", source_id=work.get("source_id"), detail=reason))


def promote(db: Session, work: dict) -> int:
    """Store an accepted work for everyone, from Open Library data only."""
    isbns = [isbn for isbn in work.get("isbns") or [] if isbn]
    fields = {"title": work["title"], "description": work.get("description"), "published_year": work["published_year"],
              "cover_image_url": work["cover_image_url"], "page_count": work["page_count"],
              "isbn13": isbns[0] if isbns else None}
    book = Book(source_id=work["source_id"], added_via=ADDED_VIA, added_at=datetime.now(timezone.utc),
                source_managed_fields=sum(bit for name, bit in _FIELD_BITS.items() if fields.get(name)), **fields)
    db.add(book)
    keys = list(work.get("author_keys") or [])
    for index, name in enumerate(work["authors"]):
        key = keys[index] if index < len(keys) and len(keys) == len(work["authors"]) else None
        author = db.scalar(select(Author).where(Author.source_id == key)) if key else None
        if author is None:
            author = Author(source_id=key, name=name, source_managed_name=bool(key))
            db.add(author)
        book.authors.append(author)
    db.flush()
    db.execute(book_authors.update().where(book_authors.c.book_id == book.id).values(source_managed=True))
    edition_key = work.get("edition_key")
    if edition_key and re.fullmatch(r"/books/OL[0-9]+M", edition_key) and not db.scalar(
            select(Edition.id).where(Edition.source_id == edition_key)):
        edition = Edition(book_id=book.id, source_id=edition_key, page_count=work["page_count"],
                          cover_image_url=work["cover_image_url"], languages=[], publishers=[])
        db.add(edition)
        db.flush()
        for isbn in isbns:
            db.add(EditionISBN(edition_id=edition.id, isbn13=isbn))
        db.flush()
        book.preferred_edition_id = edition.id
    _link_tags(db, book.id, work)
    catalogue_cache.clear()
    return book.id


def _link_tags(db: Session, book_id: int, work: dict) -> None:
    """Tags come from the same subject mapping as the bulk import, and only ever link tags that already exist."""
    normalized = clean.normalize_work({
        "key": work["source_id"], "title": work["title"], "subjects": work.get("subjects") or [],
        "authors": [{"author": {"key": key}} for key in (work.get("author_keys") or ["/authors/OL1A"])]})
    if not normalized or not normalized["tags"]:
        return
    wanted = {tag["name"].casefold(): TagType(tag["type"]) for tag in normalized["tags"]}
    rows = db.execute(select(Tag.id, Tag.name, Tag.type).where(func.lower(Tag.name).in_(wanted))).all()
    links = [{"book_id": book_id, "tag_id": tag_id, "source_managed": True}
             for tag_id, name, tag_type in rows if wanted.get(name.casefold()) == tag_type]
    if links:
        db.execute(book_tags.insert().values(links))
