from __future__ import annotations

import uuid

import pytest

PUBLIC = "public, max-age=60, stale-while-revalidate=300"


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    from rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def signed_in(app_modules, db_session):
    from auth.dependencies import get_current_user, get_current_user_optional
    models = app_modules["models"]
    user = models.User(email=f"cache-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    app = app_modules["main"].app
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_optional] = lambda: user
    yield user
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)


def test_anonymous_catalogue_list_is_publicly_cacheable(client):
    response = client.get("/books")
    assert response.status_code == 200
    assert response.headers["cache-control"] == PUBLIC


def test_anonymous_search_and_filters_are_publicly_cacheable(client):
    response = client.get("/books", params={"book": "Harry", "tag": "fantasy", "size": 5})
    assert response.status_code == 200 and response.json()["total"] == 1
    assert response.headers["cache-control"] == PUBLIC


def test_anonymous_book_detail_is_publicly_cacheable(client, seeded_books):
    book = seeded_books["Dracula"]
    response = client.get(f"/books/{book.id}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == PUBLIC


def test_public_responses_vary_on_the_session_cookie(client, seeded_books):
    for path in ("/books", f"/books/{seeded_books['Dracula'].id}"):
        assert "cookie" in client.get(path).headers["vary"].lower()


def test_an_invalid_session_cookie_is_still_anonymous(client):
    client.cookies.set("access_token", "not-a-token")
    response = client.get("/books")
    assert response.status_code == 200 and response.headers["cache-control"] == PUBLIC


def test_signed_in_list_and_detail_are_not_given_the_public_header(client, signed_in, seeded_books):
    for path in ("/books", f"/books/{seeded_books['Dracula'].id}"):
        response = client.get(path)
        assert response.status_code == 200
        assert "cache-control" not in response.headers
        assert "cookie" not in response.headers.get("vary", "").lower()


def test_a_signed_in_readers_incomplete_saved_book_is_never_publicly_cached(client, signed_in, app_modules, db_session):
    models = app_modules["models"]
    book = models.Book(title="Partial but saved", description="D", page_count=10, published_year=2000)
    db_session.add(book)
    db_session.commit()
    db_session.add(models.UserBook(user_id=signed_in.id, book_id=book.id, is_wanted=True))
    db_session.commit()
    response = client.get(f"/books/{book.id}")
    assert response.status_code == 200 and "cache-control" not in response.headers


def test_not_found_and_hidden_books_carry_no_public_cache_header(client, app_modules, db_session):
    models = app_modules["models"]
    hidden = models.Book(title="Hidden partial", description="D", page_count=10, published_year=2000)
    db_session.add(hidden)
    db_session.commit()
    for path in ("/books/999999999", f"/books/{hidden.id}"):
        response = client.get(path)
        assert response.status_code == 404
        assert "public" not in response.headers.get("cache-control", "")


def test_invalid_requests_carry_no_public_cache_header(client):
    response = client.get("/books", params={"size": 0})
    assert response.status_code == 422
    assert "public" not in response.headers.get("cache-control", "")


@pytest.fixture
def reader(app_modules, signed_in, monkeypatch):
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    return signed_in


def test_me_routes_stay_private_no_store(client, reader):
    for path in ("/me/library", "/me/reading-capabilities"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
