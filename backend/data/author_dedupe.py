"""Merge the duplicate authors T72 leaves behind (T19). Dry run by default; every change is logged and undoable with the T72 undo.

    python -m data.author_dedupe --mode production --dry-run [--samples 20] [--report FILE]
    python -m data.author_dedupe --mode production --apply   [--tag TAG] [--report FILE]
    python -m data.author_dedupe --mode production --undo TAG        (the same log and undo as `data.author_merge`)

Reads CATALOGUE_DATABASE_URL. T72 handles one keyless author next to its keyed twin. This handles what it skips or never sees: three
or more copies of one name ("James Joyce" four times) and spelling variants ("J Joyce", "James Joyce.", "JAMES JOYCE") that sit on a
book beside the full name.

Evidence that two authors are one person: BOTH are listed on the same book and `cleaner.same_person` says the names are the same (case,
punctuation, accents, initials of the full name, a typo in a long name; "Ann Lee" and "Ann Leo" are not). Such authors are joined into
a group. Per group, in one transaction per merged author:

- the winner is the group's keyed author (the one carrying an Open Library key); with no keyed author, the one with the most books;
- every other author moves into the winner by T72's own step: links move (a duplicate link is deleted instead), the old author row is
  deleted once nothing references it, and one undo-log row is written.

Never merged, only reported: a group with two or more keyed authors (deleting an author that carries an Open Library key would let the
next import create it again, so that is a decision for the lead dev). An author that shares no book with the others is not in a group.
A dry run writes nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from data import author_merge, cleaner

SAME_BOOK_PAIRS = text("""
    SELECT a1.id AS first_id, a1.name AS first_name, a1.source_id AS first_key,
           a2.id AS second_id, a2.name AS second_name, a2.source_id AS second_key
    FROM book_authors ba1
    JOIN book_authors ba2 ON ba2.book_id = ba1.book_id AND ba2.author_id > ba1.author_id
    JOIN authors a1 ON a1.id = ba1.author_id
    JOIN authors a2 ON a2.id = ba2.author_id
    WHERE similarity(a1.name, a2.name) >= 0.3
       OR lower(regexp_replace(btrim(a1.name, ' .,;'), '^.*[[:space:]]', '')) = lower(regexp_replace(btrim(a2.name, ' .,;'), '^.*[[:space:]]', ''))
""")


def find_groups(db: Session) -> list[dict]:
    """Groups of two or more authors that are one person by the evidence above: {members: [(id, name, key, books)], shared}."""
    parent: dict[int, int] = {}
    info: dict[int, tuple] = {}

    def root(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs = []
    for row in db.execute(SAME_BOOK_PAIRS):
        if not (cleaner.same_person(row.first_name, row.second_name) or cleaner.same_person(row.second_name, row.first_name)):
            continue                   # same_person is not symmetric for names of equal length ("R L Stevenson" and the full name)
        for a_id, name, key in ((row.first_id, row.first_name, row.first_key), (row.second_id, row.second_name, row.second_key)):
            parent.setdefault(a_id, a_id)
            info[a_id] = (a_id, name, key)
        parent[root(row.first_id)] = root(row.second_id)
        pairs.append(row.first_id)
    if not info:
        return []
    books = dict(db.execute(text("SELECT author_id, count(*) FROM book_authors WHERE author_id = ANY(:ids) GROUP BY author_id"),
                            {"ids": list(info)}).all())
    grouped: dict[int, list] = defaultdict(list)
    for a_id in info:
        grouped[root(a_id)].append((*info[a_id], books.get(a_id, 0)))
    shared = Counter(root(first) for first in pairs)
    return [{"members": sorted(group, key=lambda m: m[0]), "shared": shared[top]} for top, group in grouped.items()]


def _winner(members: list[tuple]) -> tuple:
    keyed = [m for m in members if m[2]]
    return keyed[0] if keyed else sorted(members, key=lambda m: (-m[3], m[0]))[0]


def plan(db: Session) -> dict:
    merges, skipped = [], []
    for group in find_groups(db):
        members = group["members"]
        if sum(1 for m in members if m[2]) > 1:
            skipped.append({"reason": "multiple_keys", "names": [m[:3] for m in members], "shared": group["shared"]})
            continue
        winner = _winner(members)
        taken: set[int] = set()        # books an earlier loser in this group already moves to the winner: a second copy there is deleted
        for loser in members:
            if loser[0] == winner[0]:
                continue
            links = author_merge._links(db, loser[0], winner[0])
            for link in links:
                if not link["has_keyed"] and link["book_id"] in taken:
                    link["has_keyed"] = True
                elif not link["has_keyed"]:
                    taken.add(link["book_id"])
            merges.append({"keyless": loser[:3], "keyed": winner[:3], "links": links})
    return {"merges": merges, "skipped": skipped}


def run(factory: sessionmaker, *, apply: bool = False, tag: str | None = None, samples: int = 20, seed: int = 2026) -> dict:
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not author_merge.TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as db:
        result = plan(db)
        db.rollback()
    merges = result["merges"]
    counts = Counter(authors_merged=len(merges), links_moved=sum(1 for m in merges for l in m["links"] if not l["has_keyed"]),
                     links_removed=sum(1 for m in merges for l in m["links"] if l["has_keyed"]),
                     books=len({l["book_id"] for m in merges for l in m["links"]}),
                     order_may_change=sum(1 for m in merges for l in m["links"] if not l["has_keyed"] and l["reorders"]),
                     skipped=len(result["skipped"]))
    done = 0
    if apply:
        for merge in merges:
            with factory() as db:        # one transaction per merged author
                author_merge._apply_one(db, merge, tag)
                db.commit()
                done += 1
    chosen = random.Random(seed).sample(merges, min(samples, len(merges)))
    return {"applied": apply, "tag": tag if apply else None, "counts": dict(counts), "merged": done, "skipped": result["skipped"],
            "samples": [{"from": m["keyless"], "into": m["keyed"], "moved": sum(not l["has_keyed"] for l in m["links"]),
                         "removed": sum(l["has_keyed"] for l in m["links"])} for m in chosen]}


def markdown(report: dict) -> str:
    c = report["counts"]
    lines = ["# Merge duplicate authors (T19)", "", f"Mode: {'APPLY, tag ' + report['tag'] if report['applied'] else 'dry run, nothing written'}", "",
             f"- Authors to merge: {c['authors_merged']} across {c['books']} books", f"- Links moved: {c['links_moved']}",
             f"- Duplicate links removed: {c['links_removed']}",
             f"- Moved links on books where the displayed author order may change: {c['order_may_change']}",
             f"- Groups skipped (more than one Open Library key): {c['skipped']}", f"- Authors merged in this run: {report['merged']}", "",
             "## Samples", ""]
    for s in report["samples"]:
        lines.append(f"- {s['from'][1]} (#{s['from'][0]}) into {s['into'][1]} (#{s['into'][0]}): {s['moved']} moved, {s['removed']} removed")
    lines += ["", "## Skipped (not merged)", ""]
    for s in report["skipped"]:
        lines.append(f"- {s['reason']}: " + " / ".join(f"{n[1]} #{n[0]} {n[2] or 'no key'}" for n in s["names"]) + f" ({s['shared']} shared books)")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--undo", metavar="TAG")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--tag")
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--report")
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
            print(json.dumps(author_merge.undo(factory, args.undo)))
            return
        body = markdown(run(factory, apply=args.apply, tag=args.tag, samples=args.samples))
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
