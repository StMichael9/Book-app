"""Lean alias phases for popular runs: the full redirect set is resolved in runner memory, and only the rows that
belong to a seed (an existing book or a popular work) are ever written to Neon."""
from __future__ import annotations

import logging
import time

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import sessionmaker

from data import clean
from data.config import ImportConfig
from data.popularity import PopularityStore
from data.reporting import _check_storage, _issue
from models import Book, CatalogueImportRun, CatalogueSourceAlias

log = logging.getLogger("bookvane.catalogue")
WRITE_BATCH = 5000
MAX_HOPS = 10
TRANSIENT = (clean.requests.RequestException, EOFError, OSError)


def terminal_keys(edges: dict[str, str]):
    """A function giving the key at the end of a redirect chain (at most ten hops), memoised."""
    memo: dict[str, str] = {}

    def end(key: str) -> str:
        path, current = [], key
        for _ in range(MAX_HOPS + 1):
            if current in memo:
                current = memo[current]
                break
            following = edges.get(current)
            if following is None or following == current:
                break
            path.append(current)
            current = following
        for item in path:
            memo[item] = current
        return current

    return end


def relevant_edges(edges: dict[str, str], seeds: set[str]) -> dict[str, str]:
    """Keep every redirect whose chain ends where a seed's chain ends: the seed's own hops and its ancestors."""
    end = terminal_keys(edges)
    wanted = {end(seed) for seed in seeds}
    return {old: canonical for old, canonical in edges.items() if end(old) in wanted}


def seed_keys(factory: sessionmaker, store: PopularityStore) -> set[str]:
    with factory() as session:
        books = set(session.execute(select(Book.source_id).where(Book.source_id.is_not(None))).scalars())
    return books | store.keys()


def run_redirects(factory: sessionmaker, config: ImportConfig, store: PopularityStore, heartbeat=None) -> None:
    """Stream the whole redirect dump into memory, then write only the seed-related rows and move to deletes."""
    expected = (config.source_manifest.get("files") or {}).get("redirects")
    options = {"start_line": 0, "user_agent": config.user_agent,
               "progress_callback": (lambda: heartbeat()) if heartbeat else None}
    if expected:
        options.update(expected_size=expected["size"], expected_md5=expected["md5"])
    for attempt in range(1, 4):
        edges: dict[str, str] = {}
        malformed, last_error = 0, None
        try:
            for row in clean.stream_dump(config.redirects_url, **options):
                if row.error:
                    malformed += 1
                    last_error = f"redirects line {row.line_number}: {row.error}"
                    continue
                item = clean.normalize_redirect(row.record)
                if item:
                    edges[item[0]] = item[1]
            break
        except ValueError as exc:
            if expected and ("checksum mismatch" in str(exc) or "size mismatch" in str(exc)):
                with factory.begin() as session:
                    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
                    run.last_error = f"redirects: {exc}"
                    _issue(session, run.id, "source_integrity", "redirects", run.last_error)
            raise
        except TRANSIENT as exc:
            if attempt == 3:
                raise
            delay = min(30, 2 ** attempt)
            log.warning("redirects stream failed (%s); streaming again in %ds", type(exc).__name__, delay)
            time.sleep(delay)
    keep = relevant_edges(edges, seed_keys(factory, store))
    log.info("redirects: %d read, %d tied to a seed and written", len(edges), len(keep))
    rows = [{"old_source_id": old, "canonical_source_id": canonical, "source_type": "redirect"}
            for old, canonical in keep.items()]
    for start in range(0, len(rows), WRITE_BATCH):
        if heartbeat:
            heartbeat(force=True)
        with factory.begin() as session:
            run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
            _check_storage(session, run, config)
            statement = insert(CatalogueSourceAlias).values(rows[start:start + WRITE_BATCH])
            session.execute(statement.on_conflict_do_update(
                index_elements=["old_source_id"],
                set_={"canonical_source_id": statement.excluded.canonical_source_id,
                      "source_type": statement.excluded.source_type}))
    with factory.begin() as session:
        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
        run.error_count += malformed
        if malformed:
            run.last_error = last_error
            _issue(session, run.id, "malformed_dump", "redirects", last_error or "")
        report = dict(run.report or {})
        if expected:
            report["verified_dumps"] = dict(report.get("verified_dumps", {})) | {"redirects": expected["md5"]}
        report["redirects"] = {"read": len(edges), "written": len(rows)}
        run.report = report
        run.phase, run.checkpoint_line = "deletes", 0


def relevant_delete_keys(factory: sessionmaker, store: PopularityStore) -> set[str]:
    """A deletion matters when it is a seed or where a kept redirect chain ends."""
    with factory() as session:
        ends = set(session.execute(text(
            "SELECT DISTINCT canonical_source_id FROM catalogue_source_aliases WHERE source_type = 'redirect'"
        )).scalars())
    return ends | seed_keys(factory, store)
