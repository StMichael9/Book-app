"""M3 context uses the existing guarded local disposable-database harness."""
import uuid
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
