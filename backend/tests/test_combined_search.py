"""T45: one combined search. Open Library is mocked everywhere: no test makes a network call."""
import uuid

import pytest
from sqlalchemy import delete, select

from test_catalogue_on_demand import OL as _OL  # noqa: F401


class FakeOL:
    """A fake Open Library: the search.json docs and the work records. Records every call."""

    def __init__(self):
        self.docs, self.records, self.calls, self.error = [], {}, [], None

    def __call__(self, path, params=None, timeout=None):
        self.calls.append((path, params, timeout))
        if self.error:
            raise self.error
        if path == "/search.json":
            wanted = (params or {}).get("q", "")
            if wanted.startswith("key:"):
                wanted_keys = set(__import__("re").findall(r"/works/OL\d+W", wanted))
                return {"docs": [d for d in self.docs if d["key"] in wanted_keys]}
            return {"docs": self.docs}
        return self.records.get(path)


def doc(n, title="Fourth Wing", authors=("Rebecca Yarros",), cover=77, year=2023, pages=500, readers=5000, ratings=900, **extra):
    base = {"key": f"/works/OL7{n:05d}W", "title": title, "author_name": list(authors), "author_key": [f"/authors/OL7{n:05d}A"],
            "cover_i": cover, "first_publish_year": year, "number_of_pages_median": pages, "readinglog_count": readers,
            "ratings_count": ratings, "subject": ["Fantasy"], "isbn": []}
    base.update(extra)
    return {k: v for k, v in base.items() if v is not None}


@pytest.fixture()
def ol(monkeypatch, client):
    from services import catalogue_resolver, combined_search
    fake = FakeOL()
    monkeypatch.setattr(catalogue_resolver, "ol_get", fake)
    combined_search.clear()
    yield fake
    combined_search.clear()


@pytest.fixture()
def me(app_modules, db_session, client):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    user = models.User(email=f"cs-{uuid.uuid4().hex[:8]}@example.test", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    from auth.dependencies import get_current_user_optional
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    app_modules["main"].app.dependency_overrides[get_current_user_optional] = lambda: user
    limiter.reset()
    yield user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    app_modules["main"].app.dependency_overrides.pop(get_current_user_optional, None)
    db_session.rollback()
    db_session.execute(delete(models.Book).where(models.Book.source_id.like("/works/OL7%W")))
    db_session.execute(delete(models.Author).where(models.Author.source_id.like("/authors/OL7%A")))
    db_session.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "gate_reject"))
    db_session.execute(delete(models.User).where(models.User.id == user.id))
    db_session.commit()
    limiter.reset()


def keys(response):
    return [item["work_key"] for item in response.json()]


def test_only_results_that_would_pass_the_gate_come_back_shaped_like_cards(client, ol, me):
    ol.docs = [doc(1), doc(2, cover=None), doc(3, authors=()), doc(4, year=None), doc(5, pages=None),
               doc(6, title="Fourth Wing Omnibus"), doc(7, title="Iron Flame", readers=9000)]
    r = client.get("/books/more", params={"book": "wing"})
    assert r.status_code == 200 and keys(r) == ["/works/OL700007W", "/works/OL700001W"]
    card = r.json()[1]
    assert set(card) == {"work_key", "title", "authors", "cover_url", "published_year", "page_count", "popularity"}
    assert card["authors"] == ["Rebecca Yarros"] and card["cover_url"].endswith("/77-L.jpg") and card["popularity"] > 0
    assert "openlibrary" not in str(card).lower().replace("covers.openlibrary.org", "")   # no source name anywhere


def test_the_exact_title_comes_first_then_popularity(client, ol, me):
    ol.docs = [doc(1, title="Sapiens Companion", readers=90000), doc(2, title="Sapiens", readers=100), doc(3, title="Sapiens Notes", readers=500)]
    assert keys(client.get("/books/more", params={"book": "Sapiens"})) == ["/works/OL700002W", "/works/OL700001W", "/works/OL700003W"]


def test_books_we_already_hold_are_left_out_by_work_key_alias_and_isbn(client, ol, me, db_session, app_modules):
    models = app_modules["models"]
    held = models.Book(title="Held By Key", source_id="/works/OL700001W", cover_image_url="x", page_count=10, published_year=2000)
    by_isbn = models.Book(title="Held By Isbn", source_id="/works/OL799999W", isbn13="9780141324524", cover_image_url="x",
                          page_count=10, published_year=2000)
    db_session.add_all([held, by_isbn])
    db_session.flush()
    db_session.add(models.CatalogueSourceAlias(old_source_id="/works/OL700003W", canonical_source_id=held.source_id, source_type="redirect"))
    db_session.commit()
    ol.docs = [doc(1), doc(2, isbn=["9780141324524"]), doc(3), doc(4, title="Brand New")]
    assert keys(client.get("/books/more", params={"book": "x"})) == ["/works/OL700004W"]
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == "/works/OL700003W"))
    db_session.commit()


@pytest.mark.parametrize("error", [None, "unavailable", "boom"])
def test_any_failure_is_an_empty_list_never_an_error(client, ol, me, error):
    from services.catalogue_resolver import OpenLibraryUnavailable
    ol.error = OpenLibraryUnavailable("timeout") if error == "unavailable" else RuntimeError("boom") if error else None
    ol.docs = [] if error is None else [doc(1)]
    r = client.get("/books/more", params={"book": "anything"})
    assert r.status_code == 200 and r.json() == []


def test_the_search_uses_the_short_timeout_and_results_are_cached_for_a_day(client, ol, me, monkeypatch):
    from services import combined_search
    ol.docs = [doc(1)]
    assert keys(client.get("/books/more", params={"book": "Fourth Wing"})) == ["/works/OL700001W"]
    assert ol.calls[0][2] == 1.5 and ol.calls[0][1]["q"] == 'title:"Fourth Wing"'
    client.get("/books/more", params={"book": "  fourth   WING "})
    assert len(ol.calls) == 1                                   # the same search, normalised, is served from memory
    client.get("/books/more", params={"book": "fourth wing", "author": "yarros"})
    assert len(ol.calls) == 2
    later = combined_search.time.monotonic() + 24 * 3600 + 5
    monkeypatch.setattr(combined_search.time, "monotonic", lambda: later)
    client.get("/books/more", params={"book": "Fourth Wing"})
    assert len(ol.calls) == 3                                   # a day later it is asked again


def test_a_search_with_no_text_asks_nothing(client, ol, me):
    assert client.get("/books/more").json() == [] and ol.calls == []


# --- resolve ---------------------------------------------------------------------------------------------------------

def test_resolve_stores_a_new_book_through_the_gate_with_popularity(client, ol, me, db_session, app_modules):
    models = app_modules["models"]
    ol.docs = [doc(1, readers=4000, ratings=800)]
    ol.records["/works/OL700001W.json"] = {"title": "Fourth Wing", "description": "A dragon-rider academy."}
    r = client.post("/books/resolve", json={"work_key": "/works/OL700001W"})
    assert r.status_code == 200
    book = db_session.get(models.Book, r.json()["id"])
    assert book.source_id == "/works/OL700001W" and book.title == "Fourth Wing" and book.popularity and book.popularity > 8
    assert book.description == "A dragon-rider academy." and book.added_via == "reader_backfill"
    again = client.post("/books/resolve", json={"work_key": "/works/OL700001W"})
    assert again.json() == r.json()


def test_resolve_of_a_book_we_hold_returns_its_id_without_asking_open_library(client, ol, me, db_session, app_modules):
    models = app_modules["models"]
    held = models.Book(title="Held", source_id="/works/OL700002W", cover_image_url="x", page_count=10, published_year=2000)
    db_session.add(held)
    db_session.commit()
    r = client.post("/books/resolve", json={"work_key": "/works/OL700002W"})
    assert r.json() == {"id": held.id} and ol.calls == []


@pytest.mark.parametrize("over", [dict(pages=None), dict(cover=None), dict(year=None), dict(title="Fourth Wing Omnibus")])
def test_resolve_of_a_book_the_gate_rejects_is_422_not_listable_and_stores_nothing(client, ol, me, db_session, app_modules, over):
    models = app_modules["models"]
    ol.docs = [doc(1, **over)]
    r = client.post("/books/resolve", json={"work_key": "/works/OL700001W"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "not_listable"
    assert db_session.scalar(select(models.Book.id).where(models.Book.source_id == "/works/OL700001W")) is None


def test_resolve_bad_key_unknown_work_and_open_library_down(client, ol, me):
    from services.catalogue_resolver import OpenLibraryUnavailable
    assert client.post("/books/resolve", json={"work_key": "/books/OL1M"}).json()["detail"]["code"] == "not_listable"
    assert client.post("/books/resolve", json={"work_key": "/works/OL700404W"}).status_code == 422     # Open Library has no such work
    ol.error = OpenLibraryUnavailable("503")
    assert client.post("/books/resolve", json={"work_key": "/works/OL700001W"}).status_code == 503
    assert client.post("/books/resolve", json={"work_key": "/works/OL700001W", "extra": 1}).status_code == 422


def test_a_signed_in_reader_may_resolve_twenty_an_hour(client, ol, me):
    ol.docs = []
    for n in range(20):
        assert client.post("/books/resolve", json={"work_key": f"/works/OL7{n + 100:05d}W"}).status_code == 422
    r = client.post("/books/resolve", json={"work_key": "/works/OL700999W"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_many_resolves"


@pytest.fixture()
def guest(client, ol, app_modules, db_session):
    from auth.dependencies import get_current_user, get_current_user_optional
    from services import combined_search
    models = app_modules["models"]
    app = app_modules["main"].app
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)
    combined_search.clear()
    yield combined_search
    combined_search.clear()
    db_session.rollback()
    db_session.execute(delete(models.Book).where(models.Book.source_id.like("/works/OL7%W")))
    db_session.execute(delete(models.Author).where(models.Author.source_id.like("/authors/OL7%A")))
    db_session.commit()


def test_a_guest_can_resolve_and_is_never_asked_to_sign_in(client, ol, guest, db_session, app_modules):
    ol.docs = [doc(1)]
    ol.records["/works/OL700001W.json"] = {"title": "Fourth Wing"}
    r = client.post("/books/resolve", json={"work_key": "/works/OL700001W"})
    assert r.status_code == 200 and db_session.get(app_modules["models"].Book, r.json()["id"]).source_id == "/works/OL700001W"


def test_guests_get_ten_an_hour_per_address(client, ol, guest):
    ol.docs = []
    for n in range(10):
        assert client.post("/books/resolve", json={"work_key": f"/works/OL7{n + 100:05d}W"}).status_code == 422
    r = client.post("/books/resolve", json={"work_key": "/works/OL700999W"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_many_resolves"


def test_one_ceiling_covers_every_guest_for_the_day(client, ol, guest, monkeypatch):
    ol.docs = []
    monkeypatch.setattr(guest, "GUEST_RESOLVES_PER_HOUR", 1000)
    monkeypatch.setattr(guest, "GUEST_RESOLVES_PER_DAY", 3)
    for n in range(3):
        assert client.post("/books/resolve", json={"work_key": f"/works/OL7{n + 100:05d}W"}).status_code == 422
    r = client.post("/books/resolve", json={"work_key": "/works/OL700999W"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "resolve_ceiling"


# --- ranking of our own results -----------------------------------------------------------------------------------------

def test_a_typed_search_ranks_the_exact_title_first_then_popularity(client, me, db_session, app_modules):
    models = app_modules["models"]
    made = []
    for n, (title, pop) in enumerate([("Sapiens Companion Guide", 99.0), ("Sapiens", 5.0), ("Sapiens Reader", 50.0), ("sapiens  ", None)]):
        item = models.Book(title=title.strip() + (" " if n == 3 else ""), source_id=f"/works/OL7{n + 200:05d}W", popularity=pop,
                           cover_image_url="x", page_count=10, published_year=2000, description="d")
        item.authors = [models.Author(name="Yuval Test", source_id=f"/authors/OL7{n + 200:05d}A")]
        db_session.add(item)
        made.append(item)
    db_session.commit()
    titles = [i["title"].strip() for i in client.get("/books", params={"book": "sapiens"}).json()["items"]]
    assert titles[:2] == ["Sapiens", "sapiens"] or titles[:2] == ["sapiens", "Sapiens"]
    assert titles[2:] == ["Sapiens Companion Guide", "Sapiens Reader"]
    assert titles.index("Sapiens Companion Guide") < titles.index("Sapiens Reader")


# --- search normalisation (T45 addition: "1984" must find Nineteen Eighty-Four) -----------------------------------------

@pytest.mark.parametrize("text,key", [
    ("Nineteen Eighty-Four", "1984"), ("nineteen eighty four", "1984"), ("1984", "1984"), ("Catch-22", "catch 22"),
    ("Catch twenty-two", "catch 22"), ("two thousand and one", "2001"), ("2001: A Space Odyssey", "2001 a space odyssey"),
    ("The Hobbit", "hobbit"), ("A Christmas Carol", "christmas carol"), ("Pride & Prejudice", "pride and prejudice"),
    ("Fahrenheit 451", "fahrenheit 451"), ("Fahrenheit four hundred fifty-one", "fahrenheit 451"),
    ("Les Misérables", "les miserables"), ("One Hundred Years of Solitude", "100 years of solitude"),
    ("Don't Stop", "dont stop"), ("Twenty One Pilots", "21 pilots"), ("Ça va?", "ca va"), ("  ", ""), ("The", "the")])
def test_the_search_key_folds_titles_and_queries_the_same_way(db_session, text, key):
    from sqlalchemy import func
    assert db_session.scalar(select(func.bookvane_search_key(text))) == key


@pytest.fixture()
def titles(me, db_session, app_modules):
    models = app_modules["models"]
    made = {}
    for name, title, author in (("orwell", "Nineteen Eighty-Four", "George Orwell"), ("catch", "Catch-22", "Joseph Heller"),
                                ("fahr", "Fahrenheit 451", "Ray Bradbury"), ("odyssey", "2001: A Space Odyssey", "Arthur C. Clarke"),
                                ("hobbit", "The Hobbit", "J. R. R. Tolkien"), ("pride", "Pride and Prejudice", "Jane Austen"),
                                ("wib", "Wibblewick Chronicles", "Test Author")):
        item = models.Book(title=title, source_id=f"/works/OL7{len(made) + 300:05d}W", popularity=100.0, cover_image_url="x",
                           page_count=10, published_year=1949, description="d")
        item.authors = [models.Author(name=author, source_id=f"/authors/OL7{len(made) + 300:05d}A")]
        db_session.add(item)
        db_session.flush()
        made[name] = item
    db_session.commit()
    return made


@pytest.mark.parametrize("query,name", [
    ("1984", "orwell"), ("Nineteen Eighty Four", "orwell"), ("nineteen eighty-four", "orwell"), ("Catch 22", "catch"),
    ("Catch-22", "catch"), ("Fahrenheit 451", "fahr"), ("2001 a space odyssey", "odyssey"), ("the hobbit", "hobbit"),
    ("hobbit", "hobbit"), ("pride & prejudice", "pride"), ("wibblewik chronicles", "wib")])
def test_each_named_search_finds_the_right_book_first(client, titles, query, name):
    items = client.get("/books", params={"book": query}).json()["items"]
    assert items and items[0]["id"] == titles[name].id


def test_aliases_use_the_same_key_and_like_wildcards_stay_literal(client, titles, db_session, app_modules):
    models = app_modules["models"]
    db_session.add(models.BookTitleAlias(book_id=titles["pride"].id, title="Elizabeth Bennet's Story", source="openlibrary_edition"))
    db_session.commit()
    assert client.get("/books", params={"book": "elizabeth bennets story"}).json()["items"][0]["id"] == titles["pride"].id
    assert client.get("/books", params={"book": "%"}).json()["total"] == 0                    # not "everything"
    assert client.get("/books", params={"book": "wib_lewick"}).json()["total"] in (0, 1)       # "_" is not a one-letter wildcard
    exact = [i["id"] for i in client.get("/books", params={"book": "Pride and Prejudice"}).json()["items"]]
    assert exact[0] == titles["pride"].id


# --- speed of a pick (the real run took 10.8 s) -----------------------------------------------------------------------------

def test_a_pick_after_the_search_needs_one_open_library_request_and_is_fast(client, ol, me, monkeypatch):
    import time as clock
    real = ol.__call__

    class Slow(FakeOL):
        def __call__(self, path, params=None, timeout=None):
            clock.sleep(0.3)                                  # 300 ms per Open Library request
            return super().__call__(path, params, timeout)

    slow = Slow()
    slow.docs = [doc(1), doc(2, title="Iron Flame")]
    slow.records = {"/works/OL700001W.json": {"title": "Fourth Wing", "description": "A dragon-rider academy."},
                    "/works/OL700002W.json": {"title": "Iron Flame"}}
    from services import catalogue_resolver
    monkeypatch.setattr(catalogue_resolver, "ol_get", slow)
    assert len(client.get("/books/more", params={"book": "wing"}).json()) == 2
    slow.calls.clear()
    began = clock.perf_counter()
    r = client.post("/books/resolve", json={"work_key": "/works/OL700001W"})
    warm = clock.perf_counter() - began
    assert r.status_code == 200 and [c[0] for c in slow.calls] == ["/works/OL700001W.json"]      # no second search, no per-author calls
    assert warm < 1.5
    from services import combined_search
    combined_search.clear()                                                                      # cold: the search result is fetched too
    slow.calls.clear()
    began = clock.perf_counter()
    assert client.post("/books/resolve", json={"work_key": "/works/OL700002W"}).status_code == 200
    assert clock.perf_counter() - began < 3 and len(slow.calls) == 2


def test_a_failing_description_request_does_not_stop_the_book_being_stored(client, ol, me, monkeypatch):
    from services import catalogue_resolver
    from services.catalogue_resolver import OpenLibraryUnavailable

    def flaky(path, params=None, timeout=None):
        if path.endswith(".json") and not path.startswith("/search"):
            raise OpenLibraryUnavailable("timeout")
        return {"docs": [doc(1)]}

    monkeypatch.setattr(catalogue_resolver, "ol_get", flaky)
    assert client.post("/books/resolve", json={"work_key": "/works/OL700001W"}).status_code == 200
