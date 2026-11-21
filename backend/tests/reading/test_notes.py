"""T68: reading notes stored one per row, each with its own date and the reading's progress when it was written."""
import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import event, text

from test_lifecycle import change, entry, owner, start  # noqa: F401

PARA = chr(10) * 2


@pytest.fixture()
def reading(client, owner, seeded_books):  # noqa: F811
    saved = entry(client, seeded_books)
    identity, result = start(client, saved)
    return identity, result, saved


def add(client, identity, text_value="A thought", request_id=None):
    return client.post(f"/me/reading-attempts/{identity}/notes", json={"request_id": request_id or str(uuid.uuid4()), "text": text_value})


def detail(client, identity):
    response = client.get(f"/me/reading-attempts/{identity}")
    assert response.status_code == 200, response.text
    return response.json()["attempt"]


# --- migration SQL ------------------------------------------------------------------------------------------------------

def migration():
    path = Path(__file__).parent.parent.parent / "alembic" / "versions" / "f4b8d2a60e17_reading_notes.py"
    spec = importlib.util.spec_from_file_location("reading_notes_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backfill_splits_on_blank_lines_in_order_and_downgrade_joins_back(app_modules, db_session):
    models = app_modules["models"]
    module = migration()
    user = models.User(email=f"mig-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(user)
    db_session.flush()
    book = models.UserBook(user_id=user.id, private_title="Migrating", is_owned=True, status="owned", version=1,
        create_request_id=uuid.uuid4(), creation_fingerprint="f" * 64)
    db_session.add(book)
    db_session.flush()
    notes = {"three": (chr(10)).join(["First", "still first", "", "Second", "", "   ", "Third  "]),
             "windows": "One" + chr(13) + chr(10) + chr(13) + chr(10) + "Two", "blank": "  " + chr(10) + " ", "none": None}
    ids = {}
    for index, (name, value) in enumerate(notes.items()):
        ids[name] = uuid.uuid4()
        # one active reading per entry is enforced, so finished readings carry the history
        db_session.add(models.ReadingAttempt(id=ids[name], user_book_id=book.id, state="finished", note=value,
            creation_fingerprint=str(index) * 64))
    db_session.flush()
    try:
        db_session.execute(text(module.BACKFILL))
        rows = lambda name: [r[0] for r in db_session.execute(
            text("SELECT text FROM reading_notes WHERE attempt_id = :a ORDER BY id"), {"a": ids[name]})]
        assert rows("three") == ["First" + chr(10) + "still first", "Second", "Third"]
        assert rows("windows") == ["One", "Two"] and rows("blank") == [] and rows("none") == []
        assert db_session.execute(text("SELECT count(*) FROM reading_notes WHERE attempt_id = :a AND written_at IS NULL "
            "AND edited_at IS NULL AND progress_unit IS NULL AND request_id IS NOT NULL"), {"a": ids["three"]}).scalar() == 3
        # the column still holds the old text after the upgrade, and the reader then deletes every note of one reading
        db_session.execute(text("DELETE FROM reading_notes WHERE attempt_id = :a"), {"a": ids["windows"]})
        db_session.execute(text(module.CLEAR))
        db_session.execute(text(module.RESTORE))
        assert db_session.execute(text("SELECT note FROM reading_attempts WHERE id = :a"), {"a": ids["windows"]}).scalar() is None
        restored = db_session.execute(text("SELECT note FROM reading_attempts WHERE id = :a"), {"a": ids["three"]}).scalar()
        assert restored == "First" + chr(10) + "still first" + PARA + "Second" + PARA + "Third"
    finally:
        db_session.rollback()


# --- create, replay, edit, delete -------------------------------------------------------------------------------------

def test_create_replay_and_conflict(client, reading):
    identity, _, _ = reading
    request_id = str(uuid.uuid4())
    first = add(client, identity, "  Opening line  ", request_id)
    assert first.status_code == 200, first.text
    note = first.json()
    assert note["text"] == "Opening line" and note["written_at"] and note["edited_at"] is None
    assert add(client, identity, "Opening line", request_id).json() == note
    assert add(client, identity, "Something else", request_id).status_code == 409
    assert len(detail(client, identity)["notes"]) == 1


def test_progress_snapshot_when_there_is_progress_and_null_when_not(client, reading):
    identity, result, _ = reading
    first = add(client, identity).json()
    assert (first["progress_unit"], first["progress_value"]) == (None, None)
    change(client, identity, result, progress_unit="pages", progress_value=42)
    second = add(client, identity, "Page note").json()
    assert (second["progress_unit"], second["progress_value"]) == ("pages", 42)
    attempt = detail(client, identity)
    assert [n["text"] for n in attempt["notes"]] == ["A thought", "Page note"]       # id order
    assert attempt["note"] == "A thought" + PARA + "Page note"                        # the compatibility field


def test_edit_keeps_date_and_page_and_delete(client, reading):
    identity, result, _ = reading
    change(client, identity, result, progress_unit="percent", progress_value=30)
    note = add(client, identity, "Before").json()
    edited = client.patch(f"/me/reading-notes/{note['id']}", json={"text": "After"})
    assert edited.status_code == 200
    body = edited.json()
    assert body["text"] == "After" and body["edited_at"]
    assert (body["written_at"], body["progress_unit"], body["progress_value"]) == (note["written_at"], "percent", 30)
    assert client.delete(f"/me/reading-notes/{note['id']}").status_code == 204
    assert detail(client, identity)["notes"] == [] and detail(client, identity)["note"] is None
    assert client.delete(f"/me/reading-notes/{note['id']}").status_code == 404


def test_notes_do_not_bump_the_entry_version(client, reading):
    identity, result, saved = reading
    add(client, identity)
    assert client.get(f"/me/reading-attempts/{identity}").json()["entry"]["version"] == result["entry"]["version"]


def test_limits_blank_text_and_the_cap(client, reading, db_session):
    identity, _, _ = reading
    assert add(client, identity, "   ").status_code == 422
    assert add(client, identity, "x" * 2001).status_code == 422
    assert add(client, identity, "x" * 2000).status_code == 200
    db_session.execute(text("INSERT INTO reading_notes (attempt_id, text, request_id) SELECT CAST(:a AS uuid), 'n', gen_random_uuid() "
        "FROM generate_series(1, 199)"), {"a": identity})
    db_session.commit()
    assert add(client, identity, "the 201st").status_code == 422
    assert len(detail(client, identity)["notes"]) == 200


def test_owner_scoping_returns_404(client, reading, app_modules, db_session):
    from auth.dependencies import get_current_user
    identity, _, _ = reading
    note = add(client, identity).json()
    models = app_modules["models"]
    other = models.User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other)
    db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert add(client, identity).status_code == 404
    assert client.patch(f"/me/reading-notes/{note['id']}", json={"text": "mine now"}).status_code == 404
    assert client.delete(f"/me/reading-notes/{note['id']}").status_code == 404
    assert client.get(f"/me/reading-attempts/{identity}").status_code == 404


# --- AttemptUpdate.note compatibility ------------------------------------------------------------------------------------

def test_attempt_update_note_replaces_all_notes(client, reading):
    identity, result, _ = reading
    add(client, identity, "Old one")
    add(client, identity, "Old two")
    result = change(client, identity, result, note="New A" + PARA + "New B" + PARA + PARA + "New C")
    attempt = result["attempt"]
    assert [n["text"] for n in attempt["notes"]] == ["New A", "New B", "New C"]
    assert all(n["written_at"] is None and n["progress_unit"] is None for n in attempt["notes"])
    assert attempt["note"] == "New A" + PARA + "New B" + PARA + "New C"
    same = change(client, identity, result, note="New A" + PARA + "New B" + PARA + "New C")        # no change: same notes, same ids
    assert [n["id"] for n in same["attempt"]["notes"]] == [n["id"] for n in attempt["notes"]]
    cleared = change(client, identity, same, note=None)
    assert cleared["attempt"]["notes"] == [] and cleared["attempt"]["note"] is None


# --- readers ------------------------------------------------------------------------------------------------------------

def test_has_note_filter_follows_the_notes(client, reading):
    identity, _, saved = reading
    ids = lambda: [item["id"] for item in client.get("/me/library?has_note=true").json()["items"]]
    assert saved["id"] not in ids()
    note = add(client, identity).json()
    assert saved["id"] in ids()
    client.delete(f"/me/reading-notes/{note['id']}")
    assert saved["id"] not in ids()


def test_json_and_csv_exports_carry_the_notes(client, reading):
    identity, result, _ = reading
    change(client, identity, result, progress_unit="pages", progress_value=7)
    add(client, identity, "First note")
    add(client, identity, "Second note")
    lines = [json.loads(line) for line in client.get("/me/reading-export").text.splitlines() if line]
    data = next(line["data"] for line in lines if line["type"] == "reading" and line["data"]["id"] == identity)
    assert data["note"] == "First note" + PARA + "Second note"
    assert [(n["text"], n["progress_unit"], n["progress_value"]) for n in data["notes"]] == [("First note", "pages", 7), ("Second note", "pages", 7)]
    assert data["notes"][0]["written_at"] and data["notes"][0]["edited_at"] is None
    csv_text = client.get("/me/library/export.csv")
    assert csv_text.status_code == 200, csv_text.text
    assert "First note" in csv_text.text and "Second note" in csv_text.text


def test_no_query_per_attempt(client, reading, app_modules, db_session):
    """Reading the journal, the export and the library list run a fixed number of statements however many notes there are."""
    identity, _, _ = reading
    engine = app_modules["database"].engine

    def count(path):
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        event.listen(engine, "before_cursor_execute", listener)
        try:
            response = client.get(path)
            assert response.status_code == 200, response.text
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen)

    paths = ("/me/reading-export", "/me/library/export.csv", "/me/library?has_note=true", f"/me/reading-attempts/{identity}")
    for _ in range(2):
        add(client, identity)
    before = [count(path) for path in paths]
    for _ in range(30):
        add(client, identity)
    assert [count(path) for path in paths] == before


def test_workspace_carries_the_notes_without_an_extra_statement(client, reading, app_modules, db_session):
    identity, _, saved = reading
    add(client, identity, "First")
    add(client, identity, "Second")
    engine = app_modules["database"].engine
    seen = []
    listener = lambda conn, cursor, statement, *a: seen.append(statement)
    db_session.commit()
    db_session.expunge_all()
    event.listen(engine, "before_cursor_execute", listener)
    try:
        response = client.get(f"/me/library/{saved['id']}/reading")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    attempt = response.json()["current_attempt"]
    assert [n["text"] for n in attempt["notes"]] == ["First", "Second"] and attempt["note"] == "First" + PARA + "Second"
    assert not any("FROM reading_notes" in s and "jsonb_agg" not in s for s in seen)       # never the lazy per-attempt read
