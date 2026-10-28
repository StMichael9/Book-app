"""Popularity phase: rank works by Open Library reading-log and ratings activity, keep the top as an allowlist.

Both dumps are streamed (never saved) and aggregated per work in memory, then the top works are written to
``catalogue_stage_popularity`` so a resume or a capacity replay does not stream them again.
"""
from __future__ import annotations

import logging
import math
import time
from collections import defaultdict

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import sessionmaker

from data import clean
from data.config import ImportConfig
from data.reporting import _check_storage, _issue
from models import CatalogueImportRun, CatalogueStagePopularity

log = logging.getLogger("bookvane.catalogue")
SHELVES = frozenset({"want to read", "currently reading", "already read"})
WRITE_BATCH = 5000


def popularity_score(readers: int, ratings_count: int) -> float:
    return math.log1p(readers) + 0.5 * math.log1p(ratings_count)


def _count(config: ImportConfig, kind: str, url: str, totals: dict[str, list[int]], heartbeat) -> tuple[int, str | None]:
    """Add one dump's rows to totals; returns (unparsable lines, the last such line's description)."""
    expected = (config.source_manifest.get("files") or {}).get(kind)
    options = {"start_line": 0, "user_agent": config.user_agent, "tabular": True,
               "progress_callback": (lambda: heartbeat()) if heartbeat else None}
    if expected:
        options.update(expected_size=expected["size"], expected_md5=expected["md5"])
    column = 0 if kind == "reading-log" else 1
    malformed, last = 0, None
    for row in clean.stream_dump(url, **options):
        if row.error:
            malformed += 1
            last = f"{kind} line {row.line_number}: {row.error}"
            continue
        key = clean.work_key(row.record["work"])
        value = row.record["value"].strip()
        if not key:
            continue
        if kind == "reading-log":
            counted = value.casefold() in SHELVES
        else:
            counted = value in ("1", "2", "3", "4", "5")
        if counted:
            totals[key][column] += 1
    return malformed, last


def run_popularity(factory: sessionmaker, config: ImportConfig, heartbeat=None) -> None:
    """Stream both dumps, keep the top works, and hand over to the first alias phase."""
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    malformed, last_error = 0, None
    for kind, url in config.popularity_urls.items():
        for attempt in range(1, 4):
            before = {key: list(value) for key, value in totals.items()}
            try:
                found, last = _count(config, kind, url, totals, heartbeat)
                break
            except (clean.requests.RequestException, EOFError, OSError) as exc:
                if attempt == 3:
                    raise
                totals.clear()
                totals.update({key: list(value) for key, value in before.items()})
                delay = min(30, 2 ** attempt)
                log.warning("%s stream failed (%s); streaming again in %ds", kind, type(exc).__name__, delay)
                time.sleep(delay)
            except ValueError as exc:
                if "checksum mismatch" in str(exc) or "size mismatch" in str(exc):
                    with factory.begin() as session:
                        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
                        run.last_error = f"{kind}: {exc}"
                        _issue(session, run.id, "source_integrity", kind, run.last_error)
                raise
        malformed += found
        last_error = last or last_error
    scores = {key: popularity_score(readers, ratings) for key, (readers, ratings) in totals.items()
              if readers or ratings}
    top = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:config.popularity_top]
    log.info("popularity: %d works counted, %d kept (%d unparsable lines)", len(scores), len(top), malformed)
    with factory.begin() as session:
        session.execute(delete(CatalogueStagePopularity).where(CatalogueStagePopularity.run_id == config.run_id))
    for start in range(0, len(top), WRITE_BATCH):
        if heartbeat:
            heartbeat(force=True)
        with factory.begin() as session:
            run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
            _check_storage(session, run, config)
            session.execute(insert(CatalogueStagePopularity).values([
                {"run_id": config.run_id, "source_id": key, "score": score}
                for key, score in top[start:start + WRITE_BATCH]
            ]))
    with factory.begin() as session:
        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
        run.error_count += malformed
        if malformed:
            run.last_error = last_error
            _issue(session, run.id, "malformed_dump", "popularity", last_error or "")
        files = config.source_manifest.get("files") or {}
        report = dict(run.report or {})
        report["verified_dumps"] = dict(report.get("verified_dumps", {})) | {
            kind: files[kind]["md5"] for kind in config.popularity_urls if files.get(kind)}
        report["popularity_ready"] = True
        report["popularity_works"] = {"counted": len(scores), "kept": len(top)}
        run.report = report
        run.phase, run.checkpoint_line = "redirects", 0
