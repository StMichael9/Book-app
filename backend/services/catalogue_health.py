"""Catalogue health (T49): coverage of a fixed benchmark list, search quality, lookup and import figures, size.

Counts and percentages only: nothing here names a reader, a search text or a private title, because the weekly report is
published in a public repository's job summary.
"""
from __future__ import annotations

import csv
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from models import Book, CatalogueImportIssue, CatalogueLookup, EventCount

BENCHMARK = Path(__file__).resolve().parents[1] / "data" / "benchmark_titles.csv"
LIMITS = {"coverage_min": 90.0, "empty_search_max": 15.0, "import_match_min": 70.0, "database_max_mb": 700.0}
ENQUEUE_MAX = 500


def benchmark_titles() -> list[dict]:
    with open(BENCHMARK, encoding="utf-8", newline="") as handle:
        return [row for row in csv.DictReader(handle) if row.get("title") and row.get("author")]


def surname(name: str) -> str:
    tokens = re.findall(r"[^\W_]+", (name or "").casefold())
    return tokens[-1] if tokens else ""


def coverage(db: Session) -> dict:
    """Share of the benchmark titles found in the catalogue (a listed book with the same normalised title and an author with
    the same surname). One statement; the same search key the public search uses."""
    items = benchmark_titles()
    rows = db.execute(text("""
        SELECT t.ord FROM unnest(CAST(:titles AS text[]), CAST(:surnames AS text[])) WITH ORDINALITY AS t(title, surname, ord)
        WHERE EXISTS (
            SELECT 1 FROM books b JOIN book_authors ba ON ba.book_id = b.id JOIN authors a ON a.id = ba.author_id
            WHERE b.is_listed AND b.title_key = bookvane_search_key(t.title)
              AND lower(a.name) LIKE '%' || t.surname)
    """), {"titles": [i["title"] for i in items], "surnames": [surname(i["author"]) for i in items]}).scalars().all()
    found = len(rows)
    return {"benchmark": len(items), "found": found, "percent": round(100.0 * found / len(items), 1) if items else None,
            "missing_ordinals": sorted(set(range(1, len(items) + 1)) - set(rows))}


def _events(db: Session, since) -> dict[str, int]:
    return dict(db.execute(select(EventCount.name, func.sum(EventCount.count)).where(EventCount.day >= since)
                           .group_by(EventCount.name)).all())


def catalogue_block(db: Session, days: int) -> dict:
    since = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    events = _events(db, since)
    runs, empty = events.get("search_run", 0), events.get("search_empty", 0)
    lookups = dict(db.execute(select(CatalogueLookup.status, func.count()).group_by(CatalogueLookup.status)).all())
    rejections = dict(db.execute(select(CatalogueImportIssue.detail, func.count()).where(
        CatalogueImportIssue.code == "gate_reject").group_by(CatalogueImportIssue.detail)).all())
    matched, total = db.execute(text("""
        SELECT coalesce(sum((summary->'counts'->>'matched')::int), 0),
               coalesce(sum((summary->'counts'->>'total')::int - coalesce((summary->'counts'->>'pending')::int, 0)), 0)
        FROM library_import_runs
        WHERE created_at >= now() - make_interval(days => :days) AND summary ? 'counts'
    """), {"days": days}).one()
    book_counts = db.execute(text("""
        SELECT count(*) FILTER (WHERE (SELECT count(*) FROM book_authors ba WHERE ba.book_id = b.id) > 3),
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
                                                  WHERE bt.book_id = b.id AND t.type::text = 'genre')),
               count(*) FILTER (WHERE b.cover_image_url IS NULL OR btrim(b.cover_image_url) = ''),
               count(*) FILTER (WHERE b.quality_score IS NOT NULL AND b.quality_score < 60),
               count(*) FILTER (WHERE b.quality_score IS NULL),
               count(*)
        FROM books b
    """)).one()
    size = float(db.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
    cover = coverage(db)
    empty_rate = round(100.0 * empty / runs, 1) if runs else None
    match_rate = round(100.0 * matched / total, 1) if total else None
    block = {
        "coverage": {key: cover[key] for key in ("benchmark", "found", "percent")},
        "searches": {"runs": runs, "empty": empty, "empty_percent": empty_rate},
        "lookups": lookups, "gate_rejections": rejections,
        "imports": {"rows": int(total), "matched": int(matched), "match_percent": match_rate},
        "books": {"total": book_counts[5], "more_than_3_authors": book_counts[0], "no_genre": book_counts[1],
                  "no_cover": book_counts[2], "low_score": book_counts[3], "unscored": book_counts[4]},
        "database_mb": round(size, 1), "limits": LIMITS,
    }
    block["alerts"] = alerts(block)
    return block


def alerts(block: dict) -> list[str]:
    """Plain sentences for each limit that is crossed (counts and percentages only)."""
    found = []
    percent = block["coverage"]["percent"]
    if percent is not None and percent < LIMITS["coverage_min"]:
        found.append(f"Benchmark coverage is {percent}% (limit {LIMITS['coverage_min']}%).")
    empty = block["searches"]["empty_percent"]
    if empty is not None and empty > LIMITS["empty_search_max"]:
        found.append(f"Empty searches are {empty}% (limit {LIMITS['empty_search_max']}%).")
    match = block["imports"]["match_percent"]
    if match is not None and match < LIMITS["import_match_min"]:
        found.append(f"Import match rate is {match}% (limit {LIMITS['import_match_min']}%).")
    if block["database_mb"] > LIMITS["database_max_mb"]:
        found.append(f"The database is {block['database_mb']} MB (limit {LIMITS['database_max_mb']:.0f} MB).")
    return found


def enqueue_missing(db: Session, items: list[dict]) -> dict:
    """Queue titles the weekly benchmark did not find for the lookup worker. Anonymous: no reader is attached."""
    from services import catalogue_queue
    queued = skipped = 0
    for item in items[:ENQUEUE_MAX]:
        title, author = (item.get("title") or "").strip(), (item.get("author") or "").strip()
        if not title or not author or len(title) > 300 or len(author) > 300:
            skipped += 1
            continue
        if catalogue_queue.enqueue(db, isbn=None, title=title, author=author, user_book_id=None) is not None:
            queued += 1
    db.commit()
    if queued:
        catalogue_queue.wake()
    return {"queued": queued, "skipped": skipped, "ignored": max(0, len(items) - ENQUEUE_MAX)}


SUPPORT_INBOX = "support@bookvane.me"


def send_alert(lines: list[str]) -> bool:
    """One short email to the support inbox through the existing mailer. False when no mailer is configured."""
    from database import settings
    import httpx
    clean_lines = [" ".join(str(line).split())[:200] for line in lines if str(line).strip()][:10]
    if not clean_lines or not (settings.resend_api_key and settings.password_reset_from):
        return False
    body = "<p>The weekly catalogue check found:</p><ul>" + "".join(f"<li>{line}</li>" for line in clean_lines) + "</ul>"
    response = httpx.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                          json={"from": settings.password_reset_from, "to": [SUPPORT_INBOX],
                                "subject": "Bookvane catalogue: a limit was crossed", "html": body}, timeout=10)
    response.raise_for_status()
    return True
