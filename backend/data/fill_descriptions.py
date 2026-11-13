"""Fill missing book descriptions from Open Library (T56). Dry run by default; every write is logged and can be undone.

    python -m data.fill_descriptions --mode production --dry-run [--samples 50] [--limit N] [--report FILE]
    python -m data.fill_descriptions --mode production --apply   [--tag TAG] [--batch 200] [--limit N] [--report FILE]
    python -m data.fill_descriptions --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. A listed book with no description and an Open Library work key gets the work's description, or
its preferred edition's when the work has none we can use. The text goes through the same rules every new and cleaned book
gets (`data.clean.description`, then `data.cleaner.clean_description`: English prose only, no seller or edition text), so
nothing the cleaner removed comes back. Open Library data is CC0, so it can be stored; the source is never shown to readers.

Database work is small on purpose: one read of the candidates, then nothing while Open Library is being asked, then one write
per batch (plus its log rows). A re-run only sees books that are still empty, so an interrupted run resumes by running again.
A dry run writes nothing. Reports carry counts and sample titles for the owner; nothing here is meant for a public log.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Integer, Text, column, create_engine, func, insert, or_, select, text, update, values
from sqlalchemy.orm import Session

from data import clean, cleaner
from models import Book, CatalogueImportIssue, Edition
from services.catalogue_resolver import OpenLibraryUnavailable, ol_get

CODE = "fill_description"
BATCH = 200
MAX_CONSECUTIVE_UNAVAILABLE = 25  # Open Library is down or throttling us: stop and report, never hammer it
TAG = re.compile(r"[A-Za-z0-9_.-]{1,40}")
REASONS = ("no_work", "no_description", "rejected_clean", "rejected_cleaner", "unavailable")


@dataclass
class Candidate:
    book_id: int
    work_key: str
    edition_key: str | None
    old: str | None  # None or whitespace only: kept so the log holds the exact old value


@dataclass
class Outcome:
    book_id: int
    work_key: str
    text: str | None = None
    source: str | None = None  # "work" | "edition"
    reason: str | None = None


def _blank(raw) -> bool:
    value = raw.get("value") if isinstance(raw, dict) else raw
    return value is None or (isinstance(value, str) and not value.strip())


def judge(raw) -> tuple[str | None, str | None]:
    """(text, reason): the description after the shared rules, or why it was refused."""
    if _blank(raw):
        return None, "no_description"
    parsed = clean.description(raw)
    if parsed is None:
        return None, "rejected_clean"
    final = cleaner.clean_description(parsed)
    return (final, None) if final else (None, "rejected_cleaner")


def resolve(candidate: Candidate, fetch=ol_get) -> Outcome:
    """The work's description, else the edition's; at most two Open Library requests, no database access."""
    reasons = []
    try:
        work = fetch(f"{candidate.work_key}.json")
        if work is not None:
            text_, reason = judge(work.get("description"))
            if text_:
                return Outcome(candidate.book_id, candidate.work_key, text_, "work")
            reasons.append(reason)
        else:
            reasons.append("no_work")
        if candidate.edition_key:
            edition = fetch(f"{candidate.edition_key}.json")
            if edition is not None:
                text_, reason = judge(edition.get("description"))
                if text_:
                    return Outcome(candidate.book_id, candidate.work_key, text_, "edition")
                reasons.append(reason)
    except OpenLibraryUnavailable:
        return Outcome(candidate.book_id, candidate.work_key, reason="unavailable")
    for reason in ("rejected_cleaner", "rejected_clean", "no_description", "no_work"):  # the most telling reason wins
        if reason in reasons:
            return Outcome(candidate.book_id, candidate.work_key, reason=reason)
    return Outcome(candidate.book_id, candidate.work_key, reason="no_description")


def _empty():
    return or_(Book.description.is_(None), func.btrim(Book.description) == "")


def candidates(db: Session, limit: int | None = None) -> list[Candidate]:
    """One read: listed books with no description that have an Open Library work key (id, keys and the blank old value only)."""
    query = (select(Book.id, Book.source_id, Edition.source_id, Book.description)
             .outerjoin(Edition, Edition.id == Book.preferred_edition_id)
             .where(Book.is_listed.is_(True), Book.source_id.like("/works/%"), _empty()).order_by(Book.id))
    if limit:
        query = query.limit(limit)
    return [Candidate(book_id, work_key, edition_key, old) for book_id, work_key, edition_key, old in db.execute(query).all()]


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _write(db: Session, fills: list[tuple[Candidate, Outcome]], tag: str) -> int:
    """One UPDATE for the batch (only books that are still empty) and one INSERT for their log rows. Returns rows written."""
    data = values(column("id", Integer), column("d", Text), name="v").data([(c.book_id, o.text) for c, o in fills])
    updated = set(db.scalars(update(Book).where(Book.id == data.c.id, _empty()).values(description=data.c.d)
                             .returning(Book.id)).all())
    logged = [(c, o) for c, o in fills if c.book_id in updated]
    if logged:
        db.execute(insert(CatalogueImportIssue), [{"run_id": None, "code": CODE, "source_id": c.work_key, "detail": json.dumps({
            "tag": tag, "book_id": c.book_id, "source": o.source, "before": {"description": c.old},
            "after_chars": len(o.text), "after_sha256": _sha(o.text)}, ensure_ascii=False, separators=(",", ":"))}
            for c, o in logged])
    db.commit()
    return len(updated) + len(logged)


def run(db: Session, *, apply: bool = False, tag: str | None = None, samples: int = 50, limit: int | None = None,
        batch: int = BATCH, fetch=ol_get, seed: int = 2026, progress=None) -> dict:
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    pending = candidates(db, limit)
    db.rollback()  # end the read transaction: the database is not held open while Open Library is asked
    counts, filled, written, aborted, streak = Counter(candidates=len(pending)), [], 0, None, 0
    rows_read = len(pending)
    for start in range(0, len(pending), batch):
        fills = []
        for candidate in pending[start:start + batch]:
            outcome = resolve(candidate, fetch)
            counts["fetched"] += 1
            streak = streak + 1 if outcome.reason == "unavailable" else 0
            if outcome.text:
                counts["fillable"] += 1
                counts[f"from_{outcome.source}"] += 1
                fills.append((candidate, outcome))
                filled.append((candidate, outcome))
            else:
                counts[f"skipped_{outcome.reason}"] += 1
            if streak >= MAX_CONSECUTIVE_UNAVAILABLE:
                aborted = "open_library_unavailable"
                break
        if apply and fills:
            written += _write(db, fills, tag)
        if progress:
            progress(counts)
        if aborted:
            break
    picks = random.Random(seed).sample(filled, min(samples, len(filled)))
    titles = {}
    if picks:
        titles = dict(db.execute(select(Book.id, Book.title).where(Book.id.in_([c.book_id for c, _ in picks]))).all())
        rows_read += len(titles)
        db.rollback()
    return {"tag": tag, "applied": apply, "aborted": aborted, "counts": dict(counts),
            "db": {"rows_read": rows_read, "rows_written": written},
            "samples": [{"book_id": c.book_id, "title": titles.get(c.book_id), "source": o.source, "text": o.text[:200]}
                        for c, o in picks]}


def undo(db: Session, tag: str) -> dict:
    """Put back the old (empty) value of every description filled under this tag, unless it has been edited since."""
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    restored = skipped = 0
    issues = db.scalars(select(CatalogueImportIssue).where(CatalogueImportIssue.code == CODE,
        CatalogueImportIssue.detail.like(f'%"tag":"{tag}"%')).order_by(CatalogueImportIssue.id)).all()
    for issue in issues:
        data = json.loads(issue.detail)
        if data.get("tag") != tag:  # LIKE treats "_" as a wildcard: confirm the exact tag
            continue
        result = db.execute(update(Book).where(Book.id == data["book_id"],
            text("encode(sha256(convert_to(books.description, 'UTF8')), 'hex') = :sha").bindparams(sha=data["after_sha256"]))
            .values(description=data["before"]["description"]))
        restored += result.rowcount
        skipped += 1 - result.rowcount
    db.commit()
    return {"restored": restored, "skipped_changed_since": skipped}


def markdown(report: dict) -> str:
    c = report["counts"]
    lines = [f"# Fill missing descriptions ({'applied' if report['applied'] else 'dry run'}), tag `{report['tag']}`", "",
             f"- Candidates (listed, no description, Open Library work key): {c.get('candidates', 0)}",
             f"- Asked Open Library about: {c.get('fetched', 0)}",
             f"- Fillable: {c.get('fillable', 0)} (from the work {c.get('from_work', 0)}, from the edition {c.get('from_edition', 0)})"]
    for reason in REASONS:
        lines.append(f"- Skipped, {reason}: {c.get(f'skipped_{reason}', 0)}")
    lines += [f"- Database rows read: {report['db']['rows_read']}, written: {report['db']['rows_written']}"]
    if report["aborted"]:
        lines += ["", f"**Stopped early: {report['aborted']}.** Run it again to continue; finished batches are already saved."]
    lines += ["", f"## Samples ({len(report['samples'])})", ""]
    for item in report["samples"]:
        lines.append(f"- {item['book_id']} {item['title']!r} ({item['source']}): {item['text']!r}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--undo", metavar="TAG")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--tag")
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--batch", type=int, default=BATCH)
    parser.add_argument("--report", help="write the Markdown report to this file")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    from data.config import validate_database_target
    from database import settings
    validate_database_target(url, args.mode)
    if "@" not in (settings.catalogue_user_agent or ""):
        parser.error("CATALOGUE_USER_AGENT must carry a contact address for Open Library")
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            if args.undo:
                print(json.dumps(undo(db, args.undo)))
                return
            report = run(db, apply=args.apply, tag=args.tag, samples=args.samples, limit=args.limit, batch=args.batch,
                         progress=lambda counts: print(f"fetched {counts['fetched']} of {counts['candidates']}, "
                                                       f"fillable {counts['fillable']}", flush=True))
            body = markdown(report)
            if args.report:
                with open(args.report, "w", encoding="utf-8") as handle:
                    handle.write(body)
            print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
