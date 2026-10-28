"""T10 "Operation Full Shelf": popularity allowlist, complete-only selection, fill-only merge, capacity and workflow."""
from __future__ import annotations

import gzip
import io
import math
import re
from argparse import Namespace
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from data import clean, sources
from test_load import (
    AUTHORS_URL, DELETES_URL, EDITIONS_URL, REDIRECTS_URL, WORKS_URL, import_env,  # noqa: F401
)

RATINGS_URL = "https://openlibrary.org/data/ol_dump_ratings_2026-09-01.txt.gz"
READING_URL = "https://openlibrary.org/data/ol_dump_reading-log_2026-09-01.txt.gz"
ROOT = Path(__file__).resolve().parents[3]


def isbn13(n: int) -> str:
    body = f"978{n:09d}"
    check = (10 - sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(body)) % 10) % 10
    return body + str(check)


def work(n, subjects=("Fantasy",), **over):
    record = {"key": f"/works/OL{n}W", "title": f"Popular Book {n}", "subjects": list(subjects),
              "authors": [{"author": {"key": f"/authors/OL{n}A"}}], "description": f"Description {n}",
              "first_publish_year": 1990 + n % 20, "covers": [1000 + n]}
    record.update(over)
    return record


def edition(n, pages=200, lang="eng", title=None, m=None):
    record = {"key": f"/books/OL{m or n}M", "works": [{"key": f"/works/OL{n}W"}],
              "languages": [{"key": f"/languages/{lang}"}], "number_of_pages": pages,
              "isbn_13": [isbn13(m or n)]}
    if title:
        record["title"] = title
    return record


def dumps(works, editions, readers=None, ratings=None, extra_reading=(), extra_ratings=()):
    """Synthetic source: popularity maps work number -> number of reading-log / rating rows."""
    readers, ratings = readers or {}, ratings or {}
    shelves = ("Want to Read", "Currently Reading", "Already Read")
    reading = [{"work": f"/works/OL{n}W", "edition": None, "value": shelves[i % 3]}
               for n, count in readers.items() for i in range(count)]
    rated = [{"work": f"/works/OL{n}W", "edition": None, "value": "4"}
             for n, count in ratings.items() for _ in range(count)]
    numbers = sorted({int(re.search(r"OL(\d+)W", w["key"]).group(1)) for w in works})
    return {
        REDIRECTS_URL: [], DELETES_URL: [], WORKS_URL: list(works), EDITIONS_URL: list(editions),
        AUTHORS_URL: [{"key": f"/authors/OL{n}A", "name": f"Author {n}"} for n in numbers],
        READING_URL: reading + list(extra_reading), RATINGS_URL: rated + list(extra_ratings),
    }


def fake_stream(monkeypatch, source):
    calls = []

    def stream(url, *, start_line=0, user_agent=None, progress_callback=None, **_options):
        calls.append(url)
        for line, record in enumerate(source.get(url, []), start=1):
            if line <= start_line:
                continue
            if isinstance(record, str):
                yield clean.DumpRow(line, None, record)
            else:
                yield clean.DumpRow(line, record)

    monkeypatch.setattr(clean, "stream_dump", stream)
    return calls


def popular(config, **changes):
    return replace(config(**changes.pop("args", {})), ratings_url=RATINGS_URL, reading_log_url=READING_URL, **changes)


def run_phases(importer, cfg, count):
    for _ in range(count):
        importer.run_import(cfg, one_phase=True)


def sources_in_books(session, models):
    return set(session.execute(select(models.Book.source_id)).scalars())


def test_popularity_scores_order_top_cut_and_malformed_lines(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(n) for n in range(1, 6)]
    source = dumps(works, [], readers={1: 8, 2: 3, 3: 1, 4: 20, 5: 0}, ratings={1: 2, 2: 6, 3: 6},
                   extra_reading=["not tab separated", {"work": "garbage", "edition": None, "value": "Want to Read"},
                                  {"work": "/works/OL3W", "edition": None, "value": "Not A Shelf"}],
                   extra_ratings=["broken row", {"work": "/works/OL4W", "edition": None, "value": "zero"}])
    fake_stream(monkeypatch, source)
    cfg = popular(config, popularity_top=3)
    run_phases(importer, cfg, 1)
    expected = {1: math.log1p(8) + 0.5 * math.log1p(2), 2: math.log1p(3) + 0.5 * math.log1p(6),
                3: math.log1p(1) + 0.5 * math.log1p(6), 4: math.log1p(20)}
    top = sorted(expected, key=lambda n: -expected[n])[:3]
    assert top == [4, 1, 2]
    with factory() as session:
        rows = dict(session.execute(select(models.CatalogueStagePopularity.source_id,
                                           models.CatalogueStagePopularity.score)).all())
        assert set(rows) == {f"/works/OL{n}W" for n in top}
        for n in top:
            assert rows[f"/works/OL{n}W"] == pytest.approx(expected[n])
        run = session.get(models.CatalogueImportRun, cfg.run_id)
        assert run.phase == "redirects"
        assert run.error_count == 2  # the two unparsable lines; wrong shelves and ratings are only ignored


def test_only_allowlisted_and_existing_works_are_staged(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(n) for n in range(1, 5)]
    source = dumps(works, [edition(n) for n in range(1, 5)], readers={2: 9, 3: 5, 4: 1})
    with factory.begin() as session:
        session.add(models.Book(title="Known", source_id="/works/OL1W", authors=[models.Author(name="Author 1")]))
    fake_stream(monkeypatch, source)
    cfg = popular(config, popularity_top=2)
    run_phases(importer, cfg, 4)
    with factory() as session:
        assert session.get(models.CatalogueImportRun, cfg.run_id).phase == "authors"
        staged = set(session.execute(select(models.CatalogueStageWork.source_id)).scalars())
        assert staged == {"/works/OL1W", "/works/OL2W", "/works/OL3W"}  # top two plus the existing book


def test_incomplete_works_are_never_selected(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1), work(2, description=None), work(3, covers=[]), work(4, first_publish_year=None),
             work(5), work(6)]
    editions = [edition(1), edition(2), edition(3), edition(4), edition(5, pages=None), edition(6, pages=0)]
    source = dumps(works, editions, readers={n: 5 for n in range(1, 7)})
    fake_stream(monkeypatch, source)
    assert importer.run_import(popular(config)) == "complete"
    with factory() as session:
        assert sources_in_books(session, models) == {"/works/OL1W"}
        book = session.execute(select(models.Book)).scalar_one()
        assert book.is_complete and book.page_count == 200


def test_derivative_titles_and_subjects_are_excluded(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1), work(2, title="The Hobbit Box Set"), work(3, title="Great OMNIBUS Edition"),
             work(4, subjects=("Fantasy", "SparkNotes")), work(5, title="Summary of Dune"),
             work(6, title="Complete Works of Someone"), work(7, title="Grammar Workbook for Beginners"),
             work(8, title="Fantasy Study Guide"), work(9, title="Stories Collection"),
             work(10, title="CliffsNotes on Emma"), work(11, title="Boxed Set Volume One")]
    source = dumps(works, [edition(n) for n in range(1, 12)], readers={n: 3 for n in range(1, 12)})
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config))
    with factory() as session:
        assert sources_in_books(session, models) == {"/works/OL1W"}


def test_selection_prefers_popular_works_within_a_quota(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(n) for n in (1, 2, 3, 4)]
    source = dumps(works, [edition(n) for n in (1, 2, 3, 4)], readers={1: 2, 2: 40, 3: 9, 4: 1})
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config, args={"target_books": 2}))
    with factory() as session:
        assert sources_in_books(session, models) == {"/works/OL2W", "/works/OL3W"}


def test_no_author_cap_for_popular_works(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(n, authors=[{"author": {"key": "/authors/OL1A"}}]) for n in (1, 2, 3)]
    source = dumps(works, [edition(n) for n in (1, 2, 3)], readers={1: 9, 2: 8, 3: 7})
    source[AUTHORS_URL] = [{"key": "/authors/OL1A", "name": "One Author"}]
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config, args={"target_books": 3}))
    with factory() as session:
        assert sources_in_books(session, models) == {f"/works/OL{n}W" for n in (1, 2, 3)}


def test_page_count_is_the_median_with_english_editions_first(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1), work(2), work(3)]
    editions = [edition(1, pages=300, m=11), edition(1, pages=100, m=12), edition(1, pages=200, m=13),
                edition(1, pages=1000, lang="fre", m=14),
                edition(2, pages=100, m=21), edition(2, pages=201, m=22),
                edition(3, pages=10, lang="fre", m=31), edition(3, pages=30, lang="fre", m=32)]
    source = dumps(works, editions, readers={1: 3, 2: 3, 3: 3})
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config))
    with factory() as session:
        pages = dict(session.execute(select(models.Book.source_id, models.Book.page_count)).all())
        assert pages == {"/works/OL1W": 200, "/works/OL2W": 151, "/works/OL3W": 20}
        assert session.scalar(select(func.count()).select_from(models.Book).where(models.Book.is_complete)) == 3


def test_existing_books_are_filled_but_never_overwritten(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1, description="Open Library text", first_publish_year=1999), work(2), work(3)]
    editions = [edition(1, pages=250), edition(2), edition(3)]
    source = dumps(works, editions, readers={2: 4, 3: 2})  # work 1 is existing and not popular
    with factory.begin() as session:
        session.add_all([
            models.Book(title="Mine One", source_id="/works/OL1W", description="Kept description",
                        cover_image_url="   ", published_year=None, page_count=None,
                        authors=[models.Author(name="Author 1")]),
            models.Book(title="Mine Three", source_id="/works/OL3W", description="Kept three",
                        cover_image_url="https://example.org/mine.jpg", published_year=1888, page_count=77,
                        authors=[models.Author(name="Author 3")]),
        ])
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config))
    with factory() as session:
        one = session.execute(select(models.Book).where(models.Book.source_id == "/works/OL1W")).scalar_one()
        assert one.description == "Kept description"
        assert one.cover_image_url.endswith("1001-L.jpg")
        assert (one.published_year, one.page_count) == (1999, 250)
        assert one.is_complete
        three = session.execute(select(models.Book).where(models.Book.source_id == "/works/OL3W")).scalar_one()
        assert (three.description, three.cover_image_url, three.published_year, three.page_count) == (
            "Kept three", "https://example.org/mine.jpg", 1888, 77)


def test_english_title_aliases_load_for_new_and_existing_books(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1, title="Original One"), work(2, title="Original Two")]
    editions = [edition(1, title="Alias For One", m=11), edition(1, title="Alias For One", m=12),
                edition(1, title="original one", m=13), edition(1, title="Titre Francais", lang="fre", m=14),
                edition(2, title="Alias For Two", m=21)]
    source = dumps(works, editions, readers={1: 5, 2: 5})
    with factory.begin() as session:
        session.add(models.Book(title="Original One", source_id="/works/OL1W",
                                authors=[models.Author(name="Author 1")]))
    fake_stream(monkeypatch, source)
    importer.run_import(popular(config))
    with factory() as session:
        aliases = set(session.execute(select(models.Book.source_id, models.BookTitleAlias.title).join(
            models.BookTitleAlias, models.BookTitleAlias.book_id == models.Book.id)).all())
        assert aliases == {("/works/OL1W", "Alias For One"), ("/works/OL2W", "Alias For Two")}


def test_dry_run_predicts_recovered_books_and_writes_nothing(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(1, first_publish_year=1999), work(2), work(3)]
    source = dumps(works, [edition(1), edition(2), edition(3)], readers={2: 4, 3: 2})
    with factory.begin() as session:
        session.add(models.Book(title="Almost", source_id="/works/OL1W", description="Has text",
                                authors=[models.Author(name="Author 1")]))
    fake_stream(monkeypatch, source)
    cfg = popular(config, dry_run=True)
    assert importer.run_import(cfg) == "dry_run"
    with factory() as session:
        run = session.get(models.CatalogueImportRun, cfg.run_id)
        report = run.report["dry_run"]
        assert (report["new_books"], report["existing_newly_complete"]) == (2, 1)
        assert report["existing_filled"]["cover_image_url"] == 1
        assert session.scalar(select(func.count()).select_from(models.Book)) == 1
        assert session.scalar(select(func.count()).select_from(models.Book).where(models.Book.is_complete)) == 0
    assert importer.run_import(replace(cfg, dry_run=False)) == "complete"
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 3
        assert session.scalar(select(func.count()).select_from(models.Book).where(models.Book.is_complete)) == 0 + 2 + 1


def test_pause_keeps_the_allowlist_and_replay_skips_popularity(import_env, monkeypatch):
    models, factory, importer, config = import_env
    works = [work(n) for n in (1, 2, 3)]
    source = dumps(works, [edition(n) for n in (1, 2, 3)], readers={1: 5, 2: 4, 3: 3})
    calls = fake_stream(monkeypatch, source)
    cfg = popular(config)
    real_check = importer._check_storage
    paused = {"on": True}

    def check(session, run, cfg_):
        if paused["on"] and run.phase == "works":
            raise importer.CapacityPause("Database reached the guard")
        return real_check(session, run, cfg_)

    monkeypatch.setattr(importer, "_check_storage", check)
    with pytest.raises(importer.CapacityPause):
        importer.run_import(cfg)
    with factory() as session:
        assert session.get(models.CatalogueImportRun, cfg.run_id).phase == "paused_capacity"
        assert session.scalar(select(func.count()).select_from(models.CatalogueStagePopularity)) == 3
        assert session.scalar(select(func.count()).select_from(models.CatalogueStageWork)) == 0
    paused["on"] = False
    calls.clear()
    assert importer.run_import(replace(cfg, restart_paused=True)) == "complete"
    assert RATINGS_URL not in calls and READING_URL not in calls
    with factory() as session:
        assert sources_in_books(session, models) == {f"/works/OL{n}W" for n in (1, 2, 3)}
        assert session.scalar(select(func.count()).select_from(models.CatalogueStagePopularity)) == 0  # cleanup drops it


def test_storage_guard_pauses_at_the_limit_and_defaults_to_700(import_env):
    _, _, importer, config = import_env
    assert importer.ImportConfig.__dataclass_fields__["max_database_mb"].default == 700

    class Result:
        def __init__(self, value):
            self.value = value

        def scalar_one(self):
            return self.value

        def scalars(self):
            return SimpleNamespace(all=lambda: [1048576] * 8)

    def session_at(size):
        return SimpleNamespace(execute=lambda statement, *_a, **_k: Result(size) if "pg_database_size" in str(
            statement) else Result(0))

    run = SimpleNamespace(peak_database_mb=0, peak_staging_mb=0)
    cfg = replace(config(), max_database_mb=700)
    importer._check_storage(session_at(699.9), run, cfg)
    with pytest.raises(importer.CapacityPause):
        importer._check_storage(session_at(700.0), run, cfg)
    args = Namespace(run_id=None, resume_only=False, snapshot="auto", target_books=None, weights_json=None,
                     batch_size=500, max_database_mb=None, restart_paused=False, mode="test",
                     works_url=WORKS_URL, authors_url=AUTHORS_URL, editions_url=EDITIONS_URL,
                     redirects_url=REDIRECTS_URL, deletes_url=DELETES_URL,
                     ratings_url=RATINGS_URL, reading_log_url=READING_URL, popularity_top=400_000, dry_run=False)
    built = importer._config_for_command(args, cfg.database_url, "Bookvane (test@example.org)")
    assert built.max_database_mb == 700 and built.ratings_url == RATINGS_URL


def test_tabular_dump_lines_parse_and_short_lines_are_errors(monkeypatch):
    body = "/works/OL1W\t/books/OL1M\tWant to Read\t2020-01-01\nshort\t\n/works/OL2W\t\t4\t2021-02-02\n"
    compressed = gzip.compress(body.encode())

    class Response:
        def __init__(self):
            self.raw = io.BytesIO(compressed)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def raise_for_status(self):
            pass

    monkeypatch.setattr(clean.requests, "get", lambda *_a, **_k: Response())
    rows = list(clean.stream_dump(READING_URL, user_agent="test@example.org", tabular=True))
    assert [row.record for row in rows][0] == {"work": "/works/OL1W", "edition": "/books/OL1M", "value": "Want to Read"}
    assert rows[1].record is None and rows[1].error
    assert rows[2].record == {"work": "/works/OL2W", "edition": "", "value": "4"}


def test_snapshot_pins_ratings_and_reading_log():
    assert {"ratings", "reading-log"} <= set(sources.KINDS)
    assert set(sources.MIN_COMPRESSED_BYTES) == set(sources.KINDS)


def test_migration_adds_stage_tables_after_the_current_head():
    from alembic.script import ScriptDirectory

    scripts = ScriptDirectory(str(ROOT / "backend" / "alembic"))
    heads = scripts.get_heads()
    assert len(heads) == 1
    head = scripts.get_revision(heads[0])
    assert head.down_revision == "c8a14d7f2b36"
    source = Path(head.path).read_text(encoding="utf-8")
    assert "catalogue_stage_popularity" in source and "title_aliases" in source and "drop_table" in source


def test_workflow_selects_environment_and_carries_it_through_continuations():
    text = (ROOT / ".github" / "workflows" / "catalogue-import.yml").read_text(encoding="utf-8")
    block = text.split("target_env:", 1)[1].split("target_books:", 1)[0]
    assert "type: choice" in block and "default: catalogue-rehearsal" in block
    assert "- catalogue-rehearsal" in text and "- catalogue-production" in text
    assert re.search(r"environment: \$\{\{[^}]*target_env[^}]*\}\}", text)
    assert 'default: "150000"' in text
    assert "--max-database-mb 700" in text
    assert re.search(r"client_payload:\{[^}]*target_env:\$target_env", text)
    assert "environment: catalogue-production" not in text


def test_workflow_dry_run_input_flag_artifact_and_continuation():
    text = (ROOT / ".github" / "workflows" / "catalogue-import.yml").read_text(encoding="utf-8")
    block = text.split("dry_run:", 1)[1].split("repository_dispatch:", 1)[0]
    assert "type: boolean" in block and "default: false" in block
    assert re.search(r'INPUT_DRY_RUN" == "true" \]\];? then\s+args\+=\(--dry-run --dry-run-report', text)
    assert "actions/upload-artifact@" in text and "dry-run-report.json" in text
    assert re.search(r"client_payload:\{[^}]*dry_run:\$dry_run", text)
    assert "DRY_RUN: ${{ inputs.dry_run || github.event.client_payload.dry_run }}" in text


def test_dry_run_command_writes_the_report_file(import_env, monkeypatch, tmp_path):
    models, factory, importer, config = import_env
    source = dumps([work(1), work(2)], [edition(1), edition(2)], readers={1: 3, 2: 2})
    fake_stream(monkeypatch, source)
    cfg = popular(config)
    out = tmp_path / "report.json"
    monkeypatch.setenv("CATALOGUE_DATABASE_URL", cfg.database_url)
    monkeypatch.setenv("CATALOGUE_USER_AGENT", cfg.user_agent)
    monkeypatch.setattr("sys.argv", [
        "load", "--mode", "test", "--run-id", "cli-dry", "--dry-run", "--dry-run-report", str(out),
        "--works-url", WORKS_URL, "--authors-url", AUTHORS_URL, "--editions-url", EDITIONS_URL,
        "--redirects-url", REDIRECTS_URL, "--deletes-url", DELETES_URL,
        "--ratings-url", RATINGS_URL, "--reading-log-url", READING_URL])
    importer.main()
    import json
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["run_id"] == "cli-dry" and data["dry_run"]["new_books"] == 2
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 0
