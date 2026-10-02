"""Selection responsibilities for the bounded catalogue importer."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict

from sqlalchemy import and_, case, delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from data.config import ImportConfig, percentage_quotas
from data.reporting import _check_storage, _issue
from data.staging import _existing_book_aliases, _prune_candidates
from models import (
    Author, Book, CatalogueImportRun,
    CatalogueStageAuthor, CatalogueStageAuthorCount, CatalogueStageCandidate,
    CatalogueStageEdition, CatalogueStageWork, CatalogueStageWorkAuthor,
    book_authors,
)

log = logging.getLogger("bookvane.catalogue")


def _mark_legacy_matches(session: Session, run: CatalogueImportRun, batch_size: int) -> None:
    cursor = ""
    while True:
        works = session.execute(select(CatalogueStageWork).where(
            CatalogueStageWork.run_id == run.id, CatalogueStageWork.source_id > cursor
        ).order_by(CatalogueStageWork.source_id).limit(batch_size)).scalars().all()
        if not works:
            return
        cursor = works[-1].source_id
        keys = {work.source_id for work in works}
        primary_rows = session.execute(
            select(CatalogueStageWorkAuthor.source_id, CatalogueStageAuthor.name)
            .join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            ))
            .where(CatalogueStageWorkAuthor.run_id == run.id,
                   CatalogueStageWorkAuthor.source_id.in_(keys),
                   CatalogueStageWorkAuthor.position == 0)
        ).all()
        primary = dict(primary_rows)
        titles = {work.title for work in works if work.source_id in primary}
        if not titles:
            continue
        legacy_rows = session.execute(
            select(Book.title, Author.name, func.count(func.distinct(Book.id)), func.min(Book.id))
            .join(book_authors, book_authors.c.book_id == Book.id)
            .join(Author, Author.id == book_authors.c.author_id)
            .where(Book.source_id.is_(None), Book.title.in_(titles))
            .group_by(Book.title, Author.name)
        ).all()
        by_title_author = {(title, name): (count, book_id)
                           for title, name, count, book_id in legacy_rows}
        unique_ids = {book_id for _, _, count, book_id in legacy_rows if count == 1}
        legacy_details = {book_id: (isbn, cover) for book_id, isbn, cover in session.execute(
            select(Book.id, Book.isbn13, Book.cover_image_url).where(Book.id.in_(unique_ids))
        )}
        # Check all staged works with these titles, including those outside this page.
        stage_rows = session.execute(
            select(CatalogueStageWork.title, CatalogueStageAuthor.name,
                   func.count(func.distinct(CatalogueStageWork.source_id)))
            .join(CatalogueStageWorkAuthor, and_(
                CatalogueStageWorkAuthor.run_id == CatalogueStageWork.run_id,
                CatalogueStageWorkAuthor.source_id == CatalogueStageWork.source_id,
                CatalogueStageWorkAuthor.position == 0,
            ))
            .join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            ))
            .where(CatalogueStageWork.run_id == run.id, CatalogueStageWork.title.in_(titles))
            .group_by(CatalogueStageWork.title, CatalogueStageAuthor.name)
        ).all()
        stage_counts = {(title, name): count for title, name, count in stage_rows}
        editions = session.execute(select(CatalogueStageEdition).where(
            CatalogueStageEdition.run_id == run.id,
            CatalogueStageEdition.source_id.in_(keys),
        )).scalars().all()
        edition_isbns: dict[str, set[str]] = defaultdict(set)
        for edition in editions:
            edition_isbns[edition.source_id].update(item["isbn13"] for item in edition.isbns)
        for work in works:
            author_name = primary.get(work.source_id)
            if not author_name:
                continue
            match_key = (work.title, author_name)
            candidate = by_title_author.get(match_key)
            if not candidate:
                continue
            candidate_count, book_id = candidate
            if candidate_count != 1 or stage_counts.get(match_key) != 1:
                _issue(session, run.id, "ambiguous_legacy_book", work.source_id, work.title)
                continue
            legacy_isbn, legacy_cover = legacy_details[book_id]
            if ((legacy_isbn and legacy_isbn in edition_isbns[work.source_id])
                    or (legacy_cover and legacy_cover == work.cover_image_url)):
                work.legacy_book_id = book_id
                work.forced = True
            else:
                _issue(session, run.id, "unmatched_legacy_book", work.source_id,
                       "Title/author matched, but ISBN or cover did not corroborate")


def _clear_unverified_forced(session: Session, run: CatalogueImportRun, batch_size: int) -> None:
    cursor = ""
    while True:
        works = session.execute(select(CatalogueStageWork).where(
            CatalogueStageWork.run_id == run.id,
            CatalogueStageWork.source_id > cursor,
            CatalogueStageWork.forced.is_(True),
            CatalogueStageWork.legacy_book_id.is_(None),
        ).order_by(CatalogueStageWork.source_id).limit(batch_size)).scalars().all()
        if not works:
            return
        cursor = works[-1].source_id
        keys = {work.source_id for work in works}
        existing = set(session.execute(select(Book.source_id).where(
            Book.source_id.in_(keys)
        )).scalars())
        redirected = set(_existing_book_aliases(session, keys).values())
        for work in works:
            if work.source_id not in existing and work.source_id not in redirected:
                work.forced = False


def _choose_category_batch(session: Session, run: CatalogueImportRun,
                           category: str | None, count: int) -> int:
    candidate = CatalogueStageCandidate
    work = CatalogueStageWork
    link = CatalogueStageWorkAuthor
    author = CatalogueStageAuthor
    author_count = CatalogueStageAuthorCount
    query = (select(work.source_id, link.author_key, candidate.category)
             .join(candidate, and_(candidate.run_id == work.run_id, candidate.source_id == work.source_id))
             .join(link, and_(link.run_id == work.run_id, link.source_id == work.source_id, link.position == 0))
             .join(author, and_(author.run_id == link.run_id, author.author_key == link.author_key))
             .outerjoin(author_count, and_(author_count.run_id == work.run_id,
                                           author_count.author_key == link.author_key))
             .where(work.run_id == run.id, work.selected.is_(False), work.forced.is_(False)))
    if category:
        query = query.where(candidate.category == category)
    author_turn = func.row_number().over(
        partition_by=link.author_key, order_by=(candidate.tie_hash, work.source_id)
    )
    query = query.order_by(candidate.quality.desc(),
                           func.coalesce(author_count.selected_count, 0) + author_turn,
                           candidate.tie_hash, work.source_id).limit(max(count * 3, 50))
    rows = query.with_only_columns(work.source_id, link.author_key, candidate.category).limit(max(count * 3, 50))
    # Preserve the ordering expression when materializing the bounded candidate page.
    chosen: dict[str, tuple[str, str]] = {}
    for source_id, author_key, allocation in session.execute(rows):
        if source_id not in chosen:
            chosen[source_id] = (author_key, allocation)
        if len(chosen) >= count:
            break
    if not chosen:
        return 0
    ids = list(chosen)
    allocation_value = (category if category else case(
        {source_id: value[1] for source_id, value in chosen.items()},
        value=CatalogueStageWork.source_id,
    ))
    session.execute(update(CatalogueStageWork).where(
        CatalogueStageWork.run_id == run.id,
        CatalogueStageWork.source_id.in_(ids),
    ).values(selected=True, allocation_category=allocation_value))
    author_counts = Counter(value[0] for value in chosen.values())
    statement = insert(CatalogueStageAuthorCount).values([
        {"run_id": run.id, "author_key": key, "selected_count": value}
        for key, value in author_counts.items()
    ])
    session.execute(statement.on_conflict_do_update(
        index_elements=["run_id", "author_key"],
        set_={"selected_count": CatalogueStageAuthorCount.selected_count + statement.excluded.selected_count},
    ))
    run.selected_count += len(ids)
    return len(ids)


def _select_works(session: Session, config: ImportConfig) -> None:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    if run.phase != "select":
        raise RuntimeError("Import phase changed during selection")
    _check_storage(session, run, config)
    _mark_legacy_matches(session, run, config.batch_size)
    _clear_unverified_forced(session, run, config.batch_size)
    remaining = max(0, config.target_books - run.baseline_count)
    quotas = percentage_quotas(remaining, config.category_weights)
    scarcity = {}
    for category in quotas:
        scarcity[category] = session.scalar(select(func.count()).select_from(
            CatalogueStageCandidate
        ).join(CatalogueStageWorkAuthor, and_(
            CatalogueStageWorkAuthor.run_id == CatalogueStageCandidate.run_id,
            CatalogueStageWorkAuthor.source_id == CatalogueStageCandidate.source_id,
            CatalogueStageWorkAuthor.position == 0,
        )).join(CatalogueStageAuthor, and_(
            CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
            CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
        )).where(CatalogueStageCandidate.run_id == run.id,
                CatalogueStageCandidate.category == category)) or 0
    selected_per_category = Counter()
    for category in sorted(quotas, key=lambda name: (scarcity[name], name)):
        while selected_per_category[category] < quotas[category]:
            count = _choose_category_batch(session, run, category,
                                           min(config.batch_size, quotas[category] - selected_per_category[category]))
            if not count:
                break
            selected_per_category[category] += count
    while run.selected_count < remaining:
        count = _choose_category_batch(session, run, None,
                                       min(config.batch_size, remaining - run.selected_count))
        if not count:
            break
    for category, quota in quotas.items():
        if selected_per_category[category] < quota:
            _issue(session, run.id, "category_shortfall", category,
                   f"Target {quota}, first allocation {selected_per_category[category]}; remainder redistributed")
    if run.selected_count < remaining:
        can_expand = any(run.shortlist_factor * max(10, quotas[name]) < seen
                         for name, seen in (run.category_seen_counts or {}).items())
        if can_expand:
            run.shortlist_factor *= 2
            run.phase, run.checkpoint_line, run.category_seen_counts = "works", 0, {}
            run.selected_count = 0
            run.report = {}
            session.execute(update(CatalogueStageWork).where(
                CatalogueStageWork.run_id == run.id
            ).values(selected=False, allocation_category=None))
            session.execute(delete(CatalogueStageAuthorCount).where(CatalogueStageAuthorCount.run_id == run.id))
            log.info("Shortlist exhausted; widening to factor=%d and replaying pinned dumps", run.shortlist_factor)
            return
        _issue(session, run.id, "target_shortfall", None,
               f"Only {run.selected_count} new works selected for {remaining} available slots")
    session.execute(text("""
        DELETE FROM catalogue_stage_candidates c
        WHERE c.run_id = :run_id AND NOT EXISTS (
            SELECT 1 FROM catalogue_stage_works w
            WHERE w.run_id = c.run_id AND w.source_id = c.source_id AND (w.selected OR w.forced)
        )
    """), {"run_id": run.id})
    _prune_candidates(session, run, config)
    run.phase, run.checkpoint_line = "hydrate", 0
    _check_storage(session, run, config)


def _backfill_authors(factory: sessionmaker, config: ImportConfig) -> None:
    """Reuse a legacy Author row only when all its linked works prove one identity."""
    cursor = 0
    while True:
        with factory.begin() as session:
            run = session.get(CatalogueImportRun, config.run_id)
            authors = session.execute(select(Author).where(
                Author.id > cursor, Author.source_id.is_(None)
            ).order_by(Author.id).limit(config.batch_size)).scalars().all()
            if not authors:
                return
            cursor = authors[-1].id
            ids = [author.id for author in authors]
            links = session.execute(select(
                book_authors.c.author_id, book_authors.c.book_id, Book.source_id
            ).join(Book, Book.id == book_authors.c.book_id).where(
                book_authors.c.author_id.in_(ids)
            )).all()
            linked_book_ids = {book_id for _, book_id, _ in links}
            legacy_work = dict(session.execute(select(
                CatalogueStageWork.legacy_book_id, CatalogueStageWork.source_id
            ).where(CatalogueStageWork.run_id == run.id,
                    CatalogueStageWork.legacy_book_id.in_(linked_book_ids))).all())
            work_ids = {source_id or legacy_work.get(book_id) for _, book_id, source_id in links}
            work_ids.discard(None)
            stage_links = session.execute(select(
                CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.author_key,
                CatalogueStageAuthor.name,
            ).join(CatalogueStageAuthor, and_(
                CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
                CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
            )).where(CatalogueStageWorkAuthor.run_id == run.id,
                    CatalogueStageWorkAuthor.source_id.in_(work_ids))).all()
            identities: dict[tuple[str, str], set[str]] = defaultdict(set)
            for source_id, author_key, name in stage_links:
                identities[(source_id, name)].add(author_key)
            linked: dict[int, list[str | None]] = defaultdict(list)
            for author_id, book_id, source_id in links:
                linked[author_id].append(source_id or legacy_work.get(book_id))
            existing_source_keys = set(session.execute(select(Author.source_id).where(
                Author.source_id.in_({key for keys in identities.values() for key in keys})
            )).scalars())
            for author in authors:
                works = linked.get(author.id, [])
                if not works or any(source_id is None for source_id in works):
                    continue
                candidate_keys = {key for source_id in works
                                  for key in identities.get((source_id, author.name), set())}
                if len(candidate_keys) != 1 or any(
                    identities.get((source_id, author.name), set()) != candidate_keys
                    for source_id in works
                ):
                    continue
                key = next(iter(candidate_keys))
                if key not in existing_source_keys:
                    author.source_id = key
                    existing_source_keys.add(key)
