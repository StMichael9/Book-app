from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    from rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def make_book(db_session, app_modules):
    models = app_modules["models"]

    def make(title, *aliases):
        book = models.Book(title=title, description="Alias fixture.", published_year=1900, page_count=100)
        db_session.add(book)
        db_session.flush()
        for alias, language in aliases:
            db_session.add(models.BookTitleAlias(book_id=book.id, title=alias, language=language, source="openlibrary_edition"))
        db_session.commit()
        return book

    return make


def titles(response):
    return [item["title"] for item in response.json()["items"]]


def test_alias_table_and_indexes_exist(db_session):
    indexes = set(db_session.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'book_title_aliases'")).scalars())
    assert {"uq_book_title_alias", "ix_book_title_aliases_book", "ix_book_title_aliases_title_trgm"} <= indexes


def test_alias_source_and_blank_titles_are_constrained(db_session, make_book, app_modules):
    models = app_modules["models"]
    book = make_book("Ὀδύσσεια")
    for title, source in (("The Odyssey", "manual"), ("   ", "openlibrary_edition"), ("x" * 501, "openlibrary_edition")):
        db_session.add(models.BookTitleAlias(book_id=book.id, title=title, language="eng", source=source))
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()


def test_alias_is_unique_per_book_ignoring_case(db_session, make_book, app_modules):
    models = app_modules["models"]
    book = make_book("Ὀδύσσεια", ("The Odyssey", "eng"))
    other = make_book("Another book", ("the odyssey", "eng"))
    assert other.id != book.id
    db_session.add(models.BookTitleAlias(book_id=book.id, title="THE ODYSSEY", language="eng", source="openlibrary_edition"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_aliases_are_removed_with_their_book(db_session, make_book, app_modules):
    models = app_modules["models"]
    book = make_book("Ὀδύσσεια", ("The Odyssey", "eng"))
    book_id = book.id
    db_session.delete(book)
    db_session.commit()
    assert db_session.scalars(select(models.BookTitleAlias).where(models.BookTitleAlias.book_id == book_id)).all() == []


def test_english_query_finds_a_book_stored_under_its_original_title(client, make_book):
    make_book("Ὀδύσσεια", ("The Odyssey", "eng"))
    response = client.get("/books", params={"book": "Odyssey"})
    assert response.status_code == 200
    assert titles(response) == ["Ὀδύσσεια"]
    assert response.json()["total"] == 1


def test_english_query_finds_a_latin_script_translation(client, make_book):
    make_book("Le petit prince", ("The Little Prince", "eng"))
    assert titles(client.get("/books", params={"book": "The Little Prince"})) == ["Le petit prince"]


def test_a_book_matching_by_both_title_and_alias_is_returned_once(client, make_book):
    make_book("The Odyssey of Homer", ("The Odyssey", "eng"), ("Odyssey (abridged)", "eng"))
    response = client.get("/books", params={"book": "Odyssey"})
    assert titles(response) == ["The Odyssey of Homer"] and response.json()["total"] == 1


def test_direct_title_match_ranks_before_alias_only_match(client, make_book):
    make_book("Ὀδύσσεια", ("The Odyssey", "eng"))
    make_book("Odyssey Notes")
    assert titles(client.get("/books", params={"book": "Odyssey"})) == ["Odyssey Notes", "Ὀδύσσεια"]


def test_like_wildcards_in_a_book_query_are_literal(client, make_book):
    make_book("A_B")
    make_book("AxB")
    make_book("Pure", ("100% Pure", "eng"))
    assert titles(client.get("/books", params={"book": "A_B"})) == ["A_B"]
    assert titles(client.get("/books", params={"book": "100%"})) == ["Pure"]
    assert client.get("/books", params={"book": "%"}).json()["total"] == 1
    assert client.get("/books", params={"book": "_"}).json()["total"] == 1


def test_english_title_is_the_first_english_alias_that_differs(client, make_book):
    book = make_book("Ὀδύσσεια", ("Odyssée", "fra"), ("The Odyssey", "eng"), ("Odyssey", "eng"))
    detail = client.get(f"/books/{book.id}").json()
    assert detail["title"] == "Ὀδύσσεια" and detail["english_title"] == "The Odyssey"
    assert client.get("/books", params={"book": "Odyssey"}).json()["items"][0]["english_title"] == "The Odyssey"


def test_english_title_is_none_when_it_adds_nothing(client, make_book):
    same = make_book("Dracula", ("dracula", "eng"))
    foreign = make_book("Le petit prince", ("El principito", "spa"), ("Der kleine Prinz", None))
    plain = make_book("Emma")
    for book in (same, foreign, plain):
        assert client.get(f"/books/{book.id}").json()["english_title"] is None


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


def test_my_books_search_finds_a_saved_book_by_alias_and_never_another_readers_private_entry(client, reader, make_book, db_session, app_modules):
    models = app_modules["models"]
    saved = make_book("Ὀδύσσεια", ("The Odyssey", "eng"))
    unsaved = make_book("Ἰλιάς", ("The Iliad", "eng"))
    assert client.put(f"/me/library/books/{saved.id}", json={"is_wanted": True}).status_code == 200
    stranger = models.User(email=f"stranger-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    db_session.add(stranger)
    db_session.commit()
    db_session.add(models.UserBook(user_id=stranger.id, book_id=None, private_title="The Odyssey, my notes",
                                   private_author="Someone", is_wanted=True))
    db_session.commit()
    response = client.get("/me/library", params={"q": "Odyssey"})
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["book"]["title"] for item in items] == ["Ὀδύσσεια"]
    assert items[0]["book"]["english_title"] == "The Odyssey"
    assert client.get("/me/library", params={"q": "Iliad"}).json()["items"] == []
    assert unsaved.id != saved.id
