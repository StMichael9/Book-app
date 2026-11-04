"""The signed-in reader's "reading life" figures for GET /me/stats. Private to the reader: none of this reaches the public
profile (whose stats come from services.profile.year_stats and stay exactly as they were).

A constant number of statements (attempts, authors, subject tags, shelf counts, the oldest waiting book); everything else is
worked out from those rows in memory.
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from models import Author, Book, ReadingAttempt, Tag, TagType, UserBook, book_authors, book_tags

SUBJECT_TYPES = (TagType.genre, TagType.topic, TagType.form, TagType.audience)
# Same length bands as the My Books filter: short < 250 pages, medium 250-450, long > 450.
# TODO(T36 landing): import LENGTHS and length_of from services.library_view so the bands live in one place.
SHORT_BELOW, LONG_ABOVE = 250, 450


def length_band(pages: int | None) -> str:
    if not pages or pages <= 0:
        return "unknown"
    return "short" if pages < SHORT_BELOW else "medium" if pages <= LONG_ABOVE else "long"


def author_key(name: str) -> str:
    return " ".join(name.casefold().split())


class Attempt:
    __slots__ = ("state", "started", "ended", "pages", "book_id", "authors")


def _load(db: Session, user_id) -> list[Attempt]:
    rows = db.execute(
        select(ReadingAttempt.state, ReadingAttempt.started_on, ReadingAttempt.ended_on, ReadingAttempt.total_pages,
               Book.page_count, UserBook.book_id, UserBook.private_author)
        .select_from(ReadingAttempt).join(UserBook, UserBook.id == ReadingAttempt.user_book_id)
        .outerjoin(Book, Book.id == UserBook.book_id)
        .where(UserBook.user_id == user_id, ReadingAttempt.state.in_(["finished", "dnf"]))).all()
    book_ids = {row.book_id for row in rows if row.book_id is not None}
    names: dict[int, list[str]] = defaultdict(list)
    if book_ids:
        for book_id, name in db.execute(select(book_authors.c.book_id, Author.name).join(
                Author, Author.id == book_authors.c.author_id).where(book_authors.c.book_id.in_(book_ids))
                .order_by(book_authors.c.book_id, Author.id)):
            names[book_id].append(name)
    attempts = []
    for row in rows:
        item = Attempt()
        item.state, item.started, item.ended = row.state, row.started_on, row.ended_on
        item.pages = row.total_pages or row.page_count or None
        item.book_id = row.book_id
        item.authors = names.get(row.book_id) or ([row.private_author] if row.private_author else [])
        attempts.append(item)
    return attempts


def _subjects(db: Session, attempts: list[Attempt]) -> dict[int, list[str]]:
    book_ids = {item.book_id for item in attempts if item.book_id is not None and item.state == "finished"}
    tags: dict[int, list[str]] = defaultdict(list)
    if book_ids:
        for book_id, name in db.execute(select(book_tags.c.book_id, Tag.name).join(Tag, Tag.id == book_tags.c.tag_id)
                                        .where(Tag.type.in_(SUBJECT_TYPES), book_tags.c.book_id.in_(book_ids))):
            tags[book_id].append(name)
    return tags


def figures(attempts: list[Attempt], tags: dict[int, list[str]], year: int) -> dict:
    """The per-year figures. A reread is another finish; unknown pages are left out of the page totals and counted."""
    done = [a for a in attempts if a.state == "finished" and a.ended and a.ended.year == year]
    stopped = sum(1 for a in attempts if a.state == "dnf" and a.ended and a.ended.year == year)
    known = [a.pages for a in done if a.pages]
    months = [{"books": 0, "pages": 0} for _ in range(12)]
    for a in done:
        months[a.ended.month - 1]["books"] += 1
        months[a.ended.month - 1]["pages"] += a.pages or 0
    days = [(a.ended - a.started).days for a in done if a.started and a.ended >= a.started]
    median = statistics.median(days) if days else None
    subjects = Counter(name for a in done for name in set(tags.get(a.book_id, ())))
    mix = Counter(length_band(a.pages) for a in done)
    earlier = {author_key(name) for a in attempts if a.state == "finished" and a.ended and a.ended.year < year
               for name in a.authors}
    this_year = {author_key(name) for a in done for name in a.authors}
    return {
        "books": len(done), "pages": sum(known), "pages_unknown": len(done) - len(known),
        "avg_length": round(sum(known) / len(known)) if known else None,
        "median_days": int(median) if median is not None and median == int(median) else median,
        "stopped": stopped, "months": months,
        "top_subjects": [{"name": name, "count": count} for name, count in
                         sorted(subjects.items(), key=lambda item: (-item[1], item[0]))[:5]],
        "length_mix": {band: mix.get(band, 0) for band in ("short", "medium", "long", "unknown")},
        "authors_new": len(this_year - earlier), "authors_returning": len(this_year & earlier),
    }


def shelf(db: Session, user_id) -> dict:
    finished = exists().where(ReadingAttempt.user_book_id == UserBook.id, ReadingAttempt.state == "finished")
    owned_unfinished, want = db.execute(select(
        func.count().filter(UserBook.is_owned.is_(True), ~finished),
        func.count().filter(UserBook.is_wanted.is_(True))).where(UserBook.user_id == user_id)).one()
    any_attempt = exists().where(ReadingAttempt.user_book_id == UserBook.id)
    oldest = db.execute(
        select(UserBook.id, UserBook.book_id, UserBook.private_title, UserBook.created_at, Book.title, Book.cover_image_url)
        .outerjoin(Book, Book.id == UserBook.book_id)
        .where(UserBook.user_id == user_id, (UserBook.is_owned.is_(True)) | (UserBook.is_wanted.is_(True)), ~any_attempt)
        .order_by(UserBook.created_at, UserBook.id).limit(1)).first()
    waiting = None
    if oldest is not None:
        entry_id, book_id, private_title, saved_at, title, cover = oldest
        waiting = {"entry_id": entry_id, "book_id": book_id, "title": title or private_title,
                   "cover_url": cover if book_id is not None else None, "saved_at": saved_at.astimezone(timezone.utc).isoformat()}
    return {"owned_unfinished": owned_unfinished, "want": want, "oldest_waiting": waiting}


def reading_life(db: Session, user_id, year: int) -> dict:
    attempts = _load(db, user_id)
    tags = _subjects(db, attempts)
    every = [a for a in attempts if a.state == "finished"]
    pages = [a.pages for a in every if a.pages]
    return {**figures(attempts, tags, year), "previous": figures(attempts, tags, year - 1),
            "all_time": {"books": len(every), "pages": sum(pages)}, "shelf": shelf(db, user_id)}
