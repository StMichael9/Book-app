"""T40: each My Books entry carries the date of its newest dated finish."""
import uuid
from datetime import date

import pytest
from sqlalchemy import event

from test_library import reader  # noqa: F401


@pytest.fixture()
def shelf(client, reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    books = sorted(seeded_books.values(), key=lambda b: b.id)[:5]
    entries = []
    for book in books:
        item = models.UserBook(user_id=reader.id, book_id=book.id, is_wanted=True)
        db_session.add(item)
        db_session.flush()
        entries.append(item)
    db_session.commit()

    def attempt(entry, state="finished", started=None, ended=None):
        db_session.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state=state, started_on=started,
                                             ended_on=ended, creation_fingerprint=uuid.uuid4().hex))
        db_session.commit()

    def listing():
        return {item["id"]: item["finished_on"] for item in client.get("/me/library", params={"limit": 100}).json()["items"]}

    return type("S", (), dict(entries=entries, attempt=staticmethod(attempt), listing=staticmethod(listing), models=models,
                              db=db_session, client=client, reader=reader))


def test_a_finished_book_returns_its_finish_date_and_a_reread_the_newest(shelf):
    once, reread, *_ = shelf.entries
    shelf.attempt(once, ended=date(2025, 12, 20))
    shelf.attempt(reread, ended=date(2024, 3, 1))
    shelf.attempt(reread, ended=date(2026, 1, 3))
    shelf.attempt(reread, ended=date(2025, 6, 6))
    got = shelf.listing()
    assert got[once.id] == "2025-12-20" and got[reread.id] == "2026-01-03"


def test_never_finished_undated_and_not_finished_states_are_null(shelf):
    never, undated, reading, dnf, _ = shelf.entries
    shelf.attempt(undated, ended=None)
    shelf.attempt(reading, "reading", started=date(2026, 1, 1))
    shelf.attempt(dnf, "dnf", ended=date(2026, 2, 2))
    got = shelf.listing()
    assert got[never.id] is None and got[undated.id] is None and got[reading.id] is None and got[dnf.id] is None


def test_another_readers_dates_never_leak(shelf, app_modules):
    from auth.dependencies import get_current_user
    models = shelf.models
    mine = shelf.entries[0]
    other = models.User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="x")
    shelf.db.add(other)
    shelf.db.flush()
    theirs = models.UserBook(user_id=other.id, book_id=mine.book_id, is_wanted=True)
    shelf.db.add(theirs)
    shelf.db.commit()
    shelf.attempt(theirs, ended=date(2026, 5, 5))
    assert shelf.listing()[mine.id] is None
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert [i["finished_on"] for i in shelf.client.get("/me/library").json()["items"]] == ["2026-05-05"]


def test_no_extra_statement_for_the_date(shelf, app_modules):
    shelf.attempt(shelf.entries[0], ended=date(2025, 1, 1))
    engine = app_modules["database"].engine
    seen = []
    listener = lambda conn, cur, stmt, *rest: seen.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        shelf.client.get("/me/library", params={"limit": 100})
        with_dates = len(seen)
        seen.clear()
        shelf.db.execute(shelf.models.ReadingAttempt.__table__.delete())
        shelf.db.commit()
        seen.clear()
        shelf.client.get("/me/library", params={"limit": 100})
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert with_dates == len(seen)
