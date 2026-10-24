"""CSV portability, source privacy and no-loss native round trips (synthetic)."""
import csv
from datetime import date
import io
import json
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from library_import_schemas import ConfirmImport, FinalizeImport, ImportDecision, StartImport, UploadImportBatch
from services.library_imports.formats import digest, inspect_headers, normalize_row


def test_csv_formula_escape_is_reversible_only_with_versioned_metadata():
    from services.library_imports.exports import COLUMNS, csv_line
    for original in ("=1+1", "+danger", "-danger", "@danger", "  =danger", "\t=danger", "'already text", "夜の本"):
        values = {"version": "1", "record_id": "stable", "title": "A book", "private_note": original}
        cells = next(csv.reader(io.StringIO(csv_line(values).decode("utf-8"))))
        inspection = inspect_headers(list(COLUMNS))
        normalized = normalize_row("bookvane", list(COLUMNS), inspection["mapping"], cells)
        assert normalized["context"]["private_note"] == original
        if original.lstrip().startswith(("=", "+", "-", "@")):
            assert cells[COLUMNS.index("private_note")].startswith("'")


@pytest.fixture
def library_export(db_session, app_modules):
    from models import User, UserBook, ReadingAttempt, LibraryImportRun, ImportedLibraryRecord
    from services.library_imports.workflow import ImportWorkflow
    user = User(email=f"m5-csv-{uuid4().hex}@example.test", hashed_password="synthetic")
    db_session.add(user)
    db_session.flush()
    entry = UserBook(user_id=user.id, private_title="=Private Unicode 夜", private_author="É Author",
        is_owned=True, is_wanted=True, save_note="Native save reason")
    db_session.add(entry)
    db_session.flush()
    attempts = [ReadingAttempt(id=uuid4(), user_book_id=entry.id, state="finished", ended_on=ended,
        note=note, reaction="liked", creation_fingerprint="a" * 64) for ended, note in (
            (None, "=Private undated reading note"), (date(2025, 5, 5), "Another reading note"))]
    db_session.add_all(attempts)
    db_session.commit()
    yield user, entry, attempts, ImportWorkflow(db_session)
    db_session.rollback()
    db_session.execute(delete(LibraryImportRun).where(LibraryImportRun.user_id == user.id))
    db_session.execute(delete(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    db_session.execute(delete(User).where(User.id == user.id))
    db_session.commit()


def test_csv_snapshot_length_and_native_private_reread_round_trip(library_export, app_modules):
    from models import ReadingAttempt, UserBook
    from services.library_imports.exports import CsvLibraryExport
    user, entry, attempts, workflow = library_export
    original = (entry.id, entry.version, entry.save_note, [(attempt.id, attempt.note, attempt.reaction) for attempt in attempts])
    export = CsvLibraryExport(app_modules["database"].engine, user.id)
    output = b"".join(export.stream())  # Small fixture only, production streams.
    assert len(output) == export.length and export.closed
    rows = list(csv.reader(io.StringIO(output.decode("utf-8"))))
    headers, cells = rows[0], rows[1:]
    assert len(cells) == 2
    run = workflow.start(user.id, StartImport(id=uuid4(), headers=headers))
    batch = workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=cells))
    workflow.finalize(user.id, run["id"], FinalizeImport(row_count=2, batch_count=1,
        manifest_hash=digest([{"ordinal": 0, "hash": batch["batch_hash"], "length": 2}])))
    for _ in range(4):
        if workflow.status(user.id, run["id"])["phase"] == "preview_ready":
            break
        workflow.advance_analysis(user.id, run["id"])
    preview = workflow.preview(user.id, run["id"])
    assert all(row["plan"]["entry_id"] == entry.id for row in preview["items"])
    state = workflow.decide(user.id, run["id"], 1, ImportDecision(expected_revision=preview["revision"], action="preserve"))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, run["id"])
    workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=state["revision"], manifest_hash=state["manifest_hash"],
        approve_private=False, skip_unresolved=False))
    result = workflow.advance_apply(user.id, run["id"])
    assert result["phase"] == "completed"
    workflow.db.refresh(entry)
    assert (entry.id, entry.version, entry.save_note) == original[:3]
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 2
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 1
    assert [(attempt.id, attempt.note, attempt.reaction) for attempt in attempts] == original[3]


def test_owner_source_context_export_clear_and_feature_rollback_guard(library_export, app_modules):
    from models import ImportedLibraryRecord, UserBook
    from services.library import LibraryService, legacy_write_guard, library_needs_v3
    from services.library_imports.provenance import clear_source, sources
    from services.reading_export import stream_reading_export
    from fastapi import HTTPException
    user, entry, _, workflow = library_export
    record = ImportedLibraryRecord(user_id=user.id, user_book_id=entry.id, source="goodreads", scope="default",
        record_key="b" * 64, accepted_hash="c" * 64, context={"review": "=Source private text", "rating": "4", "labels": ["night"]})
    workflow.db.add(record)
    workflow.db.commit()
    assert sources(workflow.db, user.id, entry.id)["items"][0]["context"]["review"] == "=Source private text"
    with pytest.raises(HTTPException) as denied:
        sources(workflow.db, uuid4(), entry.id)
    assert denied.value.status_code == 404
    assert LibraryService(workflow.db).page(user.id, label="night").total == 1
    assert LibraryService(workflow.db).page(user.id, label="other").total == 0
    assert library_needs_v3(workflow.db, user.id)
    with pytest.raises(HTTPException):
        legacy_write_guard(workflow.db, user.id, entry.book_id)
    workflow.db.rollback()
    exported = [json.loads(line) for line in stream_reading_export(app_modules["database"].engine, user.id)]
    source = next(row for row in exported if row["type"] == "imported_source")
    assert source["data"]["context"]["review"] == "=Source private text"
    assert "record_key" not in source["data"] and "accepted_hash" not in source["data"]
    original = entry.version
    clear_source(workflow.db, user.id, entry.id, record.id)
    assert sources(workflow.db, user.id, entry.id)["items"] == []
    assert workflow.db.get(UserBook, entry.id).save_note == "Native save reason"
    assert workflow.db.get(UserBook, entry.id).version == original


def test_csv_early_close_releases_read_only_snapshot(library_export, app_modules):
    from services.library_imports.exports import CsvLibraryExport
    user, _, _, _ = library_export
    engine = app_modules["database"].engine
    owner = user.id  # Resolve the fixture's expired ORM identity before baseline.
    before = engine.pool.checkedout()
    exported = CsvLibraryExport(engine, owner)
    stream = exported.stream()
    assert next(stream).startswith(b"version,")
    stream.close()
    exported.close()
    assert exported.closed and engine.pool.checkedout() == before
