"""Owner-scoped, bounded library queries and atomic flag commands."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from database import settings
from models import Author, Book, BookTitleAlias, ImportedLibraryRecord, ReadingAttempt, UserBook, UserBookStatus, book_authors
from reading_schemas import EntryDetail, FlagUpdate, LibraryEntry, LibraryPage
from services.library_view import STATES, Filters, LibraryView


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
    # The book, its authors and its alternate titles ride in the same statement as the entries (a round trip costs ~60 ms).
    book = joinedload(UserBook.book).load_only(Book.id, Book.title, Book.cover_image_url, Book.page_count, Book.isbn13)
    return (book.joinedload(Book.authors).load_only(Author.id, Author.name), joinedload(UserBook.book).joinedload(Book.title_aliases))


def _reading_state():
    return (select(ReadingAttempt.state).where(ReadingAttempt.user_book_id == UserBook.id)
            .order_by(case((ReadingAttempt.state.in_(["reading", "paused"]), 0), else_=1),
                      ReadingAttempt.created_at.desc(), ReadingAttempt.id.desc()).limit(1).correlate(UserBook).scalar_subquery())


def entry_dto(entry, state=None, *, detail=False):
    book = entry.book
    values = dict(
        id=entry.id, book_id=entry.book_id,
        book=None if book is None else dict(id=book.id, title=book.title,
            cover_image_url=book.cover_image_url, page_count=book.page_count, isbn13=book.isbn13, english_title=book.english_title,
            authors=[dict(id=author.id, name=author.name) for author in book.authors]),
        private_title=entry.private_title, private_author=entry.private_author,
        private_description=entry.private_description, private_catalogue=entry.private_catalogue,
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
        ).options(*_summary_options())).unique().one_or_none()
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

    def _conditions(self, user_id, q, label):
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
            alias_books = select(BookTitleAlias.book_id).where(BookTitleAlias.title.ilike(pattern, escape="\\"))
            matching_books = select(Book.id).where(or_(Book.title.ilike(pattern, escape="\\"),
                Book.id.in_(author_books), Book.id.in_(alias_books)))
            conditions.append(or_(
                UserBook.private_title.ilike(pattern, escape="\\"), UserBook.private_author.ilike(pattern, escape="\\"),
                UserBook.book_id.in_(matching_books),
            ))
        return conditions

    def page(self, user_id, *, q="", facet="all", limit=25, cursor=None, label="", filters: Filters | None = None):
        f = filters or Filters(q=q, facet=facet, label=label)
        view = LibraryView(self.db)
        rows, tag_names = view.load(user_id, self._conditions(user_id, f.q, f.label), f.sort)
        # Status counts, the total and the page all describe the same set: text search + every active filter.
        matching = [row for row in rows if view.passes(row, f)]
        counts = {name: sum(1 for row in matching if view.in_facet(row, name)) for name in ("all", "owned", "want", *STATES)}
        visible = [row for row in matching if view.in_facet(row, f.facet)]
        scope = f.scope(user_id)
        ordered = view.ordered(visible, f.sort)
        if cursor:
            ordered = view.after(ordered, f.sort, view.decode(cursor, f.sort, scope))
        chosen = ordered[:limit]
        by_id = {}
        if chosen:
            by_id = {entry.id: (entry, state) for entry, state in self.db.execute(
                select(UserBook, _reading_state()).where(UserBook.user_id == user_id, UserBook.id.in_([row.id for row in chosen]))
                .options(*_summary_options())).unique().all()}
        items = []
        for row in chosen:
            if row.id in by_id:
                item = entry_dto(*by_id[row.id])
                item.finished_on = row.finished_on       # already computed by the view's single statement
                items.append(item)
        next_cursor = view.encode(f.sort, chosen[-1], scope) if len(ordered) > limit and chosen else None
        return LibraryPage(items=items, counts=counts, total=counts[f.facet], next_cursor=next_cursor,
                           facets=view.facets(rows, f, tag_names), index=view.index(visible, f.sort))

    def facet_search(self, user_id, group, q, filters: Filters):
        view = LibraryView(self.db)
        rows, tag_names = view.load(user_id, self._conditions(user_id, filters.q, filters.label))
        return {"items": view.search_facet(rows, filters, tag_names, group, q)}

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
