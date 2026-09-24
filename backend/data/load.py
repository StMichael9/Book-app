"""Resumable, bounded Open Library dump importer.

Production use is a manual GitHub Actions job. All state lives in PostgreSQL;
the imported catalogue and its staging rows never need local JSON files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from sqlalchemy import case, create_engine, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from data import clean
from models import (
    Author, Book, CatalogueImportRun, CatalogueStageAuthor,
    CatalogueStageEdition, CatalogueStageWork, CatalogueStageWorkAuthor,
    Tag, TagType, book_authors, book_tags,
)

log = logging.getLogger("bookvane.catalogue")
PHASES = ("works", "authors", "editions", "merge", "cleanup", "complete")
TRANSIENT_ERRORS = (requests.RequestException, EOFError, OSError)


@dataclass(frozen=True)
class ImportConfig:
    run_id: str
    works_url: str
    authors_url: str
    editions_url: str
    database_url: str
    mode: str
    user_agent: str
    batch_size: int = 500
    max_books: int = 100000
    max_database_mb: int = 450

    def validate(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", self.run_id):
            raise ValueError("run_id must be 1-80 letters, digits, hyphens, or underscores")
        if self.mode not in ("test", "production"):
            raise ValueError("mode must be test or production")
        if not 1 <= self.batch_size <= 1000 or not 1 <= self.max_books <= 1000000:
            raise ValueError("batch_size or max_books outside supported range")
        if self.max_database_mb < 10:
            raise ValueError("max_database_mb is too small")
        if not self.user_agent or "@" not in self.user_agent:
            raise ValueError("Identify the importer with a contact email in User-Agent")
        for url in (self.works_url, self.authors_url, self.editions_url):
            parsed = urlparse(url)
            if (parsed.scheme != "https" or "latest" in url.casefold()
                    or not parsed.path.endswith(".txt.gz")
                    or parsed.hostname not in ("openlibrary.org", "archive.org")
                    and not (parsed.hostname or "").endswith(".archive.org")):
                raise ValueError("Use pinned HTTPS Open Library .txt.gz dump URLs")
        db_url = make_url(self.database_url)
        if db_url.get_backend_name() != "postgresql":
            raise ValueError("Catalogue imports require PostgreSQL")
        if self.mode == "test":
            if os.getenv("BOOKVANE_TEST_DB_ISOLATED") != "yes":
                raise ValueError("Test imports require BOOKVANE_TEST_DB_ISOLATED=yes")
            if not db_url.database or "test" not in db_url.database.casefold():
                raise ValueError("Test database name must contain 'test'")
            if db_url.host not in ("localhost", "127.0.0.1"):
                raise ValueError("Test import must use an isolated local PostgreSQL server")
            app_url = os.getenv("DATABASE_URL")
            if (app_url and db_url == make_url(app_url)
                    and os.getenv("TEST_DATABASE_URL") != self.database_url):
                raise ValueError("Test import target is the application database")
        else:
            if os.getenv("CATALOGUE_IMPORT_PRODUCTION") != "yes":
                raise ValueError("Production import requires explicit CATALOGUE_IMPORT_PRODUCTION=yes")
            if not db_url.host or not db_url.host.endswith(".neon.tech"):
                raise ValueError("Production import must target Neon")


def _category_hash() -> str:
    payload = json.dumps(clean.SUBJECT_ALIASES, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _database_mb(session: Session) -> float:
    return session.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one()


def _check_storage(session: Session, config: ImportConfig) -> None:
    used = _database_mb(session)
    if used >= config.max_database_mb:
        raise RuntimeError(
            f"Database uses {used:.1f} MiB, above the {config.max_database_mb} MiB import stop threshold"
        )


def _get_run(session: Session, config: ImportConfig) -> CatalogueImportRun:
    run = session.get(CatalogueImportRun, config.run_id)
    if run is None:
        unfinished = session.execute(
            select(CatalogueImportRun.id).where(CatalogueImportRun.phase != "complete").limit(1)
        ).scalar_one_or_none()
        if unfinished:
            raise RuntimeError(f"Resume unfinished catalogue run {unfinished} before starting another")
        run = CatalogueImportRun(
            id=config.run_id, works_url=config.works_url,
            authors_url=config.authors_url, editions_url=config.editions_url,
            category_hash=_category_hash(), max_books=config.max_books,
            phase="works", checkpoint_line=0, selected_count=0,
            merged_count=0, error_count=0,
        )
        session.add(run)
        session.flush()
    elif (run.works_url, run.authors_url, run.editions_url, run.category_hash, run.max_books) != (
        config.works_url, config.authors_url, config.editions_url, _category_hash(), config.max_books
    ):
        raise ValueError("Resume with the same pinned dumps, category mapping, and max_books")
    return run


def _dedupe_works(rows: list[dict]) -> dict[str, dict]:
    works: dict[str, dict] = {}
    for work in rows:
        old = works.get(work["source_id"])
        if old:
            work["tags"] = sorted(set(old["tags"]) | set(work["tags"]))
            work["author_keys"] = list(dict.fromkeys(old["author_keys"] + work["author_keys"]))
            for field in ("description", "published_year", "cover_image_url"):
                work[field] = work[field] or old[field]
        works[work["source_id"]] = work
    return works


def _write_works(session: Session, run: CatalogueImportRun, rows: list[dict]) -> None:
    works = _dedupe_works(rows)
    if not works:
        return
    existing = dict(session.execute(
        select(CatalogueStageWork.source_id, CatalogueStageWork.tags).where(
            CatalogueStageWork.run_id == run.id,
            CatalogueStageWork.source_id.in_(works),
        )
    ).all())
    room = max(0, run.max_books - run.selected_count)
    allowed = {key: work for key, work in works.items() if key in existing}
    for key in allowed:
        allowed[key]["tags"] = sorted(set(allowed[key]["tags"]) | set(existing[key]))
    for key in works:
        if key not in existing and room:
            allowed[key] = works[key]
            room -= 1
            run.selected_count += 1
    if not allowed:
        return
    values = [
        {key: value for key, value in work.items() if key != "author_keys"} | {"run_id": run.id}
        for work in allowed.values()
    ]
    statement = insert(CatalogueStageWork).values(values)
    session.execute(statement.on_conflict_do_update(
        index_elements=["run_id", "source_id"],
        set_={
            "title": statement.excluded.title,
            "description": func.coalesce(statement.excluded.description, CatalogueStageWork.description),
            "published_year": func.coalesce(statement.excluded.published_year, CatalogueStageWork.published_year),
            "cover_image_url": func.coalesce(statement.excluded.cover_image_url, CatalogueStageWork.cover_image_url),
            "tags": statement.excluded.tags,
        },
    ))
    links = [
        {"run_id": run.id, "source_id": work["source_id"], "author_key": key, "position": position}
        for work in allowed.values() for position, key in enumerate(work["author_keys"])
    ]
    if links:
        statement = insert(CatalogueStageWorkAuthor).values(links)
        session.execute(statement.on_conflict_do_nothing())


def _write_authors(session: Session, run: CatalogueImportRun, rows: list[dict]) -> None:
    authors = {row["source_id"]: row for row in rows}
    if not authors:
        return
    needed = set(session.execute(
        select(CatalogueStageWorkAuthor.author_key).where(
            CatalogueStageWorkAuthor.run_id == run.id,
            CatalogueStageWorkAuthor.author_key.in_(authors),
        ).distinct()
    ).scalars())
    values = [{"run_id": run.id, "author_key": key, "name": authors[key]["name"]} for key in needed]
    if values:
        statement = insert(CatalogueStageAuthor).values(values)
        session.execute(statement.on_conflict_do_update(
            index_elements=["run_id", "author_key"], set_={"name": statement.excluded.name}
        ))


def _better_edition(candidate: dict, old: dict) -> bool:
    return candidate["quality"] > old["quality"] or (
        candidate["quality"] == old["quality"] and candidate["edition_key"] < old["edition_key"]
    )


def _write_editions(session: Session, run: CatalogueImportRun, rows: list[dict]) -> None:
    best: dict[str, dict] = {}
    for row in rows:
        old = best.get(row["source_id"])
        if old is None or _better_edition(row, old):
            best[row["source_id"]] = row
    if not best:
        return
    selected = set(session.execute(
        select(CatalogueStageWork.source_id).where(
            CatalogueStageWork.run_id == run.id, CatalogueStageWork.source_id.in_(best)
        )
    ).scalars())
    values = [{"run_id": run.id, **best[key]} for key in selected]
    if values:
        statement = insert(CatalogueStageEdition).values(values)
        session.execute(statement.on_conflict_do_update(
            index_elements=["run_id", "source_id"],
            set_={
                "edition_key": statement.excluded.edition_key,
                "quality": statement.excluded.quality,
                "isbn13": statement.excluded.isbn13,
                "page_count": statement.excluded.page_count,
            },
            where=(
                (statement.excluded.quality > CatalogueStageEdition.quality)
                | (
                    (statement.excluded.quality == CatalogueStageEdition.quality)
                    & (statement.excluded.edition_key < CatalogueStageEdition.edition_key)
                )
            ),
        ))


def _write_dump_batch(session: Session, config: ImportConfig, phase: str, batch: list[clean.DumpRow]) -> None:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    if run.phase != phase:
        raise RuntimeError("Import phase changed while processing")
    _check_storage(session, config)
    good = [row.record for row in batch if row.record is not None]
    malformed = [row for row in batch if row.error]
    run.error_count += len(malformed)
    if malformed:
        run.last_error = f"{phase} line {malformed[-1].line_number}: {malformed[-1].error}"
        log.warning("%s: %d malformed dump rows; last: %s", phase, len(malformed), run.last_error)
    if phase == "works":
        _write_works(session, run, list(filter(None, (clean.normalize_work(item) for item in good))))
    elif phase == "authors":
        _write_authors(session, run, list(filter(None, (clean.normalize_author(item) for item in good))))
    else:
        _write_editions(session, run, [edition for item in good for edition in clean.normalize_edition(item)])
    _check_storage(session, config)
    run.checkpoint_line = batch[-1].line_number
    log.info("%s line=%d selected=%d errors=%d db=%.1f MiB",
             phase, run.checkpoint_line, run.selected_count, run.error_count, _database_mb(session))


def _advance_phase(session: Session, config: ImportConfig, expected: str, following: str) -> None:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    if run.phase != expected:
        raise RuntimeError("Import phase changed unexpectedly")
    run.phase = following
    run.checkpoint_line = 0
    log.info("Finished %s; advancing to %s", expected, following)


def _stream_phase(factory: sessionmaker, config: ImportConfig, phase: str, url: str, following: str) -> None:
    for attempt in range(1, 4):
        with factory() as session:
            start = session.get(CatalogueImportRun, config.run_id).checkpoint_line
        batch: list[clean.DumpRow] = []
        batch_bytes = 0
        try:
            for row in clean.stream_dump(url, start_line=start, user_agent=config.user_agent):
                batch.append(row)
                batch_bytes += row.byte_size
                if len(batch) >= config.batch_size or batch_bytes >= 8_000_000:
                    with factory.begin() as session:
                        _write_dump_batch(session, config, phase, batch)
                        reached_limit = phase == "works" and session.get(
                            CatalogueImportRun, config.run_id
                        ).selected_count >= config.max_books
                    batch.clear()
                    batch_bytes = 0
                    if reached_limit:
                        break
            if batch:
                with factory.begin() as session:
                    _write_dump_batch(session, config, phase, batch)
            with factory.begin() as session:
                _advance_phase(session, config, phase, following)
            return
        except TRANSIENT_ERRORS as exc:
            if attempt == 3:
                raise
            delay = min(30, 2 ** attempt)
            log.warning("%s stream failed (%s); reopening from committed checkpoint in %ds",
                        phase, type(exc).__name__, delay)
            time.sleep(delay)


def _merge_batch(session: Session, config: ImportConfig) -> int:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    _check_storage(session, config)
    query = select(CatalogueStageWork).where(CatalogueStageWork.run_id == run.id)
    if run.merge_cursor:
        query = query.where(CatalogueStageWork.source_id > run.merge_cursor)
    works = session.execute(query.order_by(CatalogueStageWork.source_id).limit(config.batch_size)).scalars().all()
    if not works:
        run.phase = "cleanup"
        return 0
    source_ids = [work.source_id for work in works]
    author_rows = session.execute(
        select(CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.author_key,
               CatalogueStageWorkAuthor.position, CatalogueStageAuthor.name)
        .outerjoin(CatalogueStageAuthor, (
            (CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id)
            & (CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key)
        ))
        .where(CatalogueStageWorkAuthor.run_id == run.id,
               CatalogueStageWorkAuthor.source_id.in_(source_ids))
        .order_by(CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.position)
    ).all()
    authors_by_work: dict[str, list[str]] = {key: [] for key in source_ids}
    for source_id, _key, _position, name in author_rows:
        if name and name not in authors_by_work[source_id]:
            authors_by_work[source_id].append(name)
    editions = {item.source_id: item for item in session.execute(
        select(CatalogueStageEdition).where(
            CatalogueStageEdition.run_id == run.id,
            CatalogueStageEdition.source_id.in_(source_ids),
        )
    ).scalars()}
    ready = [work for work in works if authors_by_work[work.source_id]]
    missing = len(works) - len(ready)
    if missing:
        run.error_count += missing
        run.last_error = f"{missing} works in merge batch have no resolved author"
        log.warning("%s", run.last_error)
    if ready:
        author_names = {name for work in ready for name in authors_by_work[work.source_id]}
        tag_names = {name for work in ready for name in work.tags}
        statement = insert(Author).values([{"name": name} for name in sorted(author_names)])
        session.execute(statement.on_conflict_do_nothing(index_elements=["name"]))
        statement = insert(Tag).values(
            [{"name": name, "type": TagType.genre} for name in sorted(tag_names)]
        )
        session.execute(statement.on_conflict_do_nothing(index_elements=["name", "type"]))
        author_ids = dict(session.execute(
            select(Author.name, Author.id).where(Author.name.in_(author_names))
        ).all())
        tag_ids = dict(session.execute(
            select(Tag.name, Tag.id).where(Tag.name.in_(tag_names), Tag.type == TagType.genre)
        ).all())

        # Resolve legacy rows before the work-ID upsert. An ambiguous title/author
        # match is never guessed; existing user_books always keep their book_id.
        titles = {work.title for work in ready}
        legacy_rows = session.execute(
            select(Book.id, Book.title, Author.name)
            .join(book_authors, book_authors.c.book_id == Book.id)
            .join(Author, Author.id == book_authors.c.author_id)
            .where(Book.source_id.is_(None), Book.title.in_(titles))
        ).all()
        legacy: dict[tuple[str, str], set[int]] = {}
        for book_id, title, name in legacy_rows:
            legacy.setdefault((title, name), set()).add(book_id)
        stage_sources: dict[tuple[str, str], set[str]] = {}
        if legacy:
            hashes = {hashlib.md5(title.encode("utf-8")).hexdigest() for title, _ in legacy}
            possible_sources = session.execute(
                select(CatalogueStageWork.title, CatalogueStageAuthor.name, CatalogueStageWork.source_id)
                .join(CatalogueStageWorkAuthor, (
                    (CatalogueStageWorkAuthor.run_id == CatalogueStageWork.run_id)
                    & (CatalogueStageWorkAuthor.source_id == CatalogueStageWork.source_id)
                    & (CatalogueStageWorkAuthor.position == 0)
                ))
                .join(CatalogueStageAuthor, (
                    (CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id)
                    & (CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key)
                ))
                .where(CatalogueStageWork.run_id == run.id,
                       func.md5(CatalogueStageWork.title).in_(hashes))
            ).all()
            for title, name, source_id in possible_sources:
                stage_sources.setdefault((title, name), set()).add(source_id)
        claimed: set[int] = set()
        for work in ready:
            match_key = (work.title, authors_by_work[work.source_id][0])
            candidates = legacy.get(match_key, set())
            if len(candidates) == 1 and len(stage_sources.get(match_key, set())) == 1:
                book_id = next(iter(candidates))
                if book_id not in claimed:
                    session.execute(
                        update(Book).where(Book.id == book_id, Book.source_id.is_(None))
                        .values(source_id=work.source_id)
                    )
                    claimed.add(book_id)
            elif candidates:
                log.warning("Ambiguous legacy match for %s; leaving old rows intact", work.source_id)
                run.error_count += 1
                run.last_error = f"Ambiguous legacy title/author match: {work.source_id}"

        book_values = []
        for work in ready:
            edition = editions.get(work.source_id)
            book_values.append({
                "source_id": work.source_id, "title": work.title,
                "description": work.description,
                "published_year": work.published_year,
                "cover_image_url": work.cover_image_url,
                "isbn13": edition.isbn13 if edition else None,
                "page_count": edition.page_count if edition else None,
            })
        statement = insert(Book).values(book_values)
        complete_edition = statement.excluded.isbn13.is_not(None) & statement.excluded.page_count.is_not(None)
        result = session.execute(statement.on_conflict_do_update(
            index_elements=["source_id"],
            set_={
                "title": statement.excluded.title,
                "description": func.coalesce(statement.excluded.description, Book.description),
                "published_year": func.coalesce(statement.excluded.published_year, Book.published_year),
                "cover_image_url": func.coalesce(statement.excluded.cover_image_url, Book.cover_image_url),
                "isbn13": case(
                    (complete_edition, statement.excluded.isbn13),
                    (Book.page_count.is_(None), func.coalesce(statement.excluded.isbn13, Book.isbn13)),
                    else_=Book.isbn13,
                ),
                "page_count": case(
                    (complete_edition, statement.excluded.page_count),
                    (Book.isbn13.is_(None), func.coalesce(statement.excluded.page_count, Book.page_count)),
                    else_=Book.page_count,
                ),
            },
        ).returning(Book.source_id, Book.id))
        book_ids = dict(result.all())
        author_links = [
            {"book_id": book_ids[work.source_id], "author_id": author_ids[name]}
            for work in ready for name in authors_by_work[work.source_id]
        ]
        tag_links = [
            {"book_id": book_ids[work.source_id], "tag_id": tag_ids[name]}
            for work in ready for name in work.tags
        ]
        if author_links:
            session.execute(insert(book_authors).values(author_links).on_conflict_do_nothing())
        if tag_links:
            session.execute(insert(book_tags).values(tag_links).on_conflict_do_nothing())
        run.merged_count += len(ready)
    _check_storage(session, config)
    run.merge_cursor = works[-1].source_id
    log.info("merge cursor=%s merged=%d errors=%d db=%.1f MiB",
             run.merge_cursor, run.merged_count, run.error_count, _database_mb(session))
    return len(works)


def _cleanup_batch(session: Session, config: ImportConfig) -> int:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    # No other run can start while this one is active. TRUNCATE releases the
    # staging tables' allocated pages, unlike a large DELETE.
    session.execute(text(
        "TRUNCATE catalogue_stage_work_authors, catalogue_stage_editions, "
        "catalogue_stage_authors, catalogue_stage_works"
    ))
    run.phase = "complete"
    return 0


def run_import(config: ImportConfig) -> None:
    config.validate()
    engine = create_engine(config.database_url, pool_pre_ping=True)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with engine.connect() as lock_connection:
            if not lock_connection.execute(text(
                "SELECT pg_try_advisory_lock(hashtext('bookvane_catalogue_import'))"
            )).scalar_one():
                raise RuntimeError("Another catalogue import is already running")
            try:
                with factory.begin() as session:
                    _get_run(session, config)
                while True:
                    with factory() as session:
                        phase = session.get(CatalogueImportRun, config.run_id).phase
                    if phase == "works":
                        _stream_phase(factory, config, phase, config.works_url, "authors")
                    elif phase == "authors":
                        _stream_phase(factory, config, phase, config.authors_url, "editions")
                    elif phase == "editions":
                        _stream_phase(factory, config, phase, config.editions_url, "merge")
                    elif phase == "merge":
                        with factory.begin() as session:
                            _merge_batch(session, config)
                    elif phase == "cleanup":
                        with factory.begin() as session:
                            _cleanup_batch(session, config)
                    else:
                        log.info("Import %s complete", config.run_id)
                        return
            finally:
                lock_connection.execute(text(
                    "SELECT pg_advisory_unlock(hashtext('bookvane_catalogue_import'))"
                ))
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--works-url", required=True)
    parser.add_argument("--authors-url", required=True)
    parser.add_argument("--editions-url", required=True)
    parser.add_argument("--mode", choices=("test", "production"), required=True)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-books", type=int, default=100000)
    parser.add_argument("--max-database-mb", type=int, default=450)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    database_url = os.getenv("CATALOGUE_DATABASE_URL")
    if not database_url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    run_import(ImportConfig(
        run_id=args.run_id, works_url=args.works_url,
        authors_url=args.authors_url, editions_url=args.editions_url,
        database_url=database_url, mode=args.mode,
        user_agent=os.getenv("CATALOGUE_USER_AGENT", ""),
        batch_size=args.batch_size, max_books=args.max_books,
        max_database_mb=args.max_database_mb,
    ))


if __name__ == "__main__":
    main()
