"""Re-tag the genres of the books we hold with the corrected subject rules (T57). Dry run by default; every change is logged.

    python -m data.retag_genres --mode production --dry-run [--snapshot auto] [--samples 50] [--report FILE]
    python -m data.retag_genres --mode production --apply   [--snapshot auto] [--tag TAG] [--skip-empty] [--report FILE]
    python -m data.retag_genres --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. Open Library subjects are not kept in our database, so, like `remap_genres`, this streams the same
pinned works dump once (never saved) and looks up only the works we hold. For each book it REPLACES the subject-derived genre
links (`book_tags.source_managed = true`: every path that writes genre links, the importer, the on-demand gate and the remap,
sets it) with what `data.taxonomy.genres_for_subjects` gives now, at most three in all. Links that are not subject-derived
(`source_managed = false`) are never touched; they are counted, and they use up part of the cap of three.

A book whose work has no subjects in the dump is left alone and counted. A book whose new result is empty would lose its
subject-derived genres: a dry run lists those (counts per genre and samples) and `--skip-empty` makes apply leave them as they are.
Each changed book writes one `catalogue_import_issues` row (code `retag_genre`) with the genres removed and added, so
`--undo TAG` can put them back. Nothing here is meant for a public log.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Integer, column, create_engine, delete, func, insert, select, values
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from data.taxonomy import GENRE_KEYS, MAX_GENRES_PER_BOOK, genres_for_subjects
from models import Book, CatalogueImportIssue, Tag, TagType, book_tags

CODE = "retag_genre"
CHUNK = 2000  # changed books per write
TAG = re.compile(r"[A-Za-z0-9_.-]{1,40}")
BENCHMARK_ID = 1977  # Murder on the Orient Express
BENCHMARK_TITLES = (
    "Harry Potter and the Philosopher's Stone", "Dracula", "The 48 Laws of Power", "The Psychology of Money",
    "A Game of Thrones", "The Very Hungry Caterpillar", "A Walk in the Woods", "Salt, Fat, Acid, Heat", "Good to Great",
    "Good Omens", "Charlotte's Web", "Dune", "Sapiens", "Atomic Habits", "Maus")


@dataclass
class Plan:
    book_id: int
    work_key: str
    before: list[str]   # every genre link the book has now
    after: list[str]    # every genre link it would have
    removed: list[str]
    added: list[str]
    loses_all: bool = False


def _plan(book_id: int, work_key: str, current: dict[str, bool], new: list[str]) -> Plan:
    """What the replace does to one book. `current` maps its genre to source_managed."""
    kept = [genre for genre, managed in current.items() if not managed]
    room = max(0, MAX_GENRES_PER_BOOK - len(kept))
    target = [genre for genre in new if genre not in kept][:room]
    managed_now = [genre for genre, managed in current.items() if managed]
    removed = [genre for genre in managed_now if genre not in target]
    added = [genre for genre in target if genre not in current]
    after = kept + [genre for genre in managed_now if genre in target] + added
    return Plan(book_id, work_key, list(current), after, removed, added, loses_all=bool(managed_now) and not after)


def _detail(tag: str, plan: Plan, removed: list[str], added: list[str]) -> str:
    return json.dumps({"tag": tag, "book_id": plan.book_id, "removed": removed, "added": added}, separators=(",", ":"))


def _pairs(rows: list[tuple[int, int]]):
    return values(column("book_id", Integer), column("tag_id", Integer), name="v").data(rows)


def _write(factory: sessionmaker, plans: list[Plan], tag_ids: dict[str, int], tag: str) -> tuple[int, int]:
    """One DELETE, one INSERT and one log INSERT for a chunk of books. Returns (links removed, links added)."""
    names = {tag_id: name for name, tag_id in tag_ids.items()}
    with factory.begin() as session:
        gone = {}
        wanted = [(plan.book_id, tag_ids[genre]) for plan in plans for genre in plan.removed]
        if wanted:
            v = _pairs(wanted)
            for book_id, tag_id in session.execute(delete(book_tags).where(
                    book_tags.c.book_id == v.c.book_id, book_tags.c.tag_id == v.c.tag_id,
                    book_tags.c.source_managed.is_(True)).returning(book_tags.c.book_id, book_tags.c.tag_id)):
                gone.setdefault(book_id, []).append(names[tag_id])
        new = {}
        links = [{"book_id": plan.book_id, "tag_id": tag_ids[genre], "source_managed": True}
                 for plan in plans for genre in plan.added]
        if links:
            for book_id, tag_id in session.execute(pg_insert(book_tags).values(links).on_conflict_do_nothing()
                                                   .returning(book_tags.c.book_id, book_tags.c.tag_id)):
                new.setdefault(book_id, []).append(names[tag_id])
        logs = [{"run_id": None, "code": CODE, "source_id": plan.work_key,
                 "detail": _detail(tag, plan, gone.get(plan.book_id, []), new.get(plan.book_id, []))}
                for plan in plans if gone.get(plan.book_id) or new.get(plan.book_id)]
        if logs:
            session.execute(insert(CatalogueImportIssue), logs)
        return sum(map(len, gone.values())), sum(map(len, new.values()))


def retag(factory: sessionmaker, rows, *, apply: bool = False, skip_empty: bool = False, tag: str | None = None,
          samples: int = 50, seed: int = 2026, benchmark_titles=BENCHMARK_TITLES) -> dict:
    """`rows` yields (work key, subjects). Writes only when `apply` is true."""
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as session:  # the only big read; the session is closed before the dump is streamed
        ids = dict(session.execute(select(Book.source_id, Book.id).where(Book.source_id.is_not(None))).all())
        tag_ids = {name: tag_id for tag_id, name in session.execute(
            select(Tag.id, Tag.name).where(Tag.type == TagType.genre)).all() if name in GENRE_KEYS}
        names = {tag_id: name for name, tag_id in tag_ids.items()}
        current: dict[int, dict[str, bool]] = {}
        link_rows = session.execute(select(book_tags.c.book_id, book_tags.c.tag_id, book_tags.c.source_managed)
                                    .where(book_tags.c.tag_id.in_(list(names)))).all()
        for book_id, tag_id, managed in link_rows:
            current.setdefault(book_id, {})[names[tag_id]] = managed
        benchmark = {BENCHMARK_ID: None}
        if benchmark_titles:
            found = session.execute(select(Book.id, Book.title).where(
                func.lower(Book.title).in_([t.casefold() for t in benchmark_titles]), Book.is_listed.is_(True))
                .order_by(Book.popularity.desc().nulls_last(), Book.id)).all()
            seen_titles = set()
            for book_id, title in found:
                if title.casefold() not in seen_titles:
                    seen_titles.add(title.casefold())
                    benchmark[book_id] = title
        rows_read = len(ids) + len(link_rows) + len(benchmark)

    counts, removed_by, added_by, lost_by = Counter(), Counter(), Counter(), Counter()
    plans: dict[int, Plan] = {}
    subjects_of: dict[int, list] = {}
    final: dict[int, int] = {book_id: len(genres) for book_id, genres in current.items()}
    pending: list[Plan] = []
    written = [0, 0]
    done: set[int] = set()

    def flush():
        if pending and apply:
            gone, new = _write(factory, pending, tag_ids, tag)
            written[0] += gone
            written[1] += new
        pending.clear()

    for key, subjects in rows:
        book_id = ids.get(key)
        if book_id is None or book_id in done:
            continue
        done.add(book_id)
        counts["books_seen"] += 1
        have = current.get(book_id, {})
        plan = _plan(book_id, key, have, [genre for genre in genres_for_subjects(subjects) if genre in tag_ids])
        if book_id in benchmark:
            subjects_of[book_id] = [item for item in subjects if isinstance(item, str)][:15]
            plans[book_id] = plan
        if plan.loses_all:
            counts["would_lose_all"] += 1
            lost_by.update(plan.removed)
            plans[book_id] = plan
            if skip_empty:
                counts["skipped_lose_all"] += 1
                final[book_id] = len(have)
                continue
        final[book_id] = len(plan.after)
        if not (plan.removed or plan.added):
            continue
        counts["books_changed"] += 1
        removed_by.update(plan.removed)
        added_by.update(plan.added)
        plans[book_id] = plan
        pending.append(plan)
        if len(pending) >= CHUNK:
            flush()
    flush()

    picks = random.Random(seed).sample(sorted(b for b, p in plans.items() if (p.removed or p.added) and b not in benchmark),
                                       min(samples, sum(1 for b, p in plans.items() if (p.removed or p.added) and b not in benchmark)))
    lost_picks = random.Random(seed).sample(sorted(b for b, p in plans.items() if p.loses_all),
                                            min(20, sum(1 for p in plans.values() if p.loses_all)))
    want = set(picks) | set(lost_picks) | set(benchmark)
    with factory() as session:
        titles = dict(session.execute(select(Book.id, Book.title).where(Book.id.in_(want))).all()) if want else {}
        rows_read += len(titles)

    def view(book_id):
        plan = plans.get(book_id)
        return {"book_id": book_id, "title": titles.get(book_id), "before": plan.before if plan else current.get(book_id, []),
                "after": plan.after if plan else current.get(book_id, []), "subjects": subjects_of.get(book_id),
                "in_dump": book_id in done}

    unmanaged = sum(1 for genres in current.values() for managed in genres.values() if not managed)
    counts["books_not_in_dump_with_genres"] = sum(1 for b in current if b not in done)
    counts["non_subject_links_kept"] = unmanaged
    counts["books_over_three_after"] = sum(1 for n in final.values() if n > MAX_GENRES_PER_BOOK)
    counts["books_over_three_before"] = sum(1 for genres in current.values() if len(genres) > MAX_GENRES_PER_BOOK)
    return {"tag": tag, "applied": apply, "skip_empty": skip_empty, "counts": dict(counts),
            "links_removed": dict(removed_by.most_common()), "links_added": dict(added_by.most_common()),
            "would_lose_by_genre": dict(lost_by.most_common()),
            "db": {"rows_read": rows_read, "links_removed": written[0], "links_added": written[1]},
            "benchmark": [view(b) for b in sorted(benchmark)], "lose_all_samples": [view(b) for b in lost_picks],
            "samples": [view(b) for b in picks]}


def undo(factory: sessionmaker, tag: str) -> dict:
    """Put back what one tagged run removed and take away what it added (subject-derived links only)."""
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as session:
        tag_ids = {name: tag_id for tag_id, name in session.execute(
            select(Tag.id, Tag.name).where(Tag.type == TagType.genre)).all() if name in GENRE_KEYS}
        details = [json.loads(detail) for detail in session.scalars(select(CatalogueImportIssue.detail).where(
            CatalogueImportIssue.code == CODE, CatalogueImportIssue.detail.like(f'%"tag":"{tag}"%'))
            .order_by(CatalogueImportIssue.id))]
    details = [item for item in details if item.get("tag") == tag]  # LIKE treats "_" as a wildcard: confirm the exact tag
    restored = taken_back = 0
    for start in range(0, len(details), CHUNK):
        chunk = details[start:start + CHUNK]
        with factory.begin() as session:
            added = [(item["book_id"], tag_ids[genre]) for item in chunk for genre in item["added"] if genre in tag_ids]
            if added:
                v = _pairs(added)
                taken_back += session.execute(delete(book_tags).where(
                    book_tags.c.book_id == v.c.book_id, book_tags.c.tag_id == v.c.tag_id,
                    book_tags.c.source_managed.is_(True))).rowcount or 0
            removed = [{"book_id": item["book_id"], "tag_id": tag_ids[genre], "source_managed": True}
                       for item in chunk for genre in item["removed"] if genre in tag_ids]
            if removed:
                restored += session.execute(pg_insert(book_tags).values(removed).on_conflict_do_nothing()).rowcount or 0
    return {"books": len(details), "links_restored": restored, "links_taken_back": taken_back}


def _line(view: dict) -> str:
    text = f"- {view['book_id']} {view['title']!r}: {', '.join(view['before']) or '-'}  ->  {', '.join(view['after']) or '-'}"
    return text + ("" if view["in_dump"] else "  (not in the dump: unchanged)")


def markdown(report: dict) -> str:
    c, d = report["counts"], report["db"]
    lines = [f"# Re-tag genres ({'applied' if report['applied'] else 'dry run'}), tag `{report['tag']}`", "",
             f"- Books found in the dump: {c.get('books_seen', 0)}",
             f"- Books changed: {c.get('books_changed', 0)}",
             f"- Books with more than three genres: before {c.get('books_over_three_before', 0)}, "
             f"after {c.get('books_over_three_after', 0)} (should be 0)",
             f"- Links kept because they are not subject-derived: {c.get('non_subject_links_kept', 0)}",
             f"- Books with genres that are not in the dump (left unchanged): {c.get('books_not_in_dump_with_genres', 0)}",
             f"- Books that would be left with no genre: {c.get('would_lose_all', 0)}"
             + (f" (skipped, left as they are: {c.get('skipped_lose_all', 0)})" if report["skip_empty"] else ""),
             f"- Database: rows read {d['rows_read']}, links removed {d['links_removed']}, links added {d['links_added']}",
             "", "## Links per genre (removed / added)", ""]
    genres = sorted(set(report["links_removed"]) | set(report["links_added"]))
    lines += [f"- {genre}: -{report['links_removed'].get(genre, 0)} / +{report['links_added'].get(genre, 0)}" for genre in genres]
    lines += ["", "## Genres lost by books that would end with none", ""]
    lines += [f"- {genre}: {n}" for genre, n in report["would_lose_by_genre"].items()] or ["- none"]
    lines += ["", f"### Samples of those ({len(report['lose_all_samples'])})", ""] + [_line(v) for v in report["lose_all_samples"]]
    lines += ["", "## Benchmark books", ""]
    for view in report["benchmark"]:
        lines.append(_line(view))
        if view["subjects"]:
            lines.append(f"    subjects: {view['subjects']}")
    lines += ["", f"## Random samples of changed books ({len(report['samples'])})", ""] + [_line(v) for v in report["samples"]]
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
    parser.add_argument("--snapshot", default="auto", help="'auto' or YYYY-MM-DD, as for remap_genres")
    parser.add_argument("--tag")
    parser.add_argument("--skip-empty", action="store_true", help="apply: leave books that would end with no genre as they are")
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
        from data.remap_genres import works_from_dump
        from data.sources import resolve_snapshot
        user_agent = os.getenv("CATALOGUE_USER_AGENT", "")
        snapshot = resolve_snapshot(args.snapshot, user_agent=user_agent)
        source = DumpSource(snapshot.url("works"), user_agent, snapshot.manifest())
        report = retag(factory, works_from_dump(source), apply=args.apply, skip_empty=args.skip_empty, tag=args.tag,
                       samples=args.samples)
        body = f"Snapshot: {snapshot.identifier}\n\n" + markdown(report)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
