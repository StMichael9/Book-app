"""Staging responsibilities for the bounded catalogue importer."""

from __future__ import annotations

import hashlib
from collections import defaultdict

from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from data import clean
from data.config import ImportConfig, percentage_quotas
from data.reporting import _count_skipped, _issue
from models import (
    Book, CatalogueImportRun, CatalogueSourceAlias, CatalogueStageAuthor,
    CatalogueStageCandidate, CatalogueStageEdition, CatalogueStageWork,
    CatalogueStageWorkAuthor,
)


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
