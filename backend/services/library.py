"""Owner-scoped, bounded library queries and atomic flag commands."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from database import settings
from models import Author, Book, ImportedLibraryRecord, ReadingAttempt, UserBook, UserBookStatus, book_authors
from reading_schemas import EntryDetail, FlagUpdate, LibraryEntry, LibraryPage


def reading_enabled(user_id) -> bool:
    allowed = settings.reading_v3_user_ids.split(",") if settings.reading_v3_user_ids else []
    return settings.reading_v3_enabled and (not allowed or str(user_id) in allowed)


def library_needs_v3(db: Session, user_id) -> bool:
    return bool(db.scalar(select(UserBook.id).where(UserBook.user_id == user_id,
        or_(UserBook.book_id.is_(None), UserBook.save_note.is_not(None),
            UserBook.is_owned == UserBook.is_wanted, has_history(UserBook.id), has_imports(UserBook.id))).limit(1)))


def require_reading(user_id, db=None, *, write=False):
    if not reading_enabled(user_id) and (write or db is None or not library_needs_v3(db, user_id)):
        raise HTTPException(403, detail={"code": "reading_disabled", "message": "The reading library is not enabled for this account."})


def projection(owned, wanted):
    return UserBookStatus.owned if owned else UserBookStatus.want if wanted else None


def has_history(entry_id):
    return select(ReadingAttempt.id).where(ReadingAttempt.user_book_id == entry_id).exists()


def has_imports(entry_id):
    return select(ImportedLibraryRecord.id).where(ImportedLibraryRecord.user_book_id == entry_id).exists()


def legacy_write_guard(db: Session, user_id, book_id):
    # Keep this guard even after disabling the pilot; feature-off cannot erase history.
    entry = db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.book_id == book_id).with_for_update().execution_options(populate_existing=True))
    richer = entry is not None and (entry.save_note is not None or entry.is_owned == entry.is_wanted or db.scalar(select(has_history(entry.id))) or db.scalar(select(has_imports(entry.id))))
    if reading_enabled(user_id) or richer:
        raise HTTPException(409, detail="Your library now uses independent Own and Want controls. Refresh this page before making changes.")


def _summary_options():
    return joinedload(UserBook.book).load_only(Book.id, Book.title, Book.cover_image_url, Book.page_count, Book.isbn13).selectinload(Book.authors).load_only(Author.id, Author.name)


def _reading_state():
    return (select(ReadingAttempt.state).where(ReadingAttempt.user_book_id == UserBook.id)
            .order_by(case((ReadingAttempt.state.in_(["reading", "paused"]), 0), else_=1),
                      ReadingAttempt.created_at.desc(), ReadingAttempt.id.desc()).limit(1).correlate(UserBook).scalar_subquery())


def entry_dto(entry, state=None, *, detail=False):
    book = entry.book
    values = dict(
        id=entry.id, book_id=entry.book_id,
        book=None if book is None else dict(id=book.id, title=book.title,
            cover_image_url=book.cover_image_url, page_count=book.page_count, isbn13=book.isbn13,
            authors=[dict(id=author.id, name=author.name) for author in book.authors]),
        private_title=entry.private_title, private_author=entry.private_author,
        private_catalogue=entry.private_catalogue,
        is_owned=entry.is_owned, is_wanted=entry.is_wanted, version=entry.version,
        reading_state=state, created_at=entry.created_at, updated_at=entry.updated_at,
    )
    return EntryDetail(**values, save_note=entry.save_note) if detail else LibraryEntry(**values)


class LibraryService:
    def __init__(self, db: Session):
        self.db = db

    def detail(self, user_id, entry_id):
        row = self.db.execute(select(UserBook, _reading_state()).where(
            UserBook.user_id == user_id, UserBook.id == entry_id,
        ).options(_summary_options())).one_or_none()
        if row is None:
            raise HTTPException(404, detail="Library entry not found")
        return entry_dto(*row, detail=True)

    def lookup(self, user_id, book_ids):
        rows = self.db.execute(select(UserBook.book_id, UserBook.id, UserBook.version,
            UserBook.is_owned, UserBook.is_wanted, _reading_state()).where(
            UserBook.user_id == user_id, UserBook.book_id.in_(book_ids),
        )).all()
        found = {row[0]: row for row in rows}
        # Include every requested ID so absent is distinct from an unverified lookup.
        return [{"book_id": book_id, "entry_id": found[book_id][1] if book_id in found else None,
                 "version": found[book_id][2] if book_id in found else None,
                 "is_owned": found[book_id][3] if book_id in found else False,
                 "is_wanted": found[book_id][4] if book_id in found else False,
                 "reading_state": found[book_id][5] if book_id in found else None} for book_id in book_ids]

    def page(self, user_id, *, q="", facet="all", limit=25, cursor=None, label=""):
        pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conditions = [UserBook.user_id == user_id]
        if label:
            conditions.append(select(ImportedLibraryRecord.id).where(ImportedLibraryRecord.user_id == user_id,
                ImportedLibraryRecord.user_book_id == UserBook.id, ImportedLibraryRecord.context["labels"].contains([label])).exists())
        if q.strip():
            # Uncorrelated ID sets avoid nested relationship EXISTS inside an
            # OR: that shape can inflate planner/JIT cost on large libraries.
            # Owner scoping remains on UserBook, including private records.
            author_books = select(book_authors.c.book_id).join(Author,
                Author.id == book_authors.c.author_id).where(Author.name.ilike(pattern, escape="\\"))
            matching_books = select(Book.id).where(or_(Book.title.ilike(pattern, escape="\\"),
                Book.id.in_(author_books)))
            conditions.append(or_(
                UserBook.private_title.ilike(pattern, escape="\\"), UserBook.private_author.ilike(pattern, escape="\\"),
                UserBook.book_id.in_(matching_books),
            ))
        facet_conditions = {"all": True, "owned": UserBook.is_owned.is_(True), "want": UserBook.is_wanted.is_(True)}
        # Status shelves describe one current/latest reading, not every state
        # ever recorded. Keep older attempts intact in the book's history.
        ranked = select(ReadingAttempt.user_book_id, ReadingAttempt.state,
            func.row_number().over(partition_by=ReadingAttempt.user_book_id,
                order_by=(case((ReadingAttempt.state.in_(["reading", "paused"]), 0), else_=1),
                          ReadingAttempt.created_at.desc(), ReadingAttempt.id.desc())).label("position")
        ).where(ReadingAttempt.user_book_id.in_(select(UserBook.id).where(UserBook.user_id == user_id))).subquery()
        current = select(ranked.c.user_book_id, ranked.c.state).where(ranked.c.position == 1).subquery()
        facet_conditions.update({state: UserBook.id.in_(select(current.c.user_book_id).where(current.c.state == state))
            for state in ("reading", "paused", "finished", "dnf")})
        count_query = select(*[func.count(UserBook.id).filter(facet_conditions[name]).label(name)
            for name in ("all", "owned", "want")]).where(*conditions)
        counts = dict(self.db.execute(count_query).mappings().one())
        history_counts = dict(self.db.execute(select(current.c.state, func.count(UserBook.id))
            .join(UserBook, current.c.user_book_id == UserBook.id).where(*conditions).group_by(current.c.state)).all())
        counts.update({state: history_counts.get(state, 0) for state in ("reading", "paused", "finished", "dnf")})
        cursor_scope = [str(user_id), q.strip(), facet] + ([label] if label else [])
        scope = hashlib.sha256(json.dumps(cursor_scope, separators=(",", ":")).encode()).hexdigest()
        if cursor:
            anchor, last = self._decode_cursor(cursor, scope)
        else:
            anchor = self.db.scalar(select(func.max(UserBook.id)).where(UserBook.user_id == user_id)) or 0
            last = anchor + 1
        query = select(UserBook, _reading_state()).where(*conditions, facet_conditions[facet],
            UserBook.id <= anchor, UserBook.id < last).options(_summary_options()).order_by(UserBook.id.desc()).limit(limit + 1)
        rows = self.db.execute(query).all()
        items = [entry_dto(*row) for row in rows[:limit]]
        next_cursor = self._encode_cursor(anchor, items[-1].id, scope) if len(rows) > limit else None
        return LibraryPage(items=items, counts=counts, total=counts[facet], next_cursor=next_cursor)

    def _encode_cursor(self, anchor, last, scope):
        payload = json.dumps([1, anchor, last, scope], separators=(",", ":")).encode()
        signature = hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")

    def _decode_cursor(self, cursor, scope):
        try:
            raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
            signature, payload = raw[:32], raw[32:]
            expected = hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected):
                raise ValueError()
            version, anchor, last, saved_scope = json.loads(payload)
            if version != 1 or saved_scope != scope or type(anchor) is not int or type(last) is not int or not (0 < last <= anchor + 1):
                raise ValueError()
            return anchor, last
        except (ValueError, TypeError, UnicodeError):
            raise HTTPException(422, detail="Invalid library cursor. Return to the first page.") from None

    def _conflict(self, user_id, entry_id):
        current = self.detail(user_id, entry_id).model_dump(mode="json")
        raise HTTPException(409, detail={"code": "entry_changed", "message": "Your library changed on another page. Review its current state and try again.", "current": current})

    def ensure(self, user_id, book_id, data: FlagUpdate):
        if self.db.get(Book, book_id) is None:
            raise HTTPException(404, detail="Book not found")
        owned, wanted = data.is_owned or False, data.is_wanted or False
        new_id = self.db.scalar(insert(UserBook).values(user_id=user_id, book_id=book_id,
            is_owned=owned, is_wanted=wanted, status=projection(owned, wanted), version=1)
            .on_conflict_do_nothing(constraint="uq_user_book").returning(UserBook.id))
        if new_id is not None and data.expected_version is not None:
            self.db.rollback()
            raise HTTPException(409, detail={"code": "entry_removed", "message": "This saved entry was removed. Reload its state before adding it again."})
        entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.book_id == book_id).with_for_update().execution_options(populate_existing=True))
        if new_id is None:
            self._change_flags(user_id, entry, data, allow_noop=True)
        self.db.commit()
        return self.detail(user_id, entry.id)

    def update(self, user_id, entry_id, data):
        entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.id == entry_id).with_for_update().execution_options(populate_existing=True))
        if entry is None:
            raise HTTPException(404, detail="Library entry not found")
        self._change_flags(user_id, entry, data)
        self.db.commit()
        return self.detail(user_id, entry.id)

    def _change_flags(self, user_id, entry, data, allow_noop=False):
        changes = {name: getattr(data, name) for name in ("is_owned", "is_wanted", "save_note") if name in data.model_fields_set}
        changed = any(getattr(entry, name) != value for name, value in changes.items())
        if allow_noop and not changed and data.expected_version is None:
            return
        if data.expected_version != entry.version:
            self._conflict(user_id, entry.id)
        if changed:
            for name, value in changes.items():
                setattr(entry, name, value)
            entry.status = projection(entry.is_owned, entry.is_wanted)
            entry.version += 1
            entry.updated_at = datetime.now(timezone.utc)
