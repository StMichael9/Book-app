from __future__ import annotations

import importlib

import pytest
import requests
from sqlalchemy import delete, func, select

from data import clean

WORKS_URL = "https://openlibrary.org/data/ol_dump_works_2026-09-01.txt.gz"
AUTHORS_URL = "https://openlibrary.org/data/ol_dump_authors_2026-09-01.txt.gz"
EDITIONS_URL = "https://openlibrary.org/data/ol_dump_editions_2026-09-01.txt.gz"
ISBN = "9780140328721"


def records():
    return {
        WORKS_URL: [
            {"key": "/works/OL1W", "title": "Legacy Book", "subjects": ["Fantasy", "Science"],
             "authors": [{"author": {"key": "/authors/OL1A"}}],
             "description": "A new description", "first_publish_date": "1999",
             "covers": [111]},
            {"key": "/works/OL2W", "title": "Second Book", "subjects": ["Mystery"],
             "authors": [{"author": {"key": "/authors/OL1A"}},
                         {"author": {"key": "/authors/OL2A"}}],
             "first_publish_year": 2001},
            {"key": "/works/OL3W", "title": "Bad Work", "subjects": ["Fantasy"],
             "authors": []},
        ],
        AUTHORS_URL: [
            {"key": "/authors/OL1A", "name": "Same Author"},
            {"key": "/authors/OL2A", "name": "Second Author"},
            {"key": "/authors/OL3A", "name": "Unused Author"},
        ],
        EDITIONS_URL: [
            {"key": "/books/OL1M", "works": [{"key": "/works/OL1W"}],
             "languages": [{"key": "/languages/eng"}],
             "isbn_13": [ISBN], "number_of_pages": 250},
            {"key": "/books/OL2M", "works": [{"key": "/works/OL1W"}],
             "isbn_13": ["invalid"], "number_of_pages": 999},
            {"key": "/books/OL3M", "works": [{"key": "/works/OL2W"}],
             "isbn_13": ["bad"], "number_of_pages": None},
        ],
    }


@pytest.fixture()
def import_env(app_modules, test_database_url, monkeypatch):
    models = app_modules["models"]
    database = app_modules["database"]
    importer = importlib.import_module("data.load")
    database.Base.metadata.create_all(bind=database.engine)
    with database.SessionLocal.begin() as session:
        session.execute(delete(models.CatalogueStageWorkAuthor))
        session.execute(delete(models.CatalogueImportRun))
        session.execute(delete(models.UserBook))
        session.execute(delete(models.UserPreference))
        session.execute(delete(models.Book))
        session.execute(delete(models.Author))
        session.execute(delete(models.Tag))
        session.execute(delete(models.User))
    monkeypatch.setenv("BOOKVANE_TEST_DB_ISOLATED", "yes")
    monkeypatch.setenv("TEST_DATABASE_URL", test_database_url)

    def config(run_id="sample", batch_size=2, max_books=100):
        return importer.ImportConfig(
            run_id=run_id, works_url=WORKS_URL, authors_url=AUTHORS_URL,
            editions_url=EDITIONS_URL, database_url=test_database_url,
            mode="test", user_agent="BookvaneImport (test@example.org)",
            batch_size=batch_size, max_books=max_books, max_database_mb=5000,
        )

    return models, database.SessionLocal, importer, config


def fake_stream(monkeypatch, source=None, interrupt=None):
    source = source or records()
    calls = []
    interrupted = False

    def stream(url, *, start_line=0, user_agent):
        nonlocal interrupted
        calls.append((url, start_line))
        for line, record in enumerate(source[url], start=1):
            if line <= start_line:
                continue
            yield clean.DumpRow(line, record)
            if interrupt == url and line == 2 and not interrupted:
                interrupted = True
                raise RuntimeError("simulated job interruption")

    monkeypatch.setattr(clean, "stream_dump", stream)
    return calls


def test_import_backfills_legacy_book_and_preserves_want(import_env, monkeypatch):
    models, factory, importer, config = import_env
    with factory.begin() as session:
        author = models.Author(name="Same Author")
        book = models.Book(title="Legacy Book", description=None, authors=[author])
        user = models.User(email="import-test@example.org", hashed_password="unused")
        session.add_all([book, user])
        session.flush()
        legacy_id = book.id
        session.add(models.UserBook(user_id=user.id, book_id=book.id, status=models.UserBookStatus.want))
    fake_stream(monkeypatch)
    importer.run_import(config())
    with factory() as session:
        books = session.execute(select(models.Book)).scalars().all()
        assert len(books) == 2
        legacy = session.execute(select(models.Book).where(models.Book.source_id == "/works/OL1W")).scalar_one()
        assert legacy.id == legacy_id
        assert legacy.description == "A new description"
        assert legacy.cover_image_url.endswith("/111-L.jpg")
        assert legacy.isbn13 == ISBN
        assert legacy.page_count == 250
        assert session.execute(select(models.UserBook.book_id)).scalar_one() == legacy_id
        assert session.execute(select(func.count()).select_from(models.Author)).scalar_one() == 2
        assert session.execute(select(func.count()).select_from(models.Tag)).scalar_one() == 3
        assert session.execute(select(func.count()).select_from(models.book_authors)).scalar_one() == 3
        assert session.execute(select(func.count()).select_from(models.book_tags)).scalar_one() == 3
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"
        assert session.execute(select(func.count()).select_from(models.CatalogueStageWork)).scalar_one() == 0
    importer.run_import(config())
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2


def test_second_snapshot_updates_without_duplicates_or_erasing_values(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    fake_stream(monkeypatch, source)
    importer.run_import(config("first"))
    source[WORKS_URL][0]["title"] = "Legacy Book Revised"
    source[WORKS_URL][0]["description"] = None
    source[WORKS_URL][0]["covers"] = []
    source[EDITIONS_URL][0]["isbn_13"] = ["9780306406157"]
    source[EDITIONS_URL][0]["number_of_pages"] = None
    importer.run_import(config("second"))
    with factory() as session:
        books = session.execute(select(models.Book)).scalars().all()
        assert len(books) == 2
        revised = session.execute(select(models.Book).where(models.Book.source_id == "/works/OL1W")).scalar_one()
        assert revised.title == "Legacy Book Revised"
        assert revised.description == "A new description"
        assert revised.cover_image_url.endswith("/111-L.jpg")
        assert revised.isbn13 == ISBN
        assert revised.page_count == 250
        assert session.execute(select(func.count()).select_from(models.book_authors)).scalar_one() == 3


@pytest.mark.parametrize("phase_url", [WORKS_URL, AUTHORS_URL, EDITIONS_URL])
def test_resume_from_committed_batch(import_env, monkeypatch, phase_url):
    models, factory, importer, config = import_env
    calls = fake_stream(monkeypatch, interrupt=phase_url)
    with pytest.raises(RuntimeError, match="interruption"):
        importer.run_import(config())
    with factory() as session:
        run = session.get(models.CatalogueImportRun, "sample")
        assert run.checkpoint_line == 2
        assert run.phase == {WORKS_URL: "works", AUTHORS_URL: "authors", EDITIONS_URL: "editions"}[phase_url]
    importer.run_import(config())
    assert (phase_url, 2) in calls
    with factory() as session:
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2


def test_test_mode_rejects_nonlocal_database(import_env, monkeypatch):
    _models, _factory, importer, config = import_env
    unsafe = importer.ImportConfig(
        **{**config().__dict__, "database_url": "postgresql://user:secret@db.example.org/bookvane_test"}
    )
    with pytest.raises(ValueError, match="local PostgreSQL"):
        unsafe.validate()


def test_batch_failure_rolls_back_checkpoint_and_replays(import_env, monkeypatch):
    models, factory, importer, config = import_env
    calls = fake_stream(monkeypatch)
    original = importer._write_works
    failed = False

    def fail_after_write(session, run, rows):
        nonlocal failed
        original(session, run, rows)
        if not failed:
            failed = True
            raise RuntimeError("failed before commit")

    monkeypatch.setattr(importer, "_write_works", fail_after_write)
    with pytest.raises(RuntimeError, match="before commit"):
        importer.run_import(config())
    with factory() as session:
        assert session.get(models.CatalogueImportRun, "sample").checkpoint_line == 0
        assert session.execute(select(func.count()).select_from(models.CatalogueStageWork)).scalar_one() == 0
    importer.run_import(config())
    assert calls.count((WORKS_URL, 0)) == 2
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2


def test_malformed_dump_row_is_counted_and_skipped(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()

    def stream(url, *, start_line=0, user_agent):
        for line, record in enumerate(source[url], start=1):
            if line <= start_line:
                continue
            if url == WORKS_URL and line == 2:
                yield clean.DumpRow(line, None, "bad JSON")
            else:
                yield clean.DumpRow(line, record)

    monkeypatch.setattr(clean, "stream_dump", stream)
    importer.run_import(config())
    with factory() as session:
        run = session.get(models.CatalogueImportRun, "sample")
        assert run.phase == "complete"
        assert run.error_count == 1
        assert "bad JSON" in run.last_error
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 1


def test_duplicate_work_across_batches_keeps_one_book_and_combines_tags(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    source[WORKS_URL].append({
        "key": "/works/OL1W", "title": "Legacy Book",
        "subjects": ["Mystery"],
        "authors": [{"author": {"key": "/authors/OL1A"}}],
    })
    fake_stream(monkeypatch, source)
    importer.run_import(config(batch_size=2))
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2
        book = session.execute(select(models.Book).where(models.Book.source_id == "/works/OL1W")).scalar_one()
        assert {tag.name for tag in book.tags} == {"fantasy", "science", "mystery"}


def test_full_500_work_batch_uses_bulk_writes(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = {
        WORKS_URL: [
            {"key": f"/works/OL{index}W", "title": f"Batch Book {index}",
             "subjects": ["Science"], "authors": [{"author": {"key": "/authors/OL1A"}}]}
            for index in range(1, 501)
        ],
        AUTHORS_URL: [{"key": "/authors/OL1A", "name": "Batch Author"}],
        EDITIONS_URL: [],
    }
    fake_stream(monkeypatch, source)
    importer.run_import(config(batch_size=500, max_books=500))
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 500
        assert session.execute(select(func.count()).select_from(models.Author)).scalar_one() == 1
        assert session.execute(select(func.count()).select_from(models.book_authors)).scalar_one() == 500
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"


def test_ambiguous_legacy_match_never_reassigns_want(import_env, monkeypatch):
    models, factory, importer, config = import_env
    with factory.begin() as session:
        book = models.Book(title="Same Title", authors=[models.Author(name="Same Author")])
        user = models.User(email="ambiguous@example.org", hashed_password="unused")
        session.add_all([book, user])
        session.flush()
        legacy_id = book.id
        session.add(models.UserBook(user_id=user.id, book_id=book.id, status=models.UserBookStatus.want))
    source = {
        WORKS_URL: [
            {"key": f"/works/OL{index}W", "title": "Same Title",
             "subjects": ["Fantasy"], "authors": [{"author": {"key": "/authors/OL1A"}}]}
            for index in (1, 2)
        ],
        AUTHORS_URL: [{"key": "/authors/OL1A", "name": "Same Author"}],
        EDITIONS_URL: [],
    }
    fake_stream(monkeypatch, source)
    importer.run_import(config())
    with factory() as session:
        assert session.get(models.Book, legacy_id).source_id is None
        assert session.execute(select(models.UserBook.book_id)).scalar_one() == legacy_id
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 3
        assert session.get(models.CatalogueImportRun, "sample").error_count == 2


def test_storage_gate_stops_before_catalogue_writes(import_env, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch)
    monkeypatch.setattr(importer, "_database_mb", lambda _session: 501.0)
    guarded = importer.ImportConfig(**{**config().__dict__, "max_database_mb": 500})
    with pytest.raises(RuntimeError, match="stop threshold"):
        importer.run_import(guarded)
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 0
        assert session.get(models.CatalogueImportRun, "sample").checkpoint_line == 0


def test_transient_network_failure_retries_with_bounded_backoff(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    attempts = 0
    delays = []

    def stream(url, *, start_line=0, user_agent):
        nonlocal attempts
        if url == WORKS_URL:
            attempts += 1
            if attempts < 3:
                raise requests.ConnectionError("temporary")
        for line, record in enumerate(source[url], start=1):
            if line > start_line:
                yield clean.DumpRow(line, record)

    monkeypatch.setattr(clean, "stream_dump", stream)
    monkeypatch.setattr(importer.time, "sleep", delays.append)
    importer.run_import(config())
    assert attempts == 3
    assert delays == [2, 4]
    with factory() as session:
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"
