"""Give the books we already hold their genres from the single genre list (T46). Fill-only; a dry run writes nothing.

    CATALOGUE_DATABASE_URL=... python -m data.load --remap-genres --snapshot auto [--dry-run]

Open Library subjects are not kept in our database, so this streams the pinned works dump once (never saved), looks up only the
works we hold by their Open Library key, and links the genres `data.taxonomy.genres_for_subjects` finds. Existing book-tag links
are never removed or changed; a book that already has a genre keeps it and only gains new ones.
"""
from __future__ import annotations

import logging
from collections import Counter

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import sessionmaker

from data import clean
from data.taxonomy import genres_for_subjects
from models import Book, Tag, TagType, book_tags

log = logging.getLogger("bookvane.catalogue")
CHUNK = 2000


def remap(factory: sessionmaker, rows, *, dry_run: bool = True) -> dict:
    """`rows` yields (work key, subjects). Returns counts; writes links only when dry_run is False."""
    with factory() as session:
        ids = dict(session.execute(select(Book.source_id, Book.id).where(Book.source_id.is_not(None))).all())
        tags = {name: tag_id for tag_id, name in session.execute(
            select(Tag.id, Tag.name).where(Tag.type == TagType.genre)).all()}
    counts, pending = Counter(), []
    for key, subjects in rows:
        book_id = ids.get(key)
        if book_id is None:
            continue
        counts["books_seen"] += 1
        found = [name for name in genres_for_subjects(subjects) if name in tags]
        if found:
            counts["books_with_genres"] += 1
            counts["links_proposed"] += len(found)
            pending.extend({"book_id": book_id, "tag_id": tags[name], "source_managed": True} for name in found)
        if len(pending) >= CHUNK and not dry_run:
            counts["links_added"] += _write(factory, pending)
            pending = []
    if pending and not dry_run:
        counts["links_added"] += _write(factory, pending)
    return dict(counts)


def _write(factory: sessionmaker, links: list[dict]) -> int:
    with factory.begin() as session:
        result = session.execute(insert(book_tags).values(links).on_conflict_do_nothing())
        return result.rowcount or 0


def works_from_dump(config, heartbeat=None):
    expected = (config.source_manifest.get("files") or {}).get("works")
    options = {"start_line": 0, "user_agent": config.user_agent, "progress_callback": heartbeat}
    if expected:
        options.update(expected_size=expected["size"], expected_md5=expected["md5"])
    for row in clean.stream_dump(config.works_url, **options):
        if row.error or not row.record:
            continue
        key = clean.work_key(row.record.get("key"))
        subjects = row.record.get("subjects")
        if key and isinstance(subjects, list):
            yield key, subjects
