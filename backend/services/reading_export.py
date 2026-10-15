"""Owner-only JSONL export: one read-only snapshot, bounded server memory.

No archive or temporary file is retained. A missing final complete record means
an interrupted export; the browser must not offer that partial file as success.
"""
import json
from datetime import datetime, timezone
from time import monotonic

from sqlalchemy import func, select, text

from models import Author, Book, ReadingAttempt, Tag, UserBook, UserPreference, book_authors


def _line(record):
    return json.dumps(record, ensure_ascii=False, default=str, separators=(",", ":")) + "\n"


def stream_reading_export(engine, user_id, *, batch_size=100):
    deadline = monotonic() + 120
    entry = UserBook.__table__
    attempt = ReadingAttempt.__table__
    preference = UserPreference.__table__
    # A correlated aggregate avoids one author lookup per personal book.
    authors = select(func.array_agg(Author.name)).select_from(book_authors.join(Author))\
        .where(book_authors.c.book_id == entry.c.book_id).correlate(entry).scalar_subquery()
    queries = (
        ("entry", select(entry.c.id, entry.c.book_id, entry.c.private_title, entry.c.private_author,
            entry.c.is_owned, entry.c.is_wanted, entry.c.save_note, entry.c.version,
            entry.c.created_at, entry.c.updated_at, Book.title.label("catalogue_title"),
            Book.source_id.label("catalogue_source_id"), Book.isbn13.label("catalogue_isbn13"),
            authors.label("catalogue_authors")).select_from(entry.outerjoin(Book))
            .where(entry.c.user_id == user_id).order_by(entry.c.id)),
        # Explicit format-version allowlist: future internal columns must not
        # silently become downloadable merely because the ORM grows.
        ("reading", select(*(attempt.c[name] for name in (
            "id", "user_book_id", "state", "started_on", "ended_on", "progress_unit",
            "progress_value", "total_pages", "edition_id", "edition_source_id", "edition_format",
            "note", "reaction", "started_via", "origin", "created_at", "updated_at")))
            .join(entry, attempt.c.user_book_id == entry.c.id)
            .where(entry.c.user_id == user_id).order_by(attempt.c.user_book_id, attempt.c.id)),
        ("preference", select(preference.c.id, preference.c.tag_id, preference.c.source_text,
            preference.c.created_at, Tag.name, Tag.type).join(Tag)
            .where(preference.c.user_id == user_id).order_by(preference.c.id)),
    )
    counts = {}
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL statement_timeout = '15s'"))
            connection.execute(text("SET LOCAL idle_in_transaction_session_timeout = '60s'"))
            # Establish the snapshot before yielding any response data.
            connection.execute(text("SELECT 1 FROM user_books WHERE user_id = :owner LIMIT 1"), {"owner": user_id})
            yield _line({"type": "metadata", "format_version": 1, "scope": "reading_library_and_preferences",
                "exported_at": datetime.now(timezone.utc).isoformat(), "consistency": "snapshot"})
            for kind, query in queries:
                count = 0
                with connection.execute(query.execution_options(yield_per=batch_size)) as rows:
                    for row in rows.mappings():
                        if monotonic() > deadline:
                            raise TimeoutError("Reading export exceeded its time budget")
                        values = dict(row)
                        if kind == "preference":
                            values["type"] = values["type"].value
                        yield _line({"type": kind, "data": values})
                        count += 1
                counts[kind] = count
            yield _line({"type": "complete", "format_version": 1, "counts": counts})
