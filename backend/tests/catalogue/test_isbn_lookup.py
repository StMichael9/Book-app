"""T67 part A: GET /me/catalogue/isbn/{isbn} is a lookup only, and a private entry saved with an ISBN queues a catalogue lookup.
Open Library is mocked; nothing here touches the network."""
import logging
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

sys.path.insert(0, str(Path(__file__).parent.parent))
from test_catalogue_on_demand import OL, work_json  # noqa: E402,F401

ISBN13 = "9780306406157"
ISBN10 = "0306406152"          # the same book as ISBN13
OTHER = "9781861972712"        # a valid ISBN-13 we never store


def unique(prefix, suffix):
    return f"/{prefix}/OL9{uuid.uuid4().int % 10**7}{suffix}"


@pytest.fixture
def reader(app_modules, db_session, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    user = models.User(email=f"scan-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add(user)
    db_session.commit()
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    db_session.rollback()
    db_session.execute(delete(models.CatalogueLookup))
    db_session.commit()
    limiter.reset()


@pytest.fixture
def ol(monkeypatch):
    from services import catalogue_resolver
    fake = OL()
    monkeypatch.setattr(catalogue_resolver, "ol_get", fake)
    return fake


@pytest.fixture
def held(app_modules, db_session):
    """A catalogue book with one edition that carries ISBN13."""
    models = app_modules["models"]
    book = models.Book(title="Held Book", source_id=unique("works", "W"), cover_image_url="http://c/held.jpg")
    author = models.Author(name="Hannah Held", source_id=unique("authors", "A"))
    db_session.add_all([book, author])
    db_session.flush()
    db_session.execute(models.book_authors.insert().values(book_id=book.id, author_id=author.id))
    edition = models.Edition(book_id=book.id, source_id=unique("books", "M"), languages=[], publishers=[])
    db_session.add(edition)
    db_session.flush()
    db_session.add(models.EditionISBN(edition_id=edition.id, isbn13=ISBN13))
    db_session.commit()
    yield book, edition
    db_session.rollback()
    db_session.execute(delete(models.UserBook).where(models.UserBook.book_id == book.id))
    db_session.execute(delete(models.Book).where(models.Book.id == book.id))
    db_session.execute(delete(models.Author).where(models.Author.id == author.id))
    db_session.commit()


def get(client, isbn):
    return client.get(f"/me/catalogue/isbn/{isbn}")


# --- normalisation -----------------------------------------------------------------------------------------------------

def test_isbn10_and_isbn13_with_hyphens_find_the_same_book(client, reader, ol, held):
    book, edition = held
    for value in (ISBN13, ISBN10, "978-0-306-40615-7", "0-306-40615-2"):
        body = get(client, value).json()
        assert body["status"] == "catalogue" and body["isbn13"] == ISBN13 and body["book_id"] == book.id
    assert ol.calls == []                                               # a catalogue hit makes no Open Library call


@pytest.mark.parametrize("bad", ["123", "9780306406158", "abcdefghij", "0306406153", "9770000000000"])
def test_an_invalid_isbn_is_422_and_makes_no_lookup(client, reader, ol, bad):
    assert get(client, bad).status_code == 422 and ol.calls == []


# --- catalogue hits ----------------------------------------------------------------------------------------------------

def test_a_catalogue_hit_returns_book_edition_and_card_and_on_shelf_flags(client, reader, ol, held):
    book, edition = held
    body = get(client, ISBN13).json()
    assert body["edition_id"] == edition.id and body["title"] == "Held Book" and body["authors"] == ["Hannah Held"]
    assert body["cover_url"] == "http://c/held.jpg" and body["on_shelf"] is None
    assert client.put(f"/me/library/books/{book.id}", json={"is_owned": True}).status_code == 200
    assert get(client, ISBN13).json()["on_shelf"] == {"is_owned": True, "is_wanted": False}


def test_a_books_own_isbn13_is_found_when_no_edition_carries_it(client, reader, ol, app_modules, db_session):
    models = app_modules["models"]
    book = models.Book(title="Book Level Only", source_id=unique("works", "W"), isbn13=OTHER)
    db_session.add(book)
    db_session.commit()
    try:
        body = get(client, OTHER).json()
        assert body["status"] == "catalogue" and body["book_id"] == book.id and body["edition_id"] is None
    finally:
        db_session.delete(book)
        db_session.commit()


def test_a_resolved_catalogue_lookup_answers_without_open_library(client, reader, ol, held, db_session, app_modules):
    models = app_modules["models"]
    book, _ = held
    db_session.add(models.CatalogueLookup(key=f"isbn:{OTHER}", isbn=OTHER, status="done", result_book_id=book.id))
    db_session.commit()
    body = get(client, OTHER).json()
    assert body["status"] == "catalogue" and body["book_id"] == book.id and ol.calls == []


# --- Open Library -----------------------------------------------------------------------------------------------------

def test_an_open_library_hit_is_a_preview_and_writes_nothing(client, reader, ol, db_session, app_modules):
    models = app_modules["models"]
    ol.routes = {f"/isbn/{OTHER}.json": {"title": "Edition Title", "works": [{"key": "/works/OL77W"}], "covers": [5]},
                 "/works/OL77W.json": work_json(title="Preview Work", authors=("OL90001A",), covers=(111,)),
                 "/authors/OL90001A.json": {"name": "Pat Preview"}}
    books_before = db_session.scalar(select(func.count()).select_from(models.Book))
    body = get(client, OTHER).json()
    assert body["status"] == "open_library" and body["title"] == "Preview Work" and body["authors"] == ["Pat Preview"]
    assert body["cover_url"].endswith("/111-L.jpg") and body["book_id"] is None and body["on_shelf"] is None
    assert db_session.scalar(select(func.count()).select_from(models.Book)) == books_before
    assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == 0           # a lookup, never a write


def test_not_found_and_unavailable_are_distinct(client, reader, ol):
    from services.catalogue_resolver import OpenLibraryUnavailable
    assert get(client, OTHER).json()["status"] == "not_found"
    ol.routes = {f"/isbn/{OTHER}.json": OpenLibraryUnavailable("503")}
    assert get(client, OTHER).json()["status"] == "unavailable"


def test_the_log_line_has_status_and_source_but_no_isbn_or_user(client, reader, ol, held, caplog):
    with caplog.at_level(logging.INFO, logger="bookvane.catalogue.scan"):
        get(client, ISBN13)
    line = "\n".join(r.getMessage() for r in caplog.records if r.name == "bookvane.catalogue.scan")
    assert "scan_lookup status=catalogue source=edition_isbns" in line
    assert ISBN13 not in line and str(reader.id) not in line


# --- private entries with an ISBN --------------------------------------------------------------------------------------

def test_a_private_entry_with_an_isbn_queues_a_lookup_and_links_when_it_resolves(client, reader, ol, held, db_session, app_modules):
    from services import catalogue_queue
    models = app_modules["models"]
    book, _ = held
    response = client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "Scanned", "author": "Sam Scan",
                                                        "is_owned": True, "isbn": "978-1-86197-271-2"})
    assert response.status_code == 200
    entry = db_session.scalar(select(models.UserBook).where(models.UserBook.user_id == reader.id))
    assert entry.book_id is None and entry.private_catalogue["isbn"] == OTHER
    lookup = db_session.scalar(select(models.CatalogueLookup).where(models.CatalogueLookup.key == f"isbn:{OTHER}"))
    assert lookup is not None and lookup.status == "queued"
    waiting = db_session.scalar(select(models.CatalogueLookupWaiter.user_book_id).where(
        models.CatalogueLookupWaiter.lookup_id == lookup.id))
    assert waiting == entry.id
    # the worker resolves the lookup: the waiting private entry upgrades to the catalogue book, keeping the reader's flags
    lookup.status, lookup.result_book_id = "done", book.id
    catalogue_queue.link_waiters(db_session, lookup, book.id)
    db_session.commit()
    db_session.refresh(entry)
    assert entry.book_id == book.id and entry.is_owned


def test_a_private_entry_without_an_isbn_is_unchanged(client, reader, db_session, app_modules):
    models = app_modules["models"]
    payload = {"request_id": str(uuid.uuid4()), "title": "Typed By Hand", "is_wanted": True}
    assert client.post("/me/library/private", json=payload).status_code == 200
    assert client.post("/me/library/private", json=payload).status_code == 200            # the same request id is idempotent
    assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == 0
    entry = db_session.scalar(select(models.UserBook).where(models.UserBook.user_id == reader.id))
    assert entry.private_catalogue is None


def test_a_scanned_private_isbn_shows_as_on_the_shelf(client, reader, ol):
    assert client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "Scanned", "isbn": OTHER,
                                                    "is_wanted": True}).status_code == 200
    assert get(client, OTHER).json()["on_shelf"] == {"is_owned": False, "is_wanted": True}


def test_an_invalid_isbn_on_a_private_entry_is_422(client, reader):
    assert client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "x", "isbn": "123"}).status_code == 422


# --- rate limit ----------------------------------------------------------------------------------------------------------

def test_the_lookup_is_rate_limited_to_90_a_minute(client, reader, ol):
    codes = [get(client, OTHER).status_code for _ in range(92)]
    assert codes[:90] == [200] * 90 and 429 in codes[90:]
