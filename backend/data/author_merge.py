"""Merge an old keyless author into its Open Library twin (T72). Dry run by default; every change is logged and undoable.

    python -m data.author_merge --mode production --dry-run [--samples 20] [--report FILE]
    python -m data.author_merge --mode production --apply   [--tag TAG] [--report FILE]
    python -m data.author_merge --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. The pairs come from `data.duplicate_authors` (two authors with the same normalised name on one
book). Only the safe case is merged: one author with NO Open Library key (an old author from before the import) and one WITH a
key. Per pair, in one transaction:

- every book link of the keyless author moves to the keyed author; where the book already links to the keyed author the
  duplicate link is deleted instead (the keyed link and its `source_managed` flag are the ones kept);
- the keyless author is deleted once nothing references it any more (a reader's saved entry points at a book, never an author);
- one row goes into `catalogue_import_issues` (code `author_merge`) with everything needed for `--undo TAG`.

Skipped and reported, never merged: both authors keyed; a keyless author that pairs with more than one keyed author (ambiguous);
and a keyless author whose OTHER books share no subject tag with the keyed author's books (it may be a different person).

Book author order: links carry no position; readers see authors by author id. A moved link takes the keyed author's id, so on a
book that has a third author with an id between the two, the displayed order can change. The report counts those books.
A dry run writes nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import create_engine, insert, select, text
from sqlalchemy.orm import Session, sessionmaker

from data.duplicate_authors import PAIRS
from models import CatalogueImportIssue

CODE = "author_merge"
TAG = re.compile(r"[A-Za-z0-9_.-]{1,40}")


def find_pairs(db: Session) -> list[dict]:
    """Same-name pairs on a shared book, as {keyless, keyed (author rows), shared books} plus skipped ones with a reason."""
    rows = db.execute(PAIRS).all()
    pairs: dict[tuple[int, int], dict] = {}
    for row in rows:
        entry = pairs.setdefault((row.first_id, row.second_id), {
            "first": (row.first_id, row.first_name, row.first_key), "second": (row.second_id, row.second_name, row.second_key),
            "shared": 0})
        entry["shared"] += 1
    found, keyless_partners = [], defaultdict(set)
    for item in pairs.values():
        (a_id, a_name, a_key), (b_id, b_name, b_key) = item["first"], item["second"]
        if bool(a_key) == bool(b_key):
            found.append({**item, "skip": "both_keyed" if a_key else "both_keyless"})
            continue
        keyless, keyed = ((a_id, a_name, a_key), (b_id, b_name, b_key)) if not a_key else ((b_id, b_name, b_key), (a_id, a_name, a_key))
        keyless_partners[keyless[0]].add(keyed[0])
        found.append({"keyless": keyless, "keyed": keyed, "shared": item["shared"], "skip": None})
    for item in found:
        if item["skip"] is None and len(keyless_partners[item["keyless"][0]]) > 1:
            item["skip"] = "ambiguous_twin"
    return found


def _looks_like_the_same_person(db: Session, keyless_id: int, keyed_id: int) -> bool:
    """True when the keyless author has no books beyond the keyed author's, or the keyless author's OTHER books share a subject tag with the keyed author's books."""
    other = db.scalar(text("""
        SELECT count(*) FROM book_authors k WHERE k.author_id = :k
          AND NOT EXISTS (SELECT 1 FROM book_authors t WHERE t.book_id = k.book_id AND t.author_id = :t)"""), {"k": keyless_id, "t": keyed_id})
    if not other:
        return True
    return bool(db.scalar(text("""
        SELECT EXISTS (
          SELECT 1 FROM book_authors k JOIN book_tags kt ON kt.book_id = k.book_id
          JOIN tags tg ON tg.id = kt.tag_id AND tg.type IN ('genre', 'topic', 'form', 'audience')
          JOIN book_tags tt ON tt.tag_id = kt.tag_id
          JOIN book_authors t ON t.book_id = tt.book_id AND t.author_id = :t
          WHERE k.author_id = :k
            AND NOT EXISTS (SELECT 1 FROM book_authors x WHERE x.book_id = k.book_id AND x.author_id = :t))"""),
        {"k": keyless_id, "t": keyed_id}))


def _links(db: Session, keyless_id: int, keyed_id: int) -> list[dict]:
    """The keyless author's links with what each needs: is the keyed author already there, and would the order change."""
    rows = db.execute(text("""
        SELECT k.book_id, k.source_managed,
               EXISTS (SELECT 1 FROM book_authors t WHERE t.book_id = k.book_id AND t.author_id = :t) AS has_keyed,
               EXISTS (SELECT 1 FROM book_authors o WHERE o.book_id = k.book_id AND o.author_id NOT IN (:k, :t)
                       AND o.author_id > LEAST(:k, :t) AND o.author_id < GREATEST(:k, :t)) AS reorders
        FROM book_authors k WHERE k.author_id = :k ORDER BY k.book_id"""), {"k": keyless_id, "t": keyed_id}).all()
    return [{"book_id": r.book_id, "source_managed": r.source_managed, "has_keyed": r.has_keyed, "reorders": r.reorders} for r in rows]


def plan(db: Session) -> dict:
    """Everything a run would do, from reads only."""
    merges, skipped = [], []
    for item in find_pairs(db):
        if item["skip"]:
            skipped.append({"reason": item["skip"], "names": [item.get("first", item.get("keyless")), item.get("second", item.get("keyed"))],
                            "shared": item["shared"]})
            continue
        keyless, keyed = item["keyless"], item["keyed"]
        if not _looks_like_the_same_person(db, keyless[0], keyed[0]):
            skipped.append({"reason": "different_subjects", "names": [keyless, keyed], "shared": item["shared"]})
            continue
        links = _links(db, keyless[0], keyed[0])
        merges.append({"keyless": keyless, "keyed": keyed, "links": links})
    return {"merges": merges, "skipped": skipped}


def _apply_one(db: Session, merge: dict, tag: str) -> None:
    keyless_id, keyed_id = merge["keyless"][0], merge["keyed"][0]
    author = dict(db.execute(text("SELECT * FROM authors WHERE id = :i"), {"i": keyless_id}).mappings().one())
    moved = [l for l in merge["links"] if not l["has_keyed"]]
    removed = [l for l in merge["links"] if l["has_keyed"]]
    log = {"tag": tag, "keyless": {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in author.items()},
           "keyed_id": keyed_id, "moved": [[l["book_id"], l["source_managed"]] for l in moved],
           "removed": [[l["book_id"], l["source_managed"]] for l in removed]}
    if moved:
        db.execute(text("UPDATE book_authors SET author_id = :t WHERE author_id = :k AND book_id = ANY(:b)"),
                   {"t": keyed_id, "k": keyless_id, "b": [l["book_id"] for l in moved]})
    if removed:
        db.execute(text("DELETE FROM book_authors WHERE author_id = :k AND book_id = ANY(:b)"),
                   {"k": keyless_id, "b": [l["book_id"] for l in removed]})
    leftover = db.scalar(text("SELECT count(*) FROM book_authors WHERE author_id = :k"), {"k": keyless_id})
    if leftover:
        raise RuntimeError(f"author {keyless_id} still has {leftover} links")
    db.execute(text("DELETE FROM authors WHERE id = :k"), {"k": keyless_id})
    db.execute(insert(CatalogueImportIssue), [{"run_id": None, "code": CODE, "source_id": merge["keyed"][2],
                                               "detail": json.dumps(log, separators=(",", ":"), default=str)}])


def run(factory: sessionmaker, *, apply: bool = False, tag: str | None = None, samples: int = 20, seed: int = 2026) -> dict:
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as db:
        result = plan(db)
        db.rollback()
    merges = result["merges"]
    counts = Counter(pairs=len(merges), links_moved=sum(1 for m in merges for l in m["links"] if not l["has_keyed"]),
                     links_removed=sum(1 for m in merges for l in m["links"] if l["has_keyed"]), authors_deleted=len(merges),
                     books=len({l["book_id"] for m in merges for l in m["links"]}),
                     order_may_change=sum(1 for m in merges for l in m["links"] if not l["has_keyed"] and l["reorders"]),
                     skipped=len(result["skipped"]))
    done = 0
    if apply:
        for merge in merges:
            with factory() as db:        # one transaction per pair
                _apply_one(db, merge, tag)
                db.commit()
                done += 1
    chosen = random.Random(seed).sample(merges, min(samples, len(merges)))
    return {"applied": apply, "tag": tag if apply else None, "counts": dict(counts), "merged": done, "skipped": result["skipped"],
            "samples": [{"keyless": m["keyless"], "keyed": m["keyed"], "moved": sum(not l["has_keyed"] for l in m["links"]),
                         "removed": sum(l["has_keyed"] for l in m["links"])} for m in chosen]}


def undo(factory: sessionmaker, tag: str) -> dict:
    """Recreate each deleted author with its old id and columns, give back the moved and removed links."""
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    restored = 0
    with factory() as db:
        logs = [(i, json.loads(d)) for i, d in db.execute(select(CatalogueImportIssue.id, CatalogueImportIssue.detail).where(
            CatalogueImportIssue.code == CODE, CatalogueImportIssue.detail.like(f'{{"tag":"{tag}"%')).order_by(CatalogueImportIssue.id))]
        for issue_id, item in logs:
            author, keyed_id = item["keyless"], item["keyed_id"]
            if db.scalar(text("SELECT 1 FROM authors WHERE id = :i"), {"i": author["id"]}):
                continue                                     # already restored
            columns = list(author)
            db.execute(text(f"INSERT INTO authors ({', '.join(columns)}) VALUES ({', '.join(':' + c for c in columns)})"), author)
            for book_id, managed in item["moved"]:
                db.execute(text("DELETE FROM book_authors WHERE book_id = :b AND author_id = :t"), {"b": book_id, "t": keyed_id})
                db.execute(text("INSERT INTO book_authors (book_id, author_id, source_managed) VALUES (:b, :a, :m)"),
                           {"b": book_id, "a": author["id"], "m": managed})
            for book_id, managed in item["removed"]:
                db.execute(text("INSERT INTO book_authors (book_id, author_id, source_managed) VALUES (:b, :a, :m) ON CONFLICT DO NOTHING"),
                           {"b": book_id, "a": author["id"], "m": managed})
            db.execute(text("DELETE FROM catalogue_import_issues WHERE id = :i"), {"i": issue_id})
            restored += 1
        db.commit()
    return {"tag": tag, "authors_restored": restored}


def markdown(report: dict) -> str:
    c = report["counts"]
    lines = ["# Merge duplicate authors", "", f"Mode: {'APPLY, tag ' + report['tag'] if report['applied'] else 'dry run, nothing written'}", "",
             f"- Pairs to merge: {c['pairs']} across {c['books']} books", f"- Links moved: {c['links_moved']}",
             f"- Duplicate links removed: {c['links_removed']}", f"- Keyless authors deleted: {c['authors_deleted']}",
             f"- Moved links on books where the displayed author order may change: {c['order_may_change']}",
             f"- Pairs skipped: {c['skipped']}", f"- Pairs merged in this run: {report['merged']}", "", "## Samples", ""]
    for s in report["samples"]:
        lines.append(f"- {s['keyless'][1]} (#{s['keyless'][0]}, no key) into #{s['keyed'][0]} {s['keyed'][2]}: {s['moved']} moved, {s['removed']} removed")
    lines += ["", "## Skipped (not merged)", ""]
    for s in report["skipped"]:
        names = [f"{n[1]} #{n[0]} {n[2] or 'no key'}" for n in s["names"]]
        lines.append(f"- {s['reason']}: {' / '.join(names)} ({s['shared']} shared books)")
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
            print(json.dumps(undo(factory, args.undo)))
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
