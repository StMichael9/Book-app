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
    assert client.get(f"/me/library-imports/{run['id']}/report.csv").status_code == 404
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


def test_identical_duplicate_group_collapses_before_atomic_history_limit(importing):
    from models import UserBook, ReadingAttempt
    user, workflow = importing
    _, run = start(user, workflow, ["title", "status"])
    batches = []
    for ordinal in range(2):
        result = workflow.upload(user.id, run["id"], ordinal, UploadImportBatch(rows=[["One repeated work", "finished"]] * 100))
        batches.append({"ordinal": ordinal, "hash": result["batch_hash"], "length": 100})
    workflow.finalize(user.id, run["id"], FinalizeImport(row_count=200, batch_count=2, manifest_hash=digest(batches)))
    state = analyzed(user, workflow, run)
    assert state["summary"]["dispositions"] == {"ready": 1, "duplicate": 199}
    assert apply(user, workflow, run)["phase"] == "completed"
    entry = workflow.db.scalar(select(UserBook).where(UserBook.user_id == user.id))
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 1
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 1


def test_mixed_terminal_history_requires_explicit_context_only_decision(importing, seeded_books):
    from models import UserBook, ReadingAttempt, ImportedLibraryRecord
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.source_id = "/works/OL90001W"
    workflow.db.commit()
    headers = ["version", "record_id", "attempt_id", "title", "author", "work_source_id", "status", "finished_on"]
    cells = [["1", "stable-work", attempt, book.title, book.authors[0].name, book.source_id, state, ended]
        for attempt, state, ended in (("first", "dnf", "2024-01-01"), ("second", "finished", "2025-01-01"))]
    _, run = start(user, workflow, headers)
    seal(user, workflow, run, cells)
    ready = analyzed(user, workflow, run)
    assert workflow.preview(user.id, run["id"])["items"][0]["error_code"] == "mixed_terminal_states_require_context_decision"
    state = workflow.decide(user.id, run["id"], 1, ImportDecision(expected_revision=ready["revision"], action="preserve", history_policy="context_only"))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, run["id"])
    assert apply(user, workflow, run)["phase"] == "completed"
    entry = workflow.db.scalar(select(UserBook).where(UserBook.user_id == user.id))
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 0
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    assert record.context["history_policy"] == "context_only" and len(record.context["preserved_events"]) == 2
    # Reordering the already accepted source set requires no repeated decision
    # and must not manufacture a displayed random terminal state on replay.
    _, repeat = start(user, workflow, headers)
    seal(user, workflow, repeat, list(reversed(cells)))
    repeated = analyzed(user, workflow, repeat)
    assert repeated["summary"]["dispositions"] == {"ready": 2}
    assert apply(user, workflow, repeat)["phase"] == "completed"
    assert workflow.db.scalar(select(func.count()).select_from(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)) == 0


def test_stale_source_update_cannot_restore_context_deleted_after_preview(importing):
    from models import ImportedLibraryRecord
    from services.library_imports.provenance import clear_source
    user, workflow = importing
    headers = ["title", "review"]
    _, first = start(user, workflow, headers)
    seal(user, workflow, first, [["Source privacy fixture", "Original private review"]])
    analyzed(user, workflow, first)
    assert apply(user, workflow, first)["phase"] == "completed"
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    _, update = start(user, workflow, headers)
    seal(user, workflow, update, [["Source privacy fixture", "Incoming replacement review"]])
    ready = analyzed(user, workflow, update)
    state = workflow.decide(user.id, update["id"], 1, ImportDecision(expected_revision=ready["revision"], action="preserve", accept_source_update=True))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, update["id"])
    clear_source(workflow.db, user.id, record.user_book_id, record.id)
    result = apply(user, workflow, update)
    assert result["phase"] == "preview_ready"
    assert workflow.preview(user.id, update["id"])["items"][0]["error_code"] == "source_context_changed_since_preview"
    workflow.db.refresh(record)
    assert record.context == {}, "A stale confirmed update must not restore deleted private text"


def test_http_result_csv_is_owner_only_complete_and_omits_private_source_text(import_api):
    user, workflow, client = import_api
    _, run = start(user, workflow, ["title", "review"])
    seal(user, workflow, run, [["A private report fixture", "Never put this review in a row report"]])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    response = client.get(f"/me/library-imports/{run['id']}/report.csv")
    assert response.status_code == 200
    assert len(response.content) == int(response.headers["content-length"])
    assert response.text.startswith("row,result,issue,entry_id\r\n1,applied,,")
    assert "Never put this review" not in response.text and "A private report fixture" not in response.text
    assert response.headers["cache-control"] == "private, no-store"


def test_upload_resume_pins_encoding_and_rejects_changed_start_contract(importing):
    user, workflow = importing
    request = StartImport(id=uuid4(), headers=["title"], encoding="windows-1252")
    run = workflow.start(user.id, request)
    assert workflow.status(user.id, run["id"])["upload_config"]["encoding"] == "windows-1252"
    assert workflow.start(user.id, request)["id"] == run["id"]
    with pytest.raises(HTTPException) as changed:
        workflow.start(user.id, request.model_copy(update={"encoding": "UTF-8"}))
    assert changed.value.detail["code"] == "import_request_reused"
    workflow.db.rollback()


def test_separate_connection_run_lock_returns_controlled_retry(import_api, app_modules):
    user, workflow, client = import_api
    _, run = start(user, workflow, ["title"])
    with app_modules["database"].engine.begin() as locked:
        locked.execute(text("SELECT id FROM library_import_runs WHERE id=:id FOR UPDATE"), {"id": run["id"]})
        response = client.put(f"/me/library-imports/{run['id']}/batches/0", json={"rows": [["A synthetic work"]]})
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "import_temporarily_unavailable_retry"
    assert workflow.status(user.id, run["id"])["row_count"] == 0
    assert client.put(f"/me/library-imports/{run['id']}/batches/0", json={"rows": [["A synthetic work"]]}).status_code == 200


def test_expired_cleanup_commits_even_if_new_import_cannot_reserve_capacity(importing, monkeypatch):
    from models import LibraryImportRun, LibraryImportRow
    from services.library_imports.workflow import fail
    user, workflow = importing
    _, old = start(user, workflow, ["title"])
    workflow.upload(user.id, old["id"], 0, UploadImportBatch(rows=[["Expired private text"]]))
    workflow.db.execute(text("UPDATE library_import_runs SET expires_at=now()-interval '1 second' WHERE id=:id"), {"id": old["id"]})
    workflow.db.commit()
    monkeypatch.setattr(workflow, "_capacity", lambda **_: fail("import_capacity_pause", 507))
    with pytest.raises(HTTPException) as capacity:
        start(user, workflow, ["title"])
    assert capacity.value.status_code == 507
    workflow.db.rollback()
    assert workflow.db.scalar(select(LibraryImportRun.phase).where(LibraryImportRun.id == old["id"])) == "expired"
    assert workflow.db.scalar(select(LibraryImportRow.payload).where(LibraryImportRow.run_id == old["id"])) is None


def test_cancel_after_partial_apply_preserves_committed_entries_and_stops_future_batches(importing):
    from models import UserBook, LibraryImportRow
    user, workflow = importing
    _, run = start(user, workflow, ["title"])
    manifest = []
    for ordinal in range(2):
        rows = [[f"Partial synthetic book {ordinal * 100 + index}"] for index in range(100)]
        result = workflow.upload(user.id, run["id"], ordinal, UploadImportBatch(rows=rows))
        manifest.append({"ordinal": ordinal, "hash": result["batch_hash"], "length": 100})
    workflow.finalize(user.id, run["id"], FinalizeImport(row_count=200, batch_count=2, manifest_hash=digest(manifest)))
    ready = analyzed(user, workflow, run)
    workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=ready["revision"], manifest_hash=ready["manifest_hash"], approve_private=True, skip_unresolved=False))
    assert workflow.advance_apply(user.id, run["id"])["phase"] == "applying"
    committed = workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id))
    assert committed == 100
    cancelled = workflow.cancel(user.id, run["id"])
    assert cancelled["phase"] == "cancelled"
    assert cancelled["summary"]["applied"]["added_entries"] == committed
    with pytest.raises(HTTPException):
        workflow.advance_apply(user.id, run["id"])
    workflow.db.rollback()
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == committed
    # JSONB None is JSON null with the model's existing serialization; both SQL
    # NULL and JSON null mean the private payload has been erased.
    assert workflow.db.scalar(select(func.count()).select_from(LibraryImportRow).where(
        LibraryImportRow.run_id == run["id"], func.jsonb_typeof(LibraryImportRow.payload) != "null")) == 0


def test_forget_removed_markers_clears_deleted_read_markers_without_deleting_live_data(importing):
    from models import ImportedLibraryRecord, ImportedReadLink, ReadingAttempt, UserBook
    from services.library_imports.provenance import forget_removed_markers
    user, workflow = importing
    _, run = start(user, workflow, ["title", "status", "review"])
    seal(user, workflow, run, [["Preserved private book", "finished", "Keep this accepted source review"]])
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] == "completed"
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    attempt = workflow.db.scalar(select(ReadingAttempt).where(ReadingAttempt.user_book_id == record.user_book_id))
    workflow.db.execute(delete(ReadingAttempt).where(ReadingAttempt.id == attempt.id))
    workflow.db.commit()
    assert workflow.db.scalar(select(ImportedReadLink.removed).where(ImportedReadLink.record_id == record.id))
    assert forget_removed_markers(workflow.db, user.id) == {"removed_markers": 0, "removed_read_markers": 1}
    assert workflow.db.scalar(select(func.count()).select_from(ImportedReadLink).where(ImportedReadLink.record_id == record.id)) == 0
    workflow.db.refresh(record)
    assert record.context["review"] == "Keep this accepted source review"
    assert workflow.db.get(UserBook, record.user_book_id) is not None


def test_database_size_check_timeout_returns_retry_without_advancing_import(import_api, monkeypatch):
    from services.library_imports.workflow import ImportWorkflow
    user, workflow, client = import_api
    _, run = start(user, workflow, ["title"])
    original = ImportWorkflow._capacity
    def timed_out_capacity(self, **_):
        self.db.execute(text("SET LOCAL statement_timeout = '20ms'"))
        self.db.execute(text("SELECT pg_sleep(0.05)"))
    monkeypatch.setattr(ImportWorkflow, "_capacity", timed_out_capacity)
    response = client.put(f"/me/library-imports/{run['id']}/batches/0", json={"rows": [["A synthetic bounded retry"]]})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "import_temporarily_unavailable_retry"
    assert workflow.status(user.id, run["id"])["row_count"] == 0
    monkeypatch.setattr(ImportWorkflow, "_capacity", original)
    assert client.put(f"/me/library-imports/{run['id']}/batches/0", json={"rows": [["A synthetic bounded retry"]]}).status_code == 200
    assert workflow.status(user.id, run["id"])["row_count"] == 1


def test_changed_stable_event_context_consent_preserves_read_and_erasure_on_replay(importing):
    from models import ImportedLibraryRecord, ImportedReadLink, ReadingAttempt
    from services.library_imports.provenance import clear_source
    user, workflow = importing
    headers = ["version", "record_id", "attempt_id", "title", "status", "finished_on"]
    def stage(ended):
        _, run = start(user, workflow, headers)
        seal(user, workflow, run, [["1", "stable-work", "stable-read", "Synthetic source date correction", "finished", ended]])
        analyzed(user, workflow, run)
        return run
    original = stage("2024-01-01")
    assert apply(user, workflow, original)["phase"] == "completed"
    record = workflow.db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user.id))
    original_link = workflow.db.scalar(select(ImportedReadLink).where(ImportedReadLink.record_id == record.id))
    link_identity = original_link.id, original_link.attempt_id, original_link.event_hash
    changed = stage("2024-02-02")
    ready = workflow.status(user.id, changed["id"])
    state = workflow.decide(user.id, changed["id"], 1, ImportDecision(expected_revision=ready["revision"],
        action="preserve", history_policy="context_only", accept_source_update=True))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, changed["id"])
    assert apply(user, workflow, changed, skip=False)["phase"] == "completed"
    workflow.db.refresh(record)
    assert any(event["ended_on"] == "2024-02-02" for event in record.context["preserved_events"])
    for erase in (False, True):
        if erase:
            clear_source(workflow.db, user.id, record.user_book_id, record.id)
        replay = stage("2024-02-02")
        assert apply(user, workflow, replay, skip=False)["phase"] == "completed"
        attempts = list(workflow.db.scalars(select(ReadingAttempt).where(ReadingAttempt.user_book_id == record.user_book_id)))
        assert len(attempts) == 1 and str(attempts[0].ended_on) == "2024-01-01"
        workflow.db.refresh(original_link)
        assert (original_link.id, original_link.attempt_id, original_link.event_hash) == link_identity
        if erase:
            workflow.db.refresh(record)
            assert record.context == {}


def test_review_rechecks_vacated_joined_and_transitive_groups_across_restart(importing, app_modules):
    from models import Book, LibraryImportRow, UserBook
    from services.library_imports.workflow import ImportWorkflow
    user, workflow = importing
    owner = user.id
    books = [Book(title=f"Connected review fixture {index}", source_id=f"/works/OL{920000000+index}W") for index in range(151)]
    workflow.db.add_all(books)
    workflow.db.commit()
    headers = ["version", "record_id", "title", "work_source_id"]
    rows = [["1", f"linked-{index}", books[book].title, books[book].source_id]
        for index in range(150) for book in (index, index + 1)]
    rows += [["1", f"unrelated-{index}", f"Unrelated private fixture {index}", ""] for index in range(400)]
    _, run = start(user, workflow, headers)
    batches = []
    for ordinal in range(7):
        cells = rows[ordinal * 100:(ordinal + 1) * 100]
        result = workflow.upload(owner, run["id"], ordinal, UploadImportBatch(rows=cells))
        batches.append({"ordinal": ordinal, "hash": result["batch_hash"], "length": len(cells)})
    workflow.finalize(owner, run["id"], FinalizeImport(row_count=700, batch_count=7, manifest_hash=digest(batches)))
    ready = analyzed(user, workflow, run)
    untouched = workflow.db.scalar(select(LibraryImportRow).where(LibraryImportRow.run_id == run["id"], LibraryImportRow.ordinal == 700))
    before = dict(untouched.plan), untouched.disposition
    state = workflow.decide(owner, run["id"], 1, ImportDecision(expected_revision=ready["revision"], action="match", book_id=books[0].id))
    assert state["phase"] == "grouping" and state["rechecking"]
    first = workflow.advance_analysis(owner, run["id"])
    assert first["group_cursor"] == 100 and first["phase"] == "grouping"
    workflow.db.rollback()
    # New process/session has only persisted seed scope and checkpoint. The
    # vacated group connects another 298 rows through source-record keys.
    with app_modules["database"].SessionLocal() as session:
        restarted = ImportWorkflow(session)
        state = restarted.status(owner, run["id"])
        assert state["rechecking"] and state["group_cursor"] == 100
        steps = 1
        while state["phase"] == "grouping":
            state = restarted.advance_analysis(owner, run["id"])
            steps += 1
            assert steps <= 4
        assert steps == 4 and state["group_cursor"] == 300 and not state["rechecking"]
        assert state["summary"]["dispositions"].get("review", 0) > 0
        with pytest.raises(HTTPException):
            restarted.confirm(owner, run["id"], ConfirmImport(expected_revision=state["revision"],
                manifest_hash=state["manifest_hash"], approve_private=True, skip_unresolved=False))
        session.rollback()
    workflow.db.expire_all()
    untouched = workflow.db.scalar(select(LibraryImportRow).where(LibraryImportRow.run_id == run["id"], LibraryImportRow.ordinal == 700))
    assert (untouched.plan, untouched.disposition) == before
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == owner)) == 0


def test_destination_collision_still_requires_review_after_one_match(importing, seeded_books):
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.source_id = "/works/OL920001001W"
    workflow.db.commit()
    _, run = start(user, workflow, ["version", "record_id", "title", "author", "work_source_id"])
    seal(user, workflow, run, [["1", "uncertain", book.title, "A contradictory source author", book.source_id],
        ["1", "other-source", book.title, book.authors[0].name, book.source_id]])
    ready = analyzed(user, workflow, run)
    state = workflow.decide(user.id, run["id"], 1, ImportDecision(expected_revision=ready["revision"], action="match", book_id=book.id))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, run["id"])
    second = workflow.preview(user.id, run["id"])["items"][1]
    assert second["disposition"] == "review" and second["error_code"] == "multiple_source_rows_for_work"
    with pytest.raises(HTTPException):
        workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=state["revision"],
            manifest_hash=state["manifest_hash"], approve_private=True, skip_unresolved=False))
    workflow.db.rollback()


def test_one_review_decision_does_not_rescan_twenty_thousand_unrelated_rows(importing):
    from sqlalchemy.dialects.postgresql import insert
    from models import LibraryImportRow, LibraryImportRun, UserBook
    from services.library_imports.formats import normalize_row, staged_size
    user, workflow = importing
    _, run = start(user, workflow, ["title"])
    saved = workflow.db.get(LibraryImportRun, run["id"])
    # Seed the already-analyzed phase in bounded batches. This specifically
    # measures review scope at the maximum file size, not upload/matching speed.
    stage_bytes = 0
    for batch in range(200):
        rows = []
        for offset in range(100):
            ordinal = batch * 100 + offset + 1
            payload = normalize_row(saved.source, saved.headers, saved.mapping, [f"Independent synthetic work {ordinal}"])
            plan = {"kind": "private", "private_available": True}
            stage_bytes += staged_size(payload, plan, [])
            rows.append({"run_id": saved.id, "user_id": user.id, "ordinal": ordinal,
                "batch_ordinal": batch, "batch_length": 100, "batch_hash": "a" * 64,
                "payload": payload, "row_hash": digest(payload), "record_key": payload["record_key"],
                "target_key": f"record:{payload['record_key']}", "plan": plan, "disposition": "ready"})
        workflow.db.execute(insert(LibraryImportRow), rows)
        workflow.db.commit()
    saved.row_count, saved.batch_count = 20000, 200
    saved.stage_bytes, saved.phase = stage_bytes, "preview_ready"
    workflow.db.commit()
    state = workflow.decide(user.id, saved.id, 10001, ImportDecision(expected_revision=saved.revision, action="private"))
    assert state["rechecking"]
    state = workflow.advance_analysis(user.id, saved.id)
    assert state["phase"] == "preview_ready" and not state["rechecking"]
    assert state["group_cursor"] == 10001
    assert state["summary"]["dispositions"] == {"ready": 19999, "approved": 1}
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 0


@pytest.mark.parametrize("finish", ["review_then_complete", "expire"])
def test_partial_apply_totals_survive_review_reconfirmation_and_expiry(importing, seeded_books, finish):
    from models import LibraryImportRun, UserBook
    user, workflow = importing
    book = next(iter(seeded_books.values()))
    book.source_id = "/works/OL920002001W"
    entry = UserBook(user_id=user.id, book_id=book.id, is_wanted=True, save_note="Native original")
    workflow.db.add(entry)
    workflow.db.commit()
    _, run = start(user, workflow, ["version", "record_id", "title", "work_source_id"])
    manifest = []
    rows = [["1", f"partial-{index}", f"Partial counter fixture {index}", ""] for index in range(199)]
    rows.append(["1", "changed-native", book.title, book.source_id])
    for ordinal in range(2):
        result = workflow.upload(user.id, run["id"], ordinal, UploadImportBatch(rows=rows[ordinal*100:(ordinal+1)*100]))
        manifest.append({"ordinal": ordinal, "hash": result["batch_hash"], "length": 100})
    workflow.finalize(user.id, run["id"], FinalizeImport(row_count=200, batch_count=2, manifest_hash=digest(manifest)))
    ready = analyzed(user, workflow, run)
    workflow.confirm(user.id, run["id"], ConfirmImport(expected_revision=ready["revision"],
        manifest_hash=ready["manifest_hash"], approve_private=True, skip_unresolved=False))
    state = workflow.advance_apply(user.id, run["id"])
    assert state["summary"]["applied"]["added_entries"] == 100
    if finish == "expire":
        saved = workflow.db.get(LibraryImportRun, run["id"])
        from datetime import timedelta
        from services.library_imports.workflow import utcnow
        saved.expires_at = utcnow() - timedelta(seconds=1)
        workflow.db.commit()
        workflow.cleanup()
        workflow.db.commit()
        state = workflow.status(user.id, run["id"])
        assert state["phase"] == "expired" and state["summary"]["applied"]["added_entries"] == 100
        assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 101
        return
    entry.version += 1
    entry.save_note = "Keep the concurrent native edit"
    workflow.db.commit()
    state = workflow.advance_apply(user.id, run["id"])
    assert state["phase"] == "preview_ready" and state["summary"]["applied"]["added_entries"] == 199
    assert workflow.preview(user.id, run["id"], after=199)["items"][0]["error_code"] == "library_changed_since_preview"
    state = workflow.decide(user.id, run["id"], 200, ImportDecision(expected_revision=state["revision"], action="preserve"))
    while state["phase"] == "grouping":
        state = workflow.advance_analysis(user.id, run["id"])
    assert state["summary"]["applied"]["added_entries"] == 199
    state = apply(user, workflow, run, skip=False)
    assert state["phase"] == "completed" and state["summary"]["applied"]["added_entries"] == 199
    assert state["summary"]["applied"]["linked_records"] == 200
    assert workflow.advance_apply(user.id, run["id"])["summary"]["applied"] == state["summary"]["applied"]
    workflow.db.refresh(entry)
    assert entry.save_note == "Keep the concurrent native edit"
    assert workflow.db.scalar(select(func.count()).select_from(UserBook).where(UserBook.user_id == user.id)) == 200
