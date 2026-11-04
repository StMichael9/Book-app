"""My Books at scale: filters, sorts, facet counts and the A-Z index for one reader's library.

One request reads a compact row per entry (five owner-scoped statements, however many filters are active), then filters,
sorts, counts and pages them here. A reader's library is thousands of rows, not millions, and every figure (the status
counts, the facet counts "under the other filters", the index) comes from the same rows, so they cannot disagree.
Only the page being returned is loaded in full by the caller.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import unicodedata
from dataclasses import dataclass
from functools import cached_property, lru_cache
from datetime import date

from fastapi import HTTPException
from sqlalchemy import ARRAY, Boolean, Date, DateTime, Integer, Text, case, cast, func, literal_column, null, or_, select, union_all
from sqlalchemy.dialects.postgresql import JSONB, aggregate_order_by, array_agg

from database import settings
from models import (
    Author, Book, BookTitleAlias, ImportedLibraryRecord, ReadingAttempt, Tag, TagType, UserBook, book_authors, book_tags,
)
from services.catalogue_resolver import surname

SORTS = ("added", "title", "author", "finished", "updated")
LENGTHS = ("short", "medium", "long")
LENGTH_LABELS = {"short": "Short", "medium": "Medium", "long": "Long"}
STATES = ("reading", "paused", "finished", "dnf")
SUBJECT_TYPES = (TagType.genre, TagType.topic, TagType.form, TagType.audience)
FACET_CAP = 50
FACET_GROUPS = ("subject", "author", "year_finished", "length", "source_label")
LAST = "\U0010ffff"  # sorts after every real author or title


_COMBINING = re.compile("[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]")
_WORDS = re.compile(r"[^\W_]+")


@lru_cache(maxsize=1 << 16)
def fold(value: str) -> str:
    """Case- and accent-insensitive form used for matching and sorting."""
    return _COMBINING.sub("", unicodedata.normalize("NFKD", value or "")).casefold().strip()


@lru_cache(maxsize=1 << 16)
def norm_name(value: str) -> str:
    return " ".join(_WORDS.findall(fold(value)))


@lru_cache(maxsize=1 << 16)
def author_sort_key(name: str | None) -> str:
    return f"{surname(name)}\x00{norm_name(name)}" if name and norm_name(name) else LAST


def length_of(pages) -> str | None:
    if not pages or pages <= 0:
        return None
    return "short" if pages < 250 else "medium" if pages <= 450 else "long"


def index_letter(key: str) -> str:
    first = key[:1].upper()
    return first if "A" <= first <= "Z" else "#"


@dataclass(frozen=True)
class Filters:
    q: str = ""
    facet: str = "all"
    label: str = ""
    owned: bool = False
    sort: str = "added"
    subject: tuple = ()
    author: tuple = ()
    year_finished: tuple = ()
    length: tuple = ()
    source_label: tuple = ()
    has_note: bool | None = None
    imported_since: date | None = None

    @cached_property
    def author_set(self) -> frozenset:
        return frozenset(norm_name(name) for name in self.author)

    def scope(self, user_id) -> str:
        payload = [str(user_id), self.q.strip(), self.facet, self.label, self.owned, self.sort, sorted(self.subject),
                   sorted(self.author), sorted(self.year_finished), sorted(self.length), sorted(self.source_label),
                   self.has_note, self.imported_since.isoformat() if self.imported_since else None]
        return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


class Row:
    __slots__ = ("id", "owned", "wanted", "state", "title_key", "author_key", "author_labels", "subjects", "years",
                 "finished_on", "updated_at", "length", "labels", "has_note", "imported_on")


class LibraryView:
    def __init__(self, db):
        self.db = db

    # --- loading ---------------------------------------------------------------------------------------------------

    def load(self, user_id, conditions, sort: str = "added") -> tuple[list[Row], dict[int, str]]:
        """A compact row per entry matching the text search.

        Five independent, simple reads (entries, authors, subject tags, reading figures, import labels) sent as ONE
        statement with UNION ALL over a fixed set of typed columns: a round trip costs ~60 ms on the hosted database, and
        joining the reads to each other in SQL gave the planner room to choose very slow plans on a freshly loaded
        library. Columns: (kind, key, c1..c12), each branch filling the ones it needs."""
        mine = select(UserBook.book_id).where(UserBook.user_id == user_id, UserBook.book_id.is_not(None))
        mine_entries = select(UserBook.id).where(UserBook.user_id == user_id)
        blank = null()
        types = (Integer, Boolean, Boolean, Text, Text, Boolean, DateTime(timezone=True), Text, ARRAY(Integer), Date, JSONB, Integer)

        def branch(letter, key, **named):
            """Columns c1..c12 by position; unnamed ones are typed NULLs so every branch lines up."""
            columns = [literal_column(f"'{letter}'").label("kind"), key.label("key")]
            for n, kind_ in enumerate(types, start=1):
                value = named.get(f"c{n}")
                columns.append((cast(blank, kind_) if value is None else value).label(f"c{n}"))
            return columns

        entries = select(*branch(
            "e", UserBook.id, c1=UserBook.book_id, c2=UserBook.is_owned, c3=UserBook.is_wanted, c4=UserBook.private_title,
            c5=UserBook.private_author, c6=func.btrim(func.coalesce(UserBook.save_note, "")) != "",
            c7=UserBook.updated_at, c8=Book.title, c12=Book.page_count)).select_from(UserBook).outerjoin(
            Book, Book.id == UserBook.book_id).where(*conditions)
        authors = select(*branch("a", book_authors.c.book_id, c8=Author.name)).select_from(book_authors).join(
            Author, Author.id == book_authors.c.author_id).where(book_authors.c.book_id.in_(mine))
        subjects = select(*branch("t", book_tags.c.book_id, c1=Tag.id, c8=Tag.name)).select_from(book_tags).join(
            Tag, Tag.id == book_tags.c.tag_id).where(Tag.type.in_(SUBJECT_TYPES), book_tags.c.book_id.in_(mine))
        priority = case((ReadingAttempt.state.in_(["reading", "paused"]), 0), else_=1)
        finished = ReadingAttempt.state == "finished"
        attempts = select(*branch(
            "s", ReadingAttempt.user_book_id,
            c12=func.max(ReadingAttempt.total_pages),
            c6=func.bool_or(func.btrim(func.coalesce(ReadingAttempt.note, "")) != ""),
            c8=array_agg(aggregate_order_by(ReadingAttempt.state, priority, ReadingAttempt.created_at.desc(),
                                            ReadingAttempt.id.desc()))[1],
            c9=cast(array_agg(func.distinct(func.extract("year", ReadingAttempt.ended_on))).filter(
                finished, ReadingAttempt.ended_on.is_not(None)), ARRAY(Integer)),
            c10=func.max(ReadingAttempt.ended_on).filter(finished))).select_from(ReadingAttempt).where(
            ReadingAttempt.user_book_id.in_(mine_entries)).group_by(ReadingAttempt.user_book_id)
        imports = select(*branch(
            "i", ImportedLibraryRecord.user_book_id, c7=func.max(ImportedLibraryRecord.created_at),
            c11=func.jsonb_agg(ImportedLibraryRecord.context["labels"]))).select_from(ImportedLibraryRecord).where(
            ImportedLibraryRecord.user_id == user_id, ImportedLibraryRecord.user_book_id.is_not(None)).group_by(
            ImportedLibraryRecord.user_book_id)
        result = self.db.execute(union_all(entries, authors, subjects, attempts, imports)).all()

        entry_data = []
        authors_of: dict[int, list[str]] = {}
        tags_of: dict[int, set[int]] = {}
        tag_names: dict[int, str] = {}
        facts: dict = {}
        imported: dict = {}
        for letter, key, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12 in result:
            if letter == "e":
                entry_data.append((key, c1, c2, c3, c4, c5, c6, c7, c8, c12))
            elif letter == "a":
                authors_of.setdefault(key, []).append(c8)
            elif letter == "t":
                tags_of.setdefault(key, set()).add(c1)
                tag_names[c1] = c8
            elif letter == "s":
                facts[key] = (c8, c9, c10, c6, c12)
            else:
                imported[key] = (c11, c7)
        rows = []
        for entry_id, book_id, owned, wanted, private_title, private_author, has_save_note, updated, title, pages in entry_data:
            row = Row()
            row.id, row.owned, row.wanted, row.updated_at = entry_id, bool(owned), bool(wanted), updated.isoformat()
            state, years, finished_on, attempt_note, attempt_pages = facts.get(entry_id, (None, None, None, False, None))
            row.state = state
            row.finished_on = finished_on.isoformat() if finished_on else None
            row.years = set(years or ())
            names = authors_of.get(book_id, []) if book_id is not None else []
            if not names and private_author:
                names = [private_author]
            row.author_labels = {}
            for name in names:
                row.author_labels.setdefault(norm_name(name), name)
            row.author_key = author_sort_key(names[0] if names else None) if sort == "author" else None
            row.title_key = (fold(title or private_title or "") or LAST) if sort == "title" else None
            row.subjects = tags_of.get(book_id, set()) if book_id is not None else set()
            row.length = length_of(pages or attempt_pages)
            row.has_note = bool(has_save_note) or bool(attempt_note)
            label_lists, imported_at = imported.get(entry_id, (None, None))
            row.labels = {label for labels in label_lists or () if isinstance(labels, list)
                          for label in labels if isinstance(label, str)}
            row.imported_on = imported_at.date() if imported_at else None
            rows.append(row)
        return rows, tag_names

    # --- filtering and counting --------------------------------------------------------------------------------------

    @staticmethod
    def passes(row: Row, f: Filters, skip: str | None = None) -> bool:
        """Every active filter except the group named in `skip` (the facet rule: a group counts under the others)."""
        if f.owned and not row.owned:
            return False
        if skip != "subject" and f.subject and not row.subjects.intersection(f.subject):
            return False
        if skip != "author" and f.author and not f.author_set.intersection(row.author_labels):
            return False
        if skip != "year_finished" and f.year_finished and not row.years.intersection(f.year_finished):
            return False
        if skip != "length" and f.length and row.length not in f.length:
            return False
        if skip != "source_label" and f.source_label and not row.labels.intersection(f.source_label):
            return False
        if f.has_note is not None and row.has_note != f.has_note:
            return False
        if f.imported_since is not None and not (row.imported_on and row.imported_on >= f.imported_since):
            return False
        return True

    @staticmethod
    def in_facet(row: Row, facet: str) -> bool:
        return {"all": True, "owned": row.owned, "want": row.wanted}.get(facet, row.state == facet)

    def facets(self, rows: list[Row], f: Filters, tag_names: dict[int, str], only: str | None = None,
               cap: int | None = FACET_CAP) -> dict:
        base = [row for row in rows if self.in_facet(row, f.facet)]
        out: dict = {}
        for group in FACET_GROUPS:
            if only and group != only:
                continue
            counts: dict = {}
            labels: dict = {}
            for row in base:
                if not self.passes(row, f, skip=group):
                    continue
                if group == "subject":
                    options = {tag_id: tag_names.get(tag_id, str(tag_id)) for tag_id in row.subjects}
                elif group == "author":
                    options = row.author_labels
                elif group == "year_finished":
                    options = {year: str(year) for year in row.years}
                elif group == "length":
                    options = {row.length: LENGTH_LABELS[row.length]} if row.length else {}
                else:
                    options = {label: label for label in row.labels}
                for value, label in options.items():
                    counts[value] = counts.get(value, 0) + 1
                    labels.setdefault(value, label)
            if group == "length":
                items = [{"value": v, "label": LENGTH_LABELS[v], "count": counts.get(v, 0)} for v in LENGTHS]
            elif group == "year_finished":
                items = [{"value": v, "label": labels[v], "count": c} for v, c in sorted(counts.items(), reverse=True)]
            else:
                items = [{"value": v, "label": labels[v], "count": c}
                         for v, c in sorted(counts.items(), key=lambda kv: (-kv[1], fold(labels[kv[0]])))]
            out[group] = items if cap is None else items[:cap]  # the top options by count; in-facet search finds the rest
        return out

    def search_facet(self, rows, f: Filters, tag_names, group: str, q: str) -> list[dict]:
        needle = fold(q)
        items = self.facets(rows, f, tag_names, only=group, cap=None)[group]
        if needle:
            def hit(item):
                label = fold(item["label"])
                return label.startswith(needle) or any(word.startswith(needle) for word in re.findall(r"[^\W_]+", label))
            items = [item for item in items if hit(item)]
        return sorted(items, key=lambda item: (-item["count"], fold(item["label"])))[:FACET_CAP]

    # --- sorting and paging --------------------------------------------------------------------------------------------

    @staticmethod
    def sort_key(row: Row, sort: str):
        if sort == "title":
            return (row.title_key, row.id), False
        if sort == "author":
            return (row.author_key, row.id), False
        if sort == "finished":
            return (row.finished_on or "", row.id), True
        if sort == "updated":
            return (row.updated_at, row.id), True
        return (row.id,), True

    def cursor_value(self, row: Row, sort: str):
        return list(self.sort_key(row, sort)[0])

    def after(self, rows: list[Row], sort: str, last: list) -> list[Row]:
        """The rows strictly after the cursor position in this sort's order (keyset paging: stable under inserts)."""
        descending = self.sort_key(rows[0], sort)[1] if rows else False
        position = tuple(last)
        try:
            return [row for row in rows if (self.sort_key(row, sort)[0] < position if descending
                                            else self.sort_key(row, sort)[0] > position)]
        except TypeError:
            raise invalid_cursor() from None

    def encode(self, sort: str, row: Row, scope: str) -> str:
        payload = json.dumps([2, sort, self.cursor_value(row, sort), scope], separators=(",", ":")).encode()
        signature = hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")

    @staticmethod
    def decode(cursor: str, sort: str, scope: str) -> list:
        try:
            raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
            signature, payload = raw[:32], raw[32:]
            if not hmac.compare_digest(signature, hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest()):
                raise ValueError()
            version, saved_sort, last, saved_scope = json.loads(payload)
            if version != 2 or saved_sort != sort or saved_scope != scope or not isinstance(last, list) or not last:
                raise ValueError()
            return last
        except (ValueError, TypeError, UnicodeError):
            raise invalid_cursor() from None

    def ordered(self, rows: list[Row], sort: str) -> list[Row]:
        descending = self.sort_key(rows[0], sort)[1] if rows else False
        return sorted(rows, key=lambda row: self.sort_key(row, sort)[0], reverse=descending)

    def index(self, rows: list[Row], sort: str) -> dict | None:
        if sort not in ("title", "author"):
            return None
        counts = {chr(code): 0 for code in range(ord("A"), ord("Z") + 1)}
        counts["#"] = 0
        for row in rows:
            key = row.title_key if sort == "title" else row.author_key
            counts[index_letter("" if key == LAST else key)] += 1
        return counts


def invalid_cursor() -> HTTPException:
    return HTTPException(422, detail={"code": "invalid_cursor", "message": "Invalid library cursor. Return to the first page."})
