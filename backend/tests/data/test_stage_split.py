"""T48: the importer's scratch tables live in a separate (runner-local) database; Neon receives only the merged books.

The "runner database" is a second schema of the disposable test database, reached through its own engine whose search_path
puts that schema first, so the same models and raw SQL run unchanged, exactly as against a Postgres service container.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url

from test_load import import_env  # noqa: F401
from test_popular_growth import dumps, edition, fake_stream, popular, runner_state, work  # noqa: F401

STAGE_TABLE_NAMES = ("catalogue_stage_works", "catalogue_stage_work_authors", "catalogue_stage_authors",
                     "catalogue_stage_editions", "catalogue_stage_candidates", "catalogue_stage_popularity",
                     "catalogue_import_runs")


def stage_url_for(test_database_url, schema):
    return make_url(test_database_url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)


@pytest.fixture()
def stage_schemas(import_env, test_database_url):
    created = []

    def make(name):
        engine = create_engine(test_database_url)
        with engine.begin() as connection:
            connection.execute(text(f"DROP SCHEMA IF EXISTS {name} CASCADE"))
            connection.execute(text(f"CREATE SCHEMA {name}"))
        engine.dispose()
        created.append(name)
        return stage_url_for(test_database_url, name)

    yield make
    engine = create_engine(test_database_url)
    with engine.begin() as connection:
        for name in created:
            connection.execute(text(f"DROP SCHEMA IF EXISTS {name} CASCADE"))
    engine.dispose()


def catalogue_counts(factory, models):
    with factory() as session:
        return {name: session.scalar(text(f"SELECT count(*) FROM public.{name}")) for name in STAGE_TABLE_NAMES}


def stage_phase(url, run_id="sample"):
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return connection.execute(text("SELECT phase FROM catalogue_import_runs WHERE id = :i"), {"i": run_id}).scalar()
    finally:
        engine.dispose()


def scenario():
    works = [work(1), work(2), work(3)]
    editions = [edition(1), edition(2), edition(3)]
    return dumps(works, editions, readers={1: 5, 2: 3, 3: 1})


def test_nothing_is_staged_in_the_catalogue_database_and_books_arrive_at_merge(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t48_a")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=url)
    with factory() as session:
        books_before = session.scalar(select(func.count()).select_from(models.Book))
    seen_stage_rows = 0
    for _ in range(40):
        phase = stage_phase(url)
        if phase == "merge":
            break
        importer.run_import(cfg, one_phase=True)
        # after every phase before merge the catalogue database holds no run, no staged rows and no new books
        assert all(count == 0 for count in catalogue_counts(factory, models).values())
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(models.Book)) == books_before
        engine = create_engine(url)
        with engine.connect() as connection:
            seen_stage_rows += connection.execute(text("SELECT count(*) FROM catalogue_stage_works")).scalar()
        engine.dispose()
    assert stage_phase(url) == "merge" and seen_stage_rows > 0
    importer.run_import(cfg)                                                           # merge, cleanup
    assert stage_phase(url) == "complete"
    with factory() as session:
        assert set(session.scalars(select(models.Book.source_id))) == {"/works/OL1W", "/works/OL2W", "/works/OL3W"}
        assert session.scalar(text("SELECT count(*) FROM public.catalogue_import_runs")) == 0
        assert session.scalar(text("SELECT count(*) FROM public.catalogue_stage_works")) == 0


def test_the_split_run_produces_the_same_books_as_a_single_database_run(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch, scenario())
    importer.run_import(popular(config))
    with factory() as session:
        single = sorted((b.source_id, b.title, b.page_count, b.published_year, round(b.popularity or 0, 6))
                        for b in session.scalars(select(models.Book)))
    import_env[0]  # noqa: B018
    with factory.begin() as session:                                                    # start again from an empty catalogue
        for table in ("catalogue_stage_popularity", "catalogue_stage_author_counts", "catalogue_stage_candidates",
                      "catalogue_stage_work_authors", "catalogue_stage_editions", "catalogue_stage_authors", "catalogue_stage_works",
                      "catalogue_import_issues", "catalogue_import_runs", "catalogue_source_aliases"):
            session.execute(text(f"DELETE FROM {table}"))
        session.execute(text("DELETE FROM book_authors"))
        session.execute(text("DELETE FROM book_tags"))
        session.execute(text("DELETE FROM edition_isbns"))
        session.execute(text("UPDATE books SET preferred_edition_id = NULL"))
        session.execute(text("DELETE FROM editions"))
        session.execute(text("DELETE FROM book_title_aliases"))
        session.execute(text("DELETE FROM books"))
    from data import popularity
    popularity._ACTIVE.clear()
    fake_stream(monkeypatch, scenario())
    importer.run_import(popular(config, stage_database_url=stage_schemas("stage_t48_b")))
    with factory() as session:
        split = sorted((b.source_id, b.title, b.page_count, b.published_year, round(b.popularity or 0, 6))
                       for b in session.scalars(select(models.Book)))
    assert split == single and len(split) == 3


def test_a_segment_restored_from_a_copy_resumes_at_the_same_checkpoint(import_env, stage_schemas, test_database_url, monkeypatch):
    from data.stage_db import copy_stage_tables, open_stage_engine
    models, factory, importer, config = import_env
    first, second = stage_schemas("stage_t48_c"), stage_schemas("stage_t48_d")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=first)
    for _ in range(4):
        importer.run_import(cfg, one_phase=True)
    source = create_engine(first)
    with source.connect() as connection:
        checkpoint = tuple(connection.execute(text(
            "SELECT phase, checkpoint_line, merge_cursor, selected_count FROM catalogue_import_runs")).one())
    target = open_stage_engine(popular(config, stage_database_url=second))                  # a fresh runner: empty tables
    assert copy_stage_tables(source, target) > 0
    with target.connect() as connection:
        assert tuple(connection.execute(text(
            "SELECT phase, checkpoint_line, merge_cursor, selected_count FROM catalogue_import_runs")).one()) == checkpoint
    source.dispose(), target.dispose()
    importer.run_import(popular(config, stage_database_url=second))                          # resumes, does not restart
    with factory() as session:
        assert set(session.scalars(select(models.Book.source_id))) == {"/works/OL1W", "/works/OL2W", "/works/OL3W"}
    assert stage_phase(second) == "complete"


def test_the_stage_database_may_hold_open_library_data_only(import_env, stage_schemas, test_database_url):
    from data.stage_db import STAGE_TABLES, open_stage_engine
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t48_e")
    engine = open_stage_engine(popular(config, stage_database_url=url))
    assert set(__import__("sqlalchemy").inspect(engine).get_table_names()) == set(STAGE_TABLES)
    assert not {"users", "user_books", "reading_attempts", "books"} & set(STAGE_TABLES)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE user_books (id int)"))
    engine.dispose()
    with pytest.raises(RuntimeError, match="outside the Open Library staging set"):
        open_stage_engine(popular(config, stage_database_url=url))


def test_the_split_alias_lookup_equals_the_joined_one(import_env, stage_schemas, test_database_url):
    from data.staging import _existing_book_aliases
    from data.stage_db import open_stage_engine
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t48_f")
    stage_engine = open_stage_engine(popular(config, stage_database_url=url))
    with factory.begin() as session:
        session.add(models.Book(title="Old", source_id="/works/OL10W", authors=[models.Author(name="A")]))
        session.add_all([models.CatalogueSourceAlias(old_source_id="/works/OL10W", canonical_source_id="/works/OL11W", source_type="redirect"),
                         models.CatalogueSourceAlias(old_source_id="/works/OL12W", canonical_source_id="/works/OL10W", source_type="redirect"),
                         models.CatalogueSourceAlias(old_source_id="/works/OL13W", canonical_source_id="/works/OL11W", source_type="redirect")])
    from sqlalchemy.orm import Session
    with factory() as joined:
        expected = _existing_book_aliases(joined, {"/works/OL11W"})
    with Session(stage_engine) as stage, factory() as neon:
        stage.add_all([models.CatalogueSourceAlias(old_source_id="/works/OL10W", canonical_source_id="/works/OL11W", source_type="redirect"),
                       models.CatalogueSourceAlias(old_source_id="/works/OL12W", canonical_source_id="/works/OL10W", source_type="redirect"),
                       models.CatalogueSourceAlias(old_source_id="/works/OL13W", canonical_source_id="/works/OL11W", source_type="redirect")])
        stage.flush()
        split = _existing_book_aliases(stage, {"/works/OL11W"}, neon)
    stage_engine.dispose()
    assert expected == split == {"/works/OL10W": "/works/OL11W"}


def test_the_nightly_workflow_runs_a_postgres_service_and_hands_the_stage_tables_over_as_an_artifact():
    from pathlib import Path
    text_ = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "catalogue-import.yml").read_text(encoding="utf-8")
    assert "services:" in text_ and "postgres:16" in text_ and "CATALOGUE_STAGE_DATABASE_URL" in text_
    assert "pg_dump -Fc" in text_ and "pg_restore" in text_ and "retention-days: 3" in text_
    assert "cron:" in text_ and "add_books" in text_ and "stage_dump_mb" in text_
