"""Config responsibilities for the bounded catalogue importer."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from data import clean
from models import Book, CatalogueImportRun


def equal_percentage_weights() -> dict[str, float]:
    return {name: 100.0 / len(clean.SUBJECT_ALIASES) for name in clean.SUBJECT_ALIASES}


@dataclass(frozen=True)
class ImportConfig:
    run_id: str
    works_url: str
    authors_url: str
    editions_url: str
    redirects_url: str
    deletes_url: str
    database_url: str
    mode: str
    user_agent: str
    target_books: int = 50000
    category_weights: dict[str, float] = field(default_factory=equal_percentage_weights)
    batch_size: int = 500
    max_database_mb: int = 400
    restart_paused: bool = False
    snapshot_id: str | None = None
    source_manifest: dict = field(default_factory=dict)

    def validate(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", self.run_id):
            raise ValueError("run_id must be 1-80 letters, digits, hyphens, or underscores")
        if self.mode not in ("test", "production") or self.target_books < 1 or not 1 <= self.batch_size <= 1000:
            raise ValueError("Invalid mode, target_books, or batch_size")
        if self.max_database_mb < 10 or not self.user_agent or "@" not in self.user_agent:
            raise ValueError("Set a safe storage guard and an identified contact User-Agent")
        if set(self.category_weights) != set(clean.SUBJECT_ALIASES):
            raise ValueError("Weights must include exactly the configured categories")
        if any(not math.isfinite(value) or value <= 0 for value in self.category_weights.values()):
            raise ValueError("Category percentage weights must be positive and finite")
        if abs(sum(self.category_weights.values()) - 100.0) > 0.00001:
            raise ValueError("Category percentage weights must total 100")
        for url in (self.works_url, self.authors_url, self.editions_url, self.redirects_url, self.deletes_url):
            parsed = urlparse(url)
            if (parsed.scheme != "https" or "latest" in url.casefold()
                    or not parsed.path.endswith(".txt.gz")
                    or parsed.hostname not in ("openlibrary.org", "archive.org")
                    and not (parsed.hostname or "").endswith(".archive.org")):
                raise ValueError("Use pinned HTTPS Open Library .txt.gz dump URLs")
        if self.snapshot_id:
            files = self.source_manifest.get("files")
            if self.source_manifest.get("identifier") != self.snapshot_id or not isinstance(files, dict):
                raise ValueError("Pinned snapshot metadata is incomplete")
            for kind in ("works", "authors", "editions", "redirects", "deletes"):
                entry = files.get(kind)
                if (not isinstance(entry, dict) or entry.get("url") != getattr(self, f"{kind}_url")
                        or not isinstance(entry.get("size"), int) or entry["size"] < 1
                        or not re.fullmatch(r"[a-f0-9]{32}", str(entry.get("md5", "")))):
                    raise ValueError(f"Pinned {kind} metadata does not match the import URL")
        validate_database_target(self.database_url, self.mode)


def validate_database_target(database_url: str, mode: str) -> None:
    db_url = make_url(database_url)
    if db_url.get_backend_name() != "postgresql":
        raise ValueError("Catalogue imports require PostgreSQL")
    if mode == "test":
        if os.getenv("BOOKVANE_TEST_DB_ISOLATED") != "yes":
            raise ValueError("Test imports require BOOKVANE_TEST_DB_ISOLATED=yes")
        if not db_url.database or "test" not in db_url.database.casefold():
            raise ValueError("Test database name must contain 'test'")
        if db_url.host not in ("localhost", "127.0.0.1"):
            raise ValueError("Test import must use isolated local PostgreSQL")
        app_url = os.getenv("DATABASE_URL")
        if app_url and db_url == make_url(app_url) and os.getenv("TEST_DATABASE_URL") != database_url:
            raise ValueError("Test import target is the application database")
    elif mode == "production":
        if os.getenv("CATALOGUE_IMPORT_PRODUCTION") != "yes" or not (db_url.host or "").endswith(".neon.tech"):
            raise ValueError("Production import requires explicit opt-in and a Neon target")
        if "-pooler" in db_url.host:
            raise ValueError("Catalogue imports require a direct Neon connection, not a transaction pooler")
    else:
        raise ValueError("Unknown import mode")


def _config_hash(config: ImportConfig) -> str:
    payload = {
        "subjects": clean.SUBJECT_ALIASES, "types": clean.CATEGORY_TYPES,
        "mood_theme": clean.MOOD_THEME_ALIASES, "weights": config.category_weights,
        "selection_version": 2,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def percentage_quotas(total: int, weights: dict[str, float]) -> dict[str, int]:
    exact = {name: total * weight / 100.0 for name, weight in weights.items()}
    result = {name: math.floor(value) for name, value in exact.items()}
    spare = total - sum(result.values())
    for name in sorted(weights, key=lambda key: (-(exact[key] - result[key]), key))[:spare]:
        result[name] += 1
    return result


def get_or_create_run(session: Session, config: ImportConfig) -> CatalogueImportRun:
    """Pin immutable run inputs and retain the existing checkpoint on resume."""
    run = session.get(CatalogueImportRun, config.run_id)
    if run is None:
        unfinished = session.execute(select(CatalogueImportRun.id).where(
            CatalogueImportRun.phase != "complete"
        ).limit(1)).scalar_one_or_none()
        if unfinished:
            raise RuntimeError(f"Resume or resolve unfinished catalogue run {unfinished}")
        baseline = session.scalar(select(func.count()).select_from(Book)) or 0
        if baseline > config.target_books:
            raise ValueError(f"Existing {baseline} books exceed target_books={config.target_books}")
        run = CatalogueImportRun(
            id=config.run_id, works_url=config.works_url, authors_url=config.authors_url,
            editions_url=config.editions_url, redirects_url=config.redirects_url,
            deletes_url=config.deletes_url, snapshot_id=config.snapshot_id,
            source_manifest=config.source_manifest, category_weights=config.category_weights,
            max_database_mb=config.max_database_mb, category_hash=_config_hash(config),
            target_books=config.target_books, baseline_count=baseline,
            shortlist_factor=2, phase="redirects", checkpoint_line=0,
            selected_count=0, merged_count=0, error_count=0,
            peak_database_mb=0, peak_staging_mb=0, category_seen_counts={},
        )
        session.add(run)
        session.flush()
    elif (run.works_url, run.authors_url, run.editions_url, run.redirects_url, run.deletes_url,
          run.category_hash, run.target_books, run.snapshot_id, run.source_manifest or {}) != (
          config.works_url, config.authors_url, config.editions_url, config.redirects_url,
          config.deletes_url, _config_hash(config), config.target_books,
          config.snapshot_id, config.source_manifest):
        raise ValueError("Resume with identical pinned dumps, target, weights, and taxonomy")
    elif (run.max_database_mb or config.max_database_mb) != config.max_database_mb and not (
        run.phase == "paused_capacity" and config.restart_paused
    ):
        raise ValueError("Changing the storage guard requires an explicit capacity replay")
    if run.phase == "paused_capacity":
        if not config.restart_paused:
            raise RuntimeError("Capacity pause requires reviewed --restart-paused replay")
        baseline = session.scalar(select(func.count()).select_from(Book)) or 0
        if baseline > config.target_books:
            raise ValueError(f"Existing {baseline} books exceed target_books={config.target_books}")
        previous = dict(run.report or {})
        replays = list(previous.get("capacity_replays", []))
        replays.append({
            "previous_guard_mb": run.max_database_mb,
            "guard_mb": config.max_database_mb,
            "peak_database_mb": run.peak_database_mb,
            "merged_count": run.merged_count,
            "baseline_books": baseline,
        })
        verified = dict(previous.get("verified_dumps", {}))
        # Pause cleanup discarded selection staging, not verified source aliases.
        # Replay only the first unverified alias pass, otherwise begin at works.
        files = config.source_manifest.get("files") or {}
        phase = "works"
        for kind in ("redirects", "deletes"):
            if (previous.get("alias_scope") == "shortlist" or not files.get(kind)
                    or verified.get(kind) != files[kind].get("md5")):
                phase = kind
                break
        if previous.get("alias_scope") == "shortlist":
            # Verification of an old full dump does not prove its compacted
            # rows have already been restored by this replay.
            verified.pop("redirects", None)
            verified.pop("deletes", None)
        run.phase, run.checkpoint_line, run.selected_count, run.merged_count = phase, 0, 0, 0
        run.merge_cursor = None
        run.baseline_count = baseline
        run.max_database_mb = config.max_database_mb
        run.shortlist_factor = 2
        run.category_seen_counts = {}
        run.report = {"verified_dumps": verified, "capacity_replays": replays}
        run.last_error = None
    return run
