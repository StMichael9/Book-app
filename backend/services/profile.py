"""Reader profile, yearly reading stats and reading lists.

Everything that can reach a public page is built here from an explicit short list of fields, so a new column on a
user, entry or attempt can never leak by accident.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, delete, extract, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    Author, Book, ReadingAttempt, ReadingList, ReadingListItem, Tag, TagType, User, UserBook,
    book_authors, book_tags,
)
from services import catalogue_cache

HANDLE_PATTERN = re.compile(r"^[a-z0-9-]{3,30}$")
RESERVED_HANDLES = frozenset({"admin", "api", "me", "u", "settings", "login", "signup", "books", "help", "about", "privacy",
                              "profile", "account", "register", "bookvane", "support", "my-books", "browse", "home"})
MAX_LISTS = 50
MAX_BOOKS_PER_LIST = 500
PUBLIC_TTL = 60


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code})


def not_found() -> HTTPException:
    return fail(404, "not_found")


# --- profile -----------------------------------------------------------------------------------------------------

def initials(display_name: str | None, fallback: str) -> str:
    """Up to two display-name initials, else the first letter of the fallback (email local part, or the handle in public)."""
    words = (display_name or "").split()[:2]
    if words:
        return "".join(word[0] for word in words).upper()
    return (fallback.split("@")[0][:1] or "?").upper()


def profile_view(user: User) -> dict:
    return {"display_name": user.display_name, "bio": user.bio, "initials": initials(user.display_name, user.email),
            "handle": user.handle, "profile_public": user.profile_public,
            "show_prompt": user.profile_prompted_at is None, "reading_since": user.created_at.year}


def _text(value, limit: int, code: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise fail(422, code)
    value = " ".join(value.split())
    if len(value) > limit:
        raise fail(422, code)
    return value or None


def _handle(value) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise fail(422, "handle_invalid")
    value = value.strip().lower()
    if not value:
        return None
    if not HANDLE_PATTERN.match(value):
        raise fail(422, "handle_invalid")
    if value in RESERVED_HANDLES:
        raise fail(422, "handle_reserved")
    return value


def update_profile(db: Session, user: User, changes: dict) -> dict:
    old_handle = user.handle
    values = {}
    if "display_name" in changes:
        values["display_name"] = _text(changes["display_name"], 40, "display_name_invalid")
    if "bio" in changes:
        values["bio"] = _text(changes["bio"], 160, "bio_invalid")
    if "handle" in changes:
        values["handle"] = _handle(changes["handle"])
    if "profile_public" in changes:
        if not isinstance(changes["profile_public"], bool):
            raise fail(422, "profile_public_invalid")
        values["profile_public"] = changes["profile_public"]
    handle = values.get("handle", old_handle)
    if values.get("profile_public", user.profile_public) and not handle:
        raise fail(422, "handle_required")
    if handle and handle != old_handle and db.scalar(select(User.id).where(User.handle == handle, User.id != user.id)):
        raise fail(409, "handle_taken")
    for field, value in values.items():
        setattr(user, field, value)
    if changes.get("prompted") is True:
        user.profile_prompted_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(409, "handle_taken")
    forget_public(old_handle)
    forget_public(user.handle)
    return profile_view(user)


# --- stats -------------------------------------------------------------------------------------------------------

def year_stats(db: Session, user_id, year: int) -> dict:
    """Finished attempts ending in the year. A reread counts again; pages fall back to the book's, then to 0."""
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    finished = and_(UserBook.user_id == user_id, ReadingAttempt.state == "finished",
                    ReadingAttempt.ended_on >= start, ReadingAttempt.ended_on < end)
    pages = func.coalesce(ReadingAttempt.total_pages, Book.page_count, 0)
    month = extract("month", ReadingAttempt.ended_on)
    rows = db.execute(
        select(month, func.count(), func.coalesce(func.sum(pages), 0))
        .select_from(ReadingAttempt).join(UserBook, UserBook.id == ReadingAttempt.user_book_id)
        .outerjoin(Book, Book.id == UserBook.book_id).where(finished).group_by(month)).all()
    by_month = [0] * 12
    pages_read = 0
    for number, count, page_total in rows:
        by_month[int(number) - 1] = count
        pages_read += int(page_total)
    genres = db.execute(
        select(Tag.name, func.count().label("n"))
        .select_from(ReadingAttempt).join(UserBook, UserBook.id == ReadingAttempt.user_book_id)
        .join(book_tags, book_tags.c.book_id == UserBook.book_id).join(Tag, Tag.id == book_tags.c.tag_id)
        .where(finished, Tag.type == TagType.genre).group_by(Tag.name).order_by(func.count().desc(), Tag.name).limit(3)).all()
    top = max(by_month)
    return {"year": year, "books_finished": sum(by_month), "pages_read": pages_read, "by_month": by_month,
            "top_genres": [{"name": name, "count": count} for name, count in genres],
            "biggest_month": by_month.index(top) + 1 if top else None}


# --- lists -------------------------------------------------------------------------------------------------------

def _list_row(item: ReadingList, **extra) -> dict:
    return {"id": item.id, "name": item.name, "description": item.description, "is_public": item.is_public, **extra}


def owned_list(db: Session, user_id, list_id: int) -> ReadingList:
    item = db.scalar(select(ReadingList).where(ReadingList.id == list_id, ReadingList.user_id == user_id))
    if item is None:
        raise not_found()
    return item


def my_lists(db: Session, user_id, book_id: int | None = None) -> list[dict]:
    """The reader's lists. With book_id, each row also says whether that book is already in it (for "Add to list")."""
    lists = db.scalars(select(ReadingList).where(ReadingList.user_id == user_id)
                       .order_by(ReadingList.created_at, ReadingList.id)).all()
    counts = dict(db.execute(select(ReadingListItem.list_id, func.count()).where(
        ReadingListItem.list_id.in_([item.id for item in lists])).group_by(ReadingListItem.list_id)).all())
    ranked = (select(ReadingListItem.list_id, Book.cover_image_url,
                     func.row_number().over(partition_by=ReadingListItem.list_id, order_by=ReadingListItem.position).label("n"))
              .join(Book, Book.id == ReadingListItem.book_id)
              .where(ReadingListItem.list_id.in_([item.id for item in lists]), Book.cover_image_url.is_not(None))).subquery()
    covers: dict[int, list[str]] = {}
    for list_id, url in db.execute(select(ranked.c.list_id, ranked.c.cover_image_url).where(ranked.c.n <= 3)
                                   .order_by(ranked.c.list_id, ranked.c.n)):
        covers.setdefault(list_id, []).append(url)
    rows = [_list_row(item, book_count=counts.get(item.id, 0), covers=covers.get(item.id, [])) for item in lists]
    if book_id is not None:
        holding = set(db.scalars(select(ReadingListItem.list_id).where(
            ReadingListItem.list_id.in_([item.id for item in lists]), ReadingListItem.book_id == book_id)))
        for row in rows:
            row["has_book"] = row["id"] in holding
    return rows


def create_list(db: Session, user: User, name, description, is_public) -> dict:
    name = _text(name, 80, "name_invalid")
    if not name:
        raise fail(422, "name_invalid")
    if db.scalar(select(func.count()).select_from(ReadingList).where(ReadingList.user_id == user.id)) >= MAX_LISTS:
        raise fail(422, "list_limit")
    item = ReadingList(user_id=user.id, name=name, description=_text(description, 280, "description_invalid"),
                       is_public=bool(is_public))
    db.add(item)
    db.commit()
    forget_public(user.handle)
    return _list_row(item, book_count=0, covers=[])


def edit_list(db: Session, user: User, list_id: int, changes: dict) -> dict:
    item = owned_list(db, user.id, list_id)
    if "name" in changes:
        name = _text(changes["name"], 80, "name_invalid")
        if not name:
            raise fail(422, "name_invalid")
        item.name = name
    if "description" in changes:
        item.description = _text(changes["description"], 280, "description_invalid")
    if "is_public" in changes:
        if not isinstance(changes["is_public"], bool):
            raise fail(422, "is_public_invalid")
        item.is_public = changes["is_public"]
    db.commit()
    forget_public(user.handle)
    return _list_row(item)


def delete_list(db: Session, user: User, list_id: int) -> None:
    item = owned_list(db, user.id, list_id)
    db.delete(item)
    db.commit()
    forget_public(user.handle)


def add_book(db: Session, user: User, list_id: int, book_id: int) -> None:
    item = db.scalar(select(ReadingList).where(ReadingList.id == list_id, ReadingList.user_id == user.id).with_for_update())
    if item is None:
        raise not_found()
    if db.get(Book, book_id) is None:
        raise fail(404, "book_not_found")
    count, last = db.execute(select(func.count(), func.coalesce(func.max(ReadingListItem.position), 0))
                             .where(ReadingListItem.list_id == list_id)).one()
    if db.scalar(select(ReadingListItem.book_id).where(ReadingListItem.list_id == list_id,
                                                       ReadingListItem.book_id == book_id)) is not None:
        return
    if count >= MAX_BOOKS_PER_LIST:
        raise fail(422, "list_limit")
    db.add(ReadingListItem(list_id=list_id, book_id=book_id, position=last + 1))
    db.commit()
    forget_public(user.handle)


def remove_book(db: Session, user: User, list_id: int, book_id: int) -> None:
    owned_list(db, user.id, list_id)
    db.execute(delete(ReadingListItem).where(ReadingListItem.list_id == list_id, ReadingListItem.book_id == book_id))
    db.commit()
    forget_public(user.handle)


def reorder(db: Session, user: User, list_id: int, book_ids) -> None:
    item = db.scalar(select(ReadingList).where(ReadingList.id == list_id, ReadingList.user_id == user.id).with_for_update())
    if item is None:
        raise not_found()
    current = set(db.scalars(select(ReadingListItem.book_id).where(ReadingListItem.list_id == list_id)))
    if len(book_ids) != len(set(book_ids)) or set(book_ids) != current:
        raise fail(422, "order_mismatch")
    for position, book_id in enumerate(book_ids, start=1):
        db.execute(update(ReadingListItem).where(ReadingListItem.list_id == list_id, ReadingListItem.book_id == book_id)
                   .values(position=position))
    db.commit()
    forget_public(user.handle)


def _books(db: Session, list_id: int, owner_id=None) -> list[dict]:
    """The list's books in order. With owner_id, each book also carries the reader's shelf status and latest finished month."""
    columns = [Book.id, Book.title, Book.cover_image_url, Book.page_count,
               select(func.coalesce(func.array_agg(Author.name), []))
               .select_from(book_authors.join(Author, Author.id == book_authors.c.author_id))
               .where(book_authors.c.book_id == Book.id).correlate(Book).scalar_subquery().label("authors")]
    query = select(*columns).select_from(ReadingListItem).join(Book, Book.id == ReadingListItem.book_id).where(
        ReadingListItem.list_id == list_id).order_by(ReadingListItem.position)
    if owner_id is not None:
        finished = (select(func.to_char(func.max(ReadingAttempt.ended_on), "YYYY-MM"))
                    .where(ReadingAttempt.user_book_id == UserBook.id, ReadingAttempt.state == "finished",
                           ReadingAttempt.ended_on.is_not(None)).correlate(UserBook).scalar_subquery())
        query = (query.add_columns(case((UserBook.is_owned, "owned"), (UserBook.is_wanted, "want"), else_=None).label("status"),
                                   finished.label("finished_month"))
                 .outerjoin(UserBook, and_(UserBook.book_id == Book.id, UserBook.user_id == owner_id)))
    result = []
    for row in db.execute(query):
        item = {"id": row.id, "title": row.title, "cover_image_url": row.cover_image_url,
                "page_count": row.page_count, "authors": list(row.authors or [])}
        if owner_id is not None:
            item.update(status=row.status, finished_month=row.finished_month)
        result.append(item)
    return result


def owner_list(db: Session, user: User, list_id: int) -> dict:
    item = owned_list(db, user.id, list_id)
    return _list_row(item, books=_books(db, item.id, owner_id=user.id))


# --- public ------------------------------------------------------------------------------------------------------

def forget_public(handle: str | None) -> None:
    if handle:
        catalogue_cache.drop_prefix(("profile", handle))


def _public_user(db: Session, handle: str) -> User:
    user = db.scalar(select(User).where(User.handle == handle.lower(), User.profile_public.is_(True)))
    if user is None:
        raise not_found()
    return user


def public_profile(db: Session, handle: str) -> dict:
    key = ("profile", handle.lower(), "page")
    if (hit := catalogue_cache.get(key)) is not None:
        return hit
    user = _public_user(db, handle)
    lists = db.scalars(select(ReadingList).where(ReadingList.user_id == user.id, ReadingList.is_public.is_(True))
                       .order_by(ReadingList.created_at, ReadingList.id)).all()
    mine = {row["id"]: row for row in my_lists(db, user.id)}
    payload = {"display_name": user.display_name, "initials": initials(user.display_name, user.handle),
               "bio": user.bio, "reading_since": user.created_at.year,
               "stats": year_stats(db, user.id, datetime.now(timezone.utc).year),
               "lists": [{"id": item.id, "name": item.name, "description": item.description,
                          "book_count": mine[item.id]["book_count"], "covers": mine[item.id]["covers"]} for item in lists]}
    catalogue_cache.put(key, payload, PUBLIC_TTL)
    return payload


def public_list(db: Session, handle: str, list_id: int) -> dict:
    key = ("profile", handle.lower(), "list", list_id)
    if (hit := catalogue_cache.get(key)) is not None:
        return hit
    user = _public_user(db, handle)
    item = db.scalar(select(ReadingList).where(ReadingList.id == list_id, ReadingList.user_id == user.id,
                                               ReadingList.is_public.is_(True)))
    if item is None:
        raise not_found()
    payload = {"id": item.id, "name": item.name, "description": item.description,
               "owner": {"display_name": user.display_name, "initials": initials(user.display_name, user.handle)},
               "books": _books(db, item.id)}
    catalogue_cache.put(key, payload, PUBLIC_TTL)
    return payload
