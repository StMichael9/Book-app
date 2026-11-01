"""Catalogue on demand (T30): resolver, vetting gate, promote, lookup queue, worker wake-up, description endpoints.

Open Library is mocked everywhere: no test makes a network call.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select


class OL:
    """A fake Open Library: path -> JSON (or an exception to raise). Records every call."""

    def __init__(self):
        self.routes, self.calls = {}, []

    def __call__(self, path, params=None):
        self.calls.append((path, params))
        value = self.routes.get(path)
        if isinstance(value, Exception):
            raise value
        return value


@pytest.fixture()
def ol(monkeypatch, client):
    from services import catalogue_resolver
    fake = OL()
    monkeypatch.setattr(catalogue_resolver, "ol_get", fake)
    return fake


@pytest.fixture()
def world(db_session, app_modules, seeded_books):
    models = app_modules["models"]
    created = []

    class W:
        pass

    w = W()
    w.models, w.db, w.books = models, db_session, seeded_books

    def make_user():
        user = models.User(email=f"od-{uuid.uuid4().hex[:8]}@example.test", hashed_password="x")
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    def make_entry(user, title="Orphan X", author="Gregg Hurwitz", **fields):
        entry = models.UserBook(user_id=user.id, private_title=title, private_author=author, is_wanted=True, **fields)
        db_session.add(entry)
        db_session.commit()
        return entry

    w.make_user, w.make_entry = make_user, make_entry
    yield w
    db_session.rollback()
    db_session.execute(delete(models.CatalogueLookup))
    db_session.execute(delete(models.User).where(models.User.id.in_(created)))
    db_session.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "gate_reject"))
    db_session.execute(delete(models.Book).where(models.Book.added_via == "reader_backfill"))
    db_session.execute(delete(models.Author).where(models.Author.source_id.like("/authors/OL9000%")))
    db_session.commit()


def work_json(title="Orphan X", description=None, authors=("OL90001A",), covers=(111,), date="2016"):
    data = {"title": title, "authors": [{"author": {"key": f"/authors/{key}"}} for key in authors],
            "covers": list(covers), "first_publish_date": date}
    if description:
        data["description"] = description
    return data


def good_work(**over):
    work = {"source_id": "/works/OL9001T", "title": "A Fresh Book", "authors": ["Ann Author"], "author_keys": ["/authors/OL90009A"],
            "description": "Plain text.", "cover_image_url": "https://covers.openlibrary.org/b/id/1-L.jpg",
            "published_year": 2010, "page_count": 321, "isbns": ["9780306406157"], "edition_key": "/books/OL9001M"}
    work["source_id"] = "/works/OL9001W"
    work.update(over)
    return work


# --- resolver ----------------------------------------------------------------------------------------------------

def test_neon_is_checked_first_and_costs_no_network_call(world, ol):
    from services.catalogue_resolver import resolve
    book = next(iter(world.books.values()))
    book.isbn13 = "9780306406157"
    world.db.commit()
    result = resolve(world.db, isbn="9780306406157")
    assert (result.book_id, result.confidence) == (book.id, "isbn") and ol.calls == []
    author = book.authors[0].name
    again = resolve(world.db, title=book.title, author=author)
    assert again.book_id == book.id and again.confidence == "title_author" and ol.calls == []


def test_isbn_lookup_walks_edition_to_work_to_authors(world, ol):
    from services.catalogue_resolver import resolve
    ol.routes = {"/isbn/9780306406157.json": {"key": "/books/OL77M", "works": [{"key": "/works/OL77W"}], "number_of_pages": 400,
                                              "isbn_13": ["9780306406157"], "publish_date": "2016"},
                 "/works/OL77W.json": work_json(description={"value": "A thriller."}),
                 "/authors/OL90001A.json": {"name": "Gregg Hurwitz"}}
    result = resolve(world.db, isbn="978-0-306-40615-7")
    assert result.confidence == "isbn" and result.book_id is None
    assert result.work["source_id"] == "/works/OL77W" and result.work["authors"] == ["Gregg Hurwitz"]
    assert result.work["page_count"] == 400 and result.work["description"] == "A thriller." and result.ol_description == "A thriller."
    assert result.work["cover_image_url"].endswith("111-L.jpg") and result.work["edition_key"] == "/books/OL77M"


def test_a_work_we_already_hold_resolves_to_its_book_without_more_calls(world, ol):
    from services.catalogue_resolver import resolve
    book = next(iter(world.books.values()))
    book.source_id = "/works/OL77W"
    world.db.commit()
    ol.routes = {"/isbn/9780306406157.json": {"key": "/books/OL77M", "works": [{"key": "/works/OL77W"}]}}
    assert resolve(world.db, isbn="9780306406157").book_id == book.id
    assert [call[0] for call in ol.calls] == ["/isbn/9780306406157.json"]


def doc(key, title="Orphan X", authors=("Gregg Hurwitz",)):
    return {"key": key, "title": title, "author_name": list(authors), "author_key": ["/authors/OL90001A"],
            "first_publish_year": 2016, "cover_i": 5, "number_of_pages_median": 400, "isbn": ["9780306406157", "x"]}


def test_title_and_author_search_checks_every_candidate_work_for_a_description(world, ol):
    from services.catalogue_resolver import resolve
    ol.routes = {"/search.json": {"docs": [doc("/works/OL1W", "Orphan X: A Novel"), doc("/works/OL2W"), doc("/works/OL3W")]},
                 "/works/OL1W.json": work_json(), "/works/OL2W.json": work_json(),
                 "/works/OL3W.json": work_json(description="The one with text.")}
    result = resolve(world.db, title="Orphan X", author="Hurwitz, Gregg")
    assert result.confidence == "title_author" and result.work["source_id"] == "/works/OL1W"
    assert result.ol_description == "The one with text." and result.work["description"] == "The one with text."
    assert result.work["isbns"] == ["9780306406157"] and result.work["page_count"] == 400


@pytest.mark.parametrize("docs", [
    [doc("/works/OL1W", "A Different Book")], [doc("/works/OL1W", authors=("Someone Else",))], [],
])
def test_title_and_author_must_both_match_or_there_is_no_match(world, ol, docs):
    from services.catalogue_resolver import resolve
    ol.routes = {"/search.json": {"docs": docs}}
    result = resolve(world.db, title="Orphan X", author="Gregg Hurwitz")
    assert result.confidence == "none" and result.book_id is None and result.work is None


def test_open_library_etiquette_user_agent_timeout_backoff_and_rate(monkeypatch):
    import requests
    from services import catalogue_resolver as r
    seen = {}

    class Response:
        def __init__(self, status):
            self.status_code = status

        def json(self):
            return {"ok": True}

    def fake_get(url, params=None, timeout=None, headers=None):
        seen.update(url=url, timeout=timeout, headers=headers)
        return Response(seen.get("status", 200))

    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setattr(r, "bucket", r._TokenBucket(1000))
    assert r.ol_get("/x.json") == {"ok": True}
    assert seen["timeout"] == 4 and seen["headers"]["User-Agent"].startswith("Bookvane (")
    for status in (429, 500, 503):
        seen["status"] = status
        with pytest.raises(r.OpenLibraryUnavailable):
            r.ol_get("/x.json")
    seen["status"] = 404
    assert r.ol_get("/x.json") is None
    sleeps, clock = [], {"t": 100.0}
    monkeypatch.setattr(r.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(r.time, "sleep", lambda s: sleeps.append(round(s, 3)))
    bucket = r._TokenBucket(3)
    for _ in range(4):
        bucket.take()
    assert sleeps == [0.333, 0.667, 1.0]  # never more than 3 requests a second


# --- the gate ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("over,reason", [
    ({"source_id": "isbn:9780306406157"}, "not_open_library"), ({"title": "Untitled"}, "bad_title"),
    ({"title": "9780306406157"}, "bad_title"), ({"authors": []}, "no_author"), ({"authors": ["Unknown"]}, "bad_author"),
    ({"title": "The Complete Box Set"}, "derivative"), ({"title": "Summary of Dune"}, "derivative"),
    ({"title": "SparkNotes: Hamlet"}, "derivative"), ({"cover_image_url": None}, "no_cover"),
    ({"published_year": None}, "no_year"), ({"page_count": None}, "no_pages"),
])
def test_each_gate_rule_rejects_with_a_reason(world, over, reason):
    from services import catalogue_gate
    verdict = catalogue_gate.vet(world.db, good_work(**over))
    assert isinstance(verdict, catalogue_gate.Rejected) and verdict.reason == reason


def test_a_clean_work_is_accepted_with_authors_deduplicated_by_normalised_name(world):
    from services import catalogue_gate
    verdict = catalogue_gate.vet(world.db, good_work(authors=["Ann  Author", "ann author", "Bo Other"],
                                                     description="  Some   text "))
    assert isinstance(verdict, catalogue_gate.Accepted)
    assert verdict.work["authors"] == ["Ann Author", "Bo Other"] and verdict.work["description"] == "Some text"


def test_duplicates_link_to_the_existing_book_instead_of_inserting(world):
    from services import catalogue_gate
    book = next(iter(world.books.values()))
    book.source_id, book.isbn13 = "/works/OL555W", "9780306406157"
    world.db.commit()
    author = book.authors[0].name
    world.db.add(world.models.CatalogueSourceAlias(old_source_id="/works/OL556W", canonical_source_id="/works/OL555W",
                                                   source_type="redirect"))
    world.db.commit()
    for over in ({"source_id": "/works/OL555W"}, {"source_id": "/works/OL556W"}, {"isbns": ["9780306406157"]},
                 {"title": book.title, "authors": [author], "isbns": []}):
        verdict = catalogue_gate.vet(world.db, good_work(**over))
        assert isinstance(verdict, catalogue_gate.Duplicate) and verdict.book_id == book.id, over
    world.db.execute(delete(world.models.CatalogueSourceAlias).where(
        world.models.CatalogueSourceAlias.old_source_id == "/works/OL556W"))
    world.db.commit()


def test_the_daily_cap_and_the_capacity_guard_defer_instead_of_rejecting(world, monkeypatch):
    from services import catalogue_gate
    monkeypatch.setattr(catalogue_gate.settings, "catalogue_promote_daily_cap", 1)
    assert isinstance(catalogue_gate.vet(world.db, good_work()), catalogue_gate.Accepted)
    catalogue_gate.promote(world.db, good_work())
    world.db.commit()
    verdict = catalogue_gate.vet(world.db, good_work(source_id="/works/OL9002W", isbns=["9780140449136"], title="Another One"))
    assert isinstance(verdict, catalogue_gate.Deferred) and verdict.reason == "daily_cap"
    monkeypatch.setattr(catalogue_gate.settings, "catalogue_promote_daily_cap", 100)
    monkeypatch.setattr(catalogue_gate, "_capacity", lambda db: False)
    verdict = catalogue_gate.vet(world.db, good_work(source_id="/works/OL9002W", isbns=["9780140449136"], title="Another One"))
    assert isinstance(verdict, catalogue_gate.Deferred) and verdict.reason == "capacity"


def test_rejections_log_a_reason_code_only(world):
    from services import catalogue_gate
    catalogue_gate.log_rejection(world.db, good_work(title="Secret Title"), "no_cover")
    world.db.commit()
    row = world.db.scalar(select(world.models.CatalogueImportIssue).where(world.models.CatalogueImportIssue.code == "gate_reject"))
    assert (row.run_id, row.source_id, row.detail) == (None, "/works/OL9001W", "no_cover")


# --- promote -----------------------------------------------------------------------------------------------------

def test_promote_stores_open_library_data_with_provenance_and_no_reader_data(world):
    from services import catalogue_cache, catalogue_gate
    catalogue_cache.put(("book", 1), {"x": 1}, 60)
    book_id = catalogue_gate.promote(world.db, catalogue_gate.vet(world.db, good_work()).work)
    world.db.commit()
    book = world.db.get(world.models.Book, book_id)
    assert (book.source_id, book.title, book.page_count, book.published_year, book.isbn13) == (
        "/works/OL9001W", "A Fresh Book", 321, 2010, "9780306406157")
    assert book.added_via == "reader_backfill" and abs(book.added_at - datetime.now(timezone.utc)) < timedelta(minutes=1)
    assert [a.name for a in book.authors] == ["Ann Author"] and book.authors[0].source_id == "/authors/OL90009A"
    edition = world.db.scalar(select(world.models.Edition).where(world.models.Edition.book_id == book_id))
    assert edition.source_id == "/books/OL9001M" and book.preferred_edition_id == edition.id
    assert [i.isbn13 for i in edition.isbns] == ["9780306406157"]
    assert book.is_listed and book.has_description
    assert catalogue_cache.get(("book", 1)) is None  # the catalogue cache was cleared
    columns = {c.name for c in world.models.Book.__table__.columns}
    assert not {name for name in columns if "user" in name or "email" in name or "note" in name}


def test_a_listed_book_without_a_description_is_still_listed(world):
    from services import catalogue_gate
    book_id = catalogue_gate.promote(world.db, catalogue_gate.vet(world.db, good_work(description=None)).work)
    world.db.commit()
    book = world.db.get(world.models.Book, book_id)
    assert book.is_listed and not book.has_description


# --- queue and linking -------------------------------------------------------------------------------------------

def ok_ol(ol, title="Orphan X"):
    ol.routes = {"/search.json": {"docs": [doc("/works/OL1W", title)]}, "/works/OL1W.json": work_json(title, "Described."),
                 "/authors/OL90001A.json": {"name": "Gregg Hurwitz"}}


def test_enqueue_is_idempotent_per_book_and_registers_each_waiting_entry(world):
    from services import catalogue_queue as q
    u1, u2 = world.make_user(), world.make_user()
    e1, e2 = world.make_entry(u1), world.make_entry(u2)
    a = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=e1.id)
    b = q.enqueue(world.db, isbn=None, title="orphan x: a novel", author="Hurwitz, Gregg", user_book_id=e2.id)
    q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=e1.id)
    world.db.commit()
    assert a.id == b.id and a.key.startswith("ta:")
    assert q.enqueue(world.db, isbn="9780306406157", title=None, author=None).key == "isbn:9780306406157"
    assert q.enqueue(world.db, isbn=None, title="Only a title", author=None) is None
    waiters = world.db.scalars(select(world.models.CatalogueLookupWaiter.user_book_id).where(
        world.models.CatalogueLookupWaiter.lookup_id == a.id)).all()
    assert sorted(waiters) == sorted([e1.id, e2.id])


def test_a_promoted_book_links_waiting_entries_and_keeps_every_reader_field(world, ol):
    from services import catalogue_queue as q
    user = world.make_user()
    entry = world.make_entry(user, save_note="my note", private_description="my blurb")
    entry_id, version = entry.id, entry.version
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=entry_id)
    world.db.commit()
    ok_ol(ol)
    assert q.process(world.db, lookup) == "done"
    world.db.commit()
    world.db.expire_all()
    entry = world.db.get(world.models.UserBook, entry_id)
    book = world.db.get(world.models.Book, lookup.result_book_id)
    assert entry.book_id == book.id and book.added_via == "reader_backfill" and book.description == "Described."
    assert (entry.private_title, entry.private_author, entry.private_description) == ("Orphan X", "Gregg Hurwitz", "my blurb")
    assert entry.save_note == "my note" and entry.is_wanted and entry.version == version + 1


def test_a_reader_who_already_owns_the_book_keeps_their_private_entry(world, ol):
    from services import catalogue_queue as q
    user = world.make_user()
    first = world.make_entry(user)
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=first.id)
    world.db.commit()
    ok_ol(ol)
    q.process(world.db, lookup)
    world.db.commit()
    second = world.make_entry(user, title="Orphan X again")
    world.db.refresh(lookup)
    q.link_waiters(world.db, lookup, lookup.result_book_id, only_entry=second.id)
    world.db.commit()
    world.db.refresh(second)
    assert second.book_id is None  # the reader already holds this book; nothing was merged or deleted


def test_failure_and_rejection_leave_the_entry_unchanged(world, ol):
    from services import catalogue_queue as q
    from services.catalogue_resolver import OpenLibraryUnavailable
    user = world.make_user()
    entry = world.make_entry(user)
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz", user_book_id=entry.id)
    world.db.commit()
    ol.routes = {"/search.json": OpenLibraryUnavailable("429")}
    assert q.process(world.db, lookup) == "queued"
    no_cover = {**doc("/works/OL1W", "Orphan X"), "cover_i": None}
    ol.routes = {"/search.json": {"docs": [no_cover]}, "/works/OL1W.json": work_json(covers=()),
                 "/authors/OL90001A.json": {"name": "Gregg Hurwitz"}}
    assert q.process(world.db, lookup) == "rejected"
    world.db.commit()
    world.db.refresh(entry)
    assert entry.book_id is None and entry.private_title == "Orphan X"
    reasons = world.db.scalars(select(world.models.CatalogueImportIssue.detail).where(
        world.models.CatalogueImportIssue.code == "gate_reject")).all()
    assert reasons == ["no_cover"]


def test_retry_backoff_is_1_minute_10_minutes_1_hour_1_day_then_failed_with_a_monthly_retry(world, ol):
    from services import catalogue_queue as q
    from services.catalogue_resolver import OpenLibraryUnavailable
    lookup = q.enqueue(world.db, isbn="9780306406157", title=None, author=None)
    world.db.commit()
    ol.routes = {"/isbn/9780306406157.json": OpenLibraryUnavailable("503")}
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    seen = []
    for _ in range(5):
        status = q.process(world.db, lookup, now)
        seen.append((status, lookup.next_try_at - now))
    assert [s for s, _ in seen] == ["queued"] * 4 + ["failed"]
    assert [d for _, d in seen] == [timedelta(minutes=1), timedelta(minutes=10), timedelta(hours=1), timedelta(days=1),
                                    timedelta(days=30)]


def test_a_deferred_book_waits_an_hour_without_using_an_attempt(world, ol, monkeypatch):
    from services import catalogue_gate, catalogue_queue as q
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz")
    world.db.commit()
    ok_ol(ol)
    monkeypatch.setattr(catalogue_gate, "_capacity", lambda db: False)
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert q.process(world.db, lookup, now) == "queued" and lookup.attempts == 0
    assert lookup.next_try_at - now == timedelta(hours=1)


def test_drain_once_processes_due_rows_and_reports_when_the_next_is_due(world, ol, app_modules):
    from services import catalogue_queue as q
    factory = app_modules["database"].SessionLocal
    q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz")
    later = q.enqueue(world.db, isbn="9780306406157", title=None, author=None)
    later.next_try_at = datetime.now(timezone.utc) + timedelta(hours=2)
    world.db.commit()
    ok_ol(ol)
    processed, delay = q.drain_once(factory)
    assert processed == 1 and delay == 0.0
    processed, delay = q.drain_once(factory)
    assert processed == 0 and 7000 < delay <= 7200
    world.db.execute(delete(world.models.CatalogueLookup))
    world.db.commit()
    assert q.drain_once(factory) == (0, None)


def test_the_worker_sleeps_until_woken_and_never_polls(world, monkeypatch, app_modules):
    from services import catalogue_queue as q
    factory = app_modules["database"].SessionLocal
    calls = []

    def fake_drain(_factory):
        calls.append(1)
        return (0, None)

    monkeypatch.setattr(q, "drain_once", fake_drain)

    async def scenario():
        task = asyncio.create_task(q.run_worker(factory))
        await asyncio.sleep(0.3)
        assert len(calls) == 1  # one look at startup, then it sleeps
        await asyncio.sleep(0.5)
        assert len(calls) == 1  # still no polling
        q.wake()
        await asyncio.sleep(0.3)
        assert len(calls) == 2  # woken by an enqueue
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    q.wake()  # a no-op once the worker is gone


def test_nothing_is_stored_when_no_reader_waits_and_the_book_is_rejected(world, ol):
    from services import catalogue_queue as q
    lookup = q.enqueue(world.db, isbn=None, title="Orphan X", author="Gregg Hurwitz")
    world.db.commit()
    ol.routes = {"/search.json": {"docs": []}}
    before = world.db.scalar(select(world.models.Book.id).order_by(world.models.Book.id.desc()).limit(1))
    q.process(world.db, lookup)
    world.db.commit()
    assert world.db.scalar(select(world.models.Book.id).order_by(world.models.Book.id.desc()).limit(1)) == before


# --- description endpoints ---------------------------------------------------------------------------------------

def test_book_description_endpoint(client, world):
    book = next(b for b in world.books.values())
    book.description = "  Catalogue text.  "
    world.db.commit()
    body = client.get(f"/books/{book.id}/description")
    assert body.json() == {"text": "Catalogue text.", "source": "openlibrary"} and "public" in body.headers["Cache-Control"]
    book.description = None
    world.db.commit()
    assert client.get(f"/books/{book.id}/description").json() == {"text": None, "source": None}
    assert client.get("/books/99999999/description").status_code == 404


def test_entry_description_endpoint_prefers_the_catalogue_then_the_readers_own(client, world, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    main = app_modules["main"]
    user, other = world.make_user(), world.make_user()
    book = next(iter(world.books.values()))
    book.description = "Catalogue text."
    mine = world.models.UserBook(user_id=user.id, book_id=book.id, is_wanted=True, private_description="My blurb")
    private = world.make_entry(user, private_description="Only mine")
    bare = world.make_entry(user, title="Bare")
    world.db.add(mine)
    world.db.commit()
    main.app.dependency_overrides[get_current_user] = lambda: user
    try:
        client.app.dependency_overrides  # noqa: B018
        assert client.get(f"/me/library/{mine.id}/description").json() == {"text": "Catalogue text.", "source": "openlibrary"}
        assert client.get(f"/me/library/{private.id}/description").json() == {"text": "Only mine", "source": None}
        assert client.get(f"/me/library/{bare.id}/description").json() == {"text": None, "source": None}
        main.app.dependency_overrides[get_current_user] = lambda: other
        assert client.get(f"/me/library/{private.id}/description").status_code == 404
    finally:
        main.app.dependency_overrides.pop(get_current_user, None)


def test_listing_filter_follows_cover_year_and_pages_not_the_description(world):
    book = next(iter(world.books.values()))
    book.description = None
    world.db.commit()
    world.db.refresh(book)
    assert book.is_listed and not book.has_description
    book.page_count = None
    world.db.commit()
    world.db.refresh(book)
    assert not book.is_listed


def test_migration_follows_profile_v1():
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "b8e5f1c7d204_catalogue_on_demand.py"
    assert "down_revision = 'a7d4e2b9c683'" in path.read_text(encoding="utf-8")


def test_promoted_books_get_existing_tags_from_subjects_and_never_new_ones(world):
    from services import catalogue_gate
    before = world.db.scalar(select(world.models.Tag.id).order_by(world.models.Tag.id.desc()).limit(1))
    work = good_work(subjects=["Fantasy fiction", "A subject nobody mapped", "Horror tales"])
    book_id = catalogue_gate.promote(world.db, catalogue_gate.vet(world.db, work).work)
    world.db.commit()
    names = {t.name for t in world.db.get(world.models.Book, book_id).tags}
    assert "fantasy" in names and names <= {"fantasy", "horror", "magic", "epic", "gothic", "humor"}
    assert world.db.scalar(select(world.models.Tag.id).order_by(world.models.Tag.id.desc()).limit(1)) == before  # none created
    plain = catalogue_gate.promote(world.db, catalogue_gate.vet(world.db, good_work(
        source_id="/works/OL9003W", title="Subjectless", isbns=["9780140449136"])).work)
    world.db.commit()
    assert world.db.get(world.models.Book, plain).tags == []
