"""Re-clean every description from its Open Library source, with the current rules (T58). Dry run by default; undoable.

    python -m data.reclean_descriptions --mode production --dry-run [--snapshot auto] [--samples 50] [--report FILE]
    python -m data.reclean_descriptions --mode production --apply   [--snapshot auto] [--tag TAG] [--skip-api] [--report FILE]
    python -m data.reclean_descriptions --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. The source text of a listed book with an Open Library work key is its work description in the
same pinned works dump `remap_genres` and `retag_genres` use (never saved). It goes through `data.cleaner.clean_description`:
Markdown to plain text, paragraphs kept, headed sections trimmed to the intro and plot, credit and seller lines dropped, English
only. A book whose work has nothing usable keeps what it has, re-cleaned by the same rules (and loses it if nothing usable is
left); a book with NO description also tries the Open Library API (the work, then its preferred edition, as `fill_descriptions`
does), so this job also fills the empty ones.

Only descriptions that follow the source are rewritten: an empty one, or one whose `source_managed_fields` description bit is set
(the importer sets it; a hand-edited text does not carry it). A value is written only when it differs from what is stored, and
only if the book still has the value we read. Database work stays small: one read of ids, keys and a hash of each description,
a small read of the texts that need a second look, then one UPDATE and one log INSERT per batch. Every change is logged in
`catalogue_import_issues` with the old text; `--undo TAG` puts it back unless the book was edited since.
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
from sqlalchemy.orm import Session, aliased, sessionmaker

from data import clean, cleaner, fill_descriptions
from data.merge import FIELD_DESCRIPTION
from models import Book, CatalogueImportIssue, Edition
from services.catalogue_resolver import OpenLibraryUnavailable, ol_get

CODE = "reclean_description"
BATCH = 500
TAG = re.compile(r"[A-Za-z0-9_.-]{1,40}")
BENCHMARK_IDS = (30010, 1816, 1870, 1977, 14687)  # Game of Thrones, Dracula, Fahrenheit 451, Orient Express, Franklin


@dataclass
class Book_:
    id: int
    work_key: str
    edition_key: str | None
    md5: str            # md5 of the stored description ('' when none), as Postgres computes it
    empty: bool
    managed: bool       # the importer owns this text


@dataclass
class Change:
    book_id: int
    work_key: str
    old_md5: str
    new: str | None     # None: the stored text is removed
    source: str         # "dump" | "api" | "stored"
    kind: str           # "filled" | "changed" | "emptied"


def _md5(value: str | None) -> str:
    return hashlib.md5((value or "").encode("utf-8")).hexdigest()


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _books(db: Session) -> list[Book_]:
    """One read: listed books with a work key, a hash of the description and whether it is ours to rewrite."""
    empty = or_(Book.description.is_(None), func.btrim(Book.description) == "")
    query = (select(Book.id, Book.source_id, Edition.source_id, func.md5(func.coalesce(Book.description, "")), empty,
                    Book.source_managed_fields.op("&")(FIELD_DESCRIPTION) > 0)
             .outerjoin(Edition, Edition.id == Book.preferred_edition_id)
             .where(Book.is_listed.is_(True), Book.source_id.like("/works/%")).order_by(Book.id))
    return [Book_(*row) for row in db.execute(query).all()]


def works_descriptions(source):
    """Yields (work key, raw description) from the pinned works dump, the same stream `remap_genres` reads."""
    expected = (source.source_manifest.get("files") or {}).get("works")
    options = {"start_line": 0, "user_agent": source.user_agent, "progress_callback": None}
    if expected:
        options.update(expected_size=expected["size"], expected_md5=expected["md5"])
    for row in clean.stream_dump(source.works_url, **options):
        if row.error or not row.record:
            continue
        key = clean.work_key(row.record.get("key"))
        if key:
            yield key, row.record.get("description")


def reclean(factory: sessionmaker, rows, *, apply: bool = False, tag: str | None = None, samples: int = 50,
            use_api: bool = True, fetch=ol_get, seed: int = 2026, batch: int = BATCH, progress=None) -> dict:
    """`rows` yields (work key, raw description). Writes only when `apply` is true."""
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as session:  # closed before the dump is streamed: the database is idle while we read it
        books = {item.work_key: item for item in _books(session)}
    by_id = {item.id: item for item in books.values()}
    rows_read = len(books)
    counts = Counter(candidates=len(books))
    changes: dict[int, Change] = {}
    second_look: list[Book_] = []     # a stored text and no usable source: re-clean what is stored
    to_fill: list[Book_] = []         # nothing stored and nothing usable in the dump: ask the API
    seen: set[str] = set()

    for key, raw in rows:
        item = books.get(key)
        if item is None or key in seen:
            continue
        seen.add(key)
        counts["in_dump"] += 1
        text_, reason = fill_descriptions.judge(raw)
        if text_:
            counts["source_usable"] += 1
            _decide(item, text_, "dump", changes, counts)
        else:
            counts[f"source_{reason}"] += 1
            (to_fill if item.empty else second_look).append(item)
    for item in books.values():
        if item.work_key not in seen:
            counts["not_in_dump"] += 1
            (to_fill if item.empty else second_look).append(item)

    streak = 0
    if use_api:
        for item in to_fill:
            outcome = fill_descriptions.resolve(fill_descriptions.Candidate(item.id, item.work_key, item.edition_key, None), fetch)
            counts["api_asked"] += 1
            streak = streak + 1 if outcome.reason == "unavailable" else 0
            if outcome.text:
                _decide(item, outcome.text, "api", changes, counts)
            else:
                counts[f"api_{outcome.reason}"] += 1
            if streak >= fill_descriptions.MAX_CONSECUTIVE_UNAVAILABLE:
                counts["aborted_open_library_unavailable"] = 1
                break
            if progress and counts["api_asked"] % 200 == 0:
                progress(counts)
    else:
        counts["api_skipped"] = len(to_fill)

    stored: dict[int, str] = {}
    managed_second_look = [item for item in second_look if item.managed]
    counts["kept_not_source_managed"] += len(second_look) - len(managed_second_look)
    with factory() as session:  # a small read: only texts with no usable source
        for start in range(0, len(managed_second_look), 1000):
            ids = [item.id for item in managed_second_look[start:start + 1000]]
            stored.update(session.execute(select(Book.id, Book.description).where(Book.id.in_(ids))).all())
            rows_read += len(ids)
    for item in managed_second_look:
        old = stored.get(item.id) or ""
        final = cleaner.clean_description(old)
        if final == old:
            counts["unchanged"] += 1
        else:
            _decide(item, final, "stored", changes, counts, forced=True)

    done = sorted(changes.values(), key=lambda change: change.book_id)
    written = [0, 0]
    if apply:
        for start in range(0, len(done), batch):
            gone = _write(factory, done[start:start + batch], tag)
            written[0] += gone
            written[1] += 1
    olds, titles = {}, {}
    chosen = list(BENCHMARK_IDS) + random.Random(seed).sample([c.book_id for c in done], min(samples, len(done)))
    longest = sorted((c for c in done if c.new), key=lambda c: -len(c.new))[:20]
    chosen += [c.book_id for c in longest]
    with factory() as session:
        for book_id, title, description in session.execute(select(Book.id, Book.title, Book.description).where(
                Book.id.in_(set(chosen)))).all():
            titles[book_id], olds[book_id] = title, description
        rows_read += len(titles)

    def view(book_id):
        change = changes.get(book_id)
        return {"book_id": book_id, "title": titles.get(book_id), "kind": change.kind if change else "unchanged",
                "before": olds.get(book_id), "after": change.new if change else olds.get(book_id)}

    sample_ids = chosen[len(BENCHMARK_IDS):len(BENCHMARK_IDS) + min(samples, len(done))]
    return {"tag": tag, "applied": apply, "counts": dict(counts),
            "db": {"rows_read": rows_read, "rows_written": written[0], "batches": written[1]},
            "benchmark": [view(b) for b in BENCHMARK_IDS], "samples": [view(b) for b in sample_ids],
            "longest": [view(c.book_id) for c in longest]}


def _decide(item: Book_, new: str | None, source: str, changes: dict, counts: Counter, forced: bool = False) -> None:
    if not item.empty and not item.managed:
        counts["kept_not_source_managed"] += 1
        return
    if not forced and not item.empty and _md5(new) == item.md5:
        counts["unchanged"] += 1
        return
    kind = "filled" if item.empty else ("emptied" if new is None else "changed")
    if item.empty and new is None:
        counts["unchanged"] += 1
        return
    counts[kind] += 1
    changes[item.id] = Change(item.id, item.work_key, item.md5, new, source, kind)


def _write(factory: sessionmaker, chunk: list[Change], tag: str) -> int:
    """One UPDATE (only rows that still hold the value we read, and are ours to rewrite) and one INSERT of log rows."""
    old = aliased(Book)
    data = values(column("id", Integer), column("d", Text), column("m", Text), name="v").data(
        [(c.book_id, c.new, c.old_md5) for c in chunk])
    with factory.begin() as session:
        result = session.execute(update(Book).where(
            Book.id == data.c.id, old.id == Book.id, func.md5(func.coalesce(old.description, "")) == data.c.m,
            or_(old.description.is_(None), func.btrim(old.description) == "", old.source_managed_fields.op("&")(FIELD_DESCRIPTION) > 0))
            .values(description=data.c.d).returning(Book.id, old.description)).all()
        before = dict(result)
        logs = [{"run_id": None, "code": CODE, "source_id": c.work_key, "detail": json.dumps({
            "tag": tag, "book_id": c.book_id, "kind": c.kind, "source": c.source, "before": before[c.book_id],
            "after_chars": len(c.new) if c.new else 0, "after_sha256": _sha(c.new) if c.new else None},
            ensure_ascii=False, separators=(",", ":"))} for c in chunk if c.book_id in before]
        if logs:
            session.execute(insert(CatalogueImportIssue), logs)
        return len(before)


def undo(factory: sessionmaker, tag: str) -> dict:
    """Put back the old text of every description changed under this tag, unless it has been edited since."""
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    restored = skipped = 0
    with factory.begin() as session:
        issues = session.scalars(select(CatalogueImportIssue.detail).where(
            CatalogueImportIssue.code == CODE, CatalogueImportIssue.detail.like(f'%"tag":"{tag}"%'))
            .order_by(CatalogueImportIssue.id)).all()
        for detail in issues:
            data = json.loads(detail)
            if data.get("tag") != tag:  # LIKE treats "_" as a wildcard: confirm the exact tag
                continue
            if data["after_sha256"] is None:
                same = Book.description.is_(None)
            else:
                same = text("encode(sha256(convert_to(books.description, 'UTF8')), 'hex') = :sha").bindparams(sha=data["after_sha256"])
            result = session.execute(update(Book).where(Book.id == data["book_id"], same).values(description=data["before"]))
            restored += result.rowcount
            skipped += 1 - result.rowcount
    return {"restored": restored, "skipped_changed_since": skipped}


def _clip(value: str | None, n: int = 400) -> str:
    return "(none)" if value is None else repr(value if len(value) <= n else value[:n] + f"... [{len(value)} chars]")


def markdown(report: dict) -> str:
    c, d = report["counts"], report["db"]
    lines = [f"# Re-clean descriptions ({'applied' if report['applied'] else 'dry run'}), tag `{report['tag']}`", "",
             f"- Candidates (listed, with a work key): {c.get('candidates', 0)}; found in the dump: {c.get('in_dump', 0)}; "
             f"not in the dump: {c.get('not_in_dump', 0)}",
             f"- Changed: {c.get('changed', 0)}, filled: {c.get('filled', 0)}, emptied: {c.get('emptied', 0)}, "
             f"unchanged: {c.get('unchanged', 0)}, kept (not source-managed): {c.get('kept_not_source_managed', 0)}",
             f"- Source text rejected, by reason: no description {c.get('source_no_description', 0)}, "
             f"clean {c.get('source_rejected_clean', 0)}, cleaner {c.get('source_rejected_cleaner', 0)}",
             f"- API: asked {c.get('api_asked', 0)} (nothing usable: {c.get('api_no_description', 0) + c.get('api_rejected_cleaner', 0) + c.get('api_rejected_clean', 0) + c.get('api_no_work', 0)}, "
             f"unavailable: {c.get('api_unavailable', 0)}, skipped: {c.get('api_skipped', 0)})",
             f"- Database: rows read {d['rows_read']}, rows written {d['rows_written']} in {d['batches']} batches"]
    if c.get("aborted_open_library_unavailable"):
        lines += ["", "**API lookups stopped early: Open Library kept failing.** Run it again to continue."]
    lines += ["", "## Benchmark books", ""]
    for view in report["benchmark"]:
        lines += [f"### {view['book_id']} {view['title']!r} ({view['kind']})", f"- before: {_clip(view['before'], 1200)}",
                  f"- after: {_clip(view['after'], 1200)}", ""]
    lines += [f"## Random changes ({len(report['samples'])})", ""]
    for view in report["samples"]:
        lines += [f"- {view['book_id']} {view['title']!r} ({view['kind']}): {_clip(view['before'], 200)}  ->  {_clip(view['after'], 200)}"]
    lines += ["", f"## Longest results after cleaning ({len(report['longest'])})", ""]
    lines += [f"- {v['book_id']} {v['title']!r}: {len(v['after'])} chars: {_clip(v['after'], 200)}" for v in report["longest"]]
    return "\n".join(lines) + "\n"


@dataclass
class DumpSource:
    works_url: str
    user_agent: str
    source_manifest: dict


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--undo", metavar="TAG")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--snapshot", default="auto", help="'auto' or YYYY-MM-DD, as for remap_genres and retag_genres")
    parser.add_argument("--tag")
    parser.add_argument("--skip-api", action="store_true", help="do not ask the Open Library API for empty descriptions")
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--report", help="write the Markdown report to this file")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    from data.config import validate_database_target
    from database import settings
    validate_database_target(url, args.mode)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        factory = sessionmaker(bind=engine)
        if args.undo:
            print(json.dumps(undo(factory, args.undo)))
            return
        user_agent = os.getenv("CATALOGUE_USER_AGENT", "")
        if not args.skip_api and "@" not in (settings.catalogue_user_agent or ""):
            parser.error("CATALOGUE_USER_AGENT must carry a contact address for Open Library (or use --skip-api)")
        from data.sources import resolve_snapshot
        snapshot = resolve_snapshot(args.snapshot, user_agent=user_agent)
        source = DumpSource(snapshot.url("works"), user_agent, snapshot.manifest())
        report = reclean(factory, works_descriptions(source), apply=args.apply, tag=args.tag, samples=args.samples,
                         use_api=not args.skip_api, progress=lambda counts: print(f"api asked {counts['api_asked']}", flush=True))
        body = f"Snapshot: {snapshot.identifier}\n\n" + markdown(report)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
