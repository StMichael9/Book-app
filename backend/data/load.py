"""Bounded, resumable Open Library catalogue import. No import runs on module load."""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
import uuid
from contextlib import contextmanager

import requests
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from urllib3.exceptions import HTTPError as Urllib3HTTPError

from data import clean
from data.config import (
    ImportConfig, equal_percentage_weights, get_or_create_run as _get_run,
    percentage_quotas, validate_database_target,
)
from data.merge import _merge_batch
from data.reporting import (
    CapacityPause, _build_report, _check_storage, _count_skipped, _issue,
    _release_staging, _stage_mb,
)
from data.selection import _backfill_authors, _select_works
from data.sources import resolve_snapshot
from data.staging import (
    _prune_candidates, _write_aliases, _write_authors, _write_editions,
    _write_hydrate, _write_works, select_useful_editions,
)
from models import CatalogueImportRun

log = logging.getLogger("bookvane.catalogue")
TRANSIENT_ERRORS = (requests.RequestException, Urllib3HTTPError, EOFError, OSError)


class ImportLockLost(RuntimeError):
    """Stop writing until a fresh connection acquires the exclusive import lock."""


class StreamTimeBudgetReached(RuntimeError):
    pass


@contextmanager
def _import_lock(engine):
    # A session lock needs a direct connection, without an idle transaction.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        if not connection.execute(text(
            "SELECT pg_try_advisory_lock(hashtext('bookvane_catalogue_import'))"
        )).scalar_one():
            raise RuntimeError("Another catalogue import is already running")
        last_check = time.monotonic()

        def heartbeat(force=False):
            nonlocal last_check
            if force or time.monotonic() - last_check >= 30:
                try:
                    connection.execute(text("SELECT 1"))
                except DBAPIError as exc:
                    raise ImportLockLost("Import lock connection lost; reacquire before resuming") from exc
                last_check = time.monotonic()

        try:
            yield heartbeat
        finally:
            try:
                if not connection.invalidated:
                    connection.execute(text(
                        "SELECT pg_advisory_unlock(hashtext('bookvane_catalogue_import'))"
                    ))
                else:
                    log.warning("Import lock session disconnected; session lock released by PostgreSQL")
            except SQLAlchemyError:
                # A disconnected PostgreSQL session releases its session locks.
                # Do not replace the original download/database error with cleanup.
                connection.invalidate()
                log.warning("Import lock connection closed; explicit unlock unavailable")


def _write_dump_batch(session: Session, config: ImportConfig, phase: str, batch: list[clean.DumpRow]) -> None:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    if run.phase != phase:
        raise RuntimeError("Import phase changed while processing")
    _check_storage(session, run, config)
    records = [row.record for row in batch if row.record is not None]
    malformed = [row for row in batch if row.error]
    if phase != "hydrate":
        run.error_count += len(malformed)
    if malformed and phase != "hydrate":
        run.last_error = f"{phase} line {malformed[-1].line_number}: {malformed[-1].error}"
        _issue(session, run.id, "malformed_dump", str(malformed[-1].line_number), run.last_error)
    if phase in ("redirects", "deletes"):
        _write_aliases(session, run, records, phase)
    elif phase == "works":
        _write_works(session, run, records)
        boundary = config.batch_size * 100
        if batch[0].line_number // boundary != batch[-1].line_number // boundary:
            _prune_candidates(session, run, config)
    elif phase == "authors":
        _write_authors(session, run, records)
    elif phase == "editions":
        _write_editions(session, run, records)
    elif phase == "hydrate":
        _write_hydrate(session, run, records)
    _check_storage(session, run, config)
    run.checkpoint_line = batch[-1].line_number
    log.info("%s line=%d selected=%d db_peak=%.1f MiB", phase, run.checkpoint_line,
             run.selected_count, run.peak_database_mb)


def _stream_phase(factory: sessionmaker, config: ImportConfig, phase: str, url: str,
                  following: str, deadline: float | None = None, heartbeat=None) -> bool:
    kind = "works" if phase == "hydrate" else phase
    expected = (config.source_manifest.get("files") or {}).get(kind)
    for attempt in range(1, 4):
        with factory() as session:
            start = session.get(CatalogueImportRun, config.run_id).checkpoint_line
        if deadline is not None and time.monotonic() >= deadline:
            return False
        batch: list[clean.DumpRow] = []
        batch_bytes = 0
        try:
            def check_progress(force=False):
                if heartbeat:
                    heartbeat(force=force)
                if deadline is not None and time.monotonic() >= deadline:
                    raise StreamTimeBudgetReached()

            stream_options = {"start_line": start, "user_agent": config.user_agent,
                              "progress_callback": check_progress}
            if expected:
                stream_options.update(expected_size=expected["size"], expected_md5=expected["md5"])
            for row in clean.stream_dump(url, **stream_options):
                batch.append(row)
                batch_bytes += row.byte_size
                if len(batch) >= config.batch_size or batch_bytes >= 8_000_000:
                    check_progress(force=True)
                    with factory.begin() as session:
                        _write_dump_batch(session, config, phase, batch)
                    batch.clear()
                    batch_bytes = 0
                    if deadline is not None and time.monotonic() >= deadline:
                        return False
            if batch:
                check_progress(force=True)
                with factory.begin() as session:
                    _write_dump_batch(session, config, phase, batch)
            with factory.begin() as session:
                run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
                if phase == "works":
                    _prune_candidates(session, run, config)
                if expected:
                    report = dict(run.report or {})
                    verified = dict(report.get("verified_dumps", {}))
                    verified[phase] = expected["md5"]
                    report["verified_dumps"] = verified
                    run.report = report
                run.phase, run.checkpoint_line = following, 0
            return True
        except StreamTimeBudgetReached:
            return False
        except ValueError as exc:
            if expected and ("checksum mismatch" in str(exc) or "size mismatch" in str(exc)):
                with factory.begin() as session:
                    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
                    run.last_error = f"{phase}: {exc}"
                    _issue(session, run.id, "source_integrity", phase, run.last_error)
            raise
        except TRANSIENT_ERRORS as exc:
            if attempt == 3:
                raise
            delay = min(30, 2 ** attempt)
            log.warning("%s stream failed (%s); replaying from checkpoint in %ds",
                        phase, type(exc).__name__, delay)
            time.sleep(delay)


def _pause_capacity(factory: sessionmaker, config: ImportConfig, message: str) -> None:
    with factory.begin() as session:
        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
        total = float(session.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
        run.peak_database_mb = max(run.peak_database_mb or 0, total)
        run.peak_staging_mb = max(run.peak_staging_mb or 0, _stage_mb(session))
        _issue(session, run.id, "capacity_pause", None, message)
        run.last_error = message
        run.report = _build_report(session, run)
        _release_staging(session, run)
        run.phase = "paused_capacity"


def _cleanup(factory: sessionmaker, config: ImportConfig) -> None:
    with factory.begin() as session:
        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
        _check_storage(session, run, config)
        run.report = _build_report(session, run)
        _release_staging(session, run)
        run.phase = "complete"


def _progress_marker(factory: sessionmaker, run_id: str) -> tuple:
    with factory() as session:
        run = session.get(CatalogueImportRun, run_id)
        return (run.phase, run.checkpoint_line, run.merge_cursor,
                run.selected_count, run.merged_count)


def _continuation_status(factory: sessionmaker, config: ImportConfig, initial: tuple) -> str:
    if _progress_marker(factory, config.run_id) == initial:
        raise RuntimeError(
            "No committed checkpoint progress within this job. Automatic continuation "
            "would loop; inspect dump throughput and execution method before retrying."
        )
    return "needs_continuation"


def run_import(config: ImportConfig, *, one_phase: bool = False,
               time_budget_seconds: int | None = None) -> str:
    """Retry disconnected transactions from PostgreSQL's committed checkpoint."""
    config.validate()
    if time_budget_seconds is not None and time_budget_seconds < 1:
        raise ValueError("time_budget_seconds must be positive")
    deadline = time.monotonic() + time_budget_seconds if time_budget_seconds is not None else None
    progress_state = {}
    for attempt in range(3):
        try:
            return _run_import(config, one_phase=one_phase,
                               deadline=deadline, progress_state=progress_state)
        except (DBAPIError, ImportLockLost) as exc:
            if isinstance(exc, DBAPIError) and not exc.connection_invalidated:
                raise
            if attempt == 2:
                raise
            delay = 2 ** (attempt + 1)
            log.warning("Database connection interrupted; reacquiring import lock and "
                        "resuming committed checkpoints in %ds", delay)
            time.sleep(delay)
    raise AssertionError("unreachable")


def _run_import(config: ImportConfig, *, one_phase: bool = False,
                deadline: float | None = None, progress_state: dict | None = None) -> str:
    engine = create_engine(config.database_url, pool_pre_ping=True)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with _import_lock(engine) as heartbeat:
            with factory.begin() as session:
                _get_run(session, config)
            initial = _progress_marker(factory, config.run_id)
            if progress_state is not None:
                initial = progress_state.setdefault("initial", initial)
            while True:
                heartbeat(force=True)
                with factory() as session:
                    phase = session.get(CatalogueImportRun, config.run_id).phase
                if phase == "complete":
                    return phase
                if phase == "paused_capacity":
                    raise RuntimeError("Capacity pause requires a reviewed replay")
                if deadline is not None and time.monotonic() >= deadline:
                    return _continuation_status(factory, config, initial)
                try:
                    if phase in ("redirects", "deletes", "works", "authors", "editions", "hydrate"):
                        urls = {
                            "redirects": config.redirects_url, "deletes": config.deletes_url,
                            "works": config.works_url, "authors": config.authors_url,
                            "editions": config.editions_url, "hydrate": config.works_url,
                        }
                        next_phase = {
                            "redirects": "deletes", "deletes": "works", "works": "authors",
                            "authors": "editions", "editions": "select", "hydrate": "merge",
                        }
                        if not _stream_phase(factory, config, phase, urls[phase], next_phase[phase],
                                             deadline, heartbeat):
                            return _continuation_status(factory, config, initial)
                    elif phase == "select":
                        with factory.begin() as session:
                            _select_works(session, config)
                    elif phase == "merge":
                        with factory() as session:
                            merge_cursor = session.get(CatalogueImportRun, config.run_id).merge_cursor
                        if merge_cursor is None:
                            _backfill_authors(factory, config)
                        while True:
                            heartbeat(force=True)
                            if deadline is not None and time.monotonic() >= deadline:
                                return _continuation_status(factory, config, initial)
                            with factory.begin() as session:
                                processed = _merge_batch(session, config)
                            if not processed:
                                break
                    elif phase == "cleanup":
                        _cleanup(factory, config)
                    else:
                        raise RuntimeError(f"Unknown import phase {phase}")
                except CapacityPause as exc:
                    _pause_capacity(factory, config, str(exc))
                    raise
                if one_phase:
                    with factory() as session:
                        return session.get(CatalogueImportRun, config.run_id).phase
    finally:
        engine.dispose()


def _config_for_command(args, database_url: str, user_agent: str) -> ImportConfig:
    """Resume exclusively from PostgreSQL; discover metadata only for new runs."""
    validate_database_target(database_url, args.mode)
    existing = None
    if args.run_id:
        engine = create_engine(database_url, pool_pre_ping=True)
        try:
            with Session(engine) as session:
                existing = session.get(CatalogueImportRun, args.run_id)
                if existing:
                    # Copy values before the session closes; never rediscover on resume.
                    existing = {
                        "snapshot_id": existing.snapshot_id,
                        "manifest": existing.source_manifest or {},
                        "weights": existing.category_weights or {},
                        "target": existing.target_books,
                        "guard": existing.max_database_mb,
                        "urls": {kind: getattr(existing, f"{kind}_url") for kind in
                                 ("works", "authors", "editions", "redirects", "deletes")},
                    }
        finally:
            engine.dispose()
    if existing:
        if args.snapshot not in ("auto", (existing["manifest"] or {}).get("date")):
            raise ValueError("Resume cannot switch the pinned snapshot")
        if args.target_books is not None and args.target_books != existing["target"]:
            raise ValueError("Resume cannot change target_books")
        if (existing["weights"] and args.weights_json is not None
                and json.loads(args.weights_json) != existing["weights"]):
            raise ValueError("Resume cannot change category weights")
        if (existing["guard"] is not None and args.max_database_mb is not None
                and args.max_database_mb != existing["guard"]):
            raise ValueError("Resume cannot change the storage guard")
        if not existing["weights"]:
            supplied = {kind: getattr(args, f"{kind}_url") for kind in existing["urls"]}
            if supplied != existing["urls"]:
                raise ValueError("This pre-pinning run requires its original five URLs to resume")
            weights = json.loads(args.weights_json) if args.weights_json else equal_percentage_weights()
            log.warning("Resuming a pre-pinning run; original URLs were supplied explicitly")
            return ImportConfig(
                run_id=args.run_id, database_url=database_url, mode=args.mode,
                user_agent=user_agent, target_books=existing["target"],
                category_weights=weights,
                max_database_mb=args.max_database_mb if args.max_database_mb is not None else 400,
                batch_size=args.batch_size, restart_paused=args.restart_paused,
                **{f"{kind}_url": url for kind, url in existing["urls"].items()},
            )
        log.info("Resuming pinned %s from PostgreSQL; no snapshot lookup", existing["snapshot_id"])
        return ImportConfig(
            run_id=args.run_id, database_url=database_url, mode=args.mode,
            user_agent=user_agent, target_books=existing["target"],
            category_weights=existing["weights"], max_database_mb=existing["guard"] or 400,
            batch_size=args.batch_size, restart_paused=args.restart_paused,
            snapshot_id=existing["snapshot_id"], source_manifest=existing["manifest"],
            **{f"{kind}_url": url for kind, url in existing["urls"].items()},
        )
    if getattr(args, "resume_only", False):
        raise ValueError("The requested import run does not exist; refusing to start a new import")
    legacy_urls = {kind: getattr(args, f"{kind}_url") for kind in
                   ("works", "authors", "editions", "redirects", "deletes")}
    if any(legacy_urls.values()) and not all(legacy_urls.values()):
        raise ValueError("Provide all five legacy URLs, or none")
    if all(legacy_urls.values()):
        if args.mode != "test":
            raise ValueError("Production requires automatically verified snapshot metadata")
        snapshot_id, manifest = None, {}
        urls = legacy_urls
    else:
        snapshot = resolve_snapshot(args.snapshot, user_agent=user_agent)
        snapshot_id, manifest = snapshot.identifier, snapshot.manifest()
        urls = {kind: snapshot.url(kind) for kind in legacy_urls}
        log.info("Pinned Open Library snapshot %s: %s", snapshot.identifier,
                 ", ".join(f"{kind}={urls[kind]} ({manifest['files'][kind]['size']} bytes)" for kind in urls))
    run_id = args.run_id or f"ol-{(manifest.get('date') or 'test').replace('-', '')}-{uuid.uuid4().hex[:10]}"
    return ImportConfig(
        run_id=run_id, database_url=database_url, mode=args.mode, user_agent=user_agent,
        target_books=args.target_books if args.target_books is not None else 50000,
        category_weights=json.loads(args.weights_json) if args.weights_json else equal_percentage_weights(),
        batch_size=args.batch_size,
        max_database_mb=args.max_database_mb if args.max_database_mb is not None else 400,
        restart_paused=args.restart_paused, snapshot_id=snapshot_id, source_manifest=manifest,
        **{f"{kind}_url": url for kind, url in urls.items()},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", help="Existing run to resume, or optional identifier for a new run")
    parser.add_argument("--resume-only", action="store_true",
                        help="Require --run-id to identify an existing run; never create one")
    parser.add_argument("--snapshot", default="auto", help="'auto' or explicit YYYY-MM-DD")
    for kind in ("works", "authors", "editions", "redirects", "deletes"):
        parser.add_argument(f"--{kind}-url", help="Legacy test-only URL override")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--target-books", type=int)
    parser.add_argument("--weights-json", default=None,
                        help="JSON map of category percentage weights; defaults to equal weights")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-database-mb", type=int)
    parser.add_argument("--time-budget-seconds", type=int,
                        help="Soft checkpoint deadline for automatic job continuation")
    parser.add_argument("--one-phase", action="store_true")
    parser.add_argument("--restart-paused", action="store_true")
    args = parser.parse_args()
    if args.resume_only and not args.run_id:
        parser.error("--resume-only requires --run-id")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    database_url = os.getenv("CATALOGUE_DATABASE_URL")
    if not database_url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    config = _config_for_command(args, database_url, os.getenv("CATALOGUE_USER_AGENT", ""))
    config.validate()
    result = run_import(config, one_phase=args.one_phase,
                        time_budget_seconds=args.time_budget_seconds)
    log.info("Import %s snapshot=%s phase=%s", config.run_id, config.snapshot_id, result)
    output_path = os.getenv("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"run_id={config.run_id}\nstatus={result}\nsnapshot_id={config.snapshot_id or ''}\n")


if __name__ == "__main__":
    main()
