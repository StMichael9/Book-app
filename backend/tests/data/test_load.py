from __future__ import annotations

import hashlib
import importlib
from argparse import Namespace
from dataclasses import replace

import pytest
import requests
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.exc import OperationalError
from urllib3.exceptions import ProtocolError

from data import clean

WORKS_URL = "https://openlibrary.org/data/ol_dump_works_2026-09-01.txt.gz"
AUTHORS_URL = "https://openlibrary.org/data/ol_dump_authors_2026-09-01.txt.gz"
EDITIONS_URL = "https://openlibrary.org/data/ol_dump_editions_2026-09-01.txt.gz"
REDIRECTS_URL = "https://openlibrary.org/data/ol_dump_redirects_2026-09-01.txt.gz"
DELETES_URL = "https://openlibrary.org/data/ol_dump_deletes_2026-09-01.txt.gz"
ISBN = "9780140328721"


def records():
    return {
        REDIRECTS_URL: [],
        DELETES_URL: [],
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
    with database.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    database.Base.metadata.create_all(bind=database.engine)
    with database.SessionLocal.begin() as session:
        session.execute(delete(models.CatalogueImportIssue))
        session.execute(delete(models.CatalogueStageAuthorCount))
        session.execute(delete(models.CatalogueStageCandidate))
        session.execute(delete(models.CatalogueStageWorkAuthor))
        session.execute(delete(models.CatalogueStageEdition))
        session.execute(delete(models.CatalogueStageAuthor))
        session.execute(delete(models.CatalogueStageWork))
        session.execute(delete(models.CatalogueImportRun))
        session.execute(delete(models.CatalogueSourceAlias))
        session.execute(delete(models.UserBook))
        session.execute(delete(models.UserPreference))
        session.execute(delete(models.EditionISBN))
        session.execute(delete(models.Edition))
        session.execute(delete(models.Book))
        session.execute(delete(models.Author))
        session.execute(delete(models.Tag))
        session.execute(delete(models.User))
    monkeypatch.setenv("BOOKVANE_TEST_DB_ISOLATED", "yes")
    monkeypatch.setenv("TEST_DATABASE_URL", test_database_url)

    def config(run_id="sample", batch_size=2, target_books=100):
        return importer.ImportConfig(
            run_id=run_id, works_url=WORKS_URL, authors_url=AUTHORS_URL,
            editions_url=EDITIONS_URL, redirects_url=REDIRECTS_URL,
            deletes_url=DELETES_URL, database_url=test_database_url,
            mode="test", user_agent="BookvaneImport (test@example.org)",
            batch_size=batch_size, target_books=target_books, max_database_mb=5000,
        )

    return models, database.SessionLocal, importer, config


def fake_stream(monkeypatch, source=None, interrupt=None):
    source = source or records()
    calls = []
    interrupted = False

    def stream(url, *, start_line=0, user_agent, progress_callback=None):
        nonlocal interrupted
        calls.append((url, start_line))
        for line, record in enumerate(source.get(url, []), start=1):
            if line <= start_line:
                continue
            yield clean.DumpRow(line, record)
            if interrupt == url and line == 2 and not interrupted:
                interrupted = True
                raise RuntimeError("simulated job interruption")

    monkeypatch.setattr(clean, "stream_dump", stream)
    return calls


def test_staging_measurement_is_exact_in_one_query(import_env):
    _, factory, importer, _ = import_env
    names = (
        "catalogue_stage_works", "catalogue_stage_work_authors", "catalogue_stage_authors",
        "catalogue_stage_editions", "catalogue_stage_candidates", "catalogue_stage_author_counts",
    )
    with factory() as session:
        statements = []

        def capture(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        engine = session.get_bind()
        event.listen(engine, "before_cursor_execute", capture)
        try:
            measured = importer._stage_mb(session)
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        expected = sum(session.scalar(text(
            "SELECT pg_total_relation_size(to_regclass(:name)) / 1048576.0"
        ), {"name": name}) for name in names)
        assert measured == float(expected)
        assert len(statements) == 1


def test_supported_batch_sizes_keep_same_work_shortlist(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = {WORKS_URL: [
        {"key": f"/works/OL{i}W", "title": f"Isolated batch fixture {i}",
         "subjects": ["Fantasy"], "authors": [{"author": {"key": "/authors/OL1A"}}],
         "description": "Isolated test metadata", "first_publish_year": 2000, "covers": [111]}
        for i in range(1, 2101)
    ]}
    fake_stream(monkeypatch, source=source)
    shortlists = []
    for batch_size in (500, 1000):
        cfg = config(run_id=f"batch-{batch_size}", batch_size=batch_size, target_books=100)
        for _ in range(3):
            importer.run_import(cfg, one_phase=True)
        with factory.begin() as session:
            run = session.get(models.CatalogueImportRun, cfg.run_id)
            assert run.phase == "authors"
            assert run.checkpoint_line == 0
            shortlists.append(set(session.execute(select(models.CatalogueStageWork.source_id).where(
                models.CatalogueStageWork.run_id == cfg.run_id
            )).scalars()))
            # Resolve this isolated staging-only run before exercising the next
            # batch setting. No real source or application Book rows are used.
            run.phase = "complete"
    assert len(shortlists[0]) == 10
    assert shortlists[0] == shortlists[1]


@pytest.mark.parametrize("batch_size", [2, 1000])
def test_import_backfills_legacy_book_and_preserves_want(import_env, monkeypatch, batch_size):
    models, factory, importer, config = import_env
    with factory.begin() as session:
        author = models.Author(name="Same Author")
        book = models.Book(title="Legacy Book", description=None, authors=[author],
                           cover_image_url="https://covers.openlibrary.org/b/id/111-L.jpg")
        user = models.User(email="import-test@example.org", hashed_password="unused")
        session.add_all([book, user])
        session.flush()
        legacy_id = book.id
        session.add(models.UserBook(user_id=user.id, book_id=book.id, status=models.UserBookStatus.want))
    fake_stream(monkeypatch)
    importer.run_import(config(batch_size=batch_size))
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
        assert session.get(models.CatalogueImportRun, "sample").report["total_books"] == 2
        assert session.execute(select(func.count()).select_from(models.CatalogueStageWork)).scalar_one() == 0
    importer.run_import(config(batch_size=batch_size))
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
        assert revised.isbn13 == "9780306406157"
        assert revised.page_count == 250
        assert session.execute(select(func.count()).select_from(models.book_authors)).scalar_one() == 3


@pytest.mark.parametrize("phase_url", [
    REDIRECTS_URL, DELETES_URL, WORKS_URL, AUTHORS_URL, EDITIONS_URL,
])
def test_resume_from_committed_batch(import_env, monkeypatch, phase_url):
    models, factory, importer, config = import_env
    source = records()
    source[REDIRECTS_URL] = [
        {"key": "/works/OL80W", "location": "/works/OL81W"},
        {"key": "/works/OL82W", "location": "/works/OL83W"},
    ]
    source[DELETES_URL] = [{"key": "/works/OL90W"}, {"key": "/works/OL91W"}]
    calls = fake_stream(monkeypatch, source, interrupt=phase_url)
    with pytest.raises(RuntimeError, match="interruption"):
        importer.run_import(config())
    with factory() as session:
        run = session.get(models.CatalogueImportRun, "sample")
        assert run.checkpoint_line == 2
        assert run.phase == {
            REDIRECTS_URL: "redirects", DELETES_URL: "deletes",
            WORKS_URL: "works", AUTHORS_URL: "authors", EDITIONS_URL: "editions",
        }[phase_url]
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
    assert calls.count((WORKS_URL, 0)) >= 2  # retry plus the hydration pass
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2


def test_malformed_dump_row_is_counted_and_skipped(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()

    def stream(url, *, start_line=0, user_agent, progress_callback=None):
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
    importer.run_import(config(batch_size=500, target_books=500))
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
        assert session.execute(select(func.count()).select_from(models.CatalogueImportIssue).where(
            models.CatalogueImportIssue.code == "ambiguous_legacy_book"
        )).scalar_one() == 2


def test_storage_gate_stops_before_catalogue_writes(import_env, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch)
    monkeypatch.setattr(importer, "_check_storage", lambda *_args: (_ for _ in ()).throw(
        importer.CapacityPause("Database reached guard")
    ))
    guarded = importer.ImportConfig(**{**config().__dict__, "max_database_mb": 500})
    with pytest.raises(importer.CapacityPause, match="guard"):
        importer.run_import(guarded)
    with factory() as session:
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 0
        assert session.get(models.CatalogueImportRun, "sample").checkpoint_line == 0
        assert session.get(models.CatalogueImportRun, "sample").phase == "paused_capacity"


def test_capacity_replay_skips_verified_aliases_and_records_guard_change(import_env):
    models, factory, importer, config = import_env
    original = config()
    manifest = {"files": {kind: {"md5": kind + "-checksum"}
                           for kind in ("redirects", "deletes")}}
    original = replace(original, source_manifest=manifest)
    with factory.begin() as session:
        run = importer._get_run(session, original)
        run.phase = "paused_capacity"
        run.merge_cursor = "/works/OL999W"
        run.selected_count, run.merged_count = 50, 20
        run.report = {"verified_dumps": {kind: kind + "-checksum"
                                         for kind in ("redirects", "deletes")}}
        session.add(models.Book(title="Previously committed book", source_id="/works/OL999W"))
    replay = replace(original, restart_paused=True, max_database_mb=6000)
    with factory.begin() as session:
        run = importer._get_run(session, replay)
        assert run.phase == "works"
        assert run.merge_cursor is None
        assert run.baseline_count == 1
        assert run.selected_count == run.merged_count == 0
        assert run.max_database_mb == 6000
        assert run.report["capacity_replays"][0]["previous_guard_mb"] == 5000
        assert len(run.report["verified_dumps"]) == 2
        assert importer._build_report(session, run)["capacity_replays"] == run.report["capacity_replays"]


def test_storage_guard_cannot_change_on_an_active_run(import_env):
    _models, factory, importer, config = import_env
    original = config()
    with factory.begin() as session:
        importer._get_run(session, original)
    with factory.begin() as session:
        with pytest.raises(ValueError, match="explicit capacity replay"):
            importer._get_run(session, replace(original, max_database_mb=6000))


def test_capacity_replay_resets_partial_merge_and_preserves_book_ids(import_env, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch)
    original_merge = importer._merge_batch
    calls = 0

    def interrupt_merge(session, options):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise importer.CapacityPause("simulated partial merge capacity pause")
        return original_merge(session, options)

    monkeypatch.setattr(importer, "_merge_batch", interrupt_merge)
    original = config(batch_size=1, target_books=2)
    with pytest.raises(importer.CapacityPause, match="partial merge"):
        importer.run_import(original)
    with factory() as session:
        saved = session.execute(select(models.Book)).scalar_one()
        saved_id, saved_key = saved.id, saved.source_id
        assert session.get(models.CatalogueImportRun, "sample").merge_cursor
    monkeypatch.setattr(importer, "_merge_batch", original_merge)
    assert importer.run_import(replace(original, restart_paused=True)) == "complete"
    with factory() as session:
        assert session.get(models.Book, saved_id).source_id == saved_key
        assert session.scalar(select(func.count()).select_from(models.Book)) == 2
        assert session.get(models.CatalogueImportRun, "sample").report["baseline_books"] == 1


def test_alias_compaction_preserves_relevant_chains_and_deleted_books(import_env):
    models, factory, importer, config = import_env
    from data.staging import _compact_aliases, _resolve_aliases
    with factory.begin() as session:
        run = importer._get_run(session, config())
        session.add_all([
            models.Book(title="Redirected existing book", source_id="/works/OL90W"),
            models.Book(title="Deleted source retained", source_id="/works/OL80W"),
        ])
        session.add(models.CatalogueStageWork(
            run_id=run.id, source_id="/works/OL1W", title="Shortlisted work",
            tags=[], categories=["fantasy"], quality=0,
        ))
        for old, new, kind in [
            ("/works/OL3W", "/works/OL2W", "redirect"),
            ("/works/OL2W", "/works/OL1W", "redirect"),
            ("/works/OL90W", "/works/OL91W", "redirect"),
            ("/works/OL91W", "/works/OL92W", "redirect"),
            ("/works/OL80W", "/works/OL80W", "deleted"),
            ("/works/OL100W", "/works/OL101W", "redirect"),
            ("/works/OL200W", "/works/OL200W", "deleted"),
        ]:
            session.add(models.CatalogueSourceAlias(old_source_id=old, canonical_source_id=new, source_type=kind))
    # A failed transaction must restore the complete alias table, including
    # data removed by TRUNCATE; it must not advance the run's scope marker.
    with pytest.raises(RuntimeError, match="rollback"):
        with factory.begin() as session:
            _compact_aliases(session, session.get(models.CatalogueImportRun, "sample"))
            raise RuntimeError("rollback")
    with factory.begin() as session:
        run = session.get(models.CatalogueImportRun, "sample")
        assert session.scalar(select(func.count()).select_from(models.CatalogueSourceAlias)) == 7
        _compact_aliases(session, run)
        assert run.report["alias_retained_count"] == 5
        assert _resolve_aliases(session, {"/works/OL3W", "/works/OL90W", "/works/OL80W"}) == {
            "/works/OL3W": "/works/OL1W", "/works/OL90W": "/works/OL92W", "/works/OL80W": None,
        }
        assert session.scalar(select(func.count()).select_from(models.Book)) == 2


def test_capacity_replay_restores_alias_dumps_after_shortlist_compaction(import_env):
    models, factory, importer, config = import_env
    original = replace(config(), source_manifest={"files": {
        kind: {"md5": kind + "-checksum"} for kind in ("redirects", "deletes")}})
    with factory.begin() as session:
        run = importer._get_run(session, original)
        run.phase = "paused_capacity"
        run.report = {"alias_scope": "shortlist", "verified_dumps": {
            kind: kind + "-checksum" for kind in ("redirects", "deletes")}}
    with factory.begin() as session:
        run = importer._get_run(session, replace(original, restart_paused=True))
        assert run.phase == "redirects"
        assert "redirects" not in run.report["verified_dumps"]
        assert "deletes" not in run.report["verified_dumps"]


def test_widened_shortlist_restores_pruned_aliases(import_env, monkeypatch):
    models, factory, importer, config = import_env
    from data import selection
    options = config(target_books=100)
    with factory.begin() as session:
        run = importer._get_run(session, options)
        run.phase = "select"
        run.report = {"alias_scope": "shortlist", "capacity_replays": [{"guard_mb": 5000}]}
        run.category_seen_counts = {"fantasy": 10000}
    with factory.begin() as session:
        selection._select_works(session, options)
        run = session.get(models.CatalogueImportRun, "sample")
        assert run.phase == "redirects"
        assert run.shortlist_factor == 4
        assert run.report["capacity_replays"] == [{"guard_mb": 5000}]


def test_transient_network_failure_retries_with_bounded_backoff(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    attempts = 0
    delays = []

    def stream(url, *, start_line=0, user_agent, progress_callback=None):
        nonlocal attempts
        if url == WORKS_URL:
            attempts += 1
            if attempts < 3:
                raise requests.ConnectionError("temporary")
        for line, record in enumerate(source.get(url, []), start=1):
            if line > start_line:
                yield clean.DumpRow(line, record)

    monkeypatch.setattr(clean, "stream_dump", stream)
    monkeypatch.setattr(importer.time, "sleep", delays.append)
    importer.run_import(config())
    assert attempts == 4  # three works attempts plus the hydration pass
    assert delays == [2, 4]
    with factory() as session:
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"


def test_percentage_quotas_scale_without_fixed_counts(import_env):
    _models, _factory, importer, _config = import_env
    weights = importer.equal_percentage_weights()
    for total in (1, 50_000, 100_000, 1_000_000):
        quotas = importer.percentage_quotas(total, weights)
        assert sum(quotas.values()) == total
        assert max(quotas.values()) - min(quotas.values()) <= 1


def test_same_name_authors_have_distinct_source_ids(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    source[WORKS_URL] = [
        {"key": f"/works/OL{n}W", "title": f"Title {n}", "subjects": ["Fantasy"],
         "authors": [{"author": {"key": f"/authors/OL{n}A"}}]}
        for n in (1, 2)
    ]
    source[AUTHORS_URL] = [
        {"key": f"/authors/OL{n}A", "name": "Shared Name"} for n in (1, 2)
    ]
    source[EDITIONS_URL] = []
    fake_stream(monkeypatch, source)
    importer.run_import(config(target_books=2))
    with factory() as session:
        authors = session.execute(select(models.Author)).scalars().all()
        assert len(authors) == 2
        assert {author.source_id for author in authors} == {"/authors/OL1A", "/authors/OL2A"}


def test_five_editions_and_multiple_isbns_do_not_merge(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    source[WORKS_URL] = source[WORKS_URL][:1]
    source[AUTHORS_URL] = source[AUTHORS_URL][:1]
    source[EDITIONS_URL] = [
        {"key": f"/books/OL{n}M", "works": [{"key": "/works/OL1W"}],
         "languages": [{"key": "/languages/eng" if n == 1 else "/languages/fre"}],
         "isbn_13": [ISBN, "9780306406157"] if n == 1 else [ISBN],
         "number_of_pages": 100 + n}
        for n in range(1, 8)
    ]
    fake_stream(monkeypatch, source)
    importer.run_import(config(target_books=1))
    with factory() as session:
        book = session.execute(select(models.Book)).scalar_one()
        editions = session.execute(select(models.Edition)).scalars().all()
        assert len(editions) == 5
        assert len({edition.source_id for edition in editions}) == 5
        assert book.preferred_edition_id is not None
        assert book.page_count == 101
        assert session.execute(select(func.count()).select_from(models.EditionISBN)).scalar_one() >= 6


def test_redirect_preserves_book_and_user_link(import_env, monkeypatch):
    models, factory, importer, config = import_env
    with factory.begin() as session:
        book = models.Book(title="Legacy Book", source_id="/works/OL99W")
        user = models.User(email="redirect@example.org", hashed_password="unused")
        session.add_all([book, user])
        session.flush()
        old_id = book.id
        session.add(models.UserBook(user_id=user.id, book_id=book.id,
                                    status=models.UserBookStatus.want))
    source = records()
    source[REDIRECTS_URL] = [
        {"key": "/works/OL99W", "location": "/works/OL98W"},
        {"key": "/works/OL98W", "location": "/works/OL1W"},
    ]
    fake_stream(monkeypatch, source)
    importer.run_import(config(target_books=3))
    with factory() as session:
        assert session.get(models.Book, old_id).source_id == "/works/OL1W"
        assert session.execute(select(models.UserBook.book_id)).scalar_one() == old_id
        assert session.execute(select(func.count()).select_from(models.Book)).scalar_one() == 2


def test_legacy_conflict_preserves_populated_values(import_env, monkeypatch):
    models, factory, importer, config = import_env
    with factory.begin() as session:
        session.add(models.Book(
            title="Legacy Book", description="My description", isbn13="9780306406157",
            cover_image_url="https://covers.openlibrary.org/b/id/111-L.jpg",
            authors=[models.Author(name="Same Author")],
        ))
    fake_stream(monkeypatch)
    importer.run_import(config())
    with factory() as session:
        book = session.execute(select(models.Book).where(
            models.Book.source_id == "/works/OL1W"
        )).scalar_one()
        assert book.description == "My description"
        assert book.isbn13 == "9780306406157"
        assert book.preferred_edition_id is None
        assert session.execute(select(func.count()).select_from(models.CatalogueImportIssue).where(
            models.CatalogueImportIssue.code == "legacy_field_conflict"
        )).scalar_one() >= 1


def test_source_managed_tag_links_reconcile_without_removing_legacy_links(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    fake_stream(monkeypatch, source)
    importer.run_import(config("first"))
    with factory.begin() as session:
        book = session.execute(select(models.Book).where(
            models.Book.source_id == "/works/OL1W"
        )).scalar_one()
        legacy_tag = models.Tag(name="legacy custom", type=models.TagType.theme)
        book.tags.append(legacy_tag)
    source[WORKS_URL][0]["subjects"] = ["Mystery"]
    importer.run_import(config("second"))
    with factory() as session:
        book = session.execute(select(models.Book).where(
            models.Book.source_id == "/works/OL1W"
        )).scalar_one()
        assert {tag.name for tag in book.tags} == {"mystery", "legacy custom"}


def test_new_classifications_hidden_from_existing_book_schema(import_env, monkeypatch):
    models, factory, importer, config = import_env
    from schemas import BookSchema
    source = records()
    source[WORKS_URL] = [source[WORKS_URL][0] | {
        "subjects": ["Fantasy", "Science", "Friendship -- Fiction"]
    }]
    source[EDITIONS_URL] = source[EDITIONS_URL][:1]
    fake_stream(monkeypatch, source)
    importer.run_import(config(target_books=1))
    with factory() as session:
        book = session.execute(select(models.Book)).scalar_one()
        assert {tag.name for tag in book.tags} == {"fantasy", "science", "Friendship"}
        assert {tag.name for tag in BookSchema.model_validate(book).tags} == {"fantasy"}


@pytest.mark.parametrize("reverse", [False, True])
def test_equal_quality_selection_uses_stable_work_id_not_dump_order(import_env, monkeypatch, reverse):
    models, factory, importer, config = import_env
    source = records()
    works = [
        {"key": f"/works/OL{n}W", "title": f"Title {n}", "subjects": ["Fantasy"],
         "authors": [{"author": {"key": "/authors/OL1A"}}]}
        for n in (1, 2, 3)
    ]
    source[WORKS_URL] = list(reversed(works)) if reverse else works
    source[AUTHORS_URL] = source[AUTHORS_URL][:1]
    source[EDITIONS_URL] = []
    fake_stream(monkeypatch, source)
    importer.run_import(config(target_books=1))
    expected = min((work["key"] for work in works),
                   key=lambda key: hashlib.sha256(key.encode()).hexdigest())
    with factory() as session:
        assert session.execute(select(models.Book.source_id)).scalar_one() == expected


def test_resume_uses_stored_snapshot_and_options_without_network(import_env, monkeypatch):
    models, factory, importer, config = import_env
    original = config(run_id="pinned")
    urls = {kind: getattr(original, f"{kind}_url") for kind in
            ("works", "authors", "editions", "redirects", "deletes")}
    manifest = {"identifier": "ol_dump_2026-09-01", "date": "2026-09-01",
                "files": {kind: {"url": url, "size": 100, "md5": "a" * 32}
                          for kind, url in urls.items()}}
    original = replace(original, snapshot_id=manifest["identifier"], source_manifest=manifest)
    from data.config import get_or_create_run
    with factory.begin() as session:
        run = get_or_create_run(session, original)
        assert run.source_manifest == manifest
        assert run.category_weights == original.category_weights
        assert run.max_database_mb == original.max_database_mb

    monkeypatch.setattr(importer, "resolve_snapshot", lambda *_args, **_kwargs:
                        pytest.fail("Resume must not query the archive"))
    args = Namespace(mode="test", run_id="pinned", snapshot="auto", target_books=None,
                     weights_json=None, max_database_mb=None, batch_size=2,
                     restart_paused=False, works_url=None, authors_url=None,
                     editions_url=None, redirects_url=None, deletes_url=None)
    resumed = importer._config_for_command(args, original.database_url, original.user_agent)
    assert resumed.source_manifest == manifest
    assert resumed.works_url == original.works_url
    resumed.validate()
    with pytest.raises(ValueError, match="cannot switch"):
        importer._config_for_command(Namespace(**{**vars(args), "snapshot": "2026-08-31"}),
                                     original.database_url, original.user_agent)


def test_bad_source_checksum_does_not_advance_phase_or_merge(import_env, monkeypatch):
    models, factory, importer, config = import_env
    original = config(run_id="bad_checksum", batch_size=2)
    kinds = ("works", "authors", "editions", "redirects", "deletes")
    manifest = {"identifier": "ol_dump_2026-09-01", "date": "2026-09-01",
                "files": {kind: {"url": getattr(original, f"{kind}_url"),
                                 "size": 100, "md5": "a" * 32} for kind in kinds}}
    original = replace(original, snapshot_id=manifest["identifier"], source_manifest=manifest)

    def corrupt_stream(url, **_kwargs):
        assert url == REDIRECTS_URL
        yield clean.DumpRow(1, {"key": "/works/OL1W", "location": "/works/OL2W"})
        yield clean.DumpRow(2, {"key": "/works/OL3W", "location": "/works/OL4W"})
        raise ValueError("Compressed dump checksum mismatch; phase remains incomplete")

    monkeypatch.setattr(clean, "stream_dump", corrupt_stream)
    with pytest.raises(ValueError, match="checksum mismatch"):
        importer.run_import(original)
    with factory() as session:
        run = session.get(models.CatalogueImportRun, "bad_checksum")
        assert run.phase == "redirects"
        assert run.checkpoint_line == 2
        assert session.scalar(select(func.count()).select_from(models.Book)) == 0
        assert session.scalar(select(func.count()).select_from(models.CatalogueImportIssue).where(
            models.CatalogueImportIssue.code == "source_integrity"
        )) == 1


def test_pre_pinning_run_can_resume_with_its_original_urls(import_env):
    models, factory, importer, config = import_env
    original = config(run_id="legacy_resume")
    from data.config import get_or_create_run
    with factory.begin() as session:
        run = get_or_create_run(session, original)
        run.category_weights = {}
        run.max_database_mb = None
    args = Namespace(mode="test", run_id=original.run_id, snapshot="auto",
                     target_books=None, weights_json=None, max_database_mb=None,
                     batch_size=2, restart_paused=False,
                     **{f"{kind}_url": getattr(original, f"{kind}_url") for kind in
                        ("works", "authors", "editions", "redirects", "deletes")})
    resumed = importer._config_for_command(args, original.database_url, original.user_agent)
    resumed.validate()
    with factory.begin() as session:
        assert get_or_create_run(session, resumed).id == original.run_id


def test_automatic_continuation_requires_committed_progress(import_env):
    models, factory, importer, config = import_env
    original = config(run_id="continue")
    from data.config import get_or_create_run
    with factory.begin() as session:
        get_or_create_run(session, original)
    marker = importer._progress_marker(factory, original.run_id)
    with pytest.raises(RuntimeError, match="No committed checkpoint progress"):
        importer._continuation_status(factory, original, marker)
    with factory.begin() as session:
        session.get(models.CatalogueImportRun, original.run_id).checkpoint_line = 500
    assert importer._continuation_status(factory, original, marker) == "needs_continuation"


def test_raw_download_disconnect_retries_saved_checkpoint(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    calls = []
    interrupted = False

    def stream(url, *, start_line=0, **_kwargs):
        nonlocal interrupted
        calls.append((url, start_line))
        for line, record in enumerate(source[url], start=1):
            if line <= start_line:
                continue
            yield clean.DumpRow(line, record)
            if url == WORKS_URL and line == 2 and not interrupted:
                interrupted = True
                raise ProtocolError("Connection broken: IncompleteRead")

    monkeypatch.setattr(clean, "stream_dump", stream)
    monkeypatch.setattr(importer.time, "sleep", lambda _delay: None)
    assert importer.run_import(config()) == "complete"
    assert (WORKS_URL, 2) in calls
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 2


def test_database_disconnect_rolls_back_batch_and_reacquires_lock(import_env, monkeypatch):
    models, factory, importer, config = import_env
    calls = fake_stream(monkeypatch)
    original = importer._write_works
    interrupted = False

    def drop_connection_after_write(session, run, rows):
        nonlocal interrupted
        original(session, run, rows)
        if not interrupted:
            interrupted = True
            raise OperationalError("batch write", None, Exception("server closed connection"),
                                   connection_invalidated=True)

    monkeypatch.setattr(importer, "_write_works", drop_connection_after_write)
    monkeypatch.setattr(importer.time, "sleep", lambda _delay: None)
    assert importer.run_import(config()) == "complete"
    assert calls.count((WORKS_URL, 0)) >= 3  # failed batch, retry, hydration
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 2
        assert session.get(models.CatalogueImportRun, "sample").phase == "complete"


def test_disconnected_lock_cleanup_preserves_original_error(import_env):
    _models, factory, importer, _config = import_env
    with pytest.raises(ProtocolError, match="original download failure"):
        with importer._import_lock(factory.kw["bind"]):
            with factory.begin() as session:
                session.execute(text("""
                    SELECT pg_terminate_backend(pid) FROM pg_locks
                    WHERE locktype = 'advisory' AND granted
                    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
                """))
            raise ProtocolError("original download failure")


def test_import_lock_has_no_idle_transaction_and_detects_disconnect(import_env):
    _models, factory, importer, _config = import_env
    with importer._import_lock(factory.kw["bind"]) as heartbeat:
        with factory.begin() as session:
            state = session.execute(text("""
                SELECT a.state FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid
                WHERE l.locktype = 'advisory' AND l.granted
                AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
            """)).scalar_one()
            assert state == "idle"
            session.execute(text("""
                SELECT pg_terminate_backend(pid) FROM pg_locks
                WHERE locktype = 'advisory' AND granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            """))
        with pytest.raises(importer.ImportLockLost):
            heartbeat(force=True)


def test_resume_only_rejects_unknown_run_without_snapshot_lookup(import_env, monkeypatch):
    _models, _factory, importer, config = import_env
    monkeypatch.setattr(importer, "resolve_snapshot", lambda *_args, **_kwargs:
                        pytest.fail("An unknown resume ID must not select a new snapshot"))
    args = Namespace(mode="test", run_id="missing", resume_only=True)
    with pytest.raises(ValueError, match="does not exist"):
        importer._config_for_command(args, config().database_url, config().user_agent)


def test_production_import_rejects_transaction_pooler(monkeypatch):
    from data.config import validate_database_target
    monkeypatch.setenv("CATALOGUE_IMPORT_PRODUCTION", "yes")
    with pytest.raises(ValueError, match="direct Neon"):
        validate_database_target("postgresql://user:unused@ep-example-pooler.us-east-2.aws.neon.tech/db",
                                 "production")
    validate_database_target("postgresql://user:unused@ep-example.us-east-2.aws.neon.tech/db", "production")


def test_database_retry_is_bounded_and_preserves_one_deadline(import_env, monkeypatch):
    _models, _factory, importer, config = import_env
    deadlines = []
    delays = []

    def disconnected(_config, *, one_phase, deadline, progress_state):
        deadlines.append(deadline)
        raise OperationalError("connection check", None, Exception("connection lost"),
                               connection_invalidated=True)

    monkeypatch.setattr(importer, "_run_import", disconnected)
    monkeypatch.setattr(importer.time, "sleep", delays.append)
    with pytest.raises(OperationalError):
        importer.run_import(config(), time_budget_seconds=60)
    assert len(deadlines) == 3
    assert len(set(deadlines)) == 1
    assert delays == [2, 4]


def test_permanent_database_error_is_not_retried(import_env, monkeypatch):
    _models, _factory, importer, config = import_env
    attempts = []

    def permanent(_config, **_kwargs):
        attempts.append(True)
        raise OperationalError("invalid SQL", None, Exception("permission denied"))

    monkeypatch.setattr(importer, "_run_import", permanent)
    with pytest.raises(OperationalError):
        importer.run_import(config())
    assert len(attempts) == 1


def test_time_budget_checkpoints_and_next_segment_completes(import_env, monkeypatch):
    models, factory, importer, config = import_env
    source = records()
    clock = [0.0]
    interrupted = False

    def stream(url, *, start_line=0, progress_callback=None, **_kwargs):
        nonlocal interrupted
        for line, record in enumerate(source[url], start=1):
            if line <= start_line:
                continue
            yield clean.DumpRow(line, record)
            if url == WORKS_URL and line == 2 and not interrupted:
                interrupted = True
                clock[0] = 61.0
                progress_callback()

    monkeypatch.setattr(clean, "stream_dump", stream)
    monkeypatch.setattr(importer.time, "monotonic", lambda: clock[0])
    assert importer.run_import(config(), time_budget_seconds=60) == "needs_continuation"
    with factory() as session:
        run = session.get(models.CatalogueImportRun, "sample")
        assert (run.phase, run.checkpoint_line) == ("works", 2)
        assert session.scalar(select(func.count()).select_from(models.Book)) == 0
    assert importer.run_import(config()) == "complete"
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 2
