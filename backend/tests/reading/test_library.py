import time
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, event, func, insert, select, text
from sqlalchemy.exc import IntegrityError


@pytest.fixture
def reader(app_modules, db_session, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    user = models.User(email=f"reader-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    db_session.rollback()
    limiter.reset()


def book_id(seeded_books):
    return next(iter(seeded_books.values())).id


def test_disabled_routes_and_allowlist(client, reader, app_modules, monkeypatch):
    settings = app_modules["database"].settings
    monkeypatch.setattr(settings, "reading_v3_enabled", False)
    assert client.get("/me/reading-capabilities").json()["enabled"] is False
    assert client.get("/me/library").status_code == 403
    monkeypatch.setattr(settings, "reading_v3_enabled", True)
    monkeypatch.setattr(settings, "reading_v3_user_ids", str(uuid.uuid4()))
    assert client.get("/me/library").status_code == 403
    monkeypatch.setattr(settings, "reading_v3_user_ids", str(reader.id))
    assert client.get("/me/library").status_code == 200


def test_independent_flags_noop_and_stale_write(client, reader, seeded_books):
    path = f"/me/library/books/{book_id(seeded_books)}"
    first = client.put(path, json={"is_wanted": True})
    assert first.status_code == 200
    entry = first.json()
    assert entry["version"] == 1 and entry["is_wanted"] and not entry["is_owned"]
    noop = client.put(path, json={"is_wanted": True}).json()
    assert noop["id"] == entry["id"] and noop["version"] == 1
    assert client.put(path, json={"is_owned": True}).status_code == 409
    changed = client.patch(f"/me/library/{entry['id']}", json={"is_owned": True, "expected_version": 1}).json()
    assert changed["is_owned"] and changed["is_wanted"] and changed["version"] == 2
    stale = client.patch(f"/me/library/{entry['id']}", json={"is_wanted": False, "expected_version": 1})
    assert stale.status_code == 409 and stale.json()["detail"]["current"]["is_wanted"]
    unchanged = client.get(f"/me/library/{entry['id']}").json()
    assert unchanged == changed
    assert client.patch(f"/me/library/{entry['id']}", json={"is_owned": "yes", "expected_version": 2}).status_code == 422
    assert client.patch(f"/me/library/{entry['id']}", json={"is_owned": None, "expected_version": 2}).status_code == 422
    assert client.patch(f"/me/library/{entry['id']}", json={"is_owned": False, "expected_version": 2, "user_id": str(reader.id)}).status_code == 422


def test_owner_isolation_and_lookup_limits(client, reader, seeded_books, db_session, app_modules):
    from auth.dependencies import get_current_user
    entry = client.put(f"/me/library/books/{book_id(seeded_books)}", json={"is_wanted": True}).json()
    other = app_modules["models"].User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other)
    db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"/me/library/{entry['id']}").status_code == 404
    assert client.patch(f"/me/library/{entry['id']}", json={"is_owned": True, "expected_version": 1}).status_code == 404
    assert client.get("/me/library").json()["total"] == 0
    lookup = client.post("/me/library/lookup", json={"book_ids": [entry["book_id"]]}).json()["items"][0]
    assert lookup["entry_id"] is None and lookup["version"] is None
    assert client.post("/me/library/lookup", json={"book_ids": list(range(1, 52))}).status_code == 422
    assert client.post("/me/library/lookup", json={"book_ids": [-1]}).status_code == 422
    app_modules["main"].app.dependency_overrides.pop(get_current_user)
    assert client.get("/me/library").status_code == 401


def test_legacy_guard_projection_and_flag_off_preserves_history(client, reader, seeded_books, app_modules, db_session, monkeypatch):
    models = app_modules["models"]
    entry = client.put(f"/me/library/books/{book_id(seeded_books)}", json={"is_owned": True, "is_wanted": True}).json()
    assert client.post(f"/books/{entry['book_id']}/status", json={"status": "want"}).status_code == 409
    assert client.delete(f"/books/{entry['book_id']}/status").status_code == 409
    legacy = client.get("/me/books").json()
    assert legacy[0]["status"] == "owned" and legacy[0]["id"] == entry["id"]
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    assert client.delete(f"/books/{entry['book_id']}/status").status_code == 409
    assert client.get("/me/reading-capabilities").json()["writable"] is False
    assert client.get("/me/library").json()["total"] == 1
    assert client.patch(f"/me/library/{entry['id']}", json={"is_owned": False, "expected_version": 1}).status_code == 403
    row = db_session.get(models.UserBook, entry["id"])
    row.is_wanted = False
    db_session.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=row.id, state="finished", creation_fingerprint="0" * 64))
    db_session.commit()
    assert client.delete(f"/books/{entry['book_id']}/status").status_code == 409
    assert db_session.scalar(select(func.count()).select_from(models.ReadingAttempt)) == 1


def test_legacy_unenabled_writes_sync_flags_and_versions(client, reader, seeded_books, app_modules, monkeypatch, db_session):
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    path = f"/books/{book_id(seeded_books)}/status"
    row = client.post(path, json={"status": "want"}).json()
    entry = db_session.get(app_modules["models"].UserBook, row["id"])
    assert entry.is_wanted and not entry.is_owned
    client.post(path, json={"status": "owned"})
    db_session.refresh(entry)
    assert entry.is_owned and not entry.is_wanted and entry.version == 2
    assert client.delete(path).status_code == 204


def test_neither_flag_history_and_private_rows_excluded_from_legacy(client, reader, db_session, app_modules, seeded_books):
    models = app_modules["models"]
    rows = [models.UserBook(user_id=reader.id, book_id=book_id(seeded_books)),
            models.UserBook(user_id=reader.id, private_title="私の本", private_author="Reader", is_wanted=True)]
    db_session.add_all(rows)
    db_session.commit()
    assert client.get("/me/books").json() == []
    assert client.get("/me/library").json()["total"] == 2
    assert client.get("/me/library", params={"q": "私"}).json()["items"][0]["private_title"] == "私の本"


def test_cursor_scope_tamper_and_new_insert_stability(client, reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    for book in seeded_books.values():
        db_session.add(models.UserBook(user_id=reader.id, book_id=book.id, is_wanted=True))
    db_session.commit()
    first = client.get("/me/library", params={"limit": 2}).json()
    token = first["next_cursor"]
    db_session.add(models.UserBook(user_id=reader.id, private_title="New insertion", is_wanted=True))
    db_session.commit()
    second = client.get("/me/library", params={"limit": 100, "cursor": token}).json()
    assert not ({row["id"] for row in first["items"]} & {row["id"] for row in second["items"]})
    assert all(row["private_title"] != "New insertion" for row in second["items"])
    assert client.get("/me/library", params={"q": "Harry", "cursor": token}).status_code == 422
    assert client.get("/me/library", params={"cursor": token[:-1] + "!"}).status_code == 422
    assert client.get("/me/library", params={"limit": 101}).status_code == 422


def test_history_constraints_deletions_and_edition_snapshot(reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    entry = models.UserBook(user_id=reader.id, book_id=book_id(seeded_books), is_owned=True)
    db_session.add(entry)
    db_session.flush()
    edition = models.Edition(book_id=entry.book_id, source_id="/books/OLV3M")
    db_session.add(edition)
    db_session.flush()
    attempt = models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state="paused",
        edition_id=edition.id, edition_source_id=edition.source_id, total_pages=321, creation_fingerprint="0" * 64)
    db_session.add(attempt)
    db_session.commit()
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state="reading", creation_fingerprint="1" * 64))
        db_session.flush()
    for values in ({"progress_unit": "percent", "progress_value": 101}, {"state": "broken"}, {"note": "x" * 2001}):
        with pytest.raises(IntegrityError), db_session.begin_nested():
            db_session.execute(insert(models.ReadingAttempt).values(**{
                "id": uuid.uuid4(), "user_book_id": entry.id, "state": "finished",
                "creation_fingerprint": "2" * 64, **values,
            }))
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.delete(entry.book)
        db_session.flush()
    db_session.execute(delete(models.Edition).where(models.Edition.id == edition.id))
    db_session.commit()
    db_session.refresh(attempt)
    assert attempt.edition_id is None and attempt.total_pages == 321 and attempt.edition_source_id == "/books/OLV3M"
    attempt_id = attempt.id
    db_session.delete(entry)
    db_session.commit()
    assert db_session.scalar(select(models.ReadingAttempt.id).where(models.ReadingAttempt.id == attempt_id)) is None


def test_concurrent_ensure_and_versioned_updates(reader, seeded_books, app_modules, db_session):
    from reading_schemas import EntryUpdate, FlagUpdate
    from services.library import LibraryService
    factory = app_modules["database"].SessionLocal
    bid = book_id(seeded_books)
    def ensure():
        with factory() as session:
            return LibraryService(session).ensure(reader.id, bid, FlagUpdate(is_wanted=True)).id
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: ensure(), range(2)))
    assert results[0] == results[1]
    entry_id = results[0]
    def edit(flag):
        with factory() as session:
            try:
                LibraryService(session).update(reader.id, entry_id, EntryUpdate(expected_version=1, **flag))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(edit, [{"is_owned": True}, {"is_wanted": False}]))
    assert sorted(outcomes) == [200, 409]


def test_10k_library_is_bounded_and_searchable(reader, app_modules, db_session):
    from services.library import LibraryService
    models = app_modules["models"]
    db_session.execute(insert(models.Book), [{"title": f"Large shelf book {number:05d}",
        "description": "Isolated catalogue description. " * 40} for number in range(10000)])
    ids = db_session.scalars(select(models.Book.id).where(models.Book.title.like("Large shelf book%"))).all()
    db_session.execute(insert(models.UserBook), [{"user_id": reader.id, "book_id": bid,
        "is_owned": True, "is_wanted": True, "status": models.UserBookStatus.owned} for bid in ids])
    entry_ids = db_session.scalars(select(models.UserBook.id).where(models.UserBook.user_id == reader.id)).all()
    db_session.execute(insert(models.ReadingAttempt), [{"id": uuid.uuid4(), "user_book_id": entry_id,
        "state": "finished", "creation_fingerprint": "a" * 64, "note": "Private isolated reading context. " * 5} for entry_id in entry_ids])
    db_session.execute(insert(models.ReadingAttempt), [{"id": uuid.uuid4(), "user_book_id": entry_id,
        "state": "reading", "creation_fingerprint": "b" * 64} for entry_id in entry_ids[:2000]])
    db_session.commit()
    db_session.execute(text("SET LOCAL statement_timeout = '15s'"))
    statements = []
    sql_timings = []
    captured_queries = []
    def capture(_connection, _cursor, statement, parameters, context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
            captured_queries.append((statement, parameters))
            context.m1_started = time.perf_counter()
    def after(_connection, _cursor, _statement, _parameters, context, _executemany):
        if hasattr(context, "m1_started"):
            sql_timings.append(round(time.perf_counter() - context.m1_started, 4))
    event.listen(app_modules["database"].engine, "before_cursor_execute", capture)
    event.listen(app_modules["database"].engine, "after_cursor_execute", after)
    start = time.perf_counter()
    try:
        page = LibraryService(db_session).page(reader.id)
    finally:
        event.remove(app_modules["database"].engine, "before_cursor_execute", capture)
        event.remove(app_modules["database"].engine, "after_cursor_execute", after)
    duration = time.perf_counter() - start
    assert len(page.items) == 25 and page.total == 10000
    assert page.counts["finished"] == 10000 and page.counts["reading"] == 2000
    assert len(statements) <= 6
    assert all("description" not in row.model_dump().get("book", {}) for row in page.items)
    next_start = time.perf_counter()
    second = LibraryService(db_session).page(reader.id, cursor=page.next_cursor)
    next_duration = time.perf_counter() - next_start
    assert not ({row.id for row in page.items} & {row.id for row in second.items})
    search_start = time.perf_counter()
    search = LibraryService(db_session).page(reader.id, q="book 09999", facet="want")
    assert search.total == 1 and search.counts["owned"] == 1
    print(f"M1 10K/12K attempts: first page {duration:.3f}s, next page {next_duration:.3f}s, search {time.perf_counter() - search_start:.3f}s, {len(statements)} SELECTs, 25 rows")
    print(f"M1 first-page SQL durations: {sql_timings}")
    if os.getenv("BOOKVANE_M1_EXPLAIN") == "yes":
        with app_modules["database"].engine.connect() as connection:
            for number, (statement, parameters) in enumerate(captured_queries):
                plan = connection.exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement, parameters).scalar_one()[0]
                print(f"M1 query {number}: cost={plan['Plan']['Total Cost']} execution_ms={plan['Execution Time']} jit={plan.get('JIT', {}).get('Timing', {})}")


def test_library_search_membership_preserves_literal_author_private_and_owner_matches(client, reader, app_modules, db_session):
    models = app_modules["models"]
    name = "Shared 同名 %_\\"
    first = models.Book(title="Source one", authors=[models.Author(name=name, source_id="/authors/OLM4SEARCH1A")])
    second = models.Book(title="Source two", authors=[models.Author(name=name, source_id="/authors/OLM4SEARCH2A")])
    other = models.User(email=f"search-other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add_all([first, second, other]); db_session.flush()
    entries = [models.UserBook(user_id=reader.id, book_id=first.id, is_owned=True, is_wanted=True),
        models.UserBook(user_id=reader.id, book_id=second.id, is_wanted=True),
        models.UserBook(user_id=reader.id, private_title="Private title", private_author=name, is_wanted=True)]
    db_session.add_all(entries + [models.UserBook(user_id=other.id, private_title="Hidden", private_author=name, is_wanted=True)])
    db_session.commit()
    for query, expected in [("shared 同名", entries), ("SOURCE ONE", entries[:1]),
            ("%_\\", entries), ("private title", entries[2:]), ("no matching record", [])]:
        response = client.get("/me/library", params={"q": query, "facet": "want"})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == result["counts"]["all"] == len(expected)
        assert {entry["id"] for entry in result["items"]} == {entry.id for entry in expected}
        assert result["counts"]["finished"] == result["counts"]["reading"] == 0


def test_private_no_store_and_production_preflight(client, reader, app_modules, monkeypatch):
    assert client.get("/me/library").headers["cache-control"] == "private, no-store"
    response = client.options("/me/library/1", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH"})
    assert response.status_code == 200 and response.headers["access-control-allow-origin"] == "http://localhost:5173"
    monkeypatch.setattr(app_modules["database"].settings, "is_dev", False)
    monkeypatch.setenv("CORS_ORIGINS", "https://shelfbound.dev")
    assert client.patch("/me/library/1", json={"is_owned": True, "expected_version": 1}, headers={"Origin": "https://attacker.example"}).status_code == 403


def test_public_counts_and_filters_use_both_canonical_flags(client, reader, seeded_books, db_session, app_modules):
    from services.search import SearchService
    models = app_modules["models"]
    bid = book_id(seeded_books)
    for number in range(6):
        owner = reader if number == 0 else models.User(email=f"counter-{number}-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
        db_session.add(owner)
        db_session.flush()
        db_session.add(models.UserBook(user_id=owner.id, book_id=bid, is_owned=True, is_wanted=True))
    db_session.commit()
    public = client.get(f"/books/{bid}").json()
    assert public["owned_count"] == 6 and public["want_count"] == 6
    assert not {"private_title", "save_note", "user_id"} & set(public)
    wanted = SearchService(db_session).search_books(current_user=reader, shelf_status=models.UserBookStatus.want)
    assert bid in [book.id for book in db_session.scalars(wanted)]
    excluded = SearchService(db_session).search_books(current_user=reader, exclude_owned=True)
    assert bid not in [book.id for book in db_session.scalars(excluded)]
