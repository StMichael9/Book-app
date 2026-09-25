"""Bounded, resumable Open Library catalogue import. No import runs on module load."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
from sqlalchemy import and_, case, delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine

from data import clean
from models import (
    Author, Book, CatalogueImportIssue, CatalogueImportRun, CatalogueSourceAlias,
    CatalogueStageAuthor, CatalogueStageAuthorCount, CatalogueStageCandidate,
    CatalogueStageEdition, CatalogueStageWork, CatalogueStageWorkAuthor,
    Edition, EditionISBN, Tag, TagType, book_authors, book_tags,
)

log = logging.getLogger("bookvane.catalogue")
PHASES = ("redirects", "deletes", "works", "authors", "editions", "select", "hydrate", "merge", "cleanup", "complete")
TRANSIENT_ERRORS = (requests.RequestException, EOFError, OSError)
FIELD_TITLE, FIELD_DESCRIPTION, FIELD_YEAR, FIELD_COVER, FIELD_ISBN, FIELD_PAGES = (1, 2, 4, 8, 16, 32)


class CapacityPause(RuntimeError):
    """The safety margin was reached; scratch data must be released."""


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
        db_url = make_url(self.database_url)
        if db_url.get_backend_name() != "postgresql":
            raise ValueError("Catalogue imports require PostgreSQL")
        if self.mode == "test":
            if os.getenv("BOOKVANE_TEST_DB_ISOLATED") != "yes":
                raise ValueError("Test imports require BOOKVANE_TEST_DB_ISOLATED=yes")
            if not db_url.database or "test" not in db_url.database.casefold():
                raise ValueError("Test database name must contain 'test'")
            if db_url.host not in ("localhost", "127.0.0.1"):
                raise ValueError("Test import must use isolated local PostgreSQL")
            app_url = os.getenv("DATABASE_URL")
            if app_url and db_url == make_url(app_url) and os.getenv("TEST_DATABASE_URL") != self.database_url:
                raise ValueError("Test import target is the application database")
        elif os.getenv("CATALOGUE_IMPORT_PRODUCTION") != "yes" or not (db_url.host or "").endswith(".neon.tech"):
            raise ValueError("Production import requires explicit opt-in and a Neon target")


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


def _stage_mb(session: Session) -> float:
    names = (
        "catalogue_stage_works", "catalogue_stage_work_authors", "catalogue_stage_authors",
        "catalogue_stage_editions", "catalogue_stage_candidates", "catalogue_stage_author_counts",
    )
    return sum(float(session.execute(text("SELECT pg_total_relation_size(to_regclass(:name)) / 1048576.0"), {"name": name}).scalar_one())
               for name in names)


def _check_storage(session: Session, run: CatalogueImportRun, config: ImportConfig) -> None:
    total = float(session.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
    run.peak_database_mb = max(run.peak_database_mb or 0, total)
    run.peak_staging_mb = max(run.peak_staging_mb or 0, _stage_mb(session))
    if total >= config.max_database_mb:
        raise CapacityPause(f"Database reached {total:.1f} MiB, guard is {config.max_database_mb} MiB")


def _issue(session: Session, run_id: str, code: str, source_id: str | None, detail: str) -> None:
    session.add(CatalogueImportIssue(run_id=run_id, code=code, source_id=source_id, detail=detail[:2000]))


def _count_skipped(run: CatalogueImportRun, phase: str, count: int) -> None:
    if count:
        report = dict(run.report or {})
        skipped = dict(report.get("skipped_by_phase", {}))
        skipped[phase] = skipped.get(phase, 0) + count
        report["skipped_by_phase"] = skipped
        run.report = report


def _get_run(session: Session, config: ImportConfig) -> CatalogueImportRun:
    run = session.get(CatalogueImportRun, config.run_id)
    if run is None:
        unfinished = session.execute(select(CatalogueImportRun.id).where(CatalogueImportRun.phase != "complete").limit(1)).scalar_one_or_none()
        if unfinished:
            raise RuntimeError(f"Resume or resolve unfinished catalogue run {unfinished}")
        baseline = session.scalar(select(func.count()).select_from(Book)) or 0
        if baseline > config.target_books:
            raise ValueError(f"Existing {baseline} books exceed target_books={config.target_books}")
        run = CatalogueImportRun(
            id=config.run_id, works_url=config.works_url, authors_url=config.authors_url,
            editions_url=config.editions_url, redirects_url=config.redirects_url,
            deletes_url=config.deletes_url, category_hash=_config_hash(config),
            target_books=config.target_books, baseline_count=baseline,
            shortlist_factor=2, phase="redirects", checkpoint_line=0,
            selected_count=0, merged_count=0, error_count=0,
            peak_database_mb=0, peak_staging_mb=0, category_seen_counts={},
        )
        session.add(run)
        session.flush()
    elif (run.works_url, run.authors_url, run.editions_url, run.redirects_url, run.deletes_url,
          run.category_hash, run.target_books) != (
          config.works_url, config.authors_url, config.editions_url, config.redirects_url,
          config.deletes_url, _config_hash(config), config.target_books):
        raise ValueError("Resume with identical pinned dumps, target, weights, and taxonomy")
    elif run.phase == "paused_capacity":
        if not config.restart_paused:
            raise RuntimeError("Capacity pause requires reviewed --restart-paused replay")
        run.phase, run.checkpoint_line, run.selected_count, run.merged_count = "redirects", 0, 0, 0
        run.shortlist_factor = 2
        run.category_seen_counts = {}
        run.report = {}
    return run


def _resolve_aliases(session: Session, keys: set[str]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {key: key for key in keys}
    for _ in range(10):
        pending = {value for value in resolved.values() if value}
        aliases = {item.old_source_id: item for item in session.execute(
            select(CatalogueSourceAlias).where(CatalogueSourceAlias.old_source_id.in_(pending))
        ).scalars()}
        changed = False
        for key, value in list(resolved.items()):
            alias = aliases.get(value) if value else None
            if alias:
                next_value = None if alias.source_type == "deleted" else alias.canonical_source_id
                if next_value != value:
                    resolved[key] = next_value
                    changed = True
        if not changed:
            break
    else:
        raise RuntimeError("Open Library redirect chain is cyclic or exceeds ten links")
    return resolved


def _existing_book_aliases(session: Session, canonical_keys: set[str]) -> dict[str, str]:
    """Find existing Book IDs behind even multi-hop redirects, without scanning all books."""
    if not canonical_keys:
        return {}
    rows = session.execute(text("""
        WITH RECURSIVE ancestors(old_source_id, target_source_id, depth) AS (
            SELECT old_source_id, canonical_source_id, 1
            FROM catalogue_source_aliases
            WHERE canonical_source_id = ANY(:keys) AND source_type = 'redirect'
            UNION ALL
            SELECT a.old_source_id, ancestors.target_source_id, ancestors.depth + 1
            FROM catalogue_source_aliases a
            JOIN ancestors ON a.canonical_source_id = ancestors.old_source_id
            WHERE a.source_type = 'redirect' AND ancestors.depth < 10
        )
        SELECT DISTINCT ancestors.old_source_id, ancestors.target_source_id
        FROM ancestors JOIN books b ON b.source_id = ancestors.old_source_id
    """), {"keys": list(canonical_keys)}).all()
    return dict(rows)


def _write_aliases(session: Session, run: CatalogueImportRun, records: list[dict], phase: str) -> None:
    rows = []
    for record in records:
        if phase == "redirects":
            item = clean.normalize_redirect(record)
            if item:
                rows.append({"old_source_id": item[0], "canonical_source_id": item[1], "source_type": "redirect"})
        else:
            key = clean.normalize_delete(record)
            if key:
                rows.append({"old_source_id": key, "canonical_source_id": key, "source_type": "deleted"})
    if rows:
        values = list({row["old_source_id"]: row for row in rows}.values())
        statement = insert(CatalogueSourceAlias).values(values)
        session.execute(statement.on_conflict_do_update(
            index_elements=["old_source_id"],
            set_={"canonical_source_id": statement.excluded.canonical_source_id,
                  "source_type": statement.excluded.source_type},
            where=(CatalogueSourceAlias.source_type != "redirect") if phase == "deletes" else None,
        ))


def _write_works(session: Session, run: CatalogueImportRun, records: list[dict]) -> None:
    normalized = [item for record in records if (item := clean.normalize_work(record))]
    _count_skipped(run, "works", len(records) - len(normalized))
    if not normalized:
        return
    aliases = _resolve_aliases(session, {item["source_id"] for item in normalized})
    works: dict[str, dict] = {}
    for item in normalized:
        canonical = aliases[item["source_id"]]
        if canonical is None:
            continue
        item["source_id"] = canonical
        old = works.get(canonical)
        if old:
            item["categories"] = sorted(set(old["categories"]) | set(item["categories"]))
            item["author_keys"] = list(dict.fromkeys(old["author_keys"] + item["author_keys"]))
            item["tags"] = list({(t["name"], t["type"]): t for t in old["tags"] + item["tags"]}.values())
            item["quality"] = max(old["quality"], item["quality"])
        works[canonical] = item
    if not works:
        return
    staged = {item.source_id: item for item in session.execute(select(CatalogueStageWork).where(
        CatalogueStageWork.run_id == run.id, CatalogueStageWork.source_id.in_(works)
    )).scalars()}
    for key, item in works.items():
        previous = staged.get(key)
        if previous:
            item["categories"] = sorted(set(previous.categories) | set(item["categories"]))
            item["tags"] = list({(tag["name"], tag["type"]): tag
                                 for tag in previous.tags + item["tags"]}.values())
            item["quality"] = max(previous.quality, item["quality"])
    old_aliases = _existing_book_aliases(session, set(works))
    old_keys = set(old_aliases)
    existing_ids = set(session.execute(select(Book.source_id).where(
        Book.source_id.in_(set(works) | old_keys)
    )).scalars())
    forced_keys = set(works) & existing_ids
    for old_key in old_keys & existing_ids:
        canonical = old_aliases.get(old_key)
        if canonical:
            forced_keys.add(canonical)
    legacy_titles = set(session.execute(select(Book.title).where(Book.source_id.is_(None), Book.title.in_({w["title"] for w in works.values()}))).scalars())
    values = [{"run_id": run.id, "source_id": key, "title": work["title"],
               "description": None, "published_year": work["published_year"],
               "cover_image_url": work["cover_image_url"], "tags": work["tags"],
               "categories": work["categories"], "quality": work["quality"],
               "forced": key in forced_keys or work["title"] in legacy_titles}
              for key, work in works.items()]
    statement = insert(CatalogueStageWork).values(values)
    session.execute(statement.on_conflict_do_update(
        index_elements=["run_id", "source_id"],
        set_={"title": statement.excluded.title, "published_year": statement.excluded.published_year,
              "cover_image_url": statement.excluded.cover_image_url, "tags": statement.excluded.tags,
              "categories": statement.excluded.categories, "quality": statement.excluded.quality,
              "forced": or_(CatalogueStageWork.forced, statement.excluded.forced)},
    ))
    candidates = [{"run_id": run.id, "category": category, "source_id": key,
                   "quality": work["quality"], "tie_hash": hashlib.sha256(key.encode()).hexdigest()}
                  for key, work in works.items() for category in work["categories"]]
    for start in range(0, len(candidates), 500):
        statement = insert(CatalogueStageCandidate).values(candidates[start:start + 500])
        session.execute(statement.on_conflict_do_update(
            index_elements=["run_id", "category", "source_id"],
            set_={"quality": statement.excluded.quality}
        ))
    links = [{"run_id": run.id, "source_id": key, "author_key": author_key, "position": position}
             for key, work in works.items() for position, author_key in enumerate(work["author_keys"])]
    for start in range(0, len(links), 500):
        statement = insert(CatalogueStageWorkAuthor).values(links[start:start + 500])
        session.execute(statement.on_conflict_do_nothing())
    counts = dict(run.category_seen_counts or {})
    for row in candidates:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    run.category_seen_counts = counts


def _prune_candidates(session: Session, run: CatalogueImportRun, config: ImportConfig) -> None:
    remaining = max(0, config.target_books - run.baseline_count)
    quotas = percentage_quotas(remaining, config.category_weights)
    for category, quota in quotas.items():
        limit = max(10, quota * run.shortlist_factor)
        session.execute(text("""
            DELETE FROM catalogue_stage_candidates
            WHERE run_id = :run_id AND category = :category AND source_id IN (
                SELECT source_id FROM catalogue_stage_candidates
                WHERE run_id = :run_id AND category = :category
                ORDER BY quality DESC, tie_hash, source_id OFFSET :limit
            )
        """), {"run_id": run.id, "category": category, "limit": limit})
    session.execute(text("""
        DELETE FROM catalogue_stage_editions e
        WHERE e.run_id = :run_id AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_candidates c
            WHERE c.run_id = e.run_id AND c.source_id = e.source_id
        ) AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_works w
            WHERE w.run_id = e.run_id AND w.source_id = e.source_id AND w.forced
        )
    """), {"run_id": run.id})
    session.execute(text("""
        DELETE FROM catalogue_stage_work_authors a
        WHERE a.run_id = :run_id AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_candidates c
            WHERE c.run_id = a.run_id AND c.source_id = a.source_id
        ) AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_works w
            WHERE w.run_id = a.run_id AND w.source_id = a.source_id AND w.forced
        )
    """), {"run_id": run.id})
    session.execute(text("""
        DELETE FROM catalogue_stage_works w
        WHERE w.run_id = :run_id AND NOT w.forced AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_candidates c
            WHERE c.run_id = w.run_id AND c.source_id = w.source_id
        )
    """), {"run_id": run.id})


def _write_authors(session: Session, run: CatalogueImportRun, records: list[dict]) -> None:
    normalized = [item for record in records if (item := clean.normalize_author(record))]
    authors = {item["source_id"]: item for item in normalized}
    _count_skipped(run, "authors", len(records) - len(normalized))
    if not authors:
        return
    needed = set(session.execute(select(CatalogueStageWorkAuthor.author_key).where(
        CatalogueStageWorkAuthor.run_id == run.id,
        CatalogueStageWorkAuthor.author_key.in_(authors),
    ).distinct()).scalars())
    if needed:
        statement = insert(CatalogueStageAuthor).values([
            {"run_id": run.id, "author_key": key, "name": authors[key]["name"]} for key in needed
        ])
        session.execute(statement.on_conflict_do_update(
            index_elements=["run_id", "author_key"], set_={"name": statement.excluded.name}
        ))


def _edition_signature(edition: dict) -> tuple[str, str, str]:
    return (
        next((item for item in edition["languages"] if item != "/languages/eng"),
             "/languages/eng" if "/languages/eng" in edition["languages"] else "unknown"),
        edition.get("physical_format") or "unknown",
        edition["isbns"][0]["isbn13"] if edition["isbns"] else "none",
    )


def _top_edition_candidates(editions: list[dict], limit: int = 10) -> list[dict]:
    unique = {item["edition_key"]: item for item in editions}
    ordered = sorted(unique.values(), key=lambda item: (-item["quality"], item["edition_key"]))
    first = ordered[:5]
    signatures = {_edition_signature(item) for item in first}
    varied = []
    for item in ordered[5:]:
        signature = _edition_signature(item)
        if signature not in signatures:
            varied.append(item)
            signatures.add(signature)
            if len(first) + len(varied) >= limit:
                break
    return first + varied


def select_useful_editions(editions: list[dict], limit: int = 5) -> list[dict]:
    """Choose one preferred edition then add distinct ISBN/language/format coverage."""
    remaining = sorted(editions, key=lambda item: (-item["quality"], item["edition_key"]))
    chosen: list[dict] = []
    covered_isbns: set[str] = set()
    covered_languages: set[str] = set()
    covered_formats: set[str] = set()
    while remaining and len(chosen) < limit:
        if not chosen:
            best = remaining.pop(0)
        else:
            best = max(remaining, key=lambda item: (
                len({isbn["isbn13"] for isbn in item["isbns"]} - covered_isbns),
                len(set(item["languages"]) - covered_languages),
                bool(item.get("physical_format") and item["physical_format"] not in covered_formats),
                item["quality"], -int(hashlib.sha256(item["edition_key"].encode()).hexdigest(), 16),
            ))
            remaining.remove(best)
        chosen.append(best)
        covered_isbns.update(item["isbn13"] for item in best["isbns"])
        covered_languages.update(best["languages"])
        if best.get("physical_format"):
            covered_formats.add(best["physical_format"])
    return chosen


def _write_editions(session: Session, run: CatalogueImportRun, records: list[dict]) -> None:
    candidates: dict[str, list[dict]] = defaultdict(list)
    skipped = 0
    for record in records:
        editions = clean.normalize_edition(record)
        if len(editions) > 1:
            _issue(session, run.id, "multi_work_edition", record.get("key"),
                   "Edition links to multiple works; no single Book association was guessed")
            skipped += 1
            continue
        if not editions:
            skipped += 1
        for edition in editions:
            candidates[edition["source_id"]].append(edition)
    _count_skipped(run, "editions", skipped)
    if not candidates:
        return
    aliases = _resolve_aliases(session, set(candidates))
    canonical: dict[str, list[dict]] = defaultdict(list)
    for source_id, values in candidates.items():
        if aliases[source_id]:
            for value in values:
                canonical[aliases[source_id]].append(value | {"source_id": aliases[source_id]})
    eligible = set(session.execute(select(CatalogueStageWork.source_id).where(
        CatalogueStageWork.run_id == run.id,
        CatalogueStageWork.source_id.in_(canonical),
    )).scalars())
    if not eligible:
        return
    existing = session.execute(select(CatalogueStageEdition).where(
        CatalogueStageEdition.run_id == run.id,
        CatalogueStageEdition.source_id.in_(eligible),
    )).scalars().all()
    for item in existing:
        canonical[item.source_id].append({
            "source_id": item.source_id, "edition_key": item.edition_key,
            "quality": item.quality, "isbns": item.isbns, "page_count": item.page_count,
            "languages": item.languages, "publication_date": item.publication_date,
            "publishers": item.publishers, "physical_format": item.physical_format,
            "cover_image_url": item.cover_image_url,
        })
    session.execute(delete(CatalogueStageEdition).where(
        CatalogueStageEdition.run_id == run.id, CatalogueStageEdition.source_id.in_(eligible)
    ))
    rows = [{"run_id": run.id, **item} for key in eligible for item in _top_edition_candidates(canonical[key])]
    for start in range(0, len(rows), 300):
        session.execute(insert(CatalogueStageEdition).values(rows[start:start + 300]))


def _write_hydrate(session: Session, run: CatalogueImportRun, records: list[dict]) -> None:
    works = {item["source_id"]: item for record in records if (item := clean.normalize_work(record))}
    if not works:
        return
    aliases = _resolve_aliases(session, set(works))
    canonical = {aliases[key]: work for key, work in works.items() if aliases[key]}
    eligible = set(session.execute(select(CatalogueStageWork.source_id).where(
        CatalogueStageWork.run_id == run.id,
        CatalogueStageWork.source_id.in_(canonical),
        or_(CatalogueStageWork.selected, CatalogueStageWork.forced),
    )).scalars())
    if eligible:
        session.execute(update(CatalogueStageWork), [
            {"run_id": run.id, "source_id": key, "description": canonical[key]["description"],
             "published_year": canonical[key]["published_year"],
             "cover_image_url": canonical[key]["cover_image_url"]}
            for key in eligible
        ])


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


def _stream_phase(factory: sessionmaker, config: ImportConfig, phase: str, url: str, following: str) -> None:
    for attempt in range(1, 4):
        with factory() as session:
            start = session.get(CatalogueImportRun, config.run_id).checkpoint_line
        batch: list[clean.DumpRow] = []
        batch_bytes = 0
        try:
            for row in clean.stream_dump(url, start_line=start, user_agent=config.user_agent):
                batch.append(row)
                batch_bytes += row.byte_size
                if len(batch) >= config.batch_size or batch_bytes >= 8_000_000:
                    with factory.begin() as session:
                        _write_dump_batch(session, config, phase, batch)
                    batch.clear()
                    batch_bytes = 0
            if batch:
                with factory.begin() as session:
                    _write_dump_batch(session, config, phase, batch)
            with factory.begin() as session:
                run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
                if phase == "works":
                    _prune_candidates(session, run, config)
                run.phase, run.checkpoint_line = following, 0
            return
        except TRANSIENT_ERRORS as exc:
            if attempt == 3:
                raise
            delay = min(30, 2 ** attempt)
            log.warning("%s stream failed (%s); replaying from checkpoint in %ds",
                        phase, type(exc).__name__, delay)
            time.sleep(delay)


def _mark_legacy_matches(session: Session, run: CatalogueImportRun, batch_size: int) -> None:
    cursor = ""
    while True:
        works = session.execute(select(CatalogueStageWork).where(
            CatalogueStageWork.run_id == run.id, CatalogueStageWork.source_id > cursor
        ).order_by(CatalogueStageWork.source_id).limit(batch_size)).scalars().all()
        if not works:
            return
        cursor = works[-1].source_id
        keys = {work.source_id for work in works}
        primary_rows = session.execute(
            select(CatalogueStageWorkAuthor.source_id, CatalogueStageAuthor.name)
            .join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            ))
            .where(CatalogueStageWorkAuthor.run_id == run.id,
                   CatalogueStageWorkAuthor.source_id.in_(keys),
                   CatalogueStageWorkAuthor.position == 0)
        ).all()
        primary = dict(primary_rows)
        titles = {work.title for work in works if work.source_id in primary}
        if not titles:
            continue
        legacy_rows = session.execute(
            select(Book.title, Author.name, func.count(func.distinct(Book.id)), func.min(Book.id))
            .join(book_authors, book_authors.c.book_id == Book.id)
            .join(Author, Author.id == book_authors.c.author_id)
            .where(Book.source_id.is_(None), Book.title.in_(titles))
            .group_by(Book.title, Author.name)
        ).all()
        by_title_author = {(title, name): (count, book_id)
                           for title, name, count, book_id in legacy_rows}
        unique_ids = {book_id for _, _, count, book_id in legacy_rows if count == 1}
        legacy_details = {book_id: (isbn, cover) for book_id, isbn, cover in session.execute(
            select(Book.id, Book.isbn13, Book.cover_image_url).where(Book.id.in_(unique_ids))
        )}
        # Check all staged works with these titles, including those outside this page.
        stage_rows = session.execute(
            select(CatalogueStageWork.title, CatalogueStageAuthor.name,
                   func.count(func.distinct(CatalogueStageWork.source_id)))
            .join(CatalogueStageWorkAuthor, and_(
                CatalogueStageWorkAuthor.run_id == CatalogueStageWork.run_id,
                CatalogueStageWorkAuthor.source_id == CatalogueStageWork.source_id,
                CatalogueStageWorkAuthor.position == 0,
            ))
            .join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            ))
            .where(CatalogueStageWork.run_id == run.id, CatalogueStageWork.title.in_(titles))
            .group_by(CatalogueStageWork.title, CatalogueStageAuthor.name)
        ).all()
        stage_counts = {(title, name): count for title, name, count in stage_rows}
        editions = session.execute(select(CatalogueStageEdition).where(
            CatalogueStageEdition.run_id == run.id,
            CatalogueStageEdition.source_id.in_(keys),
        )).scalars().all()
        edition_isbns: dict[str, set[str]] = defaultdict(set)
        for edition in editions:
            edition_isbns[edition.source_id].update(item["isbn13"] for item in edition.isbns)
        for work in works:
            author_name = primary.get(work.source_id)
            if not author_name:
                continue
            match_key = (work.title, author_name)
            candidate = by_title_author.get(match_key)
            if not candidate:
                continue
            candidate_count, book_id = candidate
            if candidate_count != 1 or stage_counts.get(match_key) != 1:
                _issue(session, run.id, "ambiguous_legacy_book", work.source_id, work.title)
                continue
            legacy_isbn, legacy_cover = legacy_details[book_id]
            if ((legacy_isbn and legacy_isbn in edition_isbns[work.source_id])
                    or (legacy_cover and legacy_cover == work.cover_image_url)):
                work.legacy_book_id = book_id
                work.forced = True
            else:
                _issue(session, run.id, "unmatched_legacy_book", work.source_id,
                       "Title/author matched, but ISBN or cover did not corroborate")


def _clear_unverified_forced(session: Session, run: CatalogueImportRun, batch_size: int) -> None:
    cursor = ""
    while True:
        works = session.execute(select(CatalogueStageWork).where(
            CatalogueStageWork.run_id == run.id,
            CatalogueStageWork.source_id > cursor,
            CatalogueStageWork.forced.is_(True),
            CatalogueStageWork.legacy_book_id.is_(None),
        ).order_by(CatalogueStageWork.source_id).limit(batch_size)).scalars().all()
        if not works:
            return
        cursor = works[-1].source_id
        keys = {work.source_id for work in works}
        existing = set(session.execute(select(Book.source_id).where(
            Book.source_id.in_(keys)
        )).scalars())
        redirected = set(_existing_book_aliases(session, keys).values())
        for work in works:
            if work.source_id not in existing and work.source_id not in redirected:
                work.forced = False


def _choose_category_batch(session: Session, run: CatalogueImportRun,
                           category: str | None, count: int) -> int:
    candidate = CatalogueStageCandidate
    work = CatalogueStageWork
    link = CatalogueStageWorkAuthor
    author = CatalogueStageAuthor
    author_count = CatalogueStageAuthorCount
    query = (select(work.source_id, link.author_key, candidate.category)
             .join(candidate, and_(candidate.run_id == work.run_id, candidate.source_id == work.source_id))
             .join(link, and_(link.run_id == work.run_id, link.source_id == work.source_id, link.position == 0))
             .join(author, and_(author.run_id == link.run_id, author.author_key == link.author_key))
             .outerjoin(author_count, and_(author_count.run_id == work.run_id,
                                           author_count.author_key == link.author_key))
             .where(work.run_id == run.id, work.selected.is_(False), work.forced.is_(False)))
    if category:
        query = query.where(candidate.category == category)
    author_turn = func.row_number().over(
        partition_by=link.author_key, order_by=(candidate.tie_hash, work.source_id)
    )
    query = query.order_by(candidate.quality.desc(),
                           func.coalesce(author_count.selected_count, 0) + author_turn,
                           candidate.tie_hash, work.source_id).limit(max(count * 3, 50))
    rows = query.with_only_columns(work.source_id, link.author_key, candidate.category).limit(max(count * 3, 50))
    # Preserve the ordering expression when materializing the bounded candidate page.
    chosen: dict[str, tuple[str, str]] = {}
    for source_id, author_key, allocation in session.execute(rows):
        if source_id not in chosen:
            chosen[source_id] = (author_key, allocation)
        if len(chosen) >= count:
            break
    if not chosen:
        return 0
    ids = list(chosen)
    allocation_value = (category if category else case(
        {source_id: value[1] for source_id, value in chosen.items()},
        value=CatalogueStageWork.source_id,
    ))
    session.execute(update(CatalogueStageWork).where(
        CatalogueStageWork.run_id == run.id,
        CatalogueStageWork.source_id.in_(ids),
    ).values(selected=True, allocation_category=allocation_value))
    author_counts = Counter(value[0] for value in chosen.values())
    statement = insert(CatalogueStageAuthorCount).values([
        {"run_id": run.id, "author_key": key, "selected_count": value}
        for key, value in author_counts.items()
    ])
    session.execute(statement.on_conflict_do_update(
        index_elements=["run_id", "author_key"],
        set_={"selected_count": CatalogueStageAuthorCount.selected_count + statement.excluded.selected_count},
    ))
    run.selected_count += len(ids)
    return len(ids)


def _select_works(session: Session, config: ImportConfig) -> None:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    if run.phase != "select":
        raise RuntimeError("Import phase changed during selection")
    _check_storage(session, run, config)
    _mark_legacy_matches(session, run, config.batch_size)
    _clear_unverified_forced(session, run, config.batch_size)
    remaining = max(0, config.target_books - run.baseline_count)
    quotas = percentage_quotas(remaining, config.category_weights)
    scarcity = {}
    for category in quotas:
        scarcity[category] = session.scalar(select(func.count()).select_from(
            CatalogueStageCandidate
        ).join(CatalogueStageWorkAuthor, and_(
            CatalogueStageWorkAuthor.run_id == CatalogueStageCandidate.run_id,
            CatalogueStageWorkAuthor.source_id == CatalogueStageCandidate.source_id,
            CatalogueStageWorkAuthor.position == 0,
        )).join(CatalogueStageAuthor, and_(
            CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
            CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
        )).where(CatalogueStageCandidate.run_id == run.id,
                CatalogueStageCandidate.category == category)) or 0
    selected_per_category = Counter()
    for category in sorted(quotas, key=lambda name: (scarcity[name], name)):
        while selected_per_category[category] < quotas[category]:
            count = _choose_category_batch(session, run, category,
                                           min(config.batch_size, quotas[category] - selected_per_category[category]))
            if not count:
                break
            selected_per_category[category] += count
    while run.selected_count < remaining:
        count = _choose_category_batch(session, run, None,
                                       min(config.batch_size, remaining - run.selected_count))
        if not count:
            break
    for category, quota in quotas.items():
        if selected_per_category[category] < quota:
            _issue(session, run.id, "category_shortfall", category,
                   f"Target {quota}, first allocation {selected_per_category[category]}; remainder redistributed")
    if run.selected_count < remaining:
        can_expand = any(run.shortlist_factor * max(10, quotas[name]) < seen
                         for name, seen in (run.category_seen_counts or {}).items())
        if can_expand:
            run.shortlist_factor *= 2
            run.phase, run.checkpoint_line, run.category_seen_counts = "works", 0, {}
            run.selected_count = 0
            run.report = {}
            session.execute(update(CatalogueStageWork).where(
                CatalogueStageWork.run_id == run.id
            ).values(selected=False, allocation_category=None))
            session.execute(delete(CatalogueStageAuthorCount).where(CatalogueStageAuthorCount.run_id == run.id))
            log.info("Shortlist exhausted; widening to factor=%d and replaying pinned dumps", run.shortlist_factor)
            return
        _issue(session, run.id, "target_shortfall", None,
               f"Only {run.selected_count} new works selected for {remaining} available slots")
    session.execute(text("""
        DELETE FROM catalogue_stage_candidates c
        WHERE c.run_id = :run_id AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_works w
            WHERE w.run_id = c.run_id AND w.source_id = c.source_id AND (w.selected OR w.forced)
        )
    """), {"run_id": run.id})
    _prune_candidates(session, run, config)
    run.phase, run.checkpoint_line = "hydrate", 0
    _check_storage(session, run, config)


def _backfill_authors(factory: sessionmaker, config: ImportConfig) -> None:
    """Reuse a legacy Author row only when all its linked works prove one identity."""
    cursor = 0
    while True:
        with factory.begin() as session:
            run = session.get(CatalogueImportRun, config.run_id)
            authors = session.execute(select(Author).where(
                Author.id > cursor, Author.source_id.is_(None)
            ).order_by(Author.id).limit(config.batch_size)).scalars().all()
            if not authors:
                return
            cursor = authors[-1].id
            ids = [author.id for author in authors]
            links = session.execute(select(
                book_authors.c.author_id, book_authors.c.book_id, Book.source_id
            ).join(Book, Book.id == book_authors.c.book_id).where(
                book_authors.c.author_id.in_(ids)
            )).all()
            linked_book_ids = {book_id for _, book_id, _ in links}
            legacy_work = dict(session.execute(select(
                CatalogueStageWork.legacy_book_id, CatalogueStageWork.source_id
            ).where(CatalogueStageWork.run_id == run.id,
                    CatalogueStageWork.legacy_book_id.in_(linked_book_ids))).all())
            work_ids = {source_id or legacy_work.get(book_id) for _, book_id, source_id in links}
            work_ids.discard(None)
            stage_links = session.execute(select(
                CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.author_key,
                CatalogueStageAuthor.name,
            ).join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            )).where(CatalogueStageWorkAuthor.run_id == run.id,
                    CatalogueStageWorkAuthor.source_id.in_(work_ids))).all()
            identities: dict[tuple[str, str], set[str]] = defaultdict(set)
            for source_id, author_key, name in stage_links:
                identities[(source_id, name)].add(author_key)
            linked: dict[int, list[str | None]] = defaultdict(list)
            for author_id, book_id, source_id in links:
                linked[author_id].append(source_id or legacy_work.get(book_id))
            existing_source_keys = set(session.execute(select(Author.source_id).where(
                Author.source_id.in_({key for keys in identities.values() for key in keys})
            )).scalars())
            for author in authors:
                works = linked.get(author.id, [])
                if not works or any(source_id is None for source_id in works):
                    continue
                candidate_keys = {key for source_id in works
                                  for key in identities.get((source_id, author.name), set())}
                if len(candidate_keys) != 1 or any(
                    identities.get((source_id, author.name), set()) != candidate_keys
                    for source_id in works
                ):
                    continue
                key = next(iter(candidate_keys))
                if key not in existing_source_keys:
                    author.source_id = key
                    existing_source_keys.add(key)


def _set_work_value(session: Session, run: CatalogueImportRun, book: Book,
                    field_name: str, value: object, bit: int, source_id: str) -> None:
    if value is None:
        return
    old = getattr(book, field_name)
    if old is None or book.source_managed_fields & bit:
        setattr(book, field_name, value)
        book.source_managed_fields |= bit
    elif old != value:
        _issue(session, run.id, "legacy_field_conflict", source_id,
               f"Preserved existing {field_name}; Open Library has a different value")


def _merge_batch(session: Session, config: ImportConfig) -> int:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    _check_storage(session, run, config)
    query = select(CatalogueStageWork).where(
        CatalogueStageWork.run_id == run.id,
        or_(CatalogueStageWork.selected, CatalogueStageWork.forced),
    )
    if run.merge_cursor:
        query = query.where(CatalogueStageWork.source_id > run.merge_cursor)
    works = session.execute(query.order_by(CatalogueStageWork.source_id).limit(config.batch_size)).scalars().all()
    if not works:
        run.phase = "cleanup"
        return 0
    source_ids = {work.source_id for work in works}
    author_rows = session.execute(select(
        CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.author_key,
        CatalogueStageAuthor.name,
    ).outerjoin(CatalogueStageAuthor, and_(
        CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
        CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
    )).where(CatalogueStageWorkAuthor.run_id == run.id,
            CatalogueStageWorkAuthor.source_id.in_(source_ids))).all()
    authors_by_work: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for source_id, author_key, name in author_rows:
        if name:
            authors_by_work[source_id].append((author_key, name))
    staged_editions = session.execute(select(CatalogueStageEdition).where(
        CatalogueStageEdition.run_id == run.id,
        CatalogueStageEdition.source_id.in_(source_ids),
    )).scalars().all()
    editions_by_work: dict[str, list[dict]] = defaultdict(list)
    for edition in staged_editions:
        editions_by_work[edition.source_id].append({
            "edition_key": edition.edition_key, "quality": edition.quality,
            "isbns": edition.isbns, "page_count": edition.page_count,
            "languages": edition.languages, "publication_date": edition.publication_date,
            "publishers": edition.publishers, "physical_format": edition.physical_format,
            "cover_image_url": edition.cover_image_url,
        })
    aliases = list(_existing_book_aliases(session, source_ids).items())
    old_by_new: dict[str, list[str]] = defaultdict(list)
    for old, new in aliases:
        old_by_new[new].append(old)
    potential_sources = source_ids | {old for old, _ in aliases}
    existing_books = session.execute(select(Book).where(or_(
        Book.source_id.in_(potential_sources),
        Book.id.in_([work.legacy_book_id for work in works if work.legacy_book_id]),
    ))).scalars().all()
    books_by_source = {book.source_id: book for book in existing_books if book.source_id}
    books_by_id = {book.id: book for book in existing_books}
    book_for_work: dict[str, Book] = {}
    for work in works:
        candidates = {book.id: book for source in [work.source_id, *old_by_new[work.source_id]]
                      if (book := books_by_source.get(source))}
        if work.legacy_book_id and work.legacy_book_id in books_by_id:
            candidates[work.legacy_book_id] = books_by_id[work.legacy_book_id]
        if len(candidates) > 1:
            _issue(session, run.id, "redirect_book_conflict", work.source_id,
                   "Two existing Book IDs resolve to the same Open Library work; no merge was guessed")
            continue
        book = next(iter(candidates.values())) if candidates else None
        if book is None and not authors_by_work[work.source_id]:
            _issue(session, run.id, "missing_author", work.source_id, "No resolved author; new Book skipped")
            continue
        if book is None:
            book = Book(title=work.title, source_id=work.source_id,
                        source_managed_fields=FIELD_TITLE)
            session.add(book)
        elif book.source_id != work.source_id:
            book.source_id = work.source_id
        for field_name, value, bit in (
            ("title", work.title, FIELD_TITLE),
            ("description", work.description, FIELD_DESCRIPTION),
            ("published_year", work.published_year, FIELD_YEAR),
            ("cover_image_url", work.cover_image_url, FIELD_COVER),
        ):
            _set_work_value(session, run, book, field_name, value, bit, work.source_id)
        book_for_work[work.source_id] = book
    session.flush()
    if not book_for_work:
        run.merge_cursor = works[-1].source_id
        return len(works)

    author_keys = {key for source_id in book_for_work for key, _ in authors_by_work[source_id]}
    existing_authors = {author.source_id: author for author in session.execute(
        select(Author).where(Author.source_id.in_(author_keys))
    ).scalars()}
    names_by_key = {key: name for source_id in book_for_work for key, name in authors_by_work[source_id]}
    for key in author_keys:
        if key not in existing_authors:
            author = Author(source_id=key, name=names_by_key[key], source_managed_name=True)
            session.add(author)
            existing_authors[key] = author
        elif existing_authors[key].source_managed_name:
            existing_authors[key].name = names_by_key[key]
    tag_specs = {(tag["name"].casefold(), tag["name"], tag["type"])
                 for work in works if work.source_id in book_for_work for tag in work.tags}
    tags_by_key = {tag.name.casefold(): tag for tag in session.execute(select(Tag).where(
        func.lower(Tag.name).in_({item[0] for item in tag_specs})
    )).scalars()}
    original = set(clean.SUBJECT_ALIASES) - {
        "science", "technology", "business", "art", "music", "cooking", "travel",
        "health", "nature", "sports", "psychology", "religion", "politics", "education",
    }
    for key, name, tag_type in sorted(tag_specs):
        if key not in tags_by_key:
            tag = Tag(name=name, type=TagType(tag_type), visible_in_v2=name in original)
            session.add(tag)
            tags_by_key[key] = tag
        elif tags_by_key[key].type != TagType(tag_type):
            _issue(session, run.id, "tag_type_conflict", None,
                   f"Existing tag {name} has type {tags_by_key[key].type}; import wanted {tag_type}")
    session.flush()

    book_ids = [book.id for book in book_for_work.values()]
    session.execute(delete(book_authors).where(book_authors.c.book_id.in_(book_ids),
                                             book_authors.c.source_managed.is_(True)))
    session.execute(delete(book_tags).where(book_tags.c.book_id.in_(book_ids),
                                          book_tags.c.source_managed.is_(True)))
    author_links = list({(book_for_work[source_id].id, existing_authors[key].id):
                         {"book_id": book_for_work[source_id].id, "author_id": existing_authors[key].id,
                          "source_managed": True}
                         for source_id in book_for_work for key, _ in authors_by_work[source_id]}.values())
    tag_links = list({(book_for_work[work.source_id].id, tags_by_key[tag["name"].casefold()].id):
                      {"book_id": book_for_work[work.source_id].id,
                       "tag_id": tags_by_key[tag["name"].casefold()].id, "source_managed": True}
                      for work in works if work.source_id in book_for_work for tag in work.tags
                      if tags_by_key[tag["name"].casefold()].type == TagType(tag["type"])}.values())
    for rows, table in ((author_links, book_authors), (tag_links, book_tags)):
        for start in range(0, len(rows), 500):
            session.execute(insert(table).values(rows[start:start + 500]).on_conflict_do_nothing())

    # Load, prune, and refresh all editions for this batch with set-based queries.
    selected_by_work = {key: select_useful_editions(editions_by_work[key]) for key in book_for_work}
    chosen_keys = {item["edition_key"] for items in selected_by_work.values() for item in items}
    old_editions = session.execute(select(Edition).where(Edition.book_id.in_(book_ids))).scalars().all()
    old_ids = [edition.id for edition in old_editions]
    for book in book_for_work.values():
        book.preferred_edition_id = None
    session.flush()
    if old_ids:
        session.execute(delete(EditionISBN).where(EditionISBN.edition_id.in_(old_ids)))
    stale_ids = [edition.id for edition in old_editions if edition.source_id not in chosen_keys]
    if stale_ids:
        session.execute(delete(Edition).where(Edition.id.in_(stale_ids)))
    persisted: dict[str, Edition] = {edition.source_id: edition for edition in old_editions
                                     if edition.source_id in chosen_keys}
    for source_id, items in selected_by_work.items():
        for item in items:
            edition = persisted.get(item["edition_key"])
            if edition is None:
                edition = Edition(book_id=book_for_work[source_id].id, source_id=item["edition_key"])
                session.add(edition)
            edition.page_count = item["page_count"]
            edition.languages = item["languages"]
            edition.publication_date = item["publication_date"]
            edition.publishers = item["publishers"]
            edition.physical_format = item["physical_format"]
            edition.cover_image_url = item["cover_image_url"]
            persisted[item["edition_key"]] = edition
    session.flush()
    isbn_rows = [{"edition_id": persisted[item["edition_key"]].id, **isbn}
                 for items in selected_by_work.values() for item in items for isbn in item["isbns"]]
    for start in range(0, len(isbn_rows), 500):
        session.execute(insert(EditionISBN).values(isbn_rows[start:start + 500]).on_conflict_do_nothing())
    for source_id, book in book_for_work.items():
        items = selected_by_work[source_id]
        if not items:
            continue
        preferred = items[0]
        preferred_isbn = next((item["isbn13"] for item in preferred["isbns"]
                               if not item["derived_from_isbn10"]), None)
        preferred_isbn = preferred_isbn or next((item["isbn13"] for item in preferred["isbns"]), None)
        _set_work_value(session, run, book, "isbn13", preferred_isbn, FIELD_ISBN, source_id)
        _set_work_value(session, run, book, "page_count", preferred["page_count"], FIELD_PAGES, source_id)
        if not book.cover_image_url:
            _set_work_value(session, run, book, "cover_image_url",
                            preferred["cover_image_url"], FIELD_COVER, source_id)
        if book.isbn13 == preferred_isbn and book.page_count == preferred["page_count"]:
            book.preferred_edition_id = persisted[preferred["edition_key"]].id
        else:
            _issue(session, run.id, "preferred_edition_conflict", source_id,
                   "Legacy ISBN/page values were preserved; preferred edition link remains pending")
    run.merged_count += len(book_for_work)
    run.merge_cursor = works[-1].source_id
    _check_storage(session, run, config)
    log.info("merge cursor=%s books=%d", run.merge_cursor, run.merged_count)
    return len(works)


def _release_staging(session: Session, run: CatalogueImportRun) -> None:
    session.execute(text("""
        TRUNCATE catalogue_stage_author_counts, catalogue_stage_candidates,
                 catalogue_stage_work_authors, catalogue_stage_editions,
                 catalogue_stage_authors, catalogue_stage_works
    """))
    run.checkpoint_line = 0


def _build_report(session: Session, run: CatalogueImportRun) -> dict:
    book_total = session.scalar(select(func.count()).select_from(Book)) or 0
    selected = dict(session.execute(select(
        CatalogueStageWork.allocation_category, func.count()
    ).where(CatalogueStageWork.run_id == run.id,
            CatalogueStageWork.selected.is_(True)).group_by(
                CatalogueStageWork.allocation_category
    )).all())
    sizes = dict(session.execute(text("""
        SELECT relname, pg_total_relation_size(oid)
        FROM pg_class
        WHERE relname IN ('books', 'authors', 'tags', 'book_authors', 'book_tags',
                          'editions', 'edition_isbns') AND relkind = 'r'
    """)).all())
    indexes = dict(session.execute(text("""
        SELECT indexrelname, pg_relation_size(indexrelid)
        FROM pg_stat_user_indexes
        WHERE relname IN ('books', 'authors', 'tags', 'book_authors', 'book_tags',
                          'editions', 'edition_isbns')
    """)).all())
    return {
        "skipped_by_phase": dict((run.report or {}).get("skipped_by_phase", {})),
        "target_books": run.target_books,
        "baseline_books": run.baseline_count,
        "total_books": book_total,
        "source_identified_books": session.scalar(select(func.count()).select_from(Book).where(
            Book.source_id.is_not(None)
        )) or 0,
        "allocation_by_category": {key: value for key, value in selected.items() if key},
        "books_with_cover": session.scalar(select(func.count()).select_from(Book).where(
            Book.cover_image_url.is_not(None)
        )) or 0,
        "books_with_description": session.scalar(select(func.count()).select_from(Book).where(
            Book.description.is_not(None)
        )) or 0,
        "books_with_isbn13": session.scalar(select(func.count()).select_from(Book).where(
            Book.isbn13.is_not(None)
        )) or 0,
        "author_count": session.scalar(select(func.count()).select_from(Author)) or 0,
        "edition_count": session.scalar(select(func.count()).select_from(Edition)) or 0,
        "database_mb": float(session.execute(text(
            "SELECT pg_database_size(current_database()) / 1048576.0"
        )).scalar_one()),
        "peak_database_mb": run.peak_database_mb,
        "peak_staging_mb": run.peak_staging_mb,
        "table_total_bytes": sizes,
        "index_bytes": indexes,
        "issues_by_code": dict(session.execute(select(
            CatalogueImportIssue.code, func.count()
        ).where(CatalogueImportIssue.run_id == run.id).group_by(
            CatalogueImportIssue.code
        )).all()),
    }


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


def run_import(config: ImportConfig, *, one_phase: bool = False) -> str:
    config.validate()
    engine = create_engine(config.database_url, pool_pre_ping=True)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with engine.connect() as lock_connection:
            if not lock_connection.execute(text(
                "SELECT pg_try_advisory_lock(hashtext('bookvane_catalogue_import'))"
            )).scalar_one():
                raise RuntimeError("Another catalogue import is already running")
            try:
                with factory.begin() as session:
                    _get_run(session, config)
                while True:
                    with factory() as session:
                        phase = session.get(CatalogueImportRun, config.run_id).phase
                    if phase == "complete":
                        return phase
                    if phase == "paused_capacity":
                        raise RuntimeError("Capacity pause requires a reviewed replay")
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
                            _stream_phase(factory, config, phase, urls[phase], next_phase[phase])
                        elif phase == "select":
                            with factory.begin() as session:
                                _select_works(session, config)
                        elif phase == "merge":
                            with factory() as session:
                                merge_cursor = session.get(CatalogueImportRun, config.run_id).merge_cursor
                            if merge_cursor is None:
                                _backfill_authors(factory, config)
                            while True:
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
                lock_connection.execute(text(
                    "SELECT pg_advisory_unlock(hashtext('bookvane_catalogue_import'))"
                ))
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--works-url", required=True)
    parser.add_argument("--authors-url", required=True)
    parser.add_argument("--editions-url", required=True)
    parser.add_argument("--redirects-url", required=True)
    parser.add_argument("--deletes-url", required=True)
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--target-books", type=int, default=50000)
    parser.add_argument("--weights-json", default=None,
                        help="JSON map of category percentage weights; defaults to equal weights")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-database-mb", type=int, default=400)
    parser.add_argument("--one-phase", action="store_true")
    parser.add_argument("--restart-paused", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    database_url = os.getenv("CATALOGUE_DATABASE_URL")
    if not database_url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    weights = json.loads(args.weights_json) if args.weights_json else equal_percentage_weights()
    result = run_import(ImportConfig(
        run_id=args.run_id, works_url=args.works_url, authors_url=args.authors_url,
        editions_url=args.editions_url, redirects_url=args.redirects_url,
        deletes_url=args.deletes_url, database_url=database_url, mode=args.mode,
        user_agent=os.getenv("CATALOGUE_USER_AGENT", ""), target_books=args.target_books,
        category_weights=weights, batch_size=args.batch_size,
        max_database_mb=args.max_database_mb, restart_paused=args.restart_paused,
    ), one_phase=args.one_phase)
    log.info("Import %s phase=%s", args.run_id, result)


if __name__ == "__main__":
    main()
