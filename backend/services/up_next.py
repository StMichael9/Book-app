"""The reader's "Up next" pins: up to five of their own entries, in the order they chose.

Stored as `user_books.up_next_position` (1-5). A pin whose book has since been finished or started simply stops being listed;
the next replace clears it. Owner-scoped throughout. No wording lives here: any fallback pick is the UI's.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import Author, Book, UserBook, book_authors
from services.library import _reading_state

MAX_PINS = 5
# A book being read or already finished is no longer "up next".
UNAVAILABLE_STATES = ("reading", "paused", "finished")


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code})


def _authors_of_book():
    return (select(func.array_agg(Author.name).filter(Author.name.is_not(None)))
            .select_from(book_authors.join(Author, Author.id == book_authors.c.author_id))
            .where(book_authors.c.book_id == UserBook.book_id).correlate(UserBook).scalar_subquery())


def pins(db: Session, user_id) -> list[dict]:
    """The pinned entries still worth showing, in pin order, in one statement."""
    rows = db.execute(
        select(UserBook.id, UserBook.book_id, UserBook.private_title, UserBook.private_author, UserBook.private_catalogue,
               UserBook.is_owned, UserBook.is_wanted, Book.title, Book.cover_image_url, Book.page_count,
               _authors_of_book().label("authors"), _reading_state().label("state"))
        .outerjoin(Book, Book.id == UserBook.book_id)
        .where(UserBook.user_id == user_id, UserBook.up_next_position.is_not(None))
        .order_by(UserBook.up_next_position)).all()
    items = []
    for row in rows:
        if row.state in UNAVAILABLE_STATES:
            continue  # stale pin: finished or being read; never an error
        # the reader's own title and author win where they set them
        title = row.private_title or row.title
        authors = [row.private_author] if row.private_author else list(row.authors or [])
        catalogue = row.private_catalogue if isinstance(row.private_catalogue, dict) else {}
        items.append({"entry_id": row.id, "book_id": row.book_id, "title": title, "authors": authors,
                      "cover_url": row.cover_image_url or catalogue.get("cover_image_url"),
                      "owned": bool(row.is_owned), "want": bool(row.is_wanted), "page_count": row.page_count})
    return items


def replace(db: Session, user_id, entry_ids: list[int]) -> list[dict]:
    """Make exactly these entries the pins, in this order, in one transaction."""
    if len(entry_ids) > MAX_PINS:
        raise fail(422, "too_many_pins")
    if len(set(entry_ids)) != len(entry_ids):
        raise fail(422, "duplicate_pins")
    if entry_ids:
        found = {row.id: row.state for row in db.execute(
            select(UserBook.id, _reading_state().label("state")).where(UserBook.user_id == user_id, UserBook.id.in_(entry_ids)))}
        if set(found) != set(entry_ids):
            raise fail(422, "unknown_entry")      # includes another reader's entry: it is simply not theirs
        if any(state in UNAVAILABLE_STATES for state in found.values()):
            raise fail(422, "entry_unavailable")  # finished or being read
    # updated_at is left alone: pinning is not an edit of the entry (and does not bump its version)
    db.execute(update(UserBook).where(UserBook.user_id == user_id, UserBook.up_next_position.is_not(None))
               .values(up_next_position=None, updated_at=UserBook.updated_at))
    for position, entry_id in enumerate(entry_ids, start=1):
        db.execute(update(UserBook).where(UserBook.user_id == user_id, UserBook.id == entry_id)
                   .values(up_next_position=position, updated_at=UserBook.updated_at))
    try:
        db.commit()
    except IntegrityError:  # two replaces racing for the same positions: the later one is told to try again
        db.rollback()
        raise fail(409, "up_next_conflict") from None
    return pins(db, user_id)
