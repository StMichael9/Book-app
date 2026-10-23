"""M4 decision support uses only the guarded disposable database fixture."""
import uuid

import pytest
from sqlalchemy import event, func, insert, select, text


@pytest.fixture
def reader(client, db_session, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    user = app_modules["models"].User(email=f"m4-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(user); db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()


def queue(client, book, **flags):
    response = client.put(f"/me/library/books/{book.id}", json={"is_wanted": True, **flags})
    assert response.status_code == 200, response.text
    return response.json()


def choose(client, **params):
    response = client.get("/me/next-read", params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


def test_empty_and_small_queue_never_padded_or_mutated(client, reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    empty = choose(client)
    assert empty["items"] == [] and empty["eligible_count"] == 0
    entries = [queue(client, book) for book in list(seeded_books.values())[:2]]
    before = db_session.execute(select(models.UserBook.id, models.UserBook.version, models.UserBook.is_wanted)
        .where(models.UserBook.user_id == reader.id)).all()
    result = choose(client)
    assert len(result["items"]) == 2 and result["eligible_count"] == 2
    assert {item["entry_id"] for item in result["items"]} == {entry["id"] for entry in entries}
    assert all(item["is_wanted"] and item["reasons"][0]["code"] == "want" for item in result["items"])
    assert db_session.execute(select(models.UserBook.id, models.UserBook.version, models.UserBook.is_wanted)
        .where(models.UserBook.user_id == reader.id)).all() == before
    assert db_session.scalar(select(func.count()).select_from(models.ReadingAttempt)) == 0


def test_active_paused_excluded_revisits_require_explicit_want(client, reader, seeded_books):
    book = next(iter(seeded_books.values()))
    saved = queue(client, book)
    identity = str(uuid.uuid4())
    attempt = client.put(f"/me/reading-attempts/{identity}", json={"entry_id": saved["id"], "expected_version": saved["version"]}).json()
    saved = client.patch(f"/me/library/{saved['id']}", json={"expected_version": attempt["entry"]["version"], "is_wanted": True}).json()
    assert choose(client)["items"] == []
    paused = client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": saved["version"], "state": "paused"}).json()
    assert choose(client)["items"] == []
    stopped = client.patch(f"/me/reading-attempts/{identity}", json={"expected_version": paused["entry"]["version"], "state": "dnf"}).json()
    item = choose(client)["items"][0]
    assert item["revisit"] and item["entry_id"] == saved["id"]
    client.patch(f"/me/library/{saved['id']}", json={"expected_version": stopped["entry"]["version"], "is_wanted": False})
    assert choose(client)["items"] == []
    assert book.id not in [item["book"]["id"] for item in choose(client, source="catalogue")["items"]]


def test_private_queue_unknown_metadata_owned_and_length(client, reader, seeded_books):
    private = client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "私の本", "author": "Unknown", "is_wanted": True, "is_owned": True}).json()
    result = choose(client, owned_only="true")
    assert result["items"][0]["private_title"] == "私の本" and result["items"][0]["book"] is None
    assert result["known_page_count"] == 0
    assert choose(client, max_pages=300)["items"] == []
    assert client.get(f"/me/library/{private['id']}").json()["is_wanted"]
    public = next(iter(seeded_books.values()))
    queue(client, public)
    assert len(choose(client, max_pages=public.page_count)["items"]) == 1
    assert choose(client, max_pages=public.page_count - 1)["items"] == []


def test_interest_coverage_and_preferences_do_not_infer_moods(client, reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    for book in seeded_books.values(): queue(client, book)
    fantasy = db_session.scalar(select(models.Tag).where(models.Tag.name == "fantasy"))
    theme = db_session.scalar(select(models.Tag).where(models.Tag.type == models.TagType.theme))
    db_session.add(models.UserPreference(user_id=reader.id, tag_id=fantasy.id)); db_session.commit()
    baseline = choose(client)
    assert all(item["count"] > 0 and item["type"] in {"genre", "topic", "form", "audience"} for item in baseline["interests"])
    assert theme.id not in [item["id"] for item in baseline["interests"]]
    selected = choose(client, interest_id=fantasy.id)
    for choice in selected["items"]:
        assert choice["reasons"][0] == {"code": "interest", "value": "fantasy"}
        assert any(tag.id == fantasy.id for tag in db_session.get(models.Book, choice["book"]["id"]).tags)
    assert client.get("/me/next-read", params={"interest_id": theme.id}).status_code == 422
    empty = choose(client, interest_id=fantasy.id, max_pages=1)
    assert empty["items"] == []
    assert any(item["id"] == fantasy.id and item["count"] == 0 for item in empty["interests"])


def test_repeatable_rotation_exclusions_and_no_enduring_skip_profile(client, reader, seeded_books):
    for book in seeded_books.values(): queue(client, book)
    params = {"session_id": str(uuid.uuid4())}
    first = choose(client, **params)
    assert choose(client, **params) == first
    excluded = [item["key"] for item in first["items"]]
    second = choose(client, **params, rotation=1, exclude=excluded)
    assert not set(excluded) & {item["key"] for item in second["items"]}
    assert len(second["items"]) == len(seeded_books) - 3
    assert choose(client, **params) == first


def test_selected_subject_outside_option_cap_keeps_true_scoped_count(client, reader, db_session, app_modules):
    models = app_modules["models"]
    tags = [models.Tag(name=f"M4 capped subject {index:02}", type=models.TagType.genre) for index in range(41)]
    book = models.Book(title="Selected outside cap", tags=tags, page_count=200)
    db_session.add(book); db_session.commit()
    queue(client, book, is_owned=True)
    assert tags[-1].id not in {option["id"] for option in choose(client)["interests"]}
    for source in ("want", "catalogue"):
        if source == "catalogue":
            saved = client.post("/me/library/lookup", json={"book_ids": [book.id]}).json()["items"][0]
            client.patch(f"/me/library/{saved['entry_id']}", json={"expected_version": saved["version"], "is_wanted": False})
        result = choose(client, source=source, interest_id=tags[-1].id, owned_only=True, max_pages=200)
        assert len(result["interests"]) == 40 and result["eligible_count"] == 1
        assert next(option for option in result["interests"] if option["id"] == tags[-1].id)["count"] == 1
        assert result["items"][0]["book"]["id"] == book.id
        empty = choose(client, source=source, interest_id=tags[-1].id, max_pages=100)
        assert empty["eligible_count"] == 0
        assert next(option for option in empty["interests"] if option["id"] == tags[-1].id)["count"] == 0


def test_same_name_authors_are_distinct_and_diversity_when_possible(client, reader, db_session, app_modules):
    models = app_modules["models"]
    same = models.Author(name="Same display name", source_id="/authors/OLM4A")
    other = models.Author(name="Same display name", source_id="/authors/OLM4B")
    works = [models.Book(title=f"M4 diversity {index}", authors=[same if index < 3 else other]) for index in range(4)]
    db_session.add_all(works); db_session.commit()
    for book in works: queue(client, book)
    result = choose(client, session_id=str(uuid.uuid4()))
    assert len(result["items"]) == 3
    assert len({author["id"] for item in result["items"] for author in item["book"]["authors"]}) == 2


def test_owner_isolation_and_no_notes_in_reasons(client, reader, seeded_books, db_session, app_modules):
    from auth.dependencies import get_current_user
    models = app_modules["models"]
    saved = queue(client, next(iter(seeded_books.values())))
    client.patch(f"/me/library/{saved['id']}", json={"expected_version": saved["version"], "save_note": "SECRET PRIVATE NOTE"})
    assert "SECRET PRIVATE NOTE" not in client.get("/me/next-read").text
    other = models.User(email=f"m4-other-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(other); db_session.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert choose(client)["items"] == []
    catalogue = choose(client, source="catalogue")
    assert all(item["entry_id"] is None and item["version"] is None and not item["is_owned"] and not item["is_wanted"] for item in catalogue["items"])
    app_modules["main"].app.dependency_overrides.pop(get_current_user)
    assert client.get("/me/next-read").status_code == 401


@pytest.mark.parametrize("params", [{"source": "other"}, {"max_pages": 0}, {"rotation": -1},
    {"interest_id": -1}, {"exclude": ["book:1"] * 31}, {"exclude": "injected' OR 1=1"}, {"user_id": str(uuid.uuid4())}])
def test_invalid_input_has_no_writes(client, reader, params):
    assert client.get("/me/next-read", params=params).status_code == 422


def test_readonly_richer_library_retains_choices_and_disabled_account_stays_gated(client, reader, app_modules, monkeypatch):
    client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "Read only", "is_wanted": True})
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    assert choose(client)["items"][0]["private_title"] == "Read only"
    assert client.get("/me/reading-capabilities").json()["writable"] is False


def test_disabled_empty_account_cannot_call_next_read_directly(client, reader, app_modules, monkeypatch):
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", False)
    assert client.get("/me/next-read").status_code == 403


def test_large_catalogue_query_and_factual_length_reasons(client, reader, app_modules, db_session):
    from time import perf_counter
    models = app_modules["models"]
    tag_ids = db_session.scalars(select(models.Tag.id).where(models.Tag.type == models.TagType.genre)).all()
    author_ids = db_session.scalars(select(models.Author.id)).all()
    db_session.add(models.UserPreference(user_id=reader.id, tag_id=tag_ids[0]))
    for batch in range(50):
        ids = db_session.scalars(insert(models.Book).returning(models.Book.id), [{"title": f"M4 synthetic catalogue {batch * 1000 + index}",
            "source_id": f"/works/OLM4TEST{batch * 1000 + index}W", "page_count": 120,
            "description": "Isolated synthetic catalogue description. " * 8} for index in range(1000)]).all()
        db_session.execute(insert(models.book_tags), [{"book_id": identity, "tag_id": tag_ids[index % len(tag_ids)]} for index, identity in enumerate(ids)])
        db_session.execute(insert(models.book_authors), [{"book_id": identity, "author_id": author_ids[index % len(author_ids)]} for index, identity in enumerate(ids)])
    db_session.commit()
    # Bound a regression failure rather than leaving CI stuck on a bad plan.
    # This setting and ANALYZE touch only the guarded disposable test target.
    db_session.execute(text("SET LOCAL statement_timeout = '15s'"))
    start = perf_counter()
    result = choose(client, source="catalogue", max_pages=150, session_id=str(uuid.uuid4()))
    elapsed = perf_counter() - start
    assert result["eligible_count"] >= 50000 and len(result["items"]) == 3
    assert all(any(reason == {"code": "pages", "value": item["book"]["page_count"]} for reason in item["reasons"]) for item in result["items"])
    print(f"M4 synthetic 50K catalogue choices: {elapsed:.3f}s; returned={len(result['items'])}; eligible={result['eligible_count']}")
    start = perf_counter()
    assert len(choose(client, source="catalogue", max_pages=150, session_id=result["session_id"])["items"]) == 3
    print(f"M4 synthetic 50K warm catalogue choices: {perf_counter() - start:.3f}s")
    for table in ("books", "book_tags", "book_authors", "user_books", "reading_attempts", "user_preferences"):
        db_session.execute(text(f"ANALYZE {table}"))
    start = perf_counter()
    assert len(choose(client, source="catalogue", max_pages=150, session_id=result["session_id"])["items"]) == 3
    print(f"M4 synthetic 50K analyzed catalogue choices: {perf_counter() - start:.3f}s")


def test_best_preferences_across_large_shelf_not_just_recent_60(client, reader, db_session, app_modules):
    models = app_modules["models"]
    engine = app_modules["database"].engine
    preferred = models.Tag(name="M4 preferred topic", type=models.TagType.topic)
    best = models.Book(title="Oldest best match", tags=[preferred])
    db_session.add(best); db_session.flush()
    db_session.add(models.UserPreference(user_id=reader.id, tag_id=preferred.id))
    db_session.add(models.UserBook(user_id=reader.id, book_id=best.id, is_wanted=True, is_owned=False, version=1))
    db_session.flush()
    ids = db_session.scalars(insert(models.Book).returning(models.Book.id), [{"title": f"M4 other {index}"} for index in range(10000)]).all()
    db_session.execute(insert(models.UserBook), [{"user_id": reader.id, "book_id": identity, "is_wanted": True,
        "is_owned": False, "status": "want", "version": 1} for identity in ids]); db_session.commit()
    best_id = best.id  # read before counting: refreshing the expired Book would add its alias query
    statements = []
    def observe(_connection, _cursor, sql, _parameters, _context, _many): statements.append(sql)
    event.listen(engine, "before_cursor_execute", observe)
    try:
        response = choose(client, session_id=str(uuid.uuid4()))
        assert response["items"][0]["book"]["id"] == best_id
        assert response["eligible_count"] == 10001
        assert len(response["items"]) == 3
        assert len(statements) <= 6
        assert "description" not in str(response) and "save_note" not in str(response)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
