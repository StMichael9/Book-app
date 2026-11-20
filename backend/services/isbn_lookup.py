"""Barcode scan lookup (T67 part A): what do we know about this ISBN? Read-only: nothing here writes to the catalogue.

Order: an edition that carries the ISBN, a book whose own isbn13 it is, a catalogue lookup already resolved for `isbn:{isbn}`,
then one Open Library preview (the edition, then its work and authors). The log line `scan_lookup status=... source=...`
carries no ISBN and no user id; the share of `open_library` / `not_found` answers measures what the 3-edition cap costs.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from data import clean
from models import Author, Book, CatalogueLookup, UserBook, book_authors
from services import catalogue_resolver as resolver
from services.catalogue_resolver import OpenLibraryUnavailable, edition_for_isbn

log = logging.getLogger("bookvane.catalogue.scan")


def normalize(value: str) -> str | None:
    return clean.isbn13(value) or clean.isbn10_to_13(value)


def _book_card(db: Session, book_id: int) -> dict:
    book = db.execute(select(Book.title, Book.cover_image_url).where(Book.id == book_id)).one()
    names = list(db.scalars(select(Author.name).join(book_authors, book_authors.c.author_id == Author.id)
                            .where(book_authors.c.book_id == book_id).order_by(Author.id)))
    return {"title": book.title, "authors": names, "cover_url": book.cover_image_url}


def _on_shelf(db: Session, user_id, isbn: str, book_id: int | None) -> dict | None:
    """The reader's own flags for this book, or for a private entry saved from a scan of this ISBN."""
    query = select(UserBook.is_owned, UserBook.is_wanted).where(UserBook.user_id == user_id)
    if book_id is not None:
        query = query.where(UserBook.book_id == book_id)
    else:
        query = query.where(UserBook.book_id.is_(None), UserBook.private_catalogue["isbn"].astext == isbn)
    row = db.execute(query.limit(1)).first()
    return {"is_owned": bool(row.is_owned), "is_wanted": bool(row.is_wanted)} if row else None


def _open_library_preview(isbn: str) -> dict | None:
    edition = resolver.ol_get(f"/isbn/{isbn}.json")
    if not edition:
        return None
    works = edition.get("works") or []
    work_key = clean.work_key(works[0].get("key")) if works and isinstance(works[0], dict) else None
    work = resolver.ol_get(f"{work_key}.json") if work_key else None
    title = clean._text((work or {}).get("title")) or clean._text(edition.get("title"))
    if not title:
        return None
    names = resolver._author_names(work)[0] if work else []
    covers = (work or {}).get("covers") or edition.get("covers") or []
    return {"title": title, "authors": names, "cover_url": next((url for item in covers if (url := clean.cover_url(item))), None)}


def lookup(db: Session, user_id, isbn: str) -> dict:
    """`isbn` is a valid ISBN-13. Returns the response body."""
    result = {"isbn13": isbn, "status": "not_found", "book_id": None, "edition_id": None, "title": None, "authors": [],
              "cover_url": None, "on_shelf": None}
    source = "none"
    found = edition_for_isbn(db, isbn)
    if found:
        source = "edition_isbns" if found[1] is not None and db.scalar(
            select(Book.id).where(Book.id == found[0], Book.isbn13 == isbn)) is None else "book_isbn13"
    else:
        done = db.scalar(select(CatalogueLookup.result_book_id).where(
            CatalogueLookup.key == f"isbn:{isbn}", CatalogueLookup.status == "done", CatalogueLookup.result_book_id.is_not(None)))
        if done:
            found, source = (done, None), "catalogue_lookup"
    if found:
        result |= {"status": "catalogue", "book_id": found[0], "edition_id": found[1]} | _book_card(db, found[0])
        result["on_shelf"] = _on_shelf(db, user_id, isbn, found[0])
    else:
        try:
            preview = _open_library_preview(isbn)
        except OpenLibraryUnavailable:
            result["status"], source = "unavailable", "open_library"
        else:
            if preview:
                result |= {"status": "open_library"} | preview
                source = "open_library"
        result["on_shelf"] = _on_shelf(db, user_id, isbn, None)
    log.info("scan_lookup status=%s source=%s", result["status"], source)
    return result
