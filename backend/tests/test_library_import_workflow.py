"""Synthetic import-engine checks on the guarded disposable test target only."""
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from library_import_schemas import ConfirmImport, FinalizeImport, ImportDecision, StartImport, UploadImportBatch
from services.library_imports.formats import digest


@pytest.fixture
def importing(db_session, app_modules):
    from models import User, LibraryImportRun, ImportedLibraryRecord
    from services.library_imports.workflow import ImportWorkflow
    user = User(email=f"import-{uuid4().hex}@example.test", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    workflow = ImportWorkflow(db_session)
    yield user, workflow
    db_session.rollback()
    db_session.execute(delete(LibraryImportRun).where(LibraryImportRun.user_id == user.id))
    db_session.execute(delete(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    db_session.execute(delete(User).where(User.id == user.id))
    db_session.commit()


def start(user, workflow, headers=None):
    data = StartImport(id=uuid4(), headers=headers or ["title", "author", "isbn13", "status"])
    result = workflow.start(user.id, data)
    return data, result


def seal(user, workflow, run, rows):
    result = workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=rows))
    manifest = digest([{"ordinal": 0, "hash": result["batch_hash"], "length": len(rows)}])
    return workflow.finalize(user.id, run["id"], FinalizeImport(row_count=len(rows), batch_count=1, manifest_hash=manifest))


def analyzed(user, workflow, run):
    while workflow.status(user.id, run["id"])["phase"] in ("analyzing", "grouping"):
        workflow.advance_analysis(user.id, run["id"])
    return workflow.status(user.id, run["id"])


def apply(user, workflow, run, *, private=True, skip=True):
    ready = workflow.status(user.id, run["id"])
    workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=ready["revision"],
        manifest_hash=ready["manifest_hash"], approve_private=private, skip_unresolved=skip))
    for _ in range(10):
        result = workflow.advance_apply(user.id, run["id"])
        if result["phase"] != "applying":
            return result
    pytest.fail("Bounded engineering fixture did not complete")


def test_start_replay_and_one_active_run(importing):
    user, workflow = importing
    data, first = start(user, workflow)
    assert workflow.start(user.id, data)["id"] == first["id"]
    with pytest.raises(HTTPException) as error:
        start(user, workflow)
    assert error.value.detail["code"] == "active_import_exists"
    workflow.db.rollback()


def test_batch_replay_and_manifest_are_atomic(importing):
    from models import UserBook, LibraryImportRow
    user, workflow = importing
    _, run = start(user, workflow)
    batch = UploadImportBatch(rows=[["A", "B", "", "want"]])
    first = workflow.upload(user.id, run["id"], 0, batch)
    assert workflow.upload(user.id, run["id"], 0, batch)["batch_hash"] == first["batch_hash"]
    assert workflow.status(user.id, run["id"])["row_count"] == 1
    with pytest.raises(HTTPException) as changed:
        workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=[["Different", "B", "", "want"]]))
    assert changed.value.detail["code"] == "batch_content_changed"
    workflow.db.rollback()
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 0
    with pytest.raises(HTTPException) as invalid:
        workflow.finalize(user.id, run["id"], FinalizeImport(row_count=1, batch_count=1, manifest_hash="0" * 64))
    assert invalid.value.detail["code"] == "upload_manifest_mismatch"
    workflow.db.rollback()
    assert workflow.status(user.id, run["id"])["phase"] == "uploading"
    assert workflow.db.scalar(select(func.count()).select_from(LibraryImportRow).where(LibraryImportRow.run_id == run["id"])) == 1


def test_local_isbn_match_and_no_library_writes_before_confirmation(importing, seeded_books):
    from models import UserBook
    user, workflow = importing
    book = next(book for book in seeded_books.values() if book.title.startswith("Harry Potter"))
    book.isbn13 = "9781250313195"
    workflow.db.commit()
    _, run = start(user, workflow)
    seal(user, workflow, run, [[book.title, "J.K. Rowling", book.isbn13, "want"]])
    assert workflow.advance_analysis(user.id, run["id"])["phase"] == "grouping"
    assert workflow.advance_analysis(user.id, run["id"])["phase"] == "preview_ready"
    row = workflow.preview(user.id, run["id"])["items"][0]
    assert row["plan"]["book_id"] == book.id
    assert row["plan"]["confidence"] == "identifier"
    assert row["disposition"] == "ready"
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 0


def test_conflicting_identifiers_or_title_go_to_review(importing, seeded_books):
    user, workflow = importing
    book = next(book for book in seeded_books.values() if book.title.startswith("Harry Potter"))
    book.isbn13 = "9781250313195"
    workflow.db.commit()
    _, run = start(user, workflow)
    seal(user, workflow, run, [["A completely different book", "Another author", book.isbn13, "finished"]])
    workflow.advance_analysis(user.id, run["id"])
    workflow.advance_analysis(user.id, run["id"])
    row = workflow.preview(user.id, run["id"])["items"][0]
    assert row["disposition"] == "review"
    assert "title_disagreement" in row["plan"]["reasons"]


def test_missing_book_private_fallback_and_cancel_purges_source_text(importing):
    from models import LibraryImportRow
    user, workflow = importing
    _, run = start(user, workflow, ["title", "review"])
    seal(user, workflow, run, [["Missing work", "Private source text"]])
    workflow.advance_analysis(user.id, run["id"])
    workflow.advance_analysis(user.id, run["id"])
    assert workflow.preview(user.id, run["id"])["items"][0]["plan"]["kind"] == "private"
    result = workflow.cancel(user.id, run["id"])
    assert result["phase"] == "cancelled"
    stored = workflow.db.scalar(select(LibraryImportRow).where(LibraryImportRow.run_id == run["id"]))
    assert stored.payload is None and not stored.candidates and stored.plan == {}


def test_run_and_preview_are_owner_scoped(importing):
    user, workflow = importing
    _, run = start(user, workflow)
    other = uuid4()
    for method in (workflow.status, workflow.preview, workflow.cancel):
        with pytest.raises(HTTPException) as denied:
            method(other, run["id"])
        assert denied.value.status_code == 404
        workflow.db.rollback()


def test_upload_transaction_rollback_keeps_checkpoint(importing, monkeypatch):
    user, workflow = importing
    _, run = start(user, workflow)
    real_commit = workflow.db.commit
    def interrupted():
        raise RuntimeError("synthetic disconnect before commit")
    monkeypatch.setattr(workflow.db, "commit", interrupted)
    with pytest.raises(RuntimeError, match="synthetic"):
        workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=[["A", "B", "", "want"]]))
    workflow.db.rollback()
    monkeypatch.setattr(workflow.db, "commit", real_commit)
    assert workflow.status(user.id, run["id"])["row_count"] == 0
    assert workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=[["A", "B", "", "want"]]))["status"]["row_count"] == 1


def test_expiry_hides_payload_before_physical_cleanup(importing):
    from models import LibraryImportRun, LibraryImportRow
    user, workflow = importing
    _, run = start(user, workflow)
    workflow.upload(user.id, run["id"], 0, UploadImportBatch(rows=[["A", "B", "", "want"]]))
    workflow.db.execute(text("UPDATE library_import_runs SET expires_at=now()-interval '1 second' WHERE id=:id"), {"id": run["id"]})
    workflow.db.commit()
    assert workflow.status(user.id, run["id"])["phase"] == "expired"
    with pytest.raises(HTTPException) as expired:
        workflow.preview(user.id, run["id"])
    assert expired.value.status_code == 410
    workflow.db.rollback()
    start(user, workflow)
    assert workflow.db.scalar(select(LibraryImportRun.phase).where(LibraryImportRun.id == run["id"])) == "expired"
    assert workflow.db.scalar(select(LibraryImportRow.payload).where(LibraryImportRow.run_id == run["id"])) is None


def test_database_constraint_rejects_cross_owner_source_link(importing, seeded_books):
    from models import User, UserBook, ImportedLibraryRecord
    user, workflow = importing
    other = User(email=f"other-{uuid4().hex}@example.test", hashed_password="fixture")
    workflow.db.add(other)
    workflow.db.flush()
    entry = UserBook(user_id=other.id, book_id=next(iter(seeded_books.values())).id, is_owned=True)
    workflow.db.add(entry)
    workflow.db.commit()
    workflow.db.add(ImportedLibraryRecord(user_id=user.id, user_book_id=entry.id, source="generic", scope="default",
        record_key="a" * 64, accepted_hash="b" * 64))
    with pytest.raises(IntegrityError):
        workflow.db.commit()
    workflow.db.rollback()
    workflow.db.execute(delete(User).where(User.id == other.id))
    workflow.db.commit()


def test_confirmed_private_import_reupload_is_idempotent(importing):
    from models import UserBook, ReadingAttempt, ImportedLibraryRecord, ImportedReadLink, LibraryImportRow
    user, workflow = importing
    headers = ["version", "record_id", "title", "author", "status", "finished_on", "review", "labels", "owned"]
    rows = [["1", "stable", "Uncatalogued Book", "An Author", "finished", "2025-10-01", "Private review", '["night"]', "true"]]
    _, run = start(user, workflow, headers)
    seal(user, workflow, run, rows)
    analyzed(user, workflow, run)
    result = apply(user, workflow, run)
    assert result["phase"] == "completed"
    assert result["summary"]["applied"]["added_entries"] == 1
    entry = workflow.db.scalar(select(UserBook).where(UserBook.user_id == user.id))
    assert entry.book_id is None and entry.private_title == "Uncatalogued Book" and entry.is_owned
    attempt = workflow.db.scalar(select(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id))
    assert attempt.origin == "import" and attempt.note is None and attempt.reaction is None
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    assert record.context["review"] == "Private review" and record.context["labels"] == ["night"]
    report = workflow.db.scalar(select(LibraryImportRow).where(LibraryImportRow.run_id == run["id"]))
    assert report.payload is None and report.result_entry_id == entry.id
    original_version = entry.version
    _, repeat = start(user, workflow, headers)
    seal(user, workflow, repeat, rows)
    analyzed(user, workflow, repeat)
    result = apply(user, workflow, repeat)
    assert result["phase"] == "completed"
    assert result["summary"]["applied"]["added_entries"] == 0
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 1
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 1
    assert workflow.db.scalar(select(func.count()).select_from(ImportedReadLink).where(ImportedReadLink.user_id == user.id)) == 1
    assert workflow.db.get(UserBook, entry.id).version == original_version


def test_confirmed_catalogue_import_retains_work_identity(importing, seeded_books):
    from models import UserBook, Book
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.isbn13 = "9781250313195"
    workflow.db.commit()
    catalogue_count = workflow.db.scalar(select(func.count()).select_from(Book))
    _, run = start(user, workflow)
    seal(user, workflow, run, [[book.title, book.authors[0].name, book.isbn13, "want"]])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    entry = workflow.db.scalar(select(UserBook).where(UserBook.user_id == user.id))
    assert entry.book_id == book.id and entry.private_title is None and entry.is_wanted
    assert workflow.db.scalar(select(func.count()).select_from(Book)) == catalogue_count


def test_native_fields_and_history_win_by_default(importing, seeded_books):
    from datetime import date
    from models import UserBook, ReadingAttempt, ImportedLibraryRecord
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.isbn13 = "9781250313195"
    entry = UserBook(user_id=user.id, book_id=book.id, is_owned=True, is_wanted=False, save_note="Keep native note")
    workflow.db.add(entry)
    workflow.db.flush()
    attempt = ReadingAttempt(id=uuid4(), user_book_id=entry.id, state="finished", ended_on=date(2025, 1, 1),
        note="Native reading note", reaction="loved", creation_fingerprint="c" * 64)
    workflow.db.add(attempt)
    workflow.db.commit()
    version = entry.version
    _, run = start(user, workflow)
    seal(user, workflow, run, [[book.title, book.authors[0].name, book.isbn13, "want"]])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    workflow.db.refresh(entry)
    workflow.db.refresh(attempt)
    assert entry.version == version and entry.is_owned and not entry.is_wanted and entry.save_note == "Keep native note"
    assert attempt.note == "Native reading note" and attempt.reaction == "loved" and attempt.origin == "native"
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 1


def test_stale_native_edit_is_reviewed_not_overwritten(importing, seeded_books):
    from models import UserBook
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.isbn13 = "9781250313195"
    entry = UserBook(user_id=user.id, book_id=book.id, is_wanted=True)
    workflow.db.add(entry)
    workflow.db.commit()
    _, run = start(user, workflow)
    seal(user, workflow, run, [[book.title, book.authors[0].name, book.isbn13, "want"]])
    analyzed(user, workflow, run)
    entry.save_note = "Changed on another device"
    workflow.db.commit()
    result = apply(user, workflow, run)
    assert result["phase"] == "preview_ready"
    assert workflow.preview(user.id, run["id"])["items"][0]["error_code"] == "library_changed_since_preview"
    assert workflow.db.get(UserBook, entry.id).save_note == "Changed on another device"
    # Review must bind the fresh version; it must not loop forever on the stale
    # preview, and still must not overwrite the native edit.
    state = workflow.decide(user.id, run["id"], 1, ImportDecision(expected_revision=result["revision"], action="preserve"))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, run["id"])
    assert apply(user, workflow, run)["phase"] == "completed"
    assert workflow.db.get(UserBook, entry.id).save_note == "Changed on another device"


def test_deleted_import_does_not_resurrect_on_reupload(importing):
    from models import UserBook, ImportedLibraryRecord
    user, workflow = importing
    _, run = start(user, workflow, ["title", "review"])
    rows = [["Private Book", "Sensitive imported review"]]
    seal(user, workflow, run, rows)
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    entry = workflow.db.scalar(select(UserBook).where(UserBook.user_id == user.id))
    workflow.db.execute(delete(UserBook).where(UserBook.id == entry.id, UserBook.user_id == user.id))
    workflow.db.commit()
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    workflow.db.refresh(record)
    assert record.removed and record.user_book_id is None and record.context == {}
    _, repeat = start(user, workflow, ["title", "review"])
    seal(user, workflow, repeat, rows)
    analyzed(user, workflow, repeat)
    assert workflow.preview(user.id, repeat["id"])["items"][0]["plan"]["kind"] == "removed"
    assert apply(user, workflow, repeat)["phase"] == "completed_with_issues"
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 0


@pytest.fixture
def import_api(importing, client, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    user, workflow = importing
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    monkeypatch.setattr(app_modules["database"].settings, "library_import_enabled", True)
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user, workflow, client
    limiter.reset()


def test_http_requires_feature_and_refuses_owner_in_request(import_api, app_modules, monkeypatch):
    user, workflow, client = import_api
    body = {"id": str(uuid4()), "headers": ["title"]}
    monkeypatch.setattr(app_modules["database"].settings, "library_import_enabled", False)
    assert client.post("/me/library-imports", json=body).status_code == 403
    monkeypatch.setattr(app_modules["database"].settings, "library_import_enabled", True)
    assert client.post("/me/library-imports", json={**body, "user_id": str(uuid4())}).status_code == 422
    response = client.post("/me/library-imports", json=body)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert client.get(f"/me/library-imports/{uuid4()}/rows").status_code == 404


def test_http_raw_body_limit_precedes_json_parsing(import_api, app_modules):
    _, _, client = import_api
    origin = app_modules["main"]._parse_cors_origins()[0]
    response = client.post("/me/library-imports/inspect", content=b"x" * (512 * 1024 + 1), headers={"content-type": "application/json", "origin": origin})
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "import_request_too_large"
    assert response.headers["access-control-allow-origin"] == origin


def test_http_preview_excludes_other_owner_and_unauthenticated_access(import_api, app_modules):
    from auth.dependencies import get_current_user
    from models import User
    user, workflow, client = import_api
    data, run = start(user, workflow)
    seal(user, workflow, run, [["Owner-private title", "Owner-private author", "", "want"]])
    other = User(email=f"api-other-{uuid4().hex}@example.test", hashed_password="fixture")
    workflow.db.add(other)
    workflow.db.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    response = client.get(f"/me/library-imports/{run['id']}/rows")
    assert response.status_code == 404 and "Owner-private" not in response.text
    assert client.get("/me/library-imports").json()["items"] == []
    app_modules["main"].app.dependency_overrides.pop(get_current_user)
    assert client.get(f"/me/library-imports/{run['id']}").status_code == 401
    workflow.db.execute(delete(User).where(User.id == other.id))
    workflow.db.commit()


def test_global_database_budget_is_not_a_process_local_counter(importing, app_modules):
    user, workflow = importing
    engine = app_modules["database"].engine
    with engine.connect() as first, engine.connect() as second:
        first.execute(text("SELECT pg_advisory_xact_lock(513005,1)"))
        second.execute(text("SELECT pg_advisory_xact_lock(513005,2)"))
        with pytest.raises(HTTPException) as busy:
            start(user, workflow)
        assert busy.value.status_code == 429
        assert busy.value.detail["code"] == "import_busy_retry"
        workflow.db.rollback()


def test_apply_commit_disconnect_retries_without_partial_domain_writes(importing, monkeypatch):
    from models import UserBook, ImportedLibraryRecord
    user, workflow = importing
    _, run = start(user, workflow, ["title"])
    seal(user, workflow, run, [["A synthetic private work"]])
    analyzed(user, workflow, run)
    ready = workflow.status(user.id, run["id"])
    workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=ready["revision"],
        manifest_hash=ready["manifest_hash"], approve_private=True, skip_unresolved=False))
    commit = workflow.db.commit
    def interrupted():
        raise RuntimeError("synthetic interruption after inserts before commit")
    monkeypatch.setattr(workflow.db, "commit", interrupted)
    with pytest.raises(RuntimeError):
        workflow.advance_apply(user.id, run["id"])
    workflow.db.rollback()
    monkeypatch.setattr(workflow.db, "commit", commit)
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 0
    assert workflow.db.scalar(select(func.count()).select_from(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id)) == 0
    assert workflow.advance_apply(user.id, run["id"])["phase"] == "completed"
    assert workflow.advance_apply(user.id, run["id"])["phase"] == "completed"
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 1


def test_account_deletion_cascades_active_import_provenance_and_history(importing):
    from models import User, UserBook, ReadingAttempt, ImportedLibraryRecord, ImportedReadLink, LibraryImportRun
    user, workflow = importing
    _, run = start(user, workflow, ["title", "status"])
    seal(user, workflow, run, [["Synthetic owner-private history", "finished"]])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    owner = user.id
    entries = list(workflow.db.scalars(select(UserBook.id).where(UserBook.user_id == owner)))
    assert len(entries) == 1
    workflow.db.expunge(user)  # Keep fixture teardown's detached owner ID available.
    workflow.db.execute(delete(User).where(User.id == owner))
    workflow.db.commit()
    for table in (UserBook, ImportedLibraryRecord, ImportedReadLink, LibraryImportRun):
        assert workflow.db.scalar(select(func.count()).select_from(table).where(table.user_id == owner)) == 0
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id.in_(entries))) == 0
