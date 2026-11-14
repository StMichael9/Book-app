"""The signed-in reader's "reading life" figures for GET /me/stats. Private to the reader: none of this reaches the public
profile (whose stats come from services.profile.year_stats and stay exactly as they were).

A constant number of statements (attempts, authors, subject tags, progress days, shelf counts, the oldest waiting book); everything else is
worked out from those rows in memory.
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import date, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from models import Author, Book, ReadingAttempt, ReadingProgressDay, Tag, TagType, UserBook, book_authors, book_tags
from services.library_view import LENGTHS, length_of

SUBJECT_TYPES = (TagType.genre, TagType.topic, TagType.form, TagType.audience)


MIN_BOOKS_FOR_AVERAGE = 3       # a single odd book never becomes a headline
MIN_READING_DAYS = 5


def _half_up(value: float) -> int:
    return int(value + 0.5)


def _progress_rows(db: Session, user_id) -> list:
    """The reader's own progress days (one read; the join to the entry is the owner check), oldest first per attempt."""
    return db.execute(
        select(ReadingProgressDay.attempt_id, ReadingProgressDay.day, ReadingProgressDay.unit, ReadingProgressDay.first_value,
               ReadingProgressDay.last_value, ReadingAttempt.total_pages)
        .select_from(ReadingProgressDay).join(ReadingAttempt, ReadingAttempt.id == ReadingProgressDay.attempt_id)
        .join(UserBook, UserBook.id == ReadingAttempt.user_book_id).where(UserBook.user_id == user_id)
        .order_by(ReadingProgressDay.attempt_id, ReadingProgressDay.day)).all()


def page_gains(rows) -> dict[date, int]:
    """Pages gained per reader-local day, summed over all the reader's attempts. For each attempt a day's gain is its last
    value minus the last value of the attempt's previous row (the first row: last minus first). A percent row is turned into
    pages with the attempt's total pages (rounded) and skipped when they are unknown; a change of unit skips that day's gain;
    a correction downwards counts as 0."""
    gains: dict[date, int] = defaultdict(int)
    previous: dict = {}
    for attempt_id, day, unit, first, last, total in rows:
        if unit == "percent":
            if not total:
                continue
            first, last = _half_up(first * total / 100), _half_up(last * total / 100)
        before = previous.get(attempt_id)
        previous[attempt_id] = (unit, last)
        if before is None:
            gain = last - first
        elif before[0] != unit:
            continue
        else:
            gain = last - before[1]
        gains[day] += max(gain, 0)
    return gains


def reading_days(gains: dict[date, int], year: int | None = None) -> dict:
    """Reading days (a day with a gain over all attempts) and pages per reading day, for one year or for all time."""
    counted = [g for d, g in gains.items() if g > 0 and (year is None or d.year == year)]
    return {"reading_days": len(counted),
            "pages_per_day": _half_up(sum(counted) / len(counted)) if len(counted) >= MIN_READING_DAYS else None}


def days_to_finish(attempts: list) -> list[int]:
    return [(a.ended - a.started).days for a in attempts if a.started and a.ended and a.ended >= a.started]


def average_days(days: list[int]) -> int | None:
    return _half_up(sum(days) / len(days)) if len(days) >= MIN_BOOKS_FOR_AVERAGE else None


def length_band(pages: int | None) -> str:
    """The My Books length bands (one definition, in services.library_view), or "unknown" without a page count."""
    return length_of(pages) or "unknown"


def author_key(name: str) -> str:
    return " ".join(name.casefold().split())


class Attempt:
    __slots__ = ("state", "started", "ended", "pages", "book_id", "authors", "entry", "id", "origin")


def _load(db: Session, user_id) -> list[Attempt]:
    rows = db.execute(
        select(ReadingAttempt.state, ReadingAttempt.started_on, ReadingAttempt.ended_on, ReadingAttempt.total_pages,
               Book.page_count, UserBook.book_id, UserBook.private_author, ReadingAttempt.user_book_id, ReadingAttempt.id,
               ReadingAttempt.origin)
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
        item.entry, item.id, item.origin = row.user_book_id, str(row.id), row.origin
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


def rereads_of(attempts: list[Attempt]) -> set[str]:
    """Ids of the finished attempts that come after an earlier finished attempt on the same entry (by finish date, then
    attempt id; an undated finish counts as the earliest)."""
    by_entry: dict[int, list[Attempt]] = defaultdict(list)
    for a in attempts:
        if a.state == "finished":
            by_entry[a.entry].append(a)
    later: set[str] = set()
    for group in by_entry.values():
        group.sort(key=lambda a: (a.ended or date.min, a.id))
        later.update(a.id for a in group[1:])
    return later


def top_subjects(attempts: list[Attempt], tags: dict[int, list[str]]) -> list[dict]:
    subjects = Counter(name for a in attempts for name in set(tags.get(a.book_id, ())))
    return [{"name": name, "count": count} for name, count in sorted(subjects.items(), key=lambda item: (-item[1], item[0]))[:5]]


def figures(attempts: list[Attempt], tags: dict[int, list[str]], year: int, gains: dict[date, int] | None = None) -> dict:
    """The per-year figures. A reread is another finish; unknown pages are left out of the page totals and counted."""
    done = [a for a in attempts if a.state == "finished" and a.ended and a.ended.year == year]
    stopped = sum(1 for a in attempts if a.state == "dnf" and a.ended and a.ended.year == year)
    known = [a.pages for a in done if a.pages]
    months = [{"books": 0, "pages": 0} for _ in range(12)]
    for a in done:
        months[a.ended.month - 1]["books"] += 1
        months[a.ended.month - 1]["pages"] += a.pages or 0
    days = days_to_finish(done)
    median = statistics.median(days) if days else None
    later = rereads_of(attempts)
    mix = Counter(length_band(a.pages) for a in done)
    earlier = {author_key(name) for a in attempts if a.state == "finished" and a.ended and a.ended.year < year
               for name in a.authors}
    this_year = {author_key(name) for a in done for name in a.authors}
    return {
        "books": len(done), "pages": sum(known), "pages_unknown": len(done) - len(known),
        "avg_length": round(sum(known) / len(known)) if known else None,
        "median_days": int(median) if median is not None and median == int(median) else median,
        "avg_days": average_days(days), **reading_days(gains or {}, year),
        "stopped": stopped, "months": months,
        "top_subjects": top_subjects(done, tags), "rereads": sum(1 for a in done if a.id in later),
        "length_mix": {band: mix.get(band, 0) for band in (*LENGTHS, "unknown")},
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
    gains = page_gains(_progress_rows(db, user_id))
    every = [a for a in attempts if a.state == "finished"]
    pages = [a.pages for a in every if a.pages]
    return {**figures(attempts, tags, year, gains), "previous": figures(attempts, tags, year - 1, gains),
            "all_time": {"books": len(every), "pages": sum(pages), "top_subjects": top_subjects(every, tags),
                         "avg_days": average_days(days_to_finish(every)), **reading_days(gains)},
            "years_with_reading": sorted({a.ended.year for a in every if a.ended}),
            "imported_years": sorted({a.ended.year for a in every if a.ended and a.origin == "import"}),
            "shelf": shelf(db, user_id)}
