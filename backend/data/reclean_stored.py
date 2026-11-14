"""Re-clean the descriptions we already store, with the current rules and no source swap (T59). Dry run by default; undoable.

    python -m data.reclean_stored --mode production --dry-run [--samples 50] [--report FILE]
    python -m data.reclean_stored --mode production --apply   [--tag TAG] [--report FILE]
    python -m data.reclean_stored --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. No dump and no Open Library: it takes the stored text of each listed book and runs
`data.cleaner.clean_description` on it. That covers
  - descriptions the T58 job leaves alone because the importer did not write them (`source_managed_fields` description bit not
    set: older rows and rows from the catalogue backfill, the edition backfill and the T56 fill; no route lets anyone edit a
    description by hand), whatever markup they still carry;
  - text that is not a description: one with an email address (privacy), a reader's review ("Title of Review", "My rating", ...),
    or a contents list (mostly "Title / Author" pairs, or a "Contents:" block).
Only texts that could change are read (a database-side filter), then one UPDATE and one log INSERT per batch of 500. The guard
is the same as T58's: a book is written only if it still holds the text we read. Logs use T58's code and format, so
`reclean_descriptions --undo TAG` works too; a description dropped for an email address is logged WITHOUT its old text (the
address must not be kept anywhere) and cannot be restored. Reports mask email addresses.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import create_engine, func, or_, select
from sqlalchemy.orm import sessionmaker

from data import cleaner
from data.merge import FIELD_DESCRIPTION
from data.reclean_descriptions import BATCH, TAG, Change, _md5, _write, undo
from models import Book

BENCHMARK_IDS = (1977, 38508, 15201)  # Orient Express (markup, not source-managed), The Choirboys (a review with an email), Elements of Literature (contents)
EMAIL_SQL = r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
REVIEW_SQL = r"(title\s+of\s+review|my\s+rating|my\s+review|i\s+give\s+this\s+(book|one)|stars?\s+out\s+of|out\s+of\s+(5|five)\s+stars)"


def _could_change():
    """A cheap database-side filter, so only descriptions that might change are read."""
    d = Book.description
    return or_(
        Book.source_managed_fields.op("&")(FIELD_DESCRIPTION) == 0,
        d.op("~")(EMAIL_SQL), d.op("~*")(REVIEW_SQL), d.op("~*")(r"contents\s*:"), d.op("~")(r"\s/\s.*\s/\s.*\s/\s"),
        d.op("~")(r"\*\*|\]\[|\]\(|(^|\n)\s*#{1,6}\s|\[\d+\]:"))


def reclean(factory: sessionmaker, *, apply: bool = False, tag: str | None = None, samples: int = 50, seed: int = 2026,
            batch: int = BATCH, only: set[int] | None = None) -> dict:
    """`only` limits the run to those book ids (tests)."""
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    scope = [Book.id.in_(only)] if only is not None else []
    with factory() as session:  # one read, closed straight away
        rows = session.execute(select(Book.id, Book.source_id, Book.title, Book.description,
                                      Book.source_managed_fields.op("&")(FIELD_DESCRIPTION) > 0)
                               .where(Book.is_listed.is_(True), func.btrim(func.coalesce(Book.description, "")) != "",
                                      _could_change(), *scope).order_by(Book.id)).all()
        known = {row[0] for row in rows}
        extra = [b for b in BENCHMARK_IDS if b not in known] if only is None else []
        if extra:
            rows += session.execute(select(Book.id, Book.source_id, Book.title, Book.description,
                                           Book.source_managed_fields.op("&")(FIELD_DESCRIPTION) > 0)
                                    .where(Book.id.in_(extra))).all()
    counts, flags_by_book = Counter(candidates=len(rows)), {}
    changes: list[Change] = []
    old_of, title_of = {}, {}
    for book_id, key, title, old, managed in rows:
        old_of[book_id], title_of[book_id] = old, title
        if not (old or "").strip():
            continue
        new = cleaner.clean_description(old)
        if new == old:
            counts["unchanged"] += 1
            continue
        flags = cleaner.description_flags(old)
        flags_by_book[book_id] = flags
        counts["emptied" if new is None else "changed"] += 1
        for flag in flags:
            counts[f"rule_{flag}"] += 1
        if not managed:
            counts["not_source_managed_changed"] += 1
        if not flags:
            counts["rules_only_other"] += 1
        changes.append(Change(book_id, key or "", _md5(old), new, "stored", "emptied" if new is None else "changed",
                              withhold="email" in flags))
    written = [0, 0]
    if apply:
        for start in range(0, len(changes), batch):
            written[0] += _write(factory, changes[start:start + batch], tag, owned_only=False)
            written[1] += 1
    by_id = {c.book_id: c for c in changes}

    def view(book_id):
        change = by_id.get(book_id)
        return {"book_id": book_id, "title": title_of.get(book_id), "flags": flags_by_book.get(book_id, []),
                "before": cleaner.mask_emails(old_of.get(book_id)),
                "after": change.new if change else cleaner.mask_emails(old_of.get(book_id))}

    rng = random.Random(seed)
    ids = [c.book_id for c in changes]
    contents = [b for b in ids if "contents" in flags_by_book[b]]
    return {"tag": tag, "applied": apply, "counts": dict(counts), "db": {"rows_read": len(rows), "rows_written": written[0],
                                                                       "batches": written[1]},
            "benchmark": [view(b) for b in BENCHMARK_IDS],
            "contents_samples": [view(b) for b in rng.sample(contents, min(10, len(contents)))],
            "samples": [view(b) for b in rng.sample(ids, min(samples, len(ids)))],
            "longest": [view(c.book_id) for c in sorted((c for c in changes if c.new), key=lambda c: -len(c.new))[:20]]}


def _clip(value: str | None, n: int = 400) -> str:
    return "(none)" if value is None else repr(value if len(value) <= n else value[:n] + f"... [{len(value)} chars]")


def markdown(report: dict) -> str:
    c, d = report["counts"], report["db"]
    lines = [f"# Re-clean stored descriptions ({'applied' if report['applied'] else 'dry run'}), tag `{report['tag']}`", "",
             f"- Read (could change): {c.get('candidates', 0)}; unchanged: {c.get('unchanged', 0)}; "
             f"changed: {c.get('changed', 0)}; emptied: {c.get('emptied', 0)}",
             f"- By rule (a description can hit more than one): email {c.get('rule_email', 0)}, review {c.get('rule_review', 0)}, "
             f"contents list {c.get('rule_contents', 0)}",
             f"- Not source-managed and changed: {c.get('not_source_managed_changed', 0)}; changed by the other rules only "
             f"(markup, credits, seller text): {c.get('rules_only_other', 0)}",
             f"- Database: rows read {d['rows_read']}, rows written {d['rows_written']} in {d['batches']} batches", "",
             "## Benchmark books", ""]
    for view in report["benchmark"]:
        lines += [f"### {view['book_id']} {view['title']!r} ({', '.join(view['flags']) or 'rules'})",
                  f"- before: {_clip(view['before'], 800)}", f"- after: {_clip(view['after'], 800)}", ""]
    lines += [f"## Contents lists ({len(report['contents_samples'])} samples)", ""]
    lines += [f"- {v['book_id']} {v['title']!r}: {_clip(v['before'], 250)}  ->  {_clip(v['after'], 250)}" for v in report["contents_samples"]]
    lines += ["", f"## Random changes ({len(report['samples'])})", ""]
    lines += [f"- {v['book_id']} {v['title']!r} [{', '.join(v['flags']) or 'rules'}]: {_clip(v['before'], 200)}  ->  {_clip(v['after'], 200)}"
              for v in report["samples"]]
    lines += ["", f"## Longest results after cleaning ({len(report['longest'])})", ""]
    lines += [f"- {v['book_id']} {v['title']!r}: {len(v['after'])} chars: {_clip(v['after'], 200)}" for v in report["longest"]]
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
    parser.add_argument("--report", help="write the Markdown report to this file")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    from data.config import validate_database_target
    validate_database_target(url, args.mode)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        factory = sessionmaker(bind=engine)
        if args.undo:
            print(json.dumps(undo(factory, args.undo)))
            return
        report = reclean(factory, apply=args.apply, tag=args.tag, samples=args.samples)
        body = markdown(report)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
