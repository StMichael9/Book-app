"""T32: Google Books is live-only. Mocked throughout; nothing from Google may ever be persisted."""
import pytest
from pydantic import SecretStr
from sqlalchemy import select, text

from test_catalogue_on_demand import doc, good_work, ol, work_json, world  # noqa: F401

ISBN = "9780306406157"
MARK = "GOOGLE-ONLY-TEXT-9d41"


class Google:
    """A fake Google Books volumes API: records calls, answers from `items`, can refuse any call."""

    def __init__(self):
        self.calls, self.items, self.headers, self.status, self.forbidden = [], [], {}, 200, False

    def __call__(self, url, params=None, timeout=None, **kwargs):
        assert not self.forbidden, "Google must not be called"
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        outer = self

        class Response:
            status_code = outer.status
            headers = outer.headers

            def json(self):
                return {"items": [{"volumeInfo": item} for item in outer.items]}

        return Response()


@pytest.fixture()
def google(monkeypatch, app_modules):
    from services import google_books
    fake = Google()
    monkeypatch.setattr(google_books.requests, "get", fake)
    monkeypatch.setattr(google_books, "bucket", google_books._TokenBucket(1000))
    monkeypatch.setattr(google_books.settings, "google_books_enabled", True)
    monkeypatch.setattr(google_books.settings, "google_books_api_key", SecretStr("test-key"))
    google_books.clear_cache()
    yield fake
    google_books.clear_cache()


def volume(description=f"<p>{MARK}</p>", link="https://books.google.com/books?id=abc", **over):
    return {"title": "Orphan X", "authors": ["Gregg Hurwitz"], "description": description, "infoLink": link,
            "industryIdentifiers": [{"type": "ISBN_13", "identifier": ISBN}], **over}


# --- the kill switch ---------------------------------------------------------------------------------------------

def test_it_is_off_by_default_and_without_a_key_and_makes_no_call(monkeypatch, app_modules):
    from services import google_books
    fake = Google()
    fake.forbidden = True
    monkeypatch.setattr(google_books.requests, "get", fake)
    assert google_books.settings.google_books_enabled is False  # the default
    assert google_books.description_for(ISBN, "Orphan X", "Gregg Hurwitz") is None
    assert google_books.isbn_for("Orphan X", "Gregg Hurwitz") is None
    monkeypatch.setattr(google_books.settings, "google_books_enabled", True)
    assert not google_books.enabled()  # enabled but no key
    monkeypatch.setattr(google_books.settings, "google_books_api_key", SecretStr("  "))
    assert not google_books.enabled() and google_books.description_for(ISBN, None, None) is None


# --- text handling -----------------------------------------------------------------------------------------------

def test_html_becomes_plain_text_keeping_every_word_and_never_truncating(app_modules):
    from services.google_books import html_to_text
    assert html_to_text("<p>One &amp; two</p><p>Three<br>four<br/>five<BR />six</p><b>bold</b> <i>it</i>") == \
        "One & two\nThree\nfour\nfive\nsix\nbold it"
    assert html_to_text("&lt;not a tag&gt; caf&eacute; &#8212; ok") == "<not a tag> café — ok"
    long = "word " * 40000
    assert html_to_text(f"<p>{long}</p>") == long.strip() and len(html_to_text(f"<p>{long}</p>")) > 150000


def test_description_comes_back_unaltered_with_the_google_link(google):
    from services import google_books
    google.items = [volume(description="<p>First.</p><p>Second<br>line &amp; more.</p>")]
    result = google_books.description_for(ISBN, "Orphan X", "Gregg Hurwitz")
    assert result == {"text": "First.\nSecond\nline & more.", "link": "https://books.google.com/books?id=abc"}
    call = google.calls[0]
    assert call["timeout"] == 3 and call["params"]["key"] == "test-key" and call["params"]["q"] == f"isbn:{ISBN}"


def test_a_volume_without_a_google_books_link_or_text_is_not_used(google):
    from services import google_books
    google.items = [volume(link="https://evil.example/books?id=1")]
    assert google_books.description_for(ISBN, None, None) is None
    google.items = [volume(link="http://books.google.com/x")]
    google_books.clear_cache()
    assert google_books.description_for(ISBN, None, None) is None
    google.items = [volume(description="   ")]
    google_books.clear_cache()
    assert google_books.description_for(ISBN, None, None) is None


def test_failures_return_nothing(google):
    from services import google_books
    google.status = 500
    assert google_books.description_for(ISBN, None, None) is None
    google.status = 429
    assert google_books.description_for("9780140449136", None, None) is None


# --- cache and rate ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("header,ttl", [("public, max-age=60", 60), ("max-age=999999999", 24 * 3600), ("", 3600)])
def test_cache_lives_for_the_shorter_of_cache_control_and_24_hours(google, monkeypatch, header, ttl):
    from services import google_books
    clock = {"t": 1000.0}
    monkeypatch.setattr(google_books.time, "monotonic", lambda: clock["t"])
    google.items, google.headers = [volume()], {"Cache-Control": header}
    google_books.description_for(ISBN, None, None)
    clock["t"] += ttl - 1
    google_books.description_for(ISBN, None, None)
    assert len(google.calls) == 1  # still cached
    clock["t"] += 2
    google_books.description_for(ISBN, None, None)
    assert len(google.calls) == 2  # expired


def test_calls_are_limited_to_five_a_second(monkeypatch, app_modules):
    from services import catalogue_resolver as r, google_books
    assert google_books.MAX_PER_SECOND == 5
    sleeps, clock = [], {"t": 50.0}
    monkeypatch.setattr(r.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(r.time, "sleep", lambda s: sleeps.append(round(s, 3)))
    bucket = r._TokenBucket(google_books.MAX_PER_SECOND)
    for _ in range(4):
        bucket.take()
    assert sleeps == [0.2, 0.4, 0.6]


# --- endpoints ---------------------------------------------------------------------------------------------------

def test_book_description_falls_back_to_google_only_when_open_library_has_none(client, world, google):
    book = next(iter(world.books.values()))
    google.items = [volume(title=book.title, authors=[book.authors[0].name])]
    book.description = "Open Library text."
    world.db.commit()
    google.forbidden = True
    assert client.get(f"/books/{book.id}/description").json() == {"text": "Open Library text.", "source": "openlibrary"}
    google.forbidden = False
    book.description = None
    world.db.commit()
    body = client.get(f"/books/{book.id}/description")
    assert body.json() == {"text": MARK, "source": "google", "link": "https://books.google.com/books?id=abc"}
    assert body.headers["Cache-Control"] == "private, no-store"


def test_with_the_kill_switch_off_the_endpoints_return_null(client, world, monkeypatch):
    from services import google_books
    fake = Google()
    fake.forbidden = True
    monkeypatch.setattr(google_books.requests, "get", fake)
    book = next(iter(world.books.values()))
    book.description = None
    world.db.commit()
    assert client.get(f"/books/{book.id}/description").json() == {"text": None, "source": None}


def test_a_readers_private_entry_gets_google_text_too(client, world, google, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    user = world.make_user()
    entry = world.make_entry(user)
    google.items = [volume()]
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    try:
        body = client.get(f"/me/library/{entry.id}/description")
        assert body.json() == {"text": MARK, "source": "google", "link": "https://books.google.com/books?id=abc"}
        assert body.headers["Cache-Control"] == "private, no-store"
        own = world.make_entry(user, title="Has its own", private_description="Mine.")
        google.forbidden = True
        assert client.get(f"/me/library/{own.id}/description").json() == {"text": "Mine.", "source": None}
    finally:
        app_modules["main"].app.dependency_overrides.pop(get_current_user, None)


# --- resolver tier 4 ---------------------------------------------------------------------------------------------

def test_when_open_library_finds_nothing_google_supplies_only_an_isbn(world, ol, google):
    from services.catalogue_resolver import resolve
    google.items = [volume()]
    ol.routes = {"/search.json": {"docs": []}, f"/isbn/{ISBN}.json": {"key": "/books/OL77M", "works": [{"key": "/works/OL77W"}],
                                                                          "number_of_pages": 400},
                 "/works/OL77W.json": work_json(description=None), "/authors/OL90001A.json": {"name": "Gregg Hurwitz"}}
    result = resolve(world.db, title="Orphan X", author="Gregg Hurwitz")
    assert result.work["source_id"] == "/works/OL77W" and result.work["isbns"][0] == ISBN
    assert result.work["description"] is None and MARK not in str(result.work)  # no Google text in the candidate
    assert google.calls[0]["params"]["q"].startswith("intitle:")


def test_tier_4_is_skipped_when_google_is_off(world, ol, monkeypatch):
    from services import google_books
    from services.catalogue_resolver import resolve
    fake = Google()
    fake.forbidden = True
    monkeypatch.setattr(google_books.requests, "get", fake)
    ol.routes = {"/search.json": {"docs": []}}
    assert resolve(world.db, title="Orphan X", author="Gregg Hurwitz").work is None


# --- nothing from Google is ever stored --------------------------------------------------------------------------

TABLES = ("books", "authors", "editions", "edition_isbns", "user_books", "catalogue_lookups", "catalogue_lookup_waiters",
          "catalogue_import_issues", "book_title_aliases", "tags", "event_counts")


def test_no_google_text_is_persisted_by_promote_the_worker_imports_or_the_description_path(world, ol, google, client, app_modules):
    from services import catalogue_queue as q
    google.items = [volume()]
    ol.routes = {"/search.json": {"docs": []}, f"/isbn/{ISBN}.json": {"key": "/books/OL77M", "works": [{"key": "/works/OL77W"}],
                                                                          "number_of_pages": 400},
                 "/works/OL77W.json": work_json(description=None), "/authors/OL90001A.json": {"name": "Gregg Hurwitz"}}
    user = world.make_user()
    entry = world.make_entry(user)
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=entry.id)
    world.db.commit()
    assert q.process(world.db, lookup) == "done"
    world.db.commit()
    book = world.db.get(world.models.Book, lookup.result_book_id)
    assert book.description is None and not book.has_description
    assert client.get(f"/books/{book.id}/description").json()["source"] == "google"  # shown live...
    world.db.expire_all()
    for table in TABLES:  # ...but never written anywhere
        found = world.db.scalar(text(f"SELECT count(*) FROM {table} t WHERE t::text LIKE :m"), {"m": f"%{MARK}%"})
        assert found == 0, table
