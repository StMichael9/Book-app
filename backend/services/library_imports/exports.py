"""Bounded, owner-only CSV portability, NOT a complete database backup.

One read-only snapshot and two streaming database passes establish Content-Length
before returning headers. A truncated network response cannot look like a complete
download. Neither pass retains the collection or writes a temporary file.
"""
import csv
import io
import json
from time import monotonic

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by

COLUMNS = ("version", "record_id", "attempt_id", "title", "author", "isbn13", "work_source_id", "status",
    "owned", "wanted", "started_on", "finished_on", "format", "page_count", "private_note", "description", "csv_escaped_fields")


def csv_line(values, *, columns=COLUMNS, escape_metadata=True):
    row, escaped = [], []
    for field in (columns[:-1] if escape_metadata else columns):
        value = str(values.get(field) if values.get(field) is not None else "")
        if value and (value[0] in "=+-@\t\r\n" or value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))):
            escaped.append(field)
            value = "'" + value
        row.append(value)
    if escape_metadata:
        row.append(json.dumps(escaped, separators=(",", ":")) if escaped else "")
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="\r\n").writerow(row)
    return stream.getvalue().encode("utf-8")


def _query(user_id):
    # Keep pure CSV encoding importable before application/test DB setup.
    from models import Author, Book, EditionISBN, ReadingAttempt, UserBook, book_authors
    authors = select(func.array_agg(aggregate_order_by(Author.name, Author.name, Author.id))).select_from(book_authors.join(Author))\
        .where(book_authors.c.book_id == UserBook.book_id).correlate(UserBook).scalar_subquery()
    edition_isbn = select(func.min(EditionISBN.isbn13)).where(EditionISBN.edition_id == ReadingAttempt.edition_id)\
        .correlate(ReadingAttempt).scalar_subquery()
    return (select(UserBook.id.label("entry_id"), UserBook.private_title, UserBook.private_author,
        UserBook.private_description, UserBook.is_owned, UserBook.is_wanted, Book.title, authors.label("author"), Book.source_id,
        func.coalesce(edition_isbn, Book.isbn13).label("isbn13"), ReadingAttempt.id.label("attempt_id"),
        ReadingAttempt.state, ReadingAttempt.started_on, ReadingAttempt.ended_on, ReadingAttempt.edition_format,
        ReadingAttempt.total_pages, ReadingAttempt.note).select_from(UserBook).outerjoin(Book).outerjoin(ReadingAttempt)
        .where(UserBook.user_id == user_id).order_by(UserBook.id, ReadingAttempt.id))


def _values(row):
    return {"version": "1", "record_id": f"bv-entry-{row.entry_id}",
        "attempt_id": f"bv-attempt-{row.attempt_id}" if row.attempt_id else "",
        "title": row.title if row.title is not None else row.private_title,
        "author": ", ".join(row.author or []) if row.title is not None else row.private_author,
        "isbn13": row.isbn13, "work_source_id": row.source_id,
        "status": row.state or ("want" if row.is_wanted else ""),
        "owned": "true" if row.is_owned else "false", "wanted": "true" if row.is_wanted else "false",
        "started_on": row.started_on, "finished_on": row.ended_on, "format": row.edition_format,
        "page_count": row.total_pages, "private_note": row.note,
        "description": row.private_description if row.title is None else None}


class CsvLibraryExport:
    def __init__(self, engine, user_id, *, report_id=None):
        self.connection = engine.connect().execution_options(isolation_level="REPEATABLE READ")
        self.deadline = monotonic() + 120
        self.closed = False
        try:
            self.connection.begin()
            self.connection.execute(text("SET TRANSACTION READ ONLY"))
            self.connection.execute(text("SET LOCAL statement_timeout = '15s'"))
            self.connection.execute(text("SET LOCAL idle_in_transaction_session_timeout = '60s'"))
            if report_id is None:
                self.query, self.columns, self.mapper = _query(user_id), COLUMNS, _values
            else:
                from library_import_models import LibraryImportRow
                self.query = select(LibraryImportRow.ordinal.label("row"), LibraryImportRow.disposition.label("result"),
                    LibraryImportRow.error_code.label("issue"), LibraryImportRow.result_entry_id.label("entry_id"))\
                    .where(LibraryImportRow.user_id == user_id, LibraryImportRow.run_id == report_id).order_by(LibraryImportRow.ordinal)
                self.columns, self.mapper = ("row", "result", "issue", "entry_id"), lambda row: row._mapping
            self.query = self.query.execution_options(yield_per=100)
            self.escape_metadata = report_id is None
            stream = io.StringIO(newline="")
            csv.writer(stream, lineterminator="\r\n").writerow(self.columns)
            self.header = stream.getvalue().encode("utf-8")
            self.length, count = len(self.header), 0
            with self.connection.execute(self.query) as rows:
                for row in rows:
                    self._time()
                    count += 1
                    self.length += len(self._line(row))
                    if count > 20000 or self.length > 20 * 1024 * 1024:
                        raise HTTPException(413, detail={"code": "csv_export_limit", "message": "This library exceeds the CSV portability limits. Download your private reading-data JSON instead; nothing has been truncated."})
        except BaseException:
            self.close()
            raise

    def _time(self):
        if monotonic() > self.deadline:
            raise TimeoutError("CSV export time budget exceeded")

    def _line(self, row):
        return csv_line(self.mapper(row), columns=self.columns, escape_metadata=self.escape_metadata)

    def stream(self):
        try:
            yield self.header
            with self.connection.execute(self.query) as rows:
                for row in rows:
                    self._time()
                    yield self._line(row)
        finally:
            self.close()

    def close(self):
        if not self.closed:
            self.closed = True
            self.connection.close()
