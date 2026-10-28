"""Dry run: report what the merge would add and fill, from staged data, without writing any catalogue row."""
from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy import or_, select
from sqlalchemy.orm import sessionmaker

from data.config import ImportConfig
from data.merge import _blank, median_pages
from data.staging import _existing_book_aliases
from models import (
    Book, CatalogueImportRun, CatalogueStageEdition, CatalogueStageWork, CatalogueStageWorkAuthor,
)

FIELDS = ("description", "published_year", "page_count", "cover_image_url")


def _gaps(book: Book | None, work: CatalogueStageWork, pages: int | None) -> dict:
    """The values this work would supply, keyed by field, for a book (None = a new book)."""
    supplied = {"description": work.description, "published_year": work.published_year,
                "page_count": pages, "cover_image_url": work.cover_image_url}
    return {field: value for field, value in supplied.items()
            if value is not None and (book is None or _blank(getattr(book, field)))}


def _complete(values: dict) -> bool:
    return bool(not _blank(values["cover_image_url"]) and not _blank(values["description"])
                and values["page_count"] and values["page_count"] > 0 and values["published_year"] is not None)


def dry_run_report(factory: sessionmaker, config: ImportConfig) -> dict:
    """Walk the staged works the merge would visit; store and return the prediction in the run report."""
    report = Counter()
    filled: Counter = Counter()
    cursor = ""
    with factory() as session:
        while True:
            works = session.execute(select(CatalogueStageWork).where(
                CatalogueStageWork.run_id == config.run_id, CatalogueStageWork.source_id > cursor,
                or_(CatalogueStageWork.selected, CatalogueStageWork.forced),
            ).order_by(CatalogueStageWork.source_id).limit(config.batch_size)).scalars().all()
            if not works:
                break
            cursor = works[-1].source_id
            keys = {work.source_id for work in works}
            old_by_new: dict[str, list[str]] = defaultdict(list)
            for old, new in _existing_book_aliases(session, keys).items():
                old_by_new[new].append(old)
            books = session.execute(select(Book).where(or_(
                Book.source_id.in_(keys | {old for olds in old_by_new.values() for old in olds}),
                Book.id.in_([work.legacy_book_id for work in works if work.legacy_book_id]),
            ))).scalars().all()
            by_source = {book.source_id: book for book in books if book.source_id}
            by_id = {book.id: book for book in books}
            authors = set(session.execute(select(CatalogueStageWorkAuthor.source_id).where(
                CatalogueStageWorkAuthor.run_id == config.run_id,
                CatalogueStageWorkAuthor.source_id.in_(keys))).scalars())
            editions: dict[str, list[dict]] = defaultdict(list)
            for edition in session.execute(select(CatalogueStageEdition).where(
                    CatalogueStageEdition.run_id == config.run_id, CatalogueStageEdition.source_id.in_(keys))).scalars():
                editions[edition.source_id].append({"page_count": edition.page_count, "languages": edition.languages})
            for work in works:
                book = next((by_source[source] for source in [work.source_id, *old_by_new[work.source_id]]
                             if source in by_source), None)
                if book is None and work.legacy_book_id:
                    book = by_id.get(work.legacy_book_id)
                pages = median_pages(editions[work.source_id])
                if book is None:
                    if work.source_id not in authors:
                        report["skipped_without_author"] += 1
                        continue
                    report["new_books"] += 1
                    values = {"description": work.description, "published_year": work.published_year,
                              "page_count": pages, "cover_image_url": work.cover_image_url}
                    report["new_books_complete"] += _complete(values)
                    continue
                report["existing_books_visited"] += 1
                gaps = _gaps(book, work, pages)
                if not gaps:
                    continue
                filled.update(gaps.keys())
                before = {field: getattr(book, field) for field in FIELDS}
                after = before | gaps
                report["existing_filled_books"] += 1
                report["existing_newly_complete"] += (not _complete(before)) and _complete(after)
    result = {key: int(value) for key, value in report.items()}
    result["existing_filled"] = {field: int(filled.get(field, 0)) for field in FIELDS}
    for key in ("new_books", "new_books_complete", "existing_books_visited", "existing_filled_books",
                "existing_newly_complete", "skipped_without_author"):
        result.setdefault(key, 0)
    with factory.begin() as session:
        run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
        run.report = dict(run.report or {}) | {"dry_run": result}
    return result
