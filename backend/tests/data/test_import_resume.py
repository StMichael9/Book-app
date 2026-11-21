"""T63: a continuation finds its run in the restored staging database, and a dump phase keeps the catalogue (Neon) off the
per-batch path. The "runner database" is a schema of the disposable test database, as in test_stage_split."""
from __future__ import annotations

import dataclasses
import importlib
from argparse import Namespace

import pytest
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine

from test_load import import_env  # noqa: F401
from test_popular_growth import dumps, edition, fake_stream, mod, popular, runner_state, work  # noqa: F401
from test_stage_split import stage_phase, stage_schemas, stage_url_for  # noqa: F401


def scenario(count=3):
    works = [work(n) for n in range(1, count + 1)]
    editions = [edition(n) for n in range(1, count + 1)]
    return dumps(works, editions, readers={n: count + 1 - n for n in range(1, count + 1)})


def resume_args(run_id="sample"):
    return Namespace(mode="test", run_id=run_id, snapshot="auto", target_books=None, weights_json=None, max_database_mb=None,
                     batch_size=2, restart_paused=False, resume_only=True, works_url=None, authors_url=None,
                     editions_url=None, redirects_url=None, deletes_url=None)


def run_until(importer, cfg, url, phase):
    for _ in range(40):
        if stage_phase(url) == phase:
            return
        importer.run_import(cfg, one_phase=True)
    raise AssertionError(f"never reached {phase}")


# --- fix 2: resume reads the run row from the staging database -----------------------------------------------------------

def test_a_continuation_resumes_from_a_restored_staging_database(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    first_url, second_url = stage_schemas("stage_t63_a"), stage_schemas("stage_t63_b")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=first_url)
    run_until(importer, cfg, first_url, "authors")                                 # segment 1 stops after the works phase

    stage_db = mod("stage_db")
    open_stage_engine_for, copy_stage_tables = stage_db.open_stage_engine_for, stage_db.copy_stage_tables
    second = open_stage_engine_for(second_url)                                    # segment 2: a fresh runner, empty staging
    assert copy_stage_tables(create_engine(first_url), second) > 0                # ... then the artifact is restored into it
    second.dispose()
    monkeypatch.setenv("CATALOGUE_STAGE_DATABASE_URL", second_url)
    resumed = importer._pinned_config_for_command(resume_args(), cfg.database_url, cfg.user_agent)
    assert resumed.run_id == "sample" and resumed.target_books == cfg.target_books
    resumed = dataclasses.replace(resumed, stage_database_url=second_url, ratings_url=cfg.ratings_url, reading_log_url=cfg.reading_log_url)
    importer.run_import(resumed)
    assert stage_phase(second_url) == "complete"
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(models.Book)) == 3


def test_without_the_staging_database_the_run_is_not_found_in_the_catalogue(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t63_c")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=url)
    run_until(importer, cfg, url, "works")
    monkeypatch.delenv("CATALOGUE_STAGE_DATABASE_URL", raising=False)
    with pytest.raises(ValueError, match="does not exist"):                       # what segment 2 of 14 Nov hit
        importer._pinned_config_for_command(resume_args(), cfg.database_url, cfg.user_agent)


def test_a_run_from_before_the_staging_layout_is_still_found_in_the_catalogue(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch, scenario())
    cfg = popular(config)                                                         # one database: the run row is in the catalogue
    importer.run_import(cfg, one_phase=True)
    monkeypatch.setenv("CATALOGUE_STAGE_DATABASE_URL", stage_schemas("stage_t63_d"))   # an empty staging database
    legacy = importer._pinned_config_for_command(resume_args(), cfg.database_url, cfg.user_agent)
    assert legacy.run_id == "sample" and legacy.target_books == cfg.target_books


# --- fix 3: no catalogue round trip per batch in a dump phase ------------------------------------------------------------

class Counter:
    """Counts the statements that reach the catalogue database (not the staging schema) while attached."""

    def __init__(self):
        self.catalogue = 0
        self.staging = 0

    def __call__(self, conn, cursor, statement, parameters, context, executemany):
        if "search_path" in str(conn.engine.url):
            self.staging += 1
        else:
            self.catalogue += 1


def works_phase_cost(importer, cfg, url, count):
    run_until(importer, cfg, url, "works")
    counter = Counter()
    event.listen(Engine, "before_cursor_execute", counter)
    try:
        importer.run_import(cfg, one_phase=True)                                  # the works phase
    finally:
        event.remove(Engine, "before_cursor_execute", counter)
    return counter


def test_the_works_phase_does_not_touch_the_catalogue_once_per_batch(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    costs = {}
    for count, name in ((4, "stage_t63_e"), (40, "stage_t63_f")):
        url = stage_schemas(name)
        fake_stream(monkeypatch, scenario(count))
        costs[count] = works_phase_cost(importer, popular(config, stage_database_url=url), url, count)
        monkeypatch.setattr(importer, "_DELETE_KEEP", {})
    small, large = costs[4], costs[40]
    assert large.staging > small.staging * 2                                      # ten times the batches reach the staging database
    assert large.catalogue == small.catalogue                                     # ... and cost the catalogue nothing more
    assert small.catalogue <= 20


def test_the_guard_reads_the_catalogue_size_on_a_timer_not_per_batch(import_env):
    models, factory, importer, config = import_env
    now = [0.0]
    guard = mod("reporting").StorageGuard(factory, interval=60, clock=lambda: now[0])
    for _ in range(50):
        guard.total_mb()
        now[0] += 1.0
    assert guard.readings == 1                                                    # fifty checks in fifty seconds, one reading
    now[0] += 60
    guard.total_mb()
    assert guard.readings == 2


def test_the_storage_guard_still_stops_a_dump_phase_when_the_catalogue_is_too_big(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t63_g")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=url)
    monkeypatch.setattr(mod("reporting").StorageGuard, "total_mb", lambda self: float(cfg.max_database_mb) + 1)   # the catalogue is full
    with pytest.raises(mod("reporting").CapacityPause):
        for _ in range(10):
            importer.run_import(cfg, one_phase=True)
    assert stage_phase(url) == "paused_capacity"


# --- T65: `selected=0` in the dump phases is normal; say what was staged, and stop a run that staged nothing ------------------

def test_the_works_phase_reports_what_it_staged_while_selected_stays_zero(import_env, stage_schemas, monkeypatch, caplog):
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t65_a")
    fake_stream(monkeypatch, scenario())
    cfg = popular(config, stage_database_url=url)
    with caplog.at_level("INFO", logger="bookvane.catalogue"):
        run_until(importer, cfg, url, "authors")
    text_ = "\n".join(r.getMessage() for r in caplog.records)
    assert "works finished: 3 works staged" in text_
    assert "works line=" in text_ and "selected=0" in text_                         # the progress lines still read selected=0


def test_a_popular_run_whose_works_phase_staged_nothing_stops_with_a_clear_error(import_env, stage_schemas, monkeypatch):
    models, factory, importer, config = import_env
    url = stage_schemas("stage_t65_b")
    source = dumps([work(n) for n in (1, 2, 3)], [edition(n) for n in (1, 2, 3)], readers={900: 5, 901: 4})   # popularity for other works
    fake_stream(monkeypatch, source)
    cfg = popular(config, stage_database_url=url)
    with pytest.raises(RuntimeError, match="staged no works"):
        run_until(importer, cfg, url, "authors")


def test_a_capacity_pause_ends_the_job_with_a_warning_and_its_own_status(monkeypatch, tmp_path, capsys):
    import sys
    from types import SimpleNamespace
    load = mod("load")
    config = SimpleNamespace(run_id="nightly", snapshot_id="s", validate=lambda: None, popular=False)
    monkeypatch.setenv("CATALOGUE_DATABASE_URL", "postgresql://u:p@localhost/x")
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "out"))
    monkeypatch.delenv("CATALOGUE_STAGE_DATABASE_URL", raising=False)
    monkeypatch.setattr(load, "_config_for_command", lambda args, url, agent: config)

    def pause(*args, **kwargs):
        raise mod("reporting").CapacityPause("Database reached the 750 MB guard")

    monkeypatch.setattr(load, "run_import", pause)
    monkeypatch.setattr(sys, "argv", ["load", "--mode", "production", "--add-books", "5000"])
    load.main()                                                     # no traceback, exit code 0
    assert "status=paused_capacity" in (tmp_path / "out").read_text()
    assert "::warning::Import nightly paused at the storage guard" in capsys.readouterr().out
