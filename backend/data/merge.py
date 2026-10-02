"""Merge responsibilities for the bounded catalogue importer."""

from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from data import clean
from data.config import ImportConfig
from data.reporting import _check_storage, _issue
from data.staging import _existing_book_aliases, select_useful_editions
from models import (
    Author, Book, CatalogueImportRun, CatalogueStageAuthor,
    CatalogueStageEdition, CatalogueStageWork, CatalogueStageWorkAuthor,
    Edition, EditionISBN, Tag, TagType, book_authors, book_tags,
)

log = logging.getLogger("bookvane.catalogue")
FIELD_TITLE, FIELD_DESCRIPTION, FIELD_YEAR, FIELD_COVER, FIELD_ISBN, FIELD_PAGES = (1, 2, 4, 8, 16, 32)


def _set_work_value(session: Session, run: CatalogueImportRun, book: Book,
                    field_name: str, value: object, bit: int, source_id: str) -> None:
    if value is None:
        return
    old = getattr(book, field_name)
    if old is None or book.source_managed_fields & bit:
        setattr(book, field_name, value)
        book.source_managed_fields |= bit
    elif old != value:
        _issue(session, run.id, "legacy_field_conflict", source_id,
               f"Preserved existing {field_name}; Open Library has a different value")


def _merge_batch(session: Session, config: ImportConfig) -> int:
    run = session.get(CatalogueImportRun, config.run_id, with_for_update=True)
    _check_storage(session, run, config)
    query = select(CatalogueStageWork).where(
        CatalogueStageWork.run_id == run.id,
        or_(CatalogueStageWork.selected, CatalogueStageWork.forced),
    )
    if run.merge_cursor:
        query = query.where(CatalogueStageWork.source_id > run.merge_cursor)
    works = session.execute(query.order_by(CatalogueStageWork.source_id).limit(config.batch_size)).scalars().all()
    if not works:
        run.phase = "cleanup"
        return 0
    source_ids = {work.source_id for work in works}
    author_rows = session.execute(select(
        CatalogueStageWorkAuthor.source_id, CatalogueStageWorkAuthor.author_key,
        CatalogueStageAuthor.name,
    ).outerjoin(CatalogueStageAuthor, and_(
        CatalogueStageAuthor.run_id == CatalogueStageWorkAuthor.run_id,
        CatalogueStageAuthor.author_key == CatalogueStageWorkAuthor.author_key,
    )).where(CatalogueStageWorkAuthor.run_id == run.id,
            CatalogueStageWorkAuthor.source_id.in_(source_ids))).all()
    authors_by_work: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for source_id, author_key, name in author_rows:
        if name:
            authors_by_work[source_id].append((author_key, name))
    staged_editions = session.execute(select(CatalogueStageEdition).where(
        CatalogueStageEdition.run_id == run.id,
        CatalogueStageEdition.source_id.in_(source_ids),
    )).scalars().all()
    editions_by_work: dict[str, list[dict]] = defaultdict(list)
    for edition in staged_editions:
        editions_by_work[edition.source_id].append({
            "edition_key": edition.edition_key, "quality": edition.quality,
            "isbns": edition.isbns, "page_count": edition.page_count,
            "languages": edition.languages, "publication_date": edition.publication_date,
            "publishers": edition.publishers, "physical_format": edition.physical_format,
            "cover_image_url": edition.cover_image_url,
        })
    aliases = list(_existing_book_aliases(session, source_ids).items())
    old_by_new: dict[str, list[str]] = defaultdict(list)
    for old, new in aliases:
        old_by_new[new].append(old)
    potential_sources = source_ids | {old for old, _ in aliases}
    existing_books = session.execute(select(Book).where(or_(
        Book.source_id.in_(potential_sources),
        Book.id.in_([work.legacy_book_id for work in works if work.legacy_book_id]),
    ))).scalars().all()
    books_by_source = {book.source_id: book for book in existing_books if book.source_id}
    books_by_id = {book.id: book for book in existing_books}
    book_for_work: dict[str, Book] = {}
    for work in works:
        candidates = {book.id: book for source in [work.source_id, *old_by_new[work.source_id]]
                      if (book := books_by_source.get(source))}
        if work.legacy_book_id and work.legacy_book_id in books_by_id:
            candidates[work.legacy_book_id] = books_by_id[work.legacy_book_id]
        if len(candidates) > 1:
            _issue(session, run.id, "redirect_book_conflict", work.source_id,
                   "Two existing Book IDs resolve to the same Open Library work; no merge was guessed")
            continue
        book = next(iter(candidates.values())) if candidates else None
        if book is None and not authors_by_work[work.source_id]:
            _issue(session, run.id, "missing_author", work.source_id, "No resolved author; new Book skipped")
            continue
        if book is None:
            book = Book(title=work.title, source_id=work.source_id,
                        source_managed_fields=FIELD_TITLE)
            session.add(book)
        elif book.source_id != work.source_id:
            book.source_id = work.source_id
        for field_name, value, bit in (
            ("title", work.title, FIELD_TITLE),
            ("description", work.description, FIELD_DESCRIPTION),
            ("published_year", work.published_year, FIELD_YEAR),
            ("cover_image_url", work.cover_image_url, FIELD_COVER),
        ):
            _set_work_value(session, run, book, field_name, value, bit, work.source_id)
        book_for_work[work.source_id] = book
    session.flush()
    if not book_for_work:
        run.merge_cursor = works[-1].source_id
        return len(works)

    author_keys = {key for source_id in book_for_work for key, _ in authors_by_work[source_id]}
    existing_authors = {author.source_id: author for author in session.execute(
        select(Author).where(Author.source_id.in_(author_keys))
    ).scalars()}
    names_by_key = {key: name for source_id in book_for_work for key, name in authors_by_work[source_id]}
    for key in author_keys:
        if key not in existing_authors:
            author = Author(source_id=key, name=names_by_key[key], source_managed_name=True)
            session.add(author)
            existing_authors[key] = author
        elif existing_authors[key].source_managed_name:
            existing_authors[key].name = names_by_key[key]
    tag_specs = {(tag["name"].casefold(), tag["name"], tag["type"])
                 for work in works if work.source_id in book_for_work for tag in work.tags}
    tags_by_key = {tag.name.casefold(): tag for tag in session.execute(select(Tag).where(
        func.lower(Tag.name).in_({item[0] for item in tag_specs})
    )).scalars()}
    original = set(clean.SUBJECT_ALIASES) - {
        "science", "technology", "business", "art", "music", "cooking", "travel",
        "health", "nature", "sports", "psychology", "religion", "politics", "education",
    }
    for key, name, tag_type in sorted(tag_specs):
        if key not in tags_by_key:
            tag = Tag(name=name, type=TagType(tag_type), visible_in_v2=name in original)
            session.add(tag)
            tags_by_key[key] = tag
        elif tags_by_key[key].type != TagType(tag_type):
            _issue(session, run.id, "tag_type_conflict", None,
                   f"Existing tag {name} has type {tags_by_key[key].type}; import wanted {tag_type}")
    session.flush()

    book_ids = [book.id for book in book_for_work.values()]
    session.execute(delete(book_authors).where(book_authors.c.book_id.in_(book_ids),
                                             book_authors.c.source_managed.is_(True)))
    session.execute(delete(book_tags).where(book_tags.c.book_id.in_(book_ids),
                                          book_tags.c.source_managed.is_(True)))
    author_links = list({(book_for_work[source_id].id, existing_authors[key].id):
                         {"book_id": book_for_work[source_id].id, "author_id": existing_authors[key].id,
                          "source_managed": True}
                         for source_id in book_for_work for key, _ in authors_by_work[source_id]}.values())
    tag_links = list({(book_for_work[work.source_id].id, tags_by_key[tag["name"].casefold()].id):
                      {"book_id": book_for_work[work.source_id].id,
                       "tag_id": tags_by_key[tag["name"].casefold()].id, "source_managed": True}
                      for work in works if work.source_id in book_for_work for tag in work.tags
                      if tags_by_key[tag["name"].casefold()].type == TagType(tag["type"])}.values())
    for rows, table in ((author_links, book_authors), (tag_links, book_tags)):
        for start in range(0, len(rows), 500):
            session.execute(insert(table).values(rows[start:start + 500]).on_conflict_do_nothing())

    # Load, prune, and refresh all editions for this batch with set-based queries.
    selected_by_work = {key: select_useful_editions(editions_by_work[key]) for key in book_for_work}
    chosen_keys = {item["edition_key"] for items in selected_by_work.values() for item in items}
    old_editions = session.execute(select(Edition).where(Edition.book_id.in_(book_ids))).scalars().all()
    old_ids = [edition.id for edition in old_editions]
    for book in book_for_work.values():
        book.preferred_edition_id = None
    session.flush()
    if old_ids:
        session.execute(delete(EditionISBN).where(EditionISBN.edition_id.in_(old_ids)))
    stale_ids = [edition.id for edition in old_editions if edition.source_id not in chosen_keys]
    if stale_ids:
        session.execute(delete(Edition).where(Edition.id.in_(stale_ids)))
    persisted: dict[str, Edition] = {edition.source_id: edition for edition in old_editions
                                     if edition.source_id in chosen_keys}
    for source_id, items in selected_by_work.items():
        for item in items:
            edition = persisted.get(item["edition_key"])
            if edition is None:
                edition = Edition(book_id=book_for_work[source_id].id, source_id=item["edition_key"])
                session.add(edition)
            edition.page_count = item["page_count"]
            edition.languages = item["languages"]
            edition.publication_date = item["publication_date"]
            edition.publishers = item["publishers"]
            edition.physical_format = item["physical_format"]
            edition.cover_image_url = item["cover_image_url"]
            persisted[item["edition_key"]] = edition
    session.flush()
    isbn_rows = [{"edition_id": persisted[item["edition_key"]].id, **isbn}
                 for items in selected_by_work.values() for item in items for isbn in item["isbns"]]
    for start in range(0, len(isbn_rows), 500):
        session.execute(insert(EditionISBN).values(isbn_rows[start:start + 500]).on_conflict_do_nothing())
    for source_id, book in book_for_work.items():
        items = selected_by_work[source_id]
        if not items:
            continue
        preferred = items[0]
        preferred_isbn = next((item["isbn13"] for item in preferred["isbns"]
                               if not item["derived_from_isbn10"]), None)
        preferred_isbn = preferred_isbn or next((item["isbn13"] for item in preferred["isbns"]), None)
        _set_work_value(session, run, book, "isbn13", preferred_isbn, FIELD_ISBN, source_id)
        _set_work_value(session, run, book, "page_count", preferred["page_count"], FIELD_PAGES, source_id)
        if not book.cover_image_url:
            _set_work_value(session, run, book, "cover_image_url",
                            preferred["cover_image_url"], FIELD_COVER, source_id)
        if book.isbn13 == preferred_isbn and book.page_count == preferred["page_count"]:
            book.preferred_edition_id = persisted[preferred["edition_key"]].id
        else:
            _issue(session, run.id, "preferred_edition_conflict", source_id,
                   "Legacy ISBN/page values were preserved; preferred edition link remains pending")
    run.merged_count += len(book_for_work)
    run.merge_cursor = works[-1].source_id
    _check_storage(session, run, config)
    log.info("merge cursor=%s books=%d", run.merge_cursor, run.merged_count)
    return len(works)
