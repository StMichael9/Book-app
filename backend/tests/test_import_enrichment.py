"""T31: imports show every row at once, then unknown books are looked up once and upgraded in place. Open Library is mocked."""
import pytest
from sqlalchemy import delete, func, select

from test_catalogue_on_demand import OL, doc, work_json  # noqa: F401  (fake Open Library helpers)
from test_library_import_workflow import analyzed, apply, import_api, importing, seal, start  # noqa: F401

ISBN = "9780306406157"


@pytest.fixture()
def ol(monkeypatch):
    from services import catalogue_resolver
    fake = OL()
    monkeypatch.setattr(catalogue_resolver, "ol_get", fake)
    return fake


@pytest.fixture(autouse=True)
def tidy(db_session, app_modules):
    yield
    models = app_modules["models"]
    db_session.rollback()
    db_session.execute(delete(models.CatalogueLookup))
    db_session.execute(delete(models.Book).where(models.Book.added_via == "reader_backfill"))
    db_session.execute(delete(models.Author).where(models.Author.source_id.like("/authors/OL9000%")))
    db_session.commit()


def rows(db, models, user):
    return {e.private_title or e.book_id: e for e in db.scalars(select(models.UserBook).where(models.UserBook.user_id == user.id))}


def run_import(user, workflow, data):
    _, run = start(user, workflow, ["title", "author", "isbn13", "status"])
    seal(user, workflow, run, data)
    analyzed(user, workflow, run)
    assert apply(user, workflow, run)["phase"] in ("completed", "completed_with_issues")
    return run


def open_library(ol):
    ol.routes = {
        f"/isbn/{ISBN}.json": {"key": "/books/OL90001M", "works": [{"key": "/works/OL90001W"}], "number_of_pages": 300,
                               "isbn_13": [ISBN]},
        "/works/OL90001W.json": work_json("Isbn Book", "Found by ISBN.", authors=("OL90001A",)),
        "/authors/OL90001A.json": {"name": "Ina Writer"},
        "/search.json": {"docs": [{**doc("/works/OL90002W", "Search Book", ("Sam Writer",)), "isbn": []}]},
        "/works/OL90002W.json": work_json("Search Book", "Found by search.", authors=("OL90001A",)),
    }


def test_rows_show_at_once_then_upgrade_with_no_network_during_the_import(import_api, ol, app_modules, seeded_books, db_session):
    models = app_modules["models"]
    from services import catalogue_queue as q
    user, workflow, client = import_api
    known = next(iter(seeded_books.values()))
    known.isbn13 = "9780140449136"
    db_session.commit()
    run = run_import(user, workflow, [["Isbn Book", "Ina Writer", ISBN, "want"], ["Search Book", "Sam Writer", "", "want"],
                                      [known.title, known.authors[0].name, "9780140449136", "want"]])
    assert ol.calls == []  # analysis and apply use the local tiers only
    entries = rows(db_session, models, user)
    assert set(entries) == {"Isbn Book", "Search Book", known.id}  # all rows visible at once
    assert entries["Isbn Book"].private_catalogue["isbn"] == ISBN and entries["Isbn Book"].private_catalogue["lookup_key"] == f"isbn:{ISBN}"
    assert entries["Search Book"].private_catalogue["lookup_key"].startswith("ta:")
    assert entries[known.id].private_catalogue is None
    assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == 2
    url = f"/me/library-imports/{run['id']}/enrichment"
    assert client.get(url).json() == {"pending": 2, "upgraded": 0}
    assert client.get(url).headers["cache-control"] == "private, no-store"

    open_library(ol)
    for lookup in db_session.scalars(select(models.CatalogueLookup)).all():
        assert q.process(db_session, lookup) == "done"
    db_session.commit()
    db_session.expire_all()
    assert client.get(url).json() == {"pending": 0, "upgraded": 2}
    entries = rows(db_session, models, user)
    assert all(entries[t].book_id for t in ("Isbn Book", "Search Book"))
    assert entries["Isbn Book"].private_title == "Isbn Book" and entries["Isbn Book"].is_wanted  # reader fields kept


def test_reimporting_the_same_file_creates_no_duplicate_entries_or_lookups(importing, ol, db_session, app_modules):
    models = app_modules["models"]
    from services import catalogue_queue as q
    user, workflow = importing
    data = [["Isbn Book", "Ina Writer", ISBN, "want"], ["Search Book", "Sam Writer", "", "want"]]
    run_import(user, workflow, data)
    open_library(ol)
    for lookup in db_session.scalars(select(models.CatalogueLookup)).all():
        q.process(db_session, lookup)
    db_session.commit()
    count = lambda model: db_session.scalar(select(func.count()).select_from(model))  # noqa: E731
    entries, lookups, books = count(models.UserBook), count(models.CatalogueLookup), count(models.Book)
    run_import(user, workflow, data)
    db_session.expire_all()
    assert (count(models.UserBook), count(models.CatalogueLookup), count(models.Book)) == (entries, lookups, books)


def test_a_book_two_readers_import_is_looked_up_once(importing, ol, db_session, app_modules):
    models = app_modules["models"]
    user, workflow = importing
    other = models.User(email="enrich-other@example.test", hashed_password="x")
    db_session.add(other)
    db_session.commit()
    try:
        from services.library_imports.workflow import ImportWorkflow
        run_import(user, workflow, [["Isbn Book", "Ina Writer", ISBN, "want"]])
        run_import(other, ImportWorkflow(db_session), [["Isbn Book", "Ina Writer", ISBN, "want"]])
        assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == 1
        info = [(r.user_id == other.id, r.disposition, r.error_code) for r in db_session.scalars(select(models.LibraryImportRow))]
        assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookupWaiter)) == 2, info
    finally:
        db_session.rollback()
        db_session.execute(delete(models.LibraryImportRun).where(models.LibraryImportRun.user_id == other.id))
        db_session.execute(delete(models.ImportedLibraryRecord).where(models.ImportedLibraryRecord.user_id == other.id))
        db_session.execute(delete(models.User).where(models.User.id == other.id))
        db_session.commit()


def test_enrichment_is_owner_scoped_and_unknown_runs_are_404(import_api):
    from uuid import uuid4
    user, workflow, client = import_api
    assert client.get(f"/me/library-imports/{uuid4()}/enrichment").status_code == 404
    _, run = start(user, workflow)
    assert client.get(f"/me/library-imports/{run['id']}/enrichment").json() == {"pending": 0, "upgraded": 0}


def test_backfill_script_dry_run_writes_nothing_and_a_real_run_is_repeatable(importing, db_session, app_modules):
    models = app_modules["models"]
    from data.enqueue_private_entries import backfill
    user, _ = importing
    db_session.add_all([models.UserBook(user_id=user.id, private_title="Old One", private_author="Some Author", is_wanted=True),
                        models.UserBook(user_id=user.id, private_title="No Author", is_wanted=True)])
    db_session.commit()

    assert backfill(db_session, dry_run=True)["queued"] >= 1
    assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == 0
    first = backfill(db_session, dry_run=False)
    assert first["queued"] >= 1
    lookups = db_session.scalar(select(func.count()).select_from(models.CatalogueLookup))
    again = backfill(db_session, dry_run=False)
    assert db_session.scalar(select(func.count()).select_from(models.CatalogueLookup)) == lookups  # nothing queued twice
    assert again["queued"] == 0 or again["queued"] < first["queued"]
