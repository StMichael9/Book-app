"""M2 uses only the guarded disposable test target from the existing harness."""
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import delete, event, func, select


@pytest.fixture
def owner(app_modules, db_session, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    user = app_modules["models"].User(email=f"m2-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(user)
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()


def entry(client, seeded_books):
    book = next(iter(seeded_books.values()))
    response = client.put(f"/me/library/books/{book.id}", json={"is_owned": True, "is_wanted": True})
    assert response.status_code == 200, response.text
    return response.json()


def start(client, saved, **values):
    identity = str(uuid.uuid4())
    response = client.put(f"/me/reading-attempts/{identity}", json={"entry_id": saved["id"],
        "expected_version": saved["version"], **values})
    assert response.status_code == 200, response.text
    return identity, response.json()


def change(client, identity, result, **values):
    response = client.patch(f"/me/reading-attempts/{identity}", json={
        "expected_version": result["entry"]["version"], **values})
    assert response.status_code == 200, response.text
    return response.json()


def test_full_lifecycle_reopen_and_reread_without_optional_inputs(client, owner, seeded_books):
    saved = entry(client, seeded_books)
    identity, result = start(client, saved)
    assert result["entry"]["is_owned"] and not result["entry"]["is_wanted"]
    assert result["attempt"]["started_on"] is None and result["attempt"]["ended_on"] is None
    result = change(client, identity, result, state="paused")
    assert result["attempt"]["state"] == "paused"
    result = change(client, identity, result, state="reading")
    result = change(client, identity, result, state="finished", ended_on="2026-01-02")
    result = change(client, identity, result, state="reading")
    assert result["attempt"]["ended_on"] is None
    result = change(client, identity, result, state="dnf")
    second, result = start(client, result["entry"])
    assert second != identity
    history = client.get(f"/me/library/{saved['id']}/attempts").json()["items"]
    assert len(history) == 2 and {row["state"] for row in history} == {"dnf", "reading"}
    assert client.get(f"/me/library/{saved['id']}/reading").json()["current_attempt"]["id"] == second


def test_creation_replay_after_transitions_and_intent_conflict(client, owner, seeded_books):
    saved = entry(client, seeded_books)
    identity, result = start(client, saved)
    result = change(client, identity, result, state="finished")
    body = {"entry_id": saved["id"], "expected_version": 1}
    replay = client.put(f"/me/reading-attempts/{identity}", json=body)
    assert replay.status_code == 200 and replay.json()["attempt"]["state"] == "finished"
    assert client.put(f"/me/reading-attempts/{identity}", json={**body, "state": "dnf"}).status_code == 409
    # History stays a summary; M3 context is deliberately detail-only.
    summary = {key: value for key, value in replay.json()["attempt"].items() if key not in {"note", "reaction"}}
    assert client.get(f"/me/library/{saved['id']}/attempts").json()["items"] == [summary]


def test_active_conflicts_versions_and_reopen_cannot_close_other_reading(client, owner, seeded_books):
    saved = entry(client, seeded_books)
    first, result = start(client, saved)
    assert client.patch(f"/me/reading-attempts/{first}", json={"state": "paused", "expected_version": 1}).status_code == 409
    second_body = {"entry_id": saved["id"], "expected_version": result["entry"]["version"]}
    assert client.put(f"/me/reading-attempts/{uuid.uuid4()}", json=second_body).status_code == 409
    result = change(client, first, result, state="finished")
    second, result = start(client, result["entry"])
    assert client.patch(f"/me/reading-attempts/{first}", json={"state": "reading", "expected_version": result["entry"]["version"]}).status_code == 409
    assert client.get(f"/me/library/{saved['id']}/reading").json()["current_attempt"]["id"] == second


@pytest.mark.parametrize("bad", [
    {"progress_unit": "percent", "progress_value": 101}, {"progress_unit": "pages"},
    {"progress_value": True}, {"state": None}, {"state": "reading", "ended_on": "2025-01-01"},
    {"started_on": "2026-01-02", "ended_on": "2026-01-01", "state": "finished"},
    {"progress_unit": "pages", "progress_value": 40, "total_pages": 30},
])
def test_invalid_updates_are_atomic(client, owner, seeded_books, bad):
    identity, result = start(client, entry(client, seeded_books))
    response = client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": result["entry"]["version"], **bad})
    assert response.status_code == 422, response.text
    current = client.get(f"/me/library/{result['entry']['id']}/reading").json()
    assert current["current_attempt"] == result["attempt"] and current["entry"]["version"] == result["entry"]["version"]


def test_progress_correction_and_terminal_state_are_independent(client, owner, seeded_books):
    identity, result = start(client, entry(client, seeded_books))
    result = change(client, identity, result, progress_unit="percent", progress_value=100)
    assert result["attempt"]["state"] == "reading"
    result = change(client, identity, result, progress_value=10)
    assert result["attempt"]["progress_value"] == 10
    result = change(client, identity, result, progress_unit="pages", progress_value=10, total_pages=None)
    assert result["attempt"]["total_pages"] is None
    result = change(client, identity, result, progress_unit=None, progress_value=None)
    assert result["attempt"]["progress_value"] is None


def test_private_identity_retries_unicode_and_owner_only_duplicate_suggestions(client, owner, app_modules, db_session):
    models = app_modules["models"]
    catalogue_before = [db_session.scalar(select(func.count()).select_from(model)) for model in (models.Book, models.Author, models.Tag)]
    body = {"request_id": str(uuid.uuid4()), "title": "  読書の家  ", "author": " 同名 ", "is_owned": True}
    first = client.post("/me/library/private", json=body)
    assert first.status_code == 200, first.text
    first = first.json()
    assert first["private_title"] == "読書の家" and first["book_id"] is None
    assert client.post("/me/library/private", json=body).json()["id"] == first["id"]
    assert client.post("/me/library/private", json={**body, "title": "Different"}).status_code == 409
    second = client.post("/me/library/private", json={**body, "request_id": str(uuid.uuid4())}).json()
    assert second["id"] != first["id"]
    assert len(client.get("/me/library/private-matches", params={"title": "読書の家"}).json()["items"]) == 2
    _, result = start(client, first)
    assert result["attempt"]["edition_id"] is None
    assert [db_session.scalar(select(func.count()).select_from(model)) for model in (models.Book, models.Author, models.Tag)] == catalogue_before


def test_owner_isolation_disabled_reads_and_unchanged_public_catalogue(client, owner, seeded_books, db_session, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    models = app_modules["models"]
    saved = entry(client, seeded_books)
    identity, result = start(client, saved)
    other = models.User(email=f"m2-other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other)
    db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"/me/library/{saved['id']}/reading").status_code == 404
    assert client.get(f"/me/library/{saved['id']}/attempts").status_code == 404
    assert client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": 2, "state": "dnf"}).status_code == 404
    assert client.get("/me/home").json()["current_reads"] == []
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: owner
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    assert client.get("/me/home").status_code == 200
    assert client.get(f"/me/library/{saved['id']}/reading").headers["cache-control"] == "private, no-store"
    assert client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": 2, "state": "dnf"}).status_code == 403
    public = client.get(f"/books/{saved['book_id']}").json()
    assert not ({"attempt", "current_attempt", "save_note", "private_title"} & public.keys())


def test_editions_are_work_scoped_and_snapshot_survives_deletion(client, owner, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    saved = entry(client, seeded_books)
    edition = models.Edition(book_id=saved["book_id"], source_id="/books/OLM2M", page_count=300,
        physical_format="Paperback", languages=["eng"], publishers=[])
    db_session.add(edition)
    db_session.commit()
    edition_id = edition.id
    identity, result = start(client, saved, edition_id=edition_id)
    assert result["attempt"]["total_pages"] == 300
    db_session.execute(delete(models.Edition).where(models.Edition.id == edition_id))
    db_session.commit()
    db_session.expire_all()
    snapshot = client.get(f"/me/library/{saved['id']}/reading").json()["current_attempt"]
    assert snapshot["edition_id"] is None and snapshot["edition_source_id"] == "/books/OLM2M"
    assert snapshot["total_pages"] == 300 and snapshot["edition_format"] == "Paperback"


def test_history_pagination_unknown_dates_and_bounded_home(client, owner, seeded_books, app_modules):
    saved = entry(client, seeded_books)
    for _ in range(3):
        _, result = start(client, saved, state="finished")
        saved = result["entry"]
        assert result["attempt"]["started_on"] is None and result["attempt"]["ended_on"] is None
    first = client.get(f"/me/library/{saved['id']}/attempts?limit=2").json()
    second = client.get(f"/me/library/{saved['id']}/attempts", params={"limit": 2, "cursor": first["next_cursor"]}).json()
    assert len(first["items"]) == 2 and len(second["items"]) == 1 and second["next_cursor"] is None
    assert client.get(f"/me/library/{saved['id']}/attempts", params={"cursor": str(uuid.uuid4())}).status_code == 422
    for book in list(seeded_books.values())[:4]:
        response = client.put(f"/me/library/books/{book.id}", json={"is_owned": True}).json()
        start(client, response)
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
    engine = app_modules["database"].engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        home = client.get("/me/home").json()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(home["current_reads"]) == 3 and home["reading_count"] == 4
    assert len(statements) <= 6, statements
    assert "note" not in home["current_reads"][0]["attempt"]


def test_simultaneous_starts_and_retry_identity(client, owner, seeded_books, app_modules):
    from fastapi import HTTPException
    from reading_schemas import AttemptCreate
    from services.reading import ReadingService
    saved = entry(client, seeded_books)
    identity = uuid.uuid4()
    payload = AttemptCreate(entry_id=saved["id"], expected_version=saved["version"])
    user_id = owner.id
    def create(attempt_id):
        with app_modules["database"].SessionLocal() as session:
            try:
                result = ReadingService(session).create_attempt(user_id, attempt_id, payload)
                return str(result.attempt.id)
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, [identity, identity]))
    assert results == [str(identity), str(identity)]
    history = client.get(f"/me/library/{saved['id']}/attempts").json()["items"]
    assert len(history) == 1
    payload = AttemptCreate(entry_id=saved["id"], expected_version=2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(create, [uuid.uuid4(), uuid.uuid4()])) == [409, 409]
    other_book = next(book for book in seeded_books.values() if book.id != saved["book_id"])
    other_entry = client.put(f"/me/library/books/{other_book.id}", json={"is_owned": True}).json()
    payload = AttemptCreate(entry_id=other_entry["id"], expected_version=other_entry["version"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        different_requests = list(pool.map(create, [uuid.uuid4(), uuid.uuid4()]))
    assert sum(isinstance(value, str) for value in different_requests) == 1
    assert different_requests.count(409) == 1


def test_wrong_edition_and_later_want_preserved_on_finish(client, owner, seeded_books, db_session, app_modules):
    saved = entry(client, seeded_books)
    models = app_modules["models"]
    other_id = next(book.id for book in seeded_books.values() if book.id != saved["book_id"])
    edition = models.Edition(book_id=other_id, source_id="/books/OLM2OTHER", languages=[], publishers=[])
    db_session.add(edition); db_session.commit()
    response = client.put(f"/me/reading-attempts/{uuid.uuid4()}", json={"entry_id": saved["id"], "expected_version": 1, "edition_id": edition.id})
    assert response.status_code == 422
    identity, result = start(client, saved)
    saved = client.patch(f"/me/library/{saved['id']}", json={"is_wanted": True, "expected_version": result["entry"]["version"]}).json()
    result = change(client, identity, {"entry": saved}, state="finished")
    assert result["entry"]["is_wanted"] and result["entry"]["is_owned"]
