"""T55: the reading journal's daily progress history (owner-only; first and last value saved per attempt and day)."""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from test_lifecycle import change, entry, owner, start  # noqa: F401


def today():
    return datetime.now(timezone.utc).date()


def rows(db, attempt_id):
    db.rollback()
    return [tuple(row) for row in db.execute(text(
        "SELECT day, unit, first_value, last_value FROM reading_progress_days WHERE attempt_id = :a ORDER BY day"),
        {"a": attempt_id}).all()]


def journal(client, saved):
    response = client.get(f"/me/library/{saved['id']}/reading")
    assert response.status_code == 200, response.text
    return response.json()["progress_days"]


def test_the_readers_day_is_trusted_only_within_one_day_of_utc(app_modules):
    from services.reading import ReadingService
    now = today()
    day = ReadingService._progress_day
    assert day(None) == now
    for offset, expected in ((-1, -1), (0, 0), (1, 1), (-2, 0), (2, 0), (-400, 0)):
        assert day(now + timedelta(days=offset)) == now + timedelta(days=expected)


def test_the_request_schemas_accept_on_but_it_alone_is_not_a_change(app_modules):
    from pydantic import ValidationError
    from reading_schemas import AttemptCreate, AttemptUpdate, ReadingWorkspace
    assert AttemptUpdate(expected_version=1, progress_unit="pages", progress_value=3, on=today()).on == today()
    assert AttemptCreate(entry_id=1, expected_version=1, on=today()).on == today()
    with pytest.raises(ValidationError):
        AttemptUpdate(expected_version=1, on=today())
    with pytest.raises(ValidationError):
        AttemptUpdate(expected_version=1, state="paused", on="tomorrow-ish")
    assert ReadingWorkspace.model_fields["progress_days"].default == []


@pytest.fixture()
def reading(client, owner, seeded_books):  # noqa: F811
    saved = entry(client, seeded_books)
    identity, result = start(client, saved)
    return identity, result, saved


def test_two_saves_on_one_day_keep_the_first_value_and_move_the_last(client, db_session, reading):
    identity, result, _ = reading
    result = change(client, identity, result, progress_unit="pages", progress_value=10)
    change(client, identity, result, progress_unit="pages", progress_value=25)
    assert rows(db_session, identity) == [(today(), "pages", 10, 25)]


def test_a_new_day_adds_a_row(client, db_session, reading):
    identity, result, _ = reading
    yesterday = today() - timedelta(days=1)
    result = change(client, identity, result, progress_unit="pages", progress_value=5, on=yesterday.isoformat())
    change(client, identity, result, progress_unit="pages", progress_value=9)
    assert rows(db_session, identity) == [(yesterday, "pages", 5, 5), (today(), "pages", 9, 9)]


def test_a_unit_change_the_same_day_resets_the_row(client, db_session, reading):
    identity, result, _ = reading
    result = change(client, identity, result, progress_unit="pages", progress_value=10)
    result = change(client, identity, result, progress_unit="pages", progress_value=20)
    change(client, identity, result, progress_unit="percent", progress_value=40)
    assert rows(db_session, identity) == [(today(), "percent", 40, 40)]


def test_the_readers_date_is_used_within_one_day_of_utc_and_ignored_otherwise(client, db_session, reading):
    identity, result, _ = reading
    for offset, value in ((1, 3), (-1, 4), (2, 5), (-2, 6), (400, 7)):
        result = change(client, identity, result, progress_unit="pages", progress_value=value,
                        on=(today() + timedelta(days=offset)).isoformat())
    assert rows(db_session, identity) == [
        (today() - timedelta(days=1), "pages", 4, 4),
        (today(), "pages", 5, 7),  # +2, -2 and +400 days all fall back to the server's UTC date
        (today() + timedelta(days=1), "pages", 3, 3),
    ]


def test_a_value_that_has_not_changed_writes_nothing(client, db_session, reading):
    identity, result, _ = reading
    result = change(client, identity, result, progress_unit="pages", progress_value=10)
    before = db_session.execute(text("SELECT updated_at FROM reading_progress_days WHERE attempt_id = :a"), {"a": identity}).scalar_one()
    result = change(client, identity, result, progress_unit="pages", progress_value=10)  # same value
    result = change(client, identity, result, note="Just a note")  # unrelated change
    result = change(client, identity, result, state="paused")
    db_session.rollback()
    assert rows(db_session, identity) == [(today(), "pages", 10, 10)]
    assert db_session.execute(text("SELECT updated_at FROM reading_progress_days WHERE attempt_id = :a"), {"a": identity}).scalar_one() == before


def test_clearing_progress_keeps_the_history(client, db_session, reading):
    identity, result, _ = reading
    result = change(client, identity, result, progress_unit="pages", progress_value=10)
    change(client, identity, result, progress_unit=None, progress_value=None)
    assert rows(db_session, identity) == [(today(), "pages", 10, 10)]


def test_a_save_with_on_is_accepted_and_on_alone_is_not_a_change(client, owner, reading):  # noqa: F811
    identity, result, _ = reading
    ok = client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": result["entry"]["version"],
        "progress_unit": "pages", "progress_value": 4, "on": today().isoformat()})
    assert ok.status_code == 200, ok.text
    only_on = client.patch(f"/me/reading-attempts/{identity}", json={
        "expected_version": ok.json()["entry"]["version"], "on": today().isoformat()})
    assert only_on.status_code == 422
    assert client.patch(f"/me/reading-attempts/{identity}", json={
        "expected_version": ok.json()["entry"]["version"], "state": "paused", "on": "not-a-date"}).status_code == 422


def test_starting_with_a_value_writes_a_row_and_a_retry_with_another_day_is_still_the_same_request(client, db_session, owner, seeded_books):  # noqa: F811
    saved = entry(client, seeded_books)
    identity = str(uuid.uuid4())
    body = {"entry_id": saved["id"], "expected_version": saved["version"], "progress_unit": "pages", "progress_value": 7}
    first = client.put(f"/me/reading-attempts/{identity}", json={**body, "on": today().isoformat()})
    assert first.status_code == 200, first.text
    replay = client.put(f"/me/reading-attempts/{identity}", json={**body, "on": (today() - timedelta(days=1)).isoformat()})
    assert replay.status_code == 200, replay.text  # `on` is not part of the request's identity
    assert rows(db_session, identity) == [(today(), "pages", 7, 7)]


def test_the_owner_sees_the_journal_newest_first_and_another_reader_cannot_reach_it(client, db_session, app_modules, reading):
    from auth.dependencies import get_current_user
    identity, result, saved = reading
    yesterday = today() - timedelta(days=1)
    result = change(client, identity, result, progress_unit="pages", progress_value=14, on=yesterday.isoformat())
    change(client, identity, result, progress_unit="pages", progress_value=52)
    assert journal(client, saved) == [
        {"day": today().isoformat(), "unit": "pages", "first_value": 52, "last_value": 52},
        {"day": yesterday.isoformat(), "unit": "pages", "first_value": 14, "last_value": 14},
    ]
    other = app_modules["models"].User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="x")
    db_session.add(other)
    db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"/me/library/{saved['id']}/reading").status_code == 404
    assert client.get(f"/me/reading-attempts/{identity}").status_code == 404


def test_the_journal_is_empty_without_progress_and_capped_at_366_days(client, db_session, reading):
    identity, _, saved = reading
    assert journal(client, saved) == []
    db_session.execute(text("INSERT INTO reading_progress_days (attempt_id, day, unit, first_value, last_value) "
                            "SELECT :a, (:d)::date - g, 'pages', g, g FROM generate_series(0, 399) g"),
                       {"a": identity, "d": today().isoformat()})
    db_session.commit()
    days = journal(client, saved)
    assert len(days) == 366 and days[0]["day"] == today().isoformat() and days[-1]["last_value"] == 365


def test_the_export_includes_the_history(client, reading):
    identity, result, _ = reading
    change(client, identity, result, progress_unit="pages", progress_value=33)
    response = client.get("/me/reading-export")
    assert response.status_code == 200, response.text
    records = [json.loads(line) for line in response.text.splitlines() if line]
    mine = [r["data"] for r in records if r["type"] == "progress_day"]
    assert len(mine) == 1 and mine[0]["attempt_id"] == identity and mine[0]["first_value"] == mine[0]["last_value"] == 33
    assert records[-1]["type"] == "complete" and records[-1]["counts"]["progress_day"] == 1


def test_deleting_the_attempt_removes_its_rows(client, db_session, app_modules, reading):
    identity, result, _ = reading
    change(client, identity, result, progress_unit="pages", progress_value=12)
    assert len(rows(db_session, identity)) == 1
    attempt = db_session.get(app_modules["models"].ReadingAttempt, uuid.UUID(identity))
    db_session.delete(attempt)
    db_session.commit()
    assert rows(db_session, identity) == []


def test_the_table_refuses_values_the_attempt_would_refuse(db_session, reading):
    identity, *_ = reading
    for unit, first, last in (("percent", 101, 5), ("percent", 5, -1), ("pages", -1, 5), ("miles", 1, 1)):
        with pytest.raises(Exception):
            db_session.execute(text("INSERT INTO reading_progress_days (attempt_id, day, unit, first_value, last_value) "
                                    "VALUES (:a, :d, :u, :f, :l)"), {"a": identity, "d": date(2026, 1, 1), "u": unit, "f": first, "l": last})
        db_session.rollback()
