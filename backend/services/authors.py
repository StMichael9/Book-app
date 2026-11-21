"""Author pages: one author's facts and their catalogue books (T71).

Public data only (Open Library bio and photo id, listed catalogue books). A signed-in reader's shelf flags for the books on
a page come from ONE extra query, never one per book.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from models import Author, Book, User, UserBook, book_authors

PAGE_SIZE = 24
PHOTO_URL = "https://covers.openlibrary.org/a/id/{id}-M.jpg"
PROFILE_URL = "https://openlibrary.org{key}"


def photo_url(photo_id: int | None) -> str | None:
    return PHOTO_URL.format(id=photo_id) if photo_id else None


def open_library_url(source_id: str | None) -> str | None:
    return PROFILE_URL.format(key=source_id) if source_id and source_id.startswith("/authors/") else None


def author_facts(db: Session, author_id: int) -> dict | None:
    """The author with their number of listed books, from one statement."""
    count = (select(func.count()).select_from(book_authors.join(Book, Book.id == book_authors.c.book_id))
             .where(book_authors.c.author_id == Author.id, Book.is_listed.is_(True)).correlate(Author).scalar_subquery())
    row = db.execute(select(Author.id, Author.name, Author.bio, Author.photo_id, Author.source_id, count.label("book_count"))
                     .where(Author.id == author_id)).first()
    if row is None:
        return None
    return {"id": row.id, "name": row.name.strip(), "bio": row.bio, "photo_id": row.photo_id, "photo_url": photo_url(row.photo_id),
            "source_id": row.source_id, "book_count": row.book_count}


def get_author(db: Session, author_id: int) -> dict:
    facts = author_facts(db, author_id)
    if facts is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return {key: facts[key] for key in ("id", "name", "bio", "photo_url", "book_count")}


def author_books(db: Session, author_id: int, page: int, user: User | None) -> dict:
    """One page (24) of the author's listed books, most popular first, with the reader's shelf flags when signed in."""
    exists = db.scalar(select(Author.id).where(Author.id == author_id))
    if exists is None:
        raise HTTPException(status_code=404, detail="Author not found")
    rows = db.execute(
        select(Book.id, func.count().over().label("total"))
        .join(book_authors, book_authors.c.book_id == Book.id)
        .where(book_authors.c.author_id == author_id, Book.is_listed.is_(True))
        .order_by(Book.popularity.desc().nulls_last(), Book.id)
        .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)).all()
    if rows:
        total = rows[0].total
    elif page == 1:
        total = 0
    else:   # a page past the end carries no rows to read the total from
        total = db.scalar(select(func.count()).select_from(book_authors.join(Book, Book.id == book_authors.c.book_id))
                          .where(book_authors.c.author_id == author_id, Book.is_listed.is_(True))) or 0
    ids = [row.id for row in rows]
    books = {}
    if ids:
        loaded = db.execute(select(Book).where(Book.id.in_(ids)).options(
            joinedload(Book.authors), joinedload(Book.tags), joinedload(Book.title_aliases))).unique().scalars().all()
        books = {book.id: book for book in loaded}
    shelf = {}
    if user is not None and ids:
        shelf = {row.book_id: {"entry_id": row.id, "status": row.status.value if row.status else None,
                               "is_owned": row.is_owned, "is_wanted": row.is_wanted}
                 for row in db.execute(select(UserBook.id, UserBook.book_id, UserBook.status, UserBook.is_owned, UserBook.is_wanted)
                                       .where(UserBook.user_id == user.id, UserBook.book_id.in_(ids)))}
    return {"items": [(books[book_id], shelf.get(book_id)) for book_id in ids], "total": total, "page": page,
            "size": PAGE_SIZE, "pages": -(-total // PAGE_SIZE)}
