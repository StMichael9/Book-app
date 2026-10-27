"""First-visit speed: every database round trip costs about 60 ms (API in Oregon, Neon in Ohio), so each endpoint a
page needs on first view is held to a statement budget. Counted on the real engine, with real cookie authentication."""
from __future__ import annotations

import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, text
from starlette.requests import Request
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    from rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def statements(app_modules):
    engine = app_modules["database"].engine
    seen = []
    def record(_connection, _cursor, statement, _parameters, _context, _many): seen.append(statement)
    event.listen(engine, "before_cursor_execute", record)
    yield seen
    event.remove(engine, "before_cursor_execute", record)


@pytest.fixture
def member(app_modules, db_session, client, monkeypatch):
    """A signed-in reader (real access-token cookie, so the user lookup is counted) with one book being read."""
    from auth.jwt import create_access_token
    models = app_modules["models"]
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    user = models.User(email=f"speed-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    refresh = f"refresh-{uuid.uuid4().hex}"
    db_session.add(models.RefreshToken(user_id=user.id, token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
                                       expires_at=datetime.now(timezone.utc) + timedelta(days=7)))
    db_session.commit()
    client.cookies.set("access_token", create_access_token({"sub": str(user.id), "ver": user.token_version}))
    book = db_session.query(models.Book).filter(models.Book.title == "Dracula").one()
    entry = client.put(f"/me/library/books/{book.id}", json={"is_wanted": True}).json()
    attempt_id = str(uuid.uuid4())
    started = client.put(f"/me/reading-attempts/{attempt_id}", json={"entry_id": entry["id"], "expected_version": entry["version"], "state": "reading"})
    assert started.status_code == 200, started.text
    from rate_limit import limiter
    limiter.reset()
    return {"user": user, "refresh": refresh, "entry_id": entry["id"], "book_id": book.id}


def measure(db_session, statements, call):
    """Statements issued by one request, as a fresh request would see them (no leftover identity map)."""
    db_session.commit()
    db_session.expunge_all()
    statements.clear()
    response = call()
    if os.environ.get("REPORT_COUNTS"):  # REPORT_COUNTS=1 pytest -s ... prints the budget actually used
        print(f"COUNT {len(statements):2d}  {response.request.method} {response.request.url.path}?{response.request.url.query.decode()}")
    return response, list(statements)


def test_anonymous_book_detail_is_one_statement(client, seeded_books, db_session, statements):
    dracula = seeded_books["Dracula"].id
    response, issued = measure(db_session, statements, lambda: client.get(f"/books/{dracula}"))
    assert response.status_code == 200 and response.json()["authors"] and response.json()["title"] == "Dracula"
    assert len(issued) == 1, issued


def test_anonymous_list_is_two_statements(client, seeded_books, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.get("/books", params={"size": 24}))
    assert response.status_code == 200 and response.json()["total"] == 4
    assert all(item["authors"] for item in response.json()["items"])
    assert len(issued) <= 2, issued


def test_search_list_is_two_statements_and_keeps_its_total(client, seeded_books, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.get("/books", params={"book": "o", "size": 2, "page": 2}))
    assert response.status_code == 200 and response.json()["total"] >= 2
    assert len(issued) <= 3, issued  # a page past the end may need one extra count


def test_signed_in_list_is_three_statements_including_the_user(client, member, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.get("/books", params={"size": 24}))
    assert response.status_code == 200
    assert len(issued) <= 3, issued


@pytest.mark.parametrize("path", ["/me/reading-capabilities", "/me/library", "/me/home", "/me/preferences", "/me/books"])
def test_signed_in_pages_use_at_most_three_statements(path, client, member, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.get(path))
    assert response.status_code == 200, response.text
    assert len(issued) <= 3, issued


def test_reading_workspace_uses_at_most_three_statements(client, member, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.get(f"/me/library/{member['entry_id']}/reading"))
    assert response.status_code == 200 and response.json()["current_attempt"]["state"] == "reading"
    assert len(issued) <= 3, issued


def test_library_lookup_uses_at_most_three_statements(client, member, db_session, statements):
    response, issued = measure(db_session, statements, lambda: client.post("/me/library/lookup", json={"book_ids": [member["book_id"]]}))
    assert response.status_code == 200 and response.json()["items"][0]["entry_id"] == member["entry_id"]
    assert len(issued) <= 3, issued


def test_session_refresh_uses_at_most_three_statements(client, member, db_session, statements):
    client.cookies.clear()
    client.cookies.set("refresh_token", member["refresh"])
    response, issued = measure(db_session, statements, lambda: client.post("/auth/refresh"))
    assert response.status_code == 200, response.text
    assert len(issued) <= 3, issued
    # The presented token was consumed and a new one issued; replaying the old one fails.
    client.cookies.clear()
    client.cookies.set("refresh_token", member["refresh"])
    assert client.post("/auth/refresh").status_code == 401


def test_a_repeat_anonymous_read_makes_no_database_round_trip(client, seeded_books, db_session, statements):
    path = f"/books/{seeded_books['Dracula'].id}"
    db_session.expunge_all()
    first, issued = measure(db_session, statements, lambda: client.get(path))
    second, again = measure(db_session, statements, lambda: client.get(path))
    assert first.json() == second.json() and len(issued) == 1 and again == []
    listing = lambda: client.get("/books", params={"size": 24})
    one, first_issued = measure(db_session, statements, listing)
    two, second_issued = measure(db_session, statements, listing)
    assert one.json() == two.json() and first_issued and second_issued == []
    other, different = measure(db_session, statements, lambda: client.get("/books", params={"size": 3}))
    assert len(other.json()["items"]) == 3 and different


def test_a_cached_answer_keeps_the_public_cache_header(client, seeded_books):
    path = f"/books/{seeded_books['Dracula'].id}"
    for _ in range(2):
        assert client.get(path).headers["cache-control"] == "public, max-age=60, stale-while-revalidate=300"


def test_signed_in_requests_never_use_or_fill_the_cache(client, member, seeded_books, db_session, statements):
    path = f"/books/{seeded_books['Dracula'].id}"
    first, issued = measure(db_session, statements, lambda: client.get(path))
    second, again = measure(db_session, statements, lambda: client.get(path))
    assert first.status_code == second.status_code == 200 and issued and again
    client.cookies.clear()
    anonymous, filled = measure(db_session, statements, lambda: client.get(path))
    assert anonymous.status_code == 200 and filled  # nothing from the signed-in requests was stored


def test_cache_entries_expire_and_the_cache_can_be_cleared(client, seeded_books, db_session, statements, monkeypatch):
    import time
    from services import catalogue_cache
    path = f"/books/{seeded_books['Dracula'].id}"
    measure(db_session, statements, lambda: client.get(path))
    assert measure(db_session, statements, lambda: client.get(path))[1] == []
    now = time.monotonic()
    monkeypatch.setattr(catalogue_cache.time, "monotonic", lambda: now + 11 * 60)
    assert measure(db_session, statements, lambda: client.get(path))[1] != []  # a book page lives 10 minutes
    listing = lambda: client.get("/books", params={"size": 24})
    monkeypatch.setattr(catalogue_cache.time, "monotonic", lambda: now)
    measure(db_session, statements, listing)
    monkeypatch.setattr(catalogue_cache.time, "monotonic", lambda: now + 61)
    assert measure(db_session, statements, listing)[1] != []  # a list lives 60 seconds
    catalogue_cache.clear()
    assert measure(db_session, statements, lambda: client.get(path))[1] != []


def test_the_cache_holds_at_most_two_thousand_entries():
    from services import catalogue_cache
    catalogue_cache.clear()
    for index in range(2105):
        catalogue_cache.put(("book", index), {"id": index}, ttl=600)
    assert catalogue_cache.size() <= 2000
    assert catalogue_cache.get(("book", 2104)) == {"id": 2104}
    assert catalogue_cache.get(("book", 0)) is None
    catalogue_cache.clear()


def test_read_requests_use_an_autocommit_connection_and_writes_do_not(app_modules):
    database = app_modules["database"]
    def request(method, path):
        return Request({"type": "http", "method": method, "path": path, "headers": [], "query_string": b""})
    def idle_after_select(method, path):
        generator = database.get_db(request(method, path))
        session = next(generator)
        try:
            session.execute(text("SELECT 1"))
            return session.connection().connection.dbapi_connection.info.transaction_status
        finally:
            generator.close()
    from psycopg2 import extensions
    assert idle_after_select("GET", "/books/1") == extensions.TRANSACTION_STATUS_IDLE
    assert idle_after_select("GET", "/me/home") == extensions.TRANSACTION_STATUS_IDLE
    assert idle_after_select("POST", "/me/library/lookup") == extensions.TRANSACTION_STATUS_INTRANS
    assert idle_after_select("PUT", "/me/library/books/1") == extensions.TRANSACTION_STATUS_INTRANS
    assert idle_after_select("GET", "/me/library/export.csv") == extensions.TRANSACTION_STATUS_INTRANS
    assert idle_after_select("GET", "/me/reading-export") == extensions.TRANSACTION_STATUS_INTRANS
    assert idle_after_select("GET", "/me/library/imports") == extensions.TRANSACTION_STATUS_INTRANS


def test_a_read_retries_once_when_the_connection_was_dropped(app_modules, monkeypatch):
    database = app_modules["database"]
    original = Session.execute
    calls = []
    def dropped_once(self, *args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise OperationalError("SELECT 1", {}, Exception("server closed the connection unexpectedly"), connection_invalidated=True)
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Session, "execute", dropped_once)
    generator = database.get_db(Request(
        {"type": "http", "method": "GET", "path": "/books/1", "headers": [], "query_string": b""}))
    session = next(generator)
    try:
        assert session.execute(text("SELECT 1")).scalar() == 1
    finally:
        generator.close()
    assert len(calls) == 2  # the dropped attempt, then exactly one retry on a fresh connection


def test_a_read_that_keeps_failing_is_not_retried_forever(app_modules, monkeypatch):
    database = app_modules["database"]
    calls = []
    def always_dropped(self, *args, **kwargs):
        calls.append(1)
        raise OperationalError("SELECT 1", {}, Exception("server closed the connection unexpectedly"), connection_invalidated=True)
    monkeypatch.setattr(Session, "execute", always_dropped)
    generator = database.get_db(Request(
        {"type": "http", "method": "GET", "path": "/books/1", "headers": [], "query_string": b""}))
    session = next(generator)
    try:
        with pytest.raises(OperationalError):
            session.execute(text("SELECT 1"))
    finally:
        generator.close()
    assert len(calls) == 2


def test_other_database_errors_are_not_retried(app_modules, monkeypatch):
    database = app_modules["database"]
    calls = []
    def broken(self, *args, **kwargs):
        calls.append(1)
        raise OperationalError("SELECT 1", {}, Exception("canceling statement due to statement timeout"), connection_invalidated=False)
    monkeypatch.setattr(Session, "execute", broken)
    generator = database.get_db(Request(
        {"type": "http", "method": "GET", "path": "/books/1", "headers": [], "query_string": b""}))
    session = next(generator)
    try:
        with pytest.raises(OperationalError):
            session.execute(text("SELECT 1"))
    finally:
        generator.close()
    assert len(calls) == 1


def test_the_engine_recycles_connections_instead_of_pinging_them(app_modules):
    engine = app_modules["database"].engine
    assert engine.pool._pre_ping is False and engine.pool._recycle == 240
