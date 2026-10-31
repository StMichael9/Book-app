"""A description column in an imported spreadsheet is kept on the reader's own (private) entries only."""
import csv
import io
from uuid import uuid4

import pytest
from sqlalchemy import select

from services.library_imports.formats import clean_description, inspect_headers, normalize_row
from test_library_import_workflow import analyzed, apply, importing, seal, start  # noqa: F401


def row(headers, cells):
    inspected = inspect_headers(headers)
    return normalize_row(inspected["source"], headers, inspected["mapping"], cells)


@pytest.mark.parametrize("header", ["Description", "summary", "Synopsis", "BLURB", "Book Description"])
def test_description_column_aliases_are_picked_up(header):
    assert row(["Title", "Author", header], ["A Book", "An Author", "A short story."])["description"] == "A short story."


def test_html_is_stripped_entities_decoded_and_whitespace_tidied():
    assert clean_description("<p>First &amp; <b>best</b></p><p>Second<br/>line</p>") == "First & best\nSecond\nline"
    assert clean_description("  <script>x</script>  plain   text \n\n\n\n end ") == "x plain text\n\nend"
    assert row(["Title", "Description"], ["T", "<i>Hi</i> there"])["description"] == "Hi there"


def test_over_length_text_is_trimmed_to_5000_characters():
    cleaned = row(["Title", "Description"], ["T", "x" * 9000])["description"]
    assert len(cleaned) == 5000
    assert row(["Title", "Description"], ["T", ""])["description"] == ""


def test_a_private_entry_stores_it_and_a_matched_catalogue_book_ignores_it(importing, seeded_books):
    from models import UserBook
    user, workflow = importing
    book = next(book for book in seeded_books.values() if book.title.startswith("Harry Potter"))
    book.isbn13 = "9781250313195"
    original = book.description
    workflow.db.commit()
    _, run = start(user, workflow, ["title", "author", "isbn13", "status", "description"])
    seal(user, workflow, run, [
        [book.title, "J.K. Rowling", book.isbn13, "want", "<p>Imported blurb that must not win</p>"],
        ["My Own Unmatched Book", "Nobody Known", "", "want", "<p>Kept <b>for the reader</b></p>"],
    ])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    entries = {entry.book_id: entry for entry in workflow.db.scalars(select(UserBook).where(UserBook.user_id == user.id))}
    assert entries[book.id].private_description is None
    workflow.db.refresh(book)
    assert book.description == original  # the catalogue's own description is never overwritten
    private = entries[None]
    assert private.private_title == "My Own Unmatched Book" and private.private_description == "Kept for the reader"


def test_export_then_import_round_trips_a_private_description(db_session, app_modules):
    from models import ImportedLibraryRecord, LibraryImportRun, User, UserBook
    from services.library_imports.exports import CsvLibraryExport
    from services.library_imports.workflow import ImportWorkflow
    from sqlalchemy import delete
    owner = User(email=f"desc-{uuid4().hex}@example.test", hashed_password="synthetic")
    reader = User(email=f"desc-{uuid4().hex}@example.test", hashed_password="synthetic")
    db_session.add_all([owner, reader])
    db_session.flush()
    db_session.add(UserBook(user_id=owner.id, private_title="Round Trip", private_author="Some Author", is_wanted=True,
                            private_description="=Line one\nLine two"))
    db_session.commit()
    try:
        export = CsvLibraryExport(app_modules["database"].engine, owner.id)
        rows = list(csv.reader(io.StringIO(b"".join(export.stream()).decode("utf-8"))))
        headers, cells = rows[0], rows[1:]
        assert "description" in headers
        workflow = ImportWorkflow(db_session)
        _, run = start(reader, workflow, headers)
        seal(reader, workflow, run, cells)
        analyzed(reader, workflow, run)
        assert apply(reader, workflow, run)["phase"] == "completed"
        copy = db_session.scalars(select(UserBook).where(UserBook.user_id == reader.id)).one()
        assert copy.private_title == "Round Trip" and copy.private_description == "=Line one\nLine two"
    finally:
        db_session.rollback()
        for user in (owner, reader):
            db_session.execute(delete(LibraryImportRun).where(LibraryImportRun.user_id == user.id))
            db_session.execute(delete(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
            db_session.execute(delete(User).where(User.id == user.id))
        db_session.commit()
