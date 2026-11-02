from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    from rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


COMPLETE = dict(cover_image_url="https://covers.example/c.jpg", description="A description.", page_count=200, published_year=1950)


@pytest.fixture
def make_book(db_session, app_modules):
    models = app_modules["models"]

    def make(title, **overrides):
        book = models.Book(title=title, **{**COMPLETE, **overrides})
        db_session.add(book)
        db_session.commit()
        db_session.refresh(book)
        return book

    return make


def titles(response):
    return [item["title"] for item in response.json()["items"]]


@pytest.mark.parametrize("overrides,expected", [
    ({}, True),
    ({"cover_image_url": None}, False),
    ({"cover_image_url": "   "}, False),
    ({"description": None}, False),
    ({"description": "     "}, False),
    ({"description": " \t\r\n "}, False),
    ({"cover_image_url": "\t"}, False),
    ({"cover_image_url": " \r\n"}, False),
    ({"page_count": None}, False),
    ({"page_count": 0}, False),
    ({"published_year": None}, False),
    ({"cover_image_url": None, "description": None, "page_count": None, "published_year": None}, False),
])
def test_is_complete_is_derived_from_the_required_fields(make_book, overrides, expected):
    assert make_book("Derived", **overrides).is_complete is expected


def test_is_complete_follows_later_updates_and_cannot_be_written(make_book, db_session):
    book = make_book("Derived", published_year=None)
    assert book.is_complete is False
    db_session.execute(text("UPDATE books SET published_year = 1999 WHERE id = :id"), {"id": book.id})
    db_session.commit(); db_session.refresh(book)
    assert book.is_complete is True
    with pytest.raises(Exception):
        db_session.execute(text("UPDATE books SET is_complete = false WHERE id = :id"), {"id": book.id})
    db_session.rollback()


def test_partial_index_exists(db_session):
    definition = db_session.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_books_complete'")).scalar_one()
    assert "WHERE is_complete" in definition and "(id)" in definition


def test_browse_hides_incomplete_books_and_totals_match(client, make_book):
    make_book("Complete A")
    make_book("Complete B")
    make_book("No cover", cover_image_url=None)
    make_book("No year", published_year=None)
    payload = client.get("/books", params={"size": 2}).json()
    assert payload["total"] == 2 + 4  # the four seeded books with covers plus two new ones
    everything = client.get("/books", params={"size": 100}).json()
    assert {"No cover", "No year"}.isdisjoint({item["title"] for item in everything["items"]})
    assert everything["total"] == len(everything["items"]) == payload["total"]


def test_search_hides_incomplete_books_including_alias_matches(client, make_book, db_session, app_modules):
    models = app_modules["models"]
    visible = make_book("Ὀδύσσεια")
    hidden = make_book("Ἰλιάς", cover_image_url=None)
    for book, alias in ((visible, "The Odyssey"), (hidden, "The Iliad (Odyssey sequel)")):
        db_session.add(models.BookTitleAlias(book_id=book.id, title=alias, language="eng", source="openlibrary_edition"))
    db_session.commit()
    response = client.get("/books", params={"book": "Odyssey"})
    assert titles(response) == ["Ὀδύσσεια"] and response.json()["total"] == 1
    assert client.get("/books", params={"book": "Ἰλιάς"}).json()["total"] == 0


def test_book_detail_is_404_for_an_incomplete_book_when_anonymous(client, make_book):
    complete = make_book("Whole")
    partial = make_book("Partial", page_count=None)
    undescribed = make_book("Undescribed", description=None)  # listing no longer needs a description (T30)
    assert client.get(f"/books/{complete.id}").status_code == 200
    assert client.get(f"/books/{partial.id}").status_code == 404
    assert client.get(f"/books/{undescribed.id}").status_code == 200


@pytest.fixture
def reader(app_modules, db_session, monkeypatch):
    from auth.dependencies import get_current_user, get_current_user_optional
    from rate_limit import limiter
    models = app_modules["models"]
    user = models.User(email=f"reader-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app = app_modules["main"].app
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_optional] = lambda: user
    limiter.reset()
    yield user
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)
    db_session.rollback()
    limiter.reset()


def test_book_detail_of_an_incomplete_book_stays_available_to_the_reader_who_saved_it(client, reader, make_book):
    saved = make_book("Saved but partial", page_count=None)
    other = make_book("Not saved and partial", page_count=None)
    assert client.get(f"/books/{saved.id}").status_code == 404
    assert client.put(f"/me/library/books/{saved.id}", json={"is_wanted": True}).status_code == 200
    assert client.get(f"/books/{saved.id}").status_code == 200
    assert client.get(f"/books/{other.id}").status_code == 404


def test_a_readers_own_incomplete_book_stays_in_my_books_and_the_workspace(client, reader, make_book):
    saved = make_book("Saved but partial", cover_image_url=None)
    entry = client.put(f"/me/library/books/{saved.id}", json={"is_wanted": True}).json()
    listing = client.get("/me/library").json()
    assert [item["book"]["title"] for item in listing["items"]] == ["Saved but partial"]
    assert client.get(f"/me/library/{entry['id']}/reading").status_code == 200


def choose(client, **params):
    response = client.get("/me/next-read", params={"session_id": str(uuid.uuid4()), **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_next_read_catalogue_source_skips_incomplete_books(client, reader, make_book):
    make_book("Complete pick")
    make_book("Incomplete pick", page_count=None)
    result = choose(client, source="catalogue")
    assert "Incomplete pick" not in {item["book"]["title"] for item in result["items"]}
    assert result["eligible_count"] == 5  # four seeded complete books plus "Complete pick"; the incomplete one is not counted


def test_next_read_still_offers_a_readers_own_unread_book_that_is_incomplete(client, reader, make_book):
    owned = make_book("Owned but partial", page_count=None)
    assert client.put(f"/me/library/books/{owned.id}", json={"is_owned": True}).status_code == 200
    result = choose(client, source="catalogue", owned_only="true")
    assert [item["book"]["title"] for item in result["items"]] == ["Owned but partial"]


def test_next_read_want_source_is_not_gated(client, reader, make_book):
    wanted = make_book("Wanted but partial", cover_image_url=None)
    assert client.put(f"/me/library/books/{wanted.id}", json={"is_wanted": True}).status_code == 200
    result = choose(client, source="want")
    assert [item["book"]["title"] for item in result["items"]] == ["Wanted but partial"]
