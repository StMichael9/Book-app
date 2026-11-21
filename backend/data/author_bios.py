"""Fill author bios and photo ids from the Open Library authors dump (T71). Dry run by default; every write is logged and undoable.

    python -m data.author_bios --mode production --dry-run [--snapshot auto] [--samples 20] [--report FILE]
    python -m data.author_bios --mode production --apply   [--snapshot auto] [--tag TAG] [--batch 500] [--report FILE]
    python -m data.author_bios --mode production --undo TAG

Reads CATALOGUE_DATABASE_URL. Only authors already in our catalogue (an Open Library key) are touched, and only fill-only: a
bio is written where there is none, a photo id where there is none, and nothing already stored is ever replaced. The bio goes
through `data.clean.author_bio` (plain text, at most 600 characters, cut at a sentence end) and the photo is the first positive
id in `photos` (`data.clean.author_photo`). No Open Library API calls are made: the text comes from the pinned authors dump.

Database work is small: one read of (id, key, has bio, has photo), nothing while the dump streams, then one UPDATE and one log
INSERT per batch. A dry run writes nothing and reports the number of rows it would change and the bytes it would add.
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

from sqlalchemy import Integer, Text, case, column, create_engine, func, insert, select, update, values
from sqlalchemy.orm import Session, sessionmaker

from data import clean
from models import Author, CatalogueImportIssue

CODE = "author_bio"
BATCH = 500
TAG = re.compile(r"[A-Za-z0-9_.-]{1,40}")
SOURCE = "open_library"


@dataclass
class Known:
    id: int
    key: str
    has_bio: bool
    has_photo: bool


@dataclass
class Fill:
    author_id: int
    key: str
    bio: str | None
    photo_id: int | None


def known_authors(db: Session) -> dict[str, Known]:
    """One read: authors with an Open Library key that still lack a bio or a photo."""
    rows = db.execute(select(Author.id, Author.source_id, Author.bio.is_not(None), Author.photo_id.is_not(None))
                      .where(Author.source_id.is_not(None), (Author.bio.is_(None) | Author.photo_id.is_(None)))
                      .order_by(Author.id)).all()
    return {key: Known(author_id, key, bool(has_bio), bool(has_photo)) for author_id, key, has_bio, has_photo in rows}


def authors_dump(source):
    """Yields (author key, bio, photo id) from the pinned authors dump (never saved)."""
    expected = (source.source_manifest.get("files") or {}).get("authors")
    options = {"start_line": 0, "user_agent": source.user_agent, "progress_callback": None}
    if expected:
        options.update(expected_size=expected["size"], expected_md5=expected["md5"])
    for row in clean.stream_dump(source.authors_url, **options):
        if row.error or not row.record:
            continue
        key = clean.author_key(row.record.get("key"))
        if key:
            yield key, clean.author_bio(row.record.get("bio")), clean.author_photo(row.record.get("photos"))


def _size(fill: Fill) -> int:
    return (len(fill.bio.encode("utf-8")) if fill.bio else 0) + (4 if fill.photo_id else 0)


def _write(db: Session, fills: list[Fill], tag: str) -> int:
    """One UPDATE for the batch (fill-only: re-checked in the statement) and one log INSERT. Returns rows written."""
    data = values(column("id", Integer), column("b", Text), column("p", Integer), name="v").data(
        [(f.author_id, f.bio, f.photo_id) for f in fills])
    bio_new = (Author.bio.is_(None) & (Author.bio_source.is_(None)) & (data.c.b.is_not(None)))
    result = db.execute(update(Author).where(Author.id == data.c.id).values(
        bio=case((bio_new, data.c.b), else_=Author.bio),
        bio_source=case((bio_new, SOURCE), else_=Author.bio_source),
        photo_id=func.coalesce(Author.photo_id, data.c.p),
    ).returning(Author.id, Author.bio, Author.photo_id))
    written = {row.id: row for row in result}
    logged = [f for f in fills if f.author_id in written]
    if logged:
        db.execute(insert(CatalogueImportIssue), [{"run_id": None, "code": CODE, "source_id": f.key, "detail": json.dumps({
            "tag": tag, "author_id": f.author_id, "bio": bool(f.bio), "photo_id": f.photo_id}, separators=(",", ":"))}
            for f in logged])
    db.commit()
    return len(written)


def run(factory: sessionmaker, rows, *, apply: bool = False, tag: str | None = None, samples: int = 20,
        batch: int = BATCH, seed: int = 2026) -> dict:
    """`rows` yields (author key, bio, photo id). Writes only when `apply` is true."""
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as session:  # closed before the dump is streamed: the database is idle while we read it
        known = known_authors(session)
    counts = Counter(candidates=len(known))
    seen: set[str] = set()
    pending: list[Fill] = []
    sample_pool: list[Fill] = []
    written = added = 0
    rng = random.Random(seed)

    def flush():
        nonlocal written, pending
        if apply and pending:
            with factory() as session:
                written += _write(session, pending, tag)
        pending = []

    for key, bio, photo_id in rows:
        item = known.get(key)
        if item is None or key in seen:
            continue
        seen.add(key)
        counts["in_dump"] += 1
        fill = Fill(item.id, key, bio if not item.has_bio else None, photo_id if not item.has_photo else None)
        if not fill.bio and not fill.photo_id:
            counts["nothing_to_add"] += 1
            continue
        counts["rows"] += 1
        counts["with_bio"] += bool(fill.bio)
        counts["with_photo"] += bool(fill.photo_id)
        added += _size(fill)
        if len(sample_pool) < 500:
            sample_pool.append(fill)
        pending.append(fill)
        if len(pending) >= batch:
            flush()
    flush()
    counts["not_in_dump"] = len(known) - counts["in_dump"]
    chosen = rng.sample(sample_pool, min(samples, len(sample_pool)))
    return {"applied": apply, "tag": tag if apply else None, "counts": dict(counts), "rows": counts["rows"],
            "bytes_added": added, "written": written,
            "samples": [{"key": f.key, "bio": f.bio, "photo_id": f.photo_id} for f in chosen]}


def undo(factory: sessionmaker, tag: str) -> dict:
    """Clears what a tagged run filled, where the stored bio is still the dump's (bio_source) and the photo was not changed."""
    if not TAG.fullmatch(tag):
        raise ValueError("tag must be 1-40 letters, digits, dot, dash or underscore")
    with factory() as session:
        logs = [json.loads(detail) for (detail,) in session.execute(select(CatalogueImportIssue.detail).where(
            CatalogueImportIssue.code == CODE, CatalogueImportIssue.detail.like(f'{{"tag":"{tag}"%')))]
        ids_bio = [item["author_id"] for item in logs if item["bio"]]
        photos = [(item["author_id"], item["photo_id"]) for item in logs if item["photo_id"]]
        cleared = 0
        for start in range(0, len(ids_bio), 1000):
            cleared += session.execute(update(Author).where(Author.id.in_(ids_bio[start:start + 1000]),
                                                            Author.bio_source == SOURCE)
                                       .values(bio=None, bio_source=None)).rowcount
        for start in range(0, len(photos), 1000):
            part = photos[start:start + 1000]
            data = values(column("id", Integer), column("p", Integer), name="u").data(part)
            session.execute(update(Author).where(Author.id == data.c.id, Author.photo_id == data.c.p).values(photo_id=None))
        session.commit()
    return {"tag": tag, "bios_cleared": cleared, "photos_logged": len(photos)}


def markdown(report: dict) -> str:
    counts = report["counts"]
    lines = ["# Author bios and photos", "",
             f"Mode: {'APPLY, tag ' + report['tag'] if report['applied'] else 'dry run, nothing written'}", "",
             f"- Authors in the catalogue that lack a bio or photo: {counts.get('candidates', 0)}",
             f"- Found in the authors dump: {counts.get('in_dump', 0)} (not in the dump: {counts.get('not_in_dump', 0)})",
             f"- Rows to change: {report['rows']} ({counts.get('with_bio', 0)} bios, {counts.get('with_photo', 0)} photos)",
             f"- Bytes added (text, plus 4 per photo id): {report['bytes_added']}",
             f"- Rows written: {report['written']}", "", "## Samples", ""]
    for item in report["samples"]:
        lines.append(f"- {item['key']} photo={item['photo_id']}: {(item['bio'] or '')[:200]}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--undo", metavar="TAG")
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--snapshot", default="auto")
    parser.add_argument("--tag")
    parser.add_argument("--batch", type=int, default=BATCH)
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
        from data.sources import resolve_snapshot
        user_agent = os.getenv("CATALOGUE_USER_AGENT", "")
        snapshot = resolve_snapshot(args.snapshot, user_agent=user_agent)
        source = DumpSource(snapshot.url("authors"), user_agent, snapshot.manifest())
        report = run(factory, authors_dump(source), apply=args.apply, tag=args.tag, samples=args.samples, batch=args.batch)
        body = f"Snapshot: {snapshot.identifier}\n\n" + markdown(report)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                handle.write(body)
        print(body)
    finally:
        engine.dispose()


@dataclass
class DumpSource:
    authors_url: str
    user_agent: str
    source_manifest: dict


if __name__ == "__main__":
    main()
