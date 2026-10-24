"""M3 context uses the existing guarded local disposable-database harness."""
import uuid
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException


@pytest.fixture
def context_entry(client, db_session, app_modules, monkeypatch, seeded_books):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    user = app_modules["models"].User(email=f"m3-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(user)
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    book_id = next(iter(seeded_books.values())).id
    saved = client.put(f"/me/library/books/{book_id}", json={"is_owned": True, "is_wanted": True}).json()
    identity = str(uuid.uuid4())
    result = client.put(f"/me/reading-attempts/{identity}", json={"entry_id": saved["id"], "expected_version": saved["version"]})
    assert result.status_code == 200, result.text
    yield user, result.json()
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()


def test_context_limits_clear_noop_and_independent_fields(client, context_entry):
    _, result = context_entry
    saved, attempt = result["entry"], result["attempt"]
    reason = client.patch(f"/me/library/{saved['id']}", json={"expected_version": saved["version"], "save_note": "r" * 500})
    assert reason.status_code == 200, reason.text
    assert reason.json()["is_owned"] and not reason.json()["is_wanted"]
    response = client.patch(f"/me/reading-attempts/{attempt['id']}", json={
        "expected_version": reason.json()["version"], "note": "n" * 2000, "reaction": "loved"})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["attempt"]["note"] == "n" * 2000 and updated["attempt"]["reaction"] == "loved"
    assert updated["attempt"]["state"] == "reading" and updated["attempt"]["progress_value"] is None
    unchanged = client.patch(f"/me/reading-attempts/{attempt['id']}", json={
        "expected_version": updated["entry"]["version"], "note": "n" * 2000}).json()
    assert unchanged["entry"]["version"] == updated["entry"]["version"]
    cleared = client.patch(f"/me/reading-attempts/{attempt['id']}", json={
        "expected_version": updated["entry"]["version"], "note": " \n ", "reaction": None}).json()
    assert cleared["attempt"]["note"] is None and cleared["attempt"]["reaction"] is None
    cleared_reason = client.patch(f"/me/library/{saved['id']}", json={
        "expected_version": cleared["entry"]["version"], "save_note": None}).json()
    assert cleared_reason["save_note"] is None and cleared_reason["is_owned"]


@pytest.mark.parametrize("target,values", [
    ("entry", {"save_note": "x" * 501}), ("entry", {"is_owned": None}),
    ("entry", {}), ("attempt", {"note": "x" * 2001}),
    ("attempt", {"reaction": "five_stars"}), ("attempt", {"user_id": str(uuid.uuid4())}),
])
def test_context_validation_does_not_change_saved_data(client, context_entry, target, values):
    _, result = context_entry
    path = f"/me/library/{result['entry']['id']}" if target == "entry" else f"/me/reading-attempts/{result['attempt']['id']}"
    response = client.patch(path, json={"expected_version": result["entry"]["version"], **values})
    assert response.status_code == 422
    current = client.get(f"/me/reading-attempts/{result['attempt']['id']}").json()
    assert current == result


def test_context_plain_text_owner_scope_and_summary_privacy(client, context_entry, db_session, app_modules):
    from auth.dependencies import get_current_user
    user, result = context_entry
    marker = '<img src=x onerror="alert(1)">\nPrivate memory 読書'
    path = f"/me/reading-attempts/{result['attempt']['id']}"
    saved = client.patch(path, json={"expected_version": result["entry"]["version"], "note": marker, "reaction": "not_for_me"})
    assert saved.status_code == 200 and saved.json()["attempt"]["note"] == marker
    assert client.get(path).headers["cache-control"] == "private, no-store"
    for summary in ("/me/library", "/me/library/lookup", "/me/home", f"/me/library/{result['entry']['id']}/attempts", "/books"):
        response = client.post(summary, json={"book_ids": [result['entry']['book_id']]}) if summary.endswith("lookup") else client.get(summary)
        assert response.status_code == 200, response.text
        assert marker not in response.text and "Private memory" not in response.text
    other = app_modules["models"].User(email=f"m3-other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other)
    db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(path).status_code == 404
    assert client.patch(path, json={"expected_version": saved.json()["entry"]["version"], "note": "intrusion"}).status_code == 404
    assert client.patch(f"/me/library/{result['entry']['id']}", json={"expected_version": 3, "save_note": "intrusion"}).status_code == 404
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    assert client.get(path).json()["attempt"]["note"] == marker


def test_context_rereads_reopen_and_original_creation_retry(client, context_entry):
    _, result = context_entry
    saved, attempt = result["entry"], result["attempt"]
    path = f"/me/reading-attempts/{attempt['id']}"
    finished = client.patch(path, json={"expected_version": saved["version"], "state": "finished", "note": "First reading", "reaction": "liked"}).json()
    # M3 adds context to updates, not creation defaults: pre-M3 retry intent
    # fingerprints remain compatible and do not overwrite later private edits.
    replay = client.put(path, json={"entry_id": saved["id"], "expected_version": 1})
    assert replay.status_code == 200 and replay.json()["attempt"]["note"] == "First reading"
    second = client.put(f"/me/reading-attempts/{uuid.uuid4()}", json={"entry_id": saved["id"], "expected_version": finished["entry"]["version"]}).json()
    assert second["attempt"]["note"] is None and second["attempt"]["reaction"] is None
    assert client.get(path).json()["attempt"]["note"] == "First reading"
    second = client.patch(f"/me/reading-attempts/{second['attempt']['id']}", json={"expected_version": second["entry"]["version"], "state": "dnf"}).json()
    reopened = client.patch(path, json={"expected_version": second["entry"]["version"], "state": "reading"}).json()
    assert reopened["attempt"]["note"] == "First reading" and reopened["attempt"]["reaction"] == "liked"


def test_concurrent_context_writes_conflict_instead_of_losing_notes(client, context_entry, app_modules):
    from reading_schemas import AttemptUpdate
    from services.reading import ReadingService
    user, result = context_entry
    user_id, attempt_id = user.id, uuid.UUID(result["attempt"]["id"])
    def save(note):
        with app_modules["database"].SessionLocal() as session:
            try:
                ReadingService(session).update_attempt(user_id, attempt_id, AttemptUpdate(expected_version=result["entry"]["version"], note=note))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ["Version A", "Version B"])) == [200, 409]
    current = client.get(f"/me/reading-attempts/{attempt_id}").json()
    assert current["attempt"]["note"] in {"Version A", "Version B"}
    stale = client.patch(f"/me/reading-attempts/{attempt_id}", json={"expected_version": result["entry"]["version"], "note": "stale"})
    assert stale.status_code == 409


def test_context_remains_readable_after_writes_are_disabled(client, context_entry, app_modules, monkeypatch):
    _, result = context_entry
    path = f"/me/reading-attempts/{result['attempt']['id']}"
    saved = client.patch(path, json={"expected_version": result["entry"]["version"], "note": "Keep my context"}).json()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    assert client.get(path).json()["attempt"]["note"] == "Keep my context"
    assert client.patch(path, json={"expected_version": saved["entry"]["version"], "note": None}).status_code == 403


def test_remove_one_reading_preserves_entry_flags_context_other_history(client, context_entry):
    _, result = context_entry
    entry_id, first_id = result["entry"]["id"], result["attempt"]["id"]
    first = client.patch(f"/me/reading-attempts/{first_id}", json={
        "expected_version": result["entry"]["version"], "state": "finished", "note": "first"}).json()
    saved = client.patch(f"/me/library/{entry_id}", json={"expected_version": first["entry"]["version"], "save_note": "keep reason"}).json()
    second = client.put(f"/me/reading-attempts/{uuid.uuid4()}", json={"entry_id": entry_id, "expected_version": saved["version"]}).json()
    path = f"/me/reading-attempts/{first_id}"
    stale = {"expected_version": saved["version"], "confirmed": True}
    assert client.request("DELETE", path, json=stale).status_code == 409
    deleted = client.request("DELETE", path, json={**stale, "expected_version": second["entry"]["version"]})
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["is_owned"] and deleted.json()["save_note"] == "keep reason"
    assert deleted.json()["version"] == second["entry"]["version"] + 1
    assert client.get(path).status_code == 404
    assert client.request("DELETE", path, json={**stale, "expected_version": deleted.json()["version"]}).status_code == 404
    assert [item["id"] for item in client.get(f"/me/library/{entry_id}/attempts").json()["items"]] == [second["attempt"]["id"]]


@pytest.mark.parametrize("payload", [{"expected_version": 2}, {"expected_version": 2, "confirmed": False},
    {"expected_version": 2, "confirmed": "true"}, {"expected_version": "2", "confirmed": True},
    {"expected_version": 2, "confirmed": True, "user_id": "other"}])
def test_removal_requires_explicit_strict_confirmation(client, context_entry, payload):
    _, result = context_entry
    for path in (f"/me/library/{result['entry']['id']}", f"/me/reading-attempts/{result['attempt']['id']}"):
        assert client.request("DELETE", path, json=payload).status_code == 422
    assert client.get(f"/me/reading-attempts/{result['attempt']['id']}").json() == result


def test_forget_owner_scope_cascades_only_personal_book(client, context_entry, app_modules, db_session):
    from auth.dependencies import get_current_user
    from sqlalchemy import func, select
    models = app_modules["models"]
    user, result = context_entry
    entry, attempt = result["entry"], result["attempt"]
    other = models.User(email=f"forget-other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other); db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    other_entry = client.put(f"/me/library/books/{entry['book_id']}", json={"is_wanted": True}).json()
    for path in (f"/me/library/{entry['id']}", f"/me/reading-attempts/{attempt['id']}"):
        assert client.request("DELETE", path, json={"expected_version": entry["version"], "confirmed": True}).status_code == 404
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    tag = db_session.scalar(select(models.Tag).limit(1))
    db_session.add(models.UserPreference(user_id=user.id, tag_id=tag.id, source_text="preserve")); db_session.commit()
    response = client.request("DELETE", f"/me/library/{entry['id']}", json={"expected_version": entry["version"], "confirmed": True})
    assert response.status_code == 204
    assert response.headers["cache-control"] == "private, no-store"
    assert client.get(f"/me/reading-attempts/{attempt['id']}").status_code == 404
    db_session.expire_all()
    assert db_session.get(models.Book, entry["book_id"]) is not None
    assert db_session.get(models.UserBook, other_entry["id"]) is not None
    assert db_session.scalar(select(func.count()).select_from(models.UserPreference).where(models.UserPreference.user_id == user.id)) == 1


def test_concurrent_remove_and_note_write_never_500_or_resurrects(client, context_entry, app_modules):
    from reading_schemas import AttemptUpdate, ReadingRemoval
    from services.reading import ReadingService
    user, result = context_entry
    user_id, attempt_id, version = user.id, uuid.UUID(result["attempt"]["id"]), result["entry"]["version"]
    def command(remove):
        with app_modules["database"].SessionLocal() as session:
            try:
                service = ReadingService(session)
                if remove:
                    service.remove_attempt(user_id, attempt_id, ReadingRemoval(expected_version=version, confirmed=True))
                else:
                    service.update_attempt(user_id, attempt_id, AttemptUpdate(expected_version=version, note="concurrent"))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(command, [True, False]))
    assert sorted(outcomes) in ([200, 404], [200, 409])


def test_export_owner_scope_plain_text_preferences_no_secrets_and_readonly(client, context_entry, app_modules, db_session, monkeypatch):
    from sqlalchemy import select
    user, result = context_entry
    models = app_modules["models"]
    marker = '=SUM(A1)\n<img src=x> 私の本'
    saved = client.patch(f"/me/reading-attempts/{result['attempt']['id']}", json={
        "expected_version": result["entry"]["version"], "note": marker, "reaction": "loved"}).json()
    tag = db_session.scalar(select(models.Tag).limit(1))
    db_session.add(models.UserPreference(user_id=user.id, tag_id=tag.id, source_text="private preference"))
    other = models.User(email=f"export-other-{uuid.uuid4().hex}@example.com", hashed_password="not-in-export")
    db_session.add(other); db_session.flush()
    db_session.add(models.UserBook(user_id=other.id, private_title="OTHER READER SECRET", status="want", is_wanted=True, version=1))
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    response = client.get("/me/reading-export")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert "attachment" in response.headers["content-disposition"]
    records = [json.loads(line) for line in response.text.splitlines()]
    assert records[0]["type"] == "metadata" and records[-1]["type"] == "complete"
    assert records[-1]["counts"] == {"entry": 1, "reading": 1, "preference": 1}
    reading = next(row["data"] for row in records if row["type"] == "reading")
    assert reading["note"] == marker and reading["reaction"] == "loved"
    assert reading["id"] == saved["attempt"]["id"]
    for excluded in ("OTHER READER SECRET", "hashed_password", "creation_fingerprint", "token_hash", "not-in-export", user.email):
        assert excluded not in response.text
    assert client.request("DELETE", f"/me/library/{result['entry']['id']}", json={"expected_version": saved["entry"]["version"], "confirmed": True}).status_code == 403


def test_export_snapshot_and_early_close_release_connection(context_entry, app_modules):
    from sqlalchemy import update
    from services.reading_export import stream_reading_export
    user, result = context_entry
    engine = app_modules["database"].engine
    before = engine.pool.checkedout()
    stream = stream_reading_export(engine, user.id, batch_size=2)
    assert json.loads(next(stream))["type"] == "metadata"
    with engine.begin() as connection:
        connection.execute(update(app_modules["models"].UserBook).where(
            app_modules["models"].UserBook.id == result["entry"]["id"]).values(save_note="after snapshot"))
    remaining = [json.loads(line) for line in stream]
    assert next(row["data"] for row in remaining if row["type"] == "entry")["save_note"] is None
    assert engine.pool.checkedout() == before
    partial = stream_reading_export(engine, user.id)
    next(partial)
    assert engine.pool.checkedout() == before + 1
    partial.close()
    assert engine.pool.checkedout() == before


def test_export_large_library_streams_fixed_query_count(context_entry, app_modules):
    from sqlalchemy import event, insert
    from services.reading_export import stream_reading_export
    user, _ = context_entry
    engine = app_modules["database"].engine
    with engine.begin() as connection:
        connection.execute(insert(app_modules["models"].UserBook), [{"user_id": user.id, "private_title": f"Synthetic {index}",
            "status": "want", "is_owned": False, "is_wanted": True, "version": 1, "save_note": "n" * 500} for index in range(10000)])
    queries, maximum = [], 0
    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        queries.append(statement)
    event.listen(engine, "before_cursor_execute", observe)
    try:
        counts, records = None, 0
        for line in stream_reading_export(engine, user.id, batch_size=100):
            maximum = max(maximum, len(line)); records += 1
            record = json.loads(line)
            if record["type"] == "complete": counts = record["counts"]
        assert counts == {"entry": 10001, "reading": 1, "preference": 0}
        assert records == 10004 and maximum < 5000
        assert len(queries) == 9  # settings, anchor, five fixed cursors (including private source context)
    finally:
        event.remove(engine, "before_cursor_execute", observe)


def test_account_deletion_cascades_new_private_data_without_catalogue_loss(client, context_entry, app_modules, db_session):
    from datetime import datetime, timedelta, timezone
    import jwt
    from auth.dependencies import ALGORITHM, SECRET_KEY, get_current_user
    from sqlalchemy import delete, select, func
    user, result = context_entry
    models = app_modules["models"]
    user_id, entry_id, book_id, attempt_id = user.id, result["entry"]["id"], result["entry"]["book_id"], uuid.UUID(result["attempt"]["id"])
    tag = db_session.scalar(select(models.Tag).limit(1))
    db_session.add(models.UserPreference(user_id=user_id, tag_id=tag.id))
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    db_session.add(models.RefreshToken(user_id=user_id, token_hash=uuid.uuid4().hex, expires_at=expires))
    db_session.add(models.PasswordResetToken(user_id=user_id, token_hash=uuid.uuid4().hex, expires_at=expires))
    db_session.commit()
    token = jwt.encode({"sub": str(user_id), "ver": 0, "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)
    app_modules["main"].app.dependency_overrides.pop(get_current_user)
    client.cookies.set("access_token", token)
    assert client.get("/me/reading-export").status_code == 200
    db_session.execute(delete(models.User).where(models.User.id == user_id)); db_session.commit()
    db_session.expire_all()
    assert db_session.get(models.UserBook, entry_id) is None
    assert db_session.get(models.ReadingAttempt, attempt_id) is None
    assert db_session.scalar(select(func.count()).select_from(models.UserPreference).where(models.UserPreference.user_id == user_id)) == 0
    assert db_session.get(models.Book, book_id) is not None
    for model in (models.RefreshToken, models.PasswordResetToken):
        assert db_session.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
    assert client.get("/me/reading-export").status_code == 401


def test_export_timeout_omits_footer_and_releases_connection(context_entry, app_modules, monkeypatch):
    import services.reading_export as exporting
    user, _ = context_entry
    engine = app_modules["database"].engine
    before = engine.pool.checkedout()
    clock = [0]
    monkeypatch.setattr(exporting, "monotonic", lambda: clock[0])
    stream = exporting.stream_reading_export(engine, user.id)
    assert json.loads(next(stream))["type"] == "metadata"
    clock[0] = 121
    with pytest.raises(TimeoutError):
        next(stream)
    assert engine.pool.checkedout() == before


def test_data_controls_require_auth_and_trusted_production_write_origin(client, context_entry, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    user, result = context_entry
    path = f"/me/reading-attempts/{result['attempt']['id']}"
    payload = {"expected_version": result["entry"]["version"], "confirmed": True}
    app_modules["main"].app.dependency_overrides.pop(get_current_user)
    assert client.get("/me/reading-export").status_code == 401
    assert client.request("DELETE", path, json=payload).status_code == 401
    assert client.request("DELETE", f"/me/library/{result['entry']['id']}", json=payload).status_code == 401
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr(app_modules["database"].settings, "is_dev", False)
    monkeypatch.setenv("CORS_ORIGINS", "https://reader.example")
    assert client.request("DELETE", path, json=payload).status_code == 403
    assert client.request("DELETE", path, json=payload, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert client.get(path).status_code == 200
    assert client.request("DELETE", path, json=payload, headers={"Origin": "https://reader.example"}).status_code == 200


def test_old_creation_retry_cannot_resurrect_a_removed_reading(client, context_entry):
    _, result = context_entry
    path = f"/me/reading-attempts/{result['attempt']['id']}"
    assert client.request("DELETE", path, json={"expected_version": result["entry"]["version"], "confirmed": True}).status_code == 200
    assert client.put(path, json={"entry_id": result["entry"]["id"], "expected_version": 1}).status_code == 409
    assert client.get(path).status_code == 404
