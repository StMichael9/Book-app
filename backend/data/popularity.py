"""Popularity phase: rank works by Open Library reading-log and ratings activity, keep the top as an allowlist.

Both dumps are streamed (never saved) and aggregated per work in memory. The top works are kept in a runner-local
SQLite file (``PopularityStore``), not in Neon, so a resume on the same runner (or one that restored the file from a
workflow artifact) does not stream them again, and a missing file is simply rebuilt. Only the scores of works that
are actually staged are copied into ``catalogue_stage_popularity``.
"""
from __future__ import annotations

import logging
import math
import os
import sqlite3
import tempfile
import time
from collections import defaultdict
from pathlib import Path

from sqlalchemy.orm import sessionmaker

from data import clean
from data.config import ImportConfig
from data.reporting import _issue
from models import CatalogueImportRun

log = logging.getLogger("bookvane.catalogue")
SHELVES = frozenset({"want to read", "currently reading", "already read"})
STORE_BATCH = 50_000
LOOKUP_CHUNK = 500
_ACTIVE: dict[str, "PopularityStore"] = {}


def popularity_score(readers: int, ratings_count: int) -> float:
    return math.log1p(readers) + 0.5 * math.log1p(ratings_count)


def state_dir(config: ImportConfig) -> Path:
    base = config.state_dir or os.getenv("BOOKVANE_STATE_DIR") or os.path.join(tempfile.gettempdir(), "bookvane-catalogue")
    path = Path(base)
    path.mkdir(parents=True, exist_ok=True)
    return path


class PopularityStore:
    """The popularity allowlist and scores, in a local SQLite file that can travel between segments."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def __bool__(self) -> bool:
        return True

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    @property
    def ready(self) -> bool:
        if not self.path.exists():
            return False
        db = self._connect()
        try:
            return db.execute("SELECT value FROM meta WHERE key = 'ready'").fetchone() == ("1",)
        except sqlite3.Error:
            return False
        finally:
            db.close()

    def rebuild(self, rows: list[tuple[str, float]]) -> None:
        self.path.unlink(missing_ok=True)
        db = self._connect()
        try:
            db.execute("CREATE TABLE scores (key TEXT PRIMARY KEY, score REAL NOT NULL) WITHOUT ROWID")
            db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            for start in range(0, len(rows), STORE_BATCH):
                db.executemany("INSERT OR REPLACE INTO scores VALUES (?, ?)", rows[start:start + STORE_BATCH])
            db.execute("INSERT INTO meta VALUES ('ready', '1')")  # last, so a cut-off write is never trusted
            db.commit()
        finally:
            db.close()

    def scores(self, keys) -> dict[str, float]:
        keys = list(dict.fromkeys(keys))
        found: dict[str, float] = {}
        db = self._connect()
        try:
            for start in range(0, len(keys), LOOKUP_CHUNK):
                chunk = keys[start:start + LOOKUP_CHUNK]
                marks = ",".join("?" * len(chunk))
                found.update(db.execute(f"SELECT key, score FROM scores WHERE key IN ({marks})", chunk))
        finally:
            db.close()
        return found

    def keys(self) -> set[str]:
        db = self._connect()
        try:
            return {row[0] for row in db.execute("SELECT key FROM scores")}
        finally:
            db.close()


def open_store(config: ImportConfig) -> PopularityStore:
    store = PopularityStore(state_dir(config) / f"popularity-{config.run_id}.sqlite")
    _ACTIVE[config.run_id] = store
    return store


def active_store(run_id: str) -> PopularityStore | None:
    return _ACTIVE.get(run_id)


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


def _collect(factory: sessionmaker, config: ImportConfig, heartbeat=None, only: set[str] | None = None):
    """Stream both dumps; returns (top (key, score) pairs, works counted, unparsable lines, last such line).

    With `only`, the pairs are the scores of exactly those works (all of them, not just the top cut)."""
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
    if only is not None:
        top = sorted(((key, score) for key, score in scores.items() if key in only), key=lambda item: (-item[1], item[0]))
    else:
        top = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:config.popularity_top]
    log.info("popularity: %d works counted, %d kept (%d unparsable lines)", len(scores), len(top), malformed)
    return top, len(scores), malformed, last_error


def run_backfill_popularity(factory: sessionmaker, config: ImportConfig, heartbeat=None, chunk: int = 1000) -> dict:
    """Fill books.popularity for books already in the catalogue, matched by Open Library work key. Fill-only."""
    from sqlalchemy import bindparam, select, update
    from models import Book
    with factory() as session:
        wanted = set(session.scalars(select(Book.source_id).where(Book.source_id.is_not(None), Book.popularity.is_(None))))
    top, counted, _, _ = _collect(factory, config, heartbeat, only=wanted)
    rows = [{"sid": key, "score": score} for key, score in top]
    books = Book.__table__  # Core, so the list of parameter sets runs as a plain executemany
    statement = update(books).where(books.c.source_id == bindparam("sid"), books.c.popularity.is_(None)).values(
        popularity=bindparam("score"))
    for start in range(0, len(rows), chunk):
        with factory.begin() as session:
            session.execute(statement, rows[start:start + chunk])
    log.info("popularity backfill: %d books without a score, %d scored (of %d works counted)", len(wanted), len(rows), counted)
    return {"missing": len(wanted), "scored": len(rows), "counted": counted}


def ensure_store(factory: sessionmaker, config: ImportConfig, heartbeat=None) -> PopularityStore:
    """The runner-local allowlist for this run; rebuilt from the dumps when this runner does not have it."""
    store = open_store(config)
    if not store.ready:
        top, _, _, _ = _collect(factory, config, heartbeat)
        store.rebuild(top)
    return store


def run_popularity(factory: sessionmaker, config: ImportConfig, heartbeat=None) -> None:
    """Stream both dumps, keep the top works locally, and hand over to the first alias phase."""
    top, counted, malformed, last_error = _collect(factory, config, heartbeat)
    open_store(config).rebuild(top)
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
        report["popularity_works"] = {"counted": counted, "kept": len(top)}
        run.report = report
        run.phase, run.checkpoint_line = "redirects", 0
