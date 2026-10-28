"""Reading commands serialize on the existing owner-scoped library entry."""
import hashlib
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import case, func, select, tuple_
from sqlalchemy.orm import aliased
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from models import Book, Edition, ImportedLibraryRecord, ReadingAttempt, UserBook
from reading_schemas import AttemptDetail, AttemptPage, AttemptView, ReadingResult, ReadingWorkspace
from services.library import LibraryService, _reading_state, _summary_options, entry_dto, projection


def fingerprint(values):
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


class ReadingService(LibraryService):
    def _entry(self, user_id, entry_id):
        entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.id == entry_id)
            .with_for_update().execution_options(populate_existing=True))
        if entry is None:
            raise HTTPException(404, detail="Library entry not found")
        return entry

    def _version(self, user_id, entry, expected):
        if entry.version != expected:
            self._conflict(user_id, entry.id)

    def _attempt(self, user_id, attempt_id):
        attempt = self.db.scalar(select(ReadingAttempt).join(UserBook).where(
            ReadingAttempt.id == attempt_id, UserBook.user_id == user_id)
            .execution_options(populate_existing=True))
        if attempt is None:
            raise HTTPException(404, detail="Reading record not found")
        return attempt

    def _active(self, entry_id, except_id=None):
        query = select(ReadingAttempt.id).where(ReadingAttempt.user_book_id == entry_id,
            ReadingAttempt.state.in_(["reading", "paused"]))
        if except_id is not None:
            query = query.where(ReadingAttempt.id != except_id)
        return self.db.scalar(query.limit(1))

    @staticmethod
    def _validate(attempt):
        if attempt.ended_on is not None and attempt.state not in ("finished", "dnf"):
            raise HTTPException(422, detail="Only finished or stopped readings can have an end date")
        if attempt.started_on and attempt.ended_on and attempt.ended_on < attempt.started_on:
            raise HTTPException(422, detail="End date cannot precede start date")
        if (attempt.progress_unit is None) != (attempt.progress_value is None):
            raise HTTPException(422, detail="Supply both a progress unit and value, or clear both")
        if attempt.progress_value is not None:
            maximum = 100 if attempt.progress_unit == "percent" else attempt.total_pages
            if maximum is not None and attempt.progress_value > maximum:
                raise HTTPException(422, detail="Progress exceeds the selected total")

    @staticmethod
    def _touch(entry):
        entry.version += 1
        entry.updated_at = datetime.now(timezone.utc)
        entry.status = projection(entry.is_owned, entry.is_wanted)

    def _result(self, user_id, entry_id, attempt_id):
        return ReadingResult(entry=self.detail(user_id, entry_id),
            attempt=AttemptDetail.model_validate(self._attempt(user_id, attempt_id)))

    def attempt_detail(self, user_id, attempt_id):
        # Capture context and its parent version in one SELECT snapshot. A
        # second version read could incorrectly bless an older note as current.
        row = self.db.execute(select(UserBook, ReadingAttempt, _reading_state())
            .join(ReadingAttempt, ReadingAttempt.user_book_id == UserBook.id)
            .where(UserBook.user_id == user_id, ReadingAttempt.id == attempt_id)
            .options(*_summary_options()).execution_options(populate_existing=True)).unique().one_or_none()
        if row is None:
            raise HTTPException(404, detail="Reading record not found")
        entry, attempt, state = row
        return ReadingResult(entry=entry_dto(entry, state, detail=True),
            attempt=AttemptDetail.model_validate(attempt))

    def create_attempt(self, user_id, attempt_id, data):
        entry = self._entry(user_id, data.entry_id)
        intent = fingerprint(data.model_dump(mode="json", exclude={"expected_version"}))
        existing = self.db.get(ReadingAttempt, attempt_id)
        if existing is not None:
            if existing.user_book_id != entry.id:
                raise HTTPException(404, detail="Reading record not found")
            if existing.creation_fingerprint != intent:
                raise HTTPException(409, detail="This request identifier already represents a different reading")
            return self._result(user_id, entry.id, attempt_id)
        self._version(user_id, entry, data.expected_version)
        if self._active(entry.id):
            raise HTTPException(409, detail="This book already has a current reading. Open it to continue or correct it.")
        attempt = ReadingAttempt(id=attempt_id, user_book_id=entry.id,
            **data.model_dump(exclude={"entry_id", "expected_version", "edition_id"}),
            creation_fingerprint=intent)
        book = self.db.get(Book, entry.book_id) if entry.book_id is not None else None
        edition_id = data.edition_id if "edition_id" in data.model_fields_set else book.preferred_edition_id if book else None
        edition = None
        if edition_id is not None:
            edition = self.db.scalar(select(Edition).where(Edition.id == edition_id,
                Edition.book_id == entry.book_id).with_for_update(read=True, key_share=True))
            if edition is None or book is None:
                raise HTTPException(422, detail="Select an edition of this catalogue book")
            attempt.edition_id = edition.id
            attempt.edition_source_id = edition.source_id
            attempt.edition_format = (edition.physical_format or "")[:200] or None
        if "total_pages" not in data.model_fields_set:
            source_total = edition.page_count if edition else book.page_count if book else None
            attempt.total_pages = source_total if source_total is not None and source_total > 0 else None
        self._validate(attempt)
        self.db.add(attempt)
        if data.state == "reading":
            entry.is_wanted = False
        self._touch(entry)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            # UUID collisions and database uniqueness are safeguards, not 500s.
            raise HTTPException(409, detail="Reading changed concurrently. Reload before trying again.") from None
        return self._result(user_id, entry.id, attempt_id)

    def update_attempt(self, user_id, attempt_id, data):
        attempt = self._attempt(user_id, attempt_id)
        entry = self._entry(user_id, attempt.user_book_id)
        # A deletion can finish while we wait for the parent lock. Requery
        # with ownership rather than refreshing a now-deleted ORM instance.
        attempt = self._attempt(user_id, attempt_id)
        self._version(user_id, entry, data.expected_version)
        changes = data.model_dump(exclude_unset=True, exclude={"expected_version"})
        target = changes.get("state", attempt.state)
        if attempt.state in ("finished", "dnf"):
            if target == "paused":
                raise HTTPException(422, detail="Reopen this reading before pausing it")
            if target == "reading":
                if self._active(entry.id, except_id=attempt.id):
                    raise HTTPException(409, detail="Another reading is active. Resolve it before reopening this record.")
                changes["ended_on"] = None
        candidate = SimpleNamespace(**{key: getattr(attempt, key) for key in (
            "state", "started_on", "ended_on", "progress_unit", "progress_value", "total_pages")})
        for key, value in changes.items():
            setattr(candidate, key, value)
        self._validate(candidate)
        changed = any(getattr(attempt, key) != value for key, value in changes.items())
        for key, value in changes.items():
            setattr(attempt, key, value)
        if changed:
            attempt.updated_at = datetime.now(timezone.utc)
            self._touch(entry)
        self.db.commit()
        return self._result(user_id, entry.id, attempt.id)

    def remove_attempt(self, user_id, attempt_id, data):
        attempt = self._attempt(user_id, attempt_id)
        entry = self._entry(user_id, attempt.user_book_id)
        attempt = self._attempt(user_id, attempt_id)
        self._version(user_id, entry, data.expected_version)
        self.db.delete(attempt)
        self._touch(entry)
        self.db.commit()
        return self.detail(user_id, entry.id)

    def forget_entry(self, user_id, entry_id, data):
        entry = self._entry(user_id, entry_id)
        self._version(user_id, entry, data.expected_version)
        # Database cascades remove this entry's attempts only. Catalogue rows,
        # preferences, and other readers' shelves are deliberately untouched.
        self.db.delete(entry)
        self.db.commit()

    def create_private(self, user_id, data, *, catalogue_metadata=None):
        values = data.model_dump(mode="json", exclude={"request_id"})
        values["author"] = values["author"] or None
        if catalogue_metadata is not None:
            values['catalogue'] = catalogue_metadata
        intent = fingerprint(values)
        new_id = self.db.scalar(insert(UserBook).values(user_id=user_id,
            private_title=values["title"], private_author=values["author"], private_catalogue=catalogue_metadata,
            is_owned=data.is_owned, is_wanted=data.is_wanted,
            status=projection(data.is_owned, data.is_wanted), version=1,
            create_request_id=data.request_id, creation_fingerprint=intent)
            .on_conflict_do_nothing(constraint="uq_user_book_request").returning(UserBook.id))
        entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id,
            UserBook.create_request_id == data.request_id))
        if entry.creation_fingerprint != intent:
            self.db.rollback()
            raise HTTPException(409, detail="This request identifier already represents a different private book")
        self.db.commit()
        return self.detail(user_id, new_id or entry.id)

    def private_matches(self, user_id, title):
        # Suggestions only; names are never identities and nothing is merged.
        entries = self.db.scalars(select(UserBook).where(UserBook.user_id == user_id,
            UserBook.book_id.is_(None), func.lower(UserBook.private_title) == title.strip().lower())
            .options(*_summary_options()).order_by(UserBook.id.desc()).limit(5)).unique().all()
        return [entry_dto(entry) for entry in entries]

    def workspace(self, user_id, entry_id):
        # One statement carries the entry (with its book, authors and alternate titles), its current reading and the
        # imported-source count; the book's editions are the only other trip.
        current_attempt_id = (select(ReadingAttempt.id).where(ReadingAttempt.user_book_id == UserBook.id)
            .order_by(case((ReadingAttempt.state.in_(["reading", "paused"]), 0), else_=1),
                ReadingAttempt.created_at.desc(), ReadingAttempt.id.desc()).limit(1).correlate(UserBook).scalar_subquery())
        imported = (select(func.count()).select_from(ImportedLibraryRecord)
            .where(ImportedLibraryRecord.user_id == UserBook.user_id, ImportedLibraryRecord.user_book_id == UserBook.id,
                ImportedLibraryRecord.removed.is_(False), ImportedLibraryRecord.context != {}).correlate(UserBook).scalar_subquery())
        current = aliased(ReadingAttempt)
        row = self.db.execute(select(UserBook, current, _reading_state(), imported)
            .outerjoin(current, current.id == current_attempt_id)
            .where(UserBook.user_id == user_id, UserBook.id == entry_id).options(*_summary_options())).unique().one_or_none()
        if row is None:
            raise HTTPException(404, detail="Library entry not found")
        entry, attempt, state, imported_count = row
        editions = [] if entry.book_id is None else self.db.execute(select(Edition.id, Edition.source_id,
            Edition.physical_format, Edition.page_count, Edition.languages).where(Edition.book_id == entry.book_id)
            .order_by(Edition.id).limit(5)).mappings().all()
        return ReadingWorkspace(entry=entry_dto(entry, state, detail=True),
            current_attempt=AttemptDetail.model_validate(attempt) if attempt else None,
            editions=[dict(item) for item in editions], imported_sources_count=imported_count)

    def history(self, user_id, entry_id, *, limit=25, cursor=None):
        self.detail(user_id, entry_id)  # Owner predicate before any history lookup.
        query = select(ReadingAttempt).where(ReadingAttempt.user_book_id == entry_id)
        if cursor is not None:
            anchor = self.db.scalar(select(ReadingAttempt).where(ReadingAttempt.id == cursor,
                ReadingAttempt.user_book_id == entry_id))
            if anchor is None:
                raise HTTPException(422, detail="Invalid reading cursor. Return to the first page.")
            query = query.where(tuple_(ReadingAttempt.created_at, ReadingAttempt.id) < (anchor.created_at, anchor.id))
        rows = self.db.scalars(query.order_by(ReadingAttempt.created_at.desc(), ReadingAttempt.id.desc()).limit(limit + 1)).all()
        return AttemptPage(items=[AttemptView.model_validate(row) for row in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None)

    def home(self, user_id):
        def count(state):
            return (select(func.count()).select_from(ReadingAttempt).join(UserBook, ReadingAttempt.user_book_id == UserBook.id)
                .where(UserBook.user_id == user_id, ReadingAttempt.state == state).scalar_subquery())
        # One statement: the books being read plus both counts as columns. Only a reader with nothing in progress
        # (no rows to carry the counts) needs a second.
        rows = self.db.execute(select(UserBook, ReadingAttempt, count("reading"), count("paused")).join(ReadingAttempt)
            .where(UserBook.user_id == user_id, ReadingAttempt.state == "reading")
            .options(*_summary_options()).order_by(ReadingAttempt.updated_at.desc(), ReadingAttempt.id.desc()).limit(3)).unique().all()
        if rows:
            reading_count, paused_count = rows[0][2], rows[0][3]
        else:
            reading_count, paused_count = self.db.execute(select(count("reading"), count("paused"))).one()
        return {"current_reads": [{"entry": entry_dto(entry, "reading"), "attempt": AttemptView.model_validate(attempt)}
            for entry, attempt, *_ in rows], "reading_count": reading_count, "paused_count": paused_count}
