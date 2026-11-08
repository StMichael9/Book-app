"""Re-clean the books we already hold with the same rules as every new book (T47). Dry run by default.

    python -m data.clean_catalogue --dry-run [--samples 50] [--report clean-report.md]
    python -m data.clean_catalogue --apply   [--tag 2026-11-10]
    python -m data.clean_catalogue --undo TAG

Reads CATALOGUE_DATABASE_URL. A dry run writes nothing. A real run changes only `books` (title, description, quality score),
drops repeated or junk `book_authors` links, folds duplicate works into one (moving readers' links, adding a work-key alias,
and unlisting the duplicate, never deleting it), and logs every change in `catalogue_import_issues` with its before and after so
`--undo TAG` can put it back. A reader's own entry is never edited: it is only re-linked when its book is folded into another.
Reports carry counts and sample titles for the owner; nothing here is meant for a public log.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import create_engine, delete, func, insert, select, update
from sqlalchemy.orm import Session

from data import cleaner
from models import (Author, Book, BookTitleAlias, CatalogueImportIssue, CatalogueSourceAlias, Tag, TagType, UserBook,
                    book_authors, book_tags)

BATCH = 500
CODE = "clean_book"
ALIAS_TYPE = "merged_work"


@dataclass
class Row:
    id: int
    title: str
    description: str | None
    source_id: str | None
    popularity: float | None
    cover: str | None
    pages: int | None
    year: int | None
    score: int | None
    authors: list[tuple[int, str]] = field(default_factory=list)     # (author id, name), oldest author row first
    genres: int = 0


@dataclass
class Change:
    book_id: int
    source_id: str | None
    before: dict
    after: dict
    drop_authors: list[tuple[int, str]]
    notes: list[str]


def order_authors(authors: list[tuple[int, str]], title: str) -> list[tuple[int, str]]:
    """Open Library's first-listed author is not stored; the one named in the title (else the oldest row) leads."""
    title_tokens = set(cleaner.name_tokens(title))
    named = [a for a in authors if set(cleaner.name_tokens(a[1])[-1:]) & title_tokens]
    return named[:1] + [a for a in authors if a not in named[:1]]


def plan(row: Row) -> tuple[Change | None, dict]:
    """What cleaning would do to one book (None when nothing changes) and its facts for the report."""
    ordered = order_authors(row.authors, row.title)
    kept_names = cleaner.clean_authors([name for _, name in ordered])
    keep_ids, seen = set(), set()
    for author_id, name in sorted(ordered, key=lambda item: item[0]):
        tidy = cleaner.tidy_name(name)
        if tidy in kept_names and tidy not in seen:
            seen.add(tidy)
            keep_ids.add(author_id)
    drop = [a for a in row.authors if a[0] not in keep_ids] if keep_ids else []   # never strip a book of every author
    final_authors = kept_names if keep_ids else [name for _, name in row.authors]
    title = cleaner.clean_title(row.title, final_authors) or row.title
    description = cleaner.clean_description(row.description) if row.description else None
    score = cleaner.quality_score(title=title, authors=final_authors, description=description, cover=row.cover,
                                  pages=row.pages, year=row.year, popularity=row.popularity, genres=row.genres)
    facts = {
        "many_authors": len(row.authors) > 3, "derivative": cleaner.is_derivative(title),
        "bad_description": bool(row.description) and description is None,
        "seller_text": bool(row.description and cleaner.SELLER.search(row.description)),
        "unlisted_after": score < cleaner.LISTING_THRESHOLD, "authors_dropped": len(drop)}
    notes = []
    after = {"title": title, "description": description, "quality_score": score}
    before = {"title": row.title, "description": row.description, "quality_score": row.score}
    if title != row.title:
        notes.append("title")
    if description != row.description:
        notes.append("description")
    if drop:
        notes.append("authors")
    if score != row.score:
        notes.append("quality")
    if not notes:
        return None, facts
    before["authors"] = [name for _, name in row.authors]
    after["authors"] = final_authors
    return Change(row.id, row.source_id, before, after, drop, notes), facts


def batches(db: Session, limit: int | None, only: list[int] | None = None):
    last, seen = 0, 0
    while True:
        books = db.execute(select(Book.id, Book.title, Book.description, Book.source_id, Book.popularity, Book.cover_image_url,
                                  Book.page_count, Book.published_year, Book.quality_score)
                           .where(Book.id > last, *([Book.id.in_(only)] if only is not None else []))
                           .order_by(Book.id).limit(BATCH)).all()
        if not books:
            return
        ids = [b.id for b in books]
        authors: dict[int, list] = defaultdict(list)
        for book_id, author_id, name in db.execute(select(book_authors.c.book_id, Author.id, Author.name).join(
                Author, Author.id == book_authors.c.author_id).where(book_authors.c.book_id.in_(ids)).order_by(
                book_authors.c.book_id, Author.id)):
            authors[book_id].append((author_id, name))
        genres = dict(db.execute(select(book_tags.c.book_id, func.count()).join(Tag, Tag.id == book_tags.c.tag_id).where(
            book_tags.c.book_id.in_(ids), Tag.type == TagType.genre).group_by(book_tags.c.book_id)).all())
        yield [Row(b.id, b.title, b.description, b.source_id, b.popularity, b.cover_image_url, b.page_count, b.published_year,
                   b.quality_score, authors.get(b.id, []), genres.get(b.id, 0)) for b in books]
        last = ids[-1]
        seen += len(ids)
        if limit and seen >= limit:
            return


def _write(db: Session, changes: list[Change], tag: str) -> None:
    for change in changes:
        values = {"title": change.after["title"], "description": change.after["description"],
                  "quality_score": change.after["quality_score"]}
        db.execute(update(Book).where(Book.id == change.book_id).values(**values))
        if change.drop_authors:
            db.execute(delete(book_authors).where(book_authors.c.book_id == change.book_id,
                                                  book_authors.c.author_id.in_([a[0] for a in change.drop_authors])))
    db.execute(insert(CatalogueImportIssue), [
        {"run_id": None, "code": CODE, "source_id": c.source_id, "detail": json.dumps({
            "tag": tag, "book_id": c.book_id, "notes": c.notes, "before": c.before, "after": c.after,
            "dropped_author_ids": [a[0] for a in c.drop_authors]}, ensure_ascii=False)} for c in changes])


def duplicate_groups(index: dict[tuple[str, str], list[tuple[int, float | None, str | None]]]):
    """Groups of books with the same cleaned title and primary author: the most popular (then oldest) is kept."""
    for members in index.values():
        if len(members) > 1:
            ordered = sorted(members, key=lambda m: (m[1] is None, -(m[1] or 0), m[0]))
            yield ordered[0], ordered[1:]


def fold_duplicates(db: Session, groups: list, tag: str) -> Counter:
    result = Counter()
    for (keep_id, _, keep_source), others in groups:
        for dup_id, _, dup_source in others:
            both = select(UserBook.user_id).where(UserBook.book_id == keep_id)
            conflict = db.scalar(select(func.count()).select_from(UserBook).where(UserBook.book_id == dup_id, UserBook.user_id.in_(both)))
            if conflict:                       # a reader holds both: neither entry is merged or changed
                result["skipped_reader_holds_both"] += 1
                continue
            moved = db.execute(update(UserBook).where(UserBook.book_id == dup_id).values(book_id=keep_id)).rowcount
            if dup_source and keep_source and not db.scalar(select(CatalogueSourceAlias.old_source_id).where(
                    CatalogueSourceAlias.old_source_id == dup_source)):
                db.add(CatalogueSourceAlias(old_source_id=dup_source, canonical_source_id=keep_source, source_type=ALIAS_TYPE))
            dup_title = db.scalar(select(Book.title).where(Book.id == dup_id))
            if dup_title and not db.scalar(select(BookTitleAlias.id).where(
                    BookTitleAlias.book_id == keep_id, func.lower(BookTitleAlias.title) == dup_title.lower())):
                if dup_title.lower() != (db.scalar(select(Book.title).where(Book.id == keep_id)) or "").lower():
                    db.add(BookTitleAlias(book_id=keep_id, title=dup_title, source="openlibrary_edition"))
            db.execute(update(Book).where(Book.id == dup_id).values(quality_score=0))
            db.add(CatalogueImportIssue(run_id=None, code=CODE, source_id=dup_source, detail=json.dumps({
                "tag": tag, "book_id": dup_id, "notes": ["duplicate"], "merged_into": keep_id, "moved_links": moved})))
            result["folded"] += 1
            result["moved_links"] += moved
    return result


def scan(db: Session, *, apply: bool = False, tag: str | None = None, samples: int = 50, limit: int | None = None,
         seed: int = 2026, only: list[int] | None = None) -> dict:
    tag = tag or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    counts, changed, index = Counter(), [], defaultdict(list)
    for batch in batches(db, limit, only):
        pending = []
        for row in batch:
            change, facts = plan(row)
            counts["books"] += 1
            for name in ("many_authors", "derivative", "bad_description", "seller_text", "unlisted_after"):
                counts[name] += bool(facts[name])
            if change:
                counts["changed"] += 1
                pending.append(change)
                changed.append(change)
            title = change.after["title"] if change else row.title
            dropped = {a[0] for a in change.drop_authors} if change else set()
            authors = [name for author_id, name in order_authors(row.authors, row.title) if author_id not in dropped]
            if authors and not facts["derivative"]:
                index[(cleaner.name_key(title), cleaner.name_key(authors[0]))].append((row.id, row.popularity, row.source_id))
        if apply and pending:
            _write(db, pending, tag)
            db.commit()
    groups = list(duplicate_groups(index))
    counts["duplicate_groups"] = len(groups)
    counts["duplicate_books"] = sum(len(others) for _, others in groups)
    folded = Counter()
    if apply and groups:
        folded = fold_duplicates(db, groups, tag)
        db.commit()
    picks = random.Random(seed).sample(changed, min(samples, len(changed)))
    return {"tag": tag, "applied": apply, "counts": dict(counts), "folded": dict(folded),
            "samples": [{"book_id": c.book_id, "notes": c.notes, "before": c.before, "after": c.after} for c in picks]}


def undo(db: Session, tag: str) -> int:
    """Put back every title, description, score and removed author link logged under this tag (duplicates stay folded)."""
    restored = 0
    rows = db.scalars(select(CatalogueImportIssue).where(CatalogueImportIssue.code == CODE)).all()
    for issue in rows:
        data = json.loads(issue.detail)
        if data.get("tag") != tag or "before" not in data:
            continue
        before = data["before"]
        db.execute(update(Book).where(Book.id == data["book_id"]).values(
            title=before["title"], description=before["description"], quality_score=before["quality_score"]))
        for author_id in data.get("dropped_author_ids", []):
            db.execute(_relink(book_id=data["book_id"], author_id=author_id))
        restored += 1
    db.commit()
    return restored


def _relink(book_id: int, author_id: int):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    return pg_insert(book_authors).values(book_id=book_id, author_id=author_id, source_managed=True).on_conflict_do_nothing()


def markdown(report: dict) -> str:
    c = report["counts"]
    lines = [f"# Catalogue re-clean {'(applied)' if report['applied'] else '(dry run)'} - {report['tag']}", "",
             "| Measure | Books |", "| --- | --- |"]
    for label, key in (("Books checked", "books"), ("Books that would change", "changed"), ("More than 3 authors", "many_authors"),
                       ("Derivative titles", "derivative"), ("Descriptions removed (non-English or only seller text)", "bad_description"),
                       ("Descriptions with seller or edition text", "seller_text"), ("Unlisted after cleaning (score under 60)", "unlisted_after"),
                       ("Duplicate groups", "duplicate_groups"), ("Duplicate books to fold", "duplicate_books")):
        lines.append(f"| {label} | {c.get(key, 0)} |")
    if report["folded"]:
        lines += ["", f"Folded: {report['folded']}"]
    lines += ["", "## Before and after samples", ""]
    for sample in report["samples"]:
        b, a = sample["before"], sample["after"]
        lines += [f"### Book {sample['book_id']} ({', '.join(sample['notes'])})",
                  f"- Title: {b['title']!r} -> {a['title']!r}",
                  f"- Authors ({len(b['authors'])} -> {len(a['authors'])}): {', '.join(b['authors'][:6])}{'...' if len(b['authors']) > 6 else ''}"
                  f" -> {', '.join(a['authors'])}",
                  f"- Description: {(b['description'] or '')[:90]!r} -> {(a['description'] or '')[:90]!r}",
                  f"- Score: {b['quality_score']} -> {a['quality_score']}", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--undo", metavar="TAG")
    parser.add_argument("--tag")
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--report", help="write the Markdown report to this file")
    args = parser.parse_args()
    url = os.getenv("CATALOGUE_DATABASE_URL")
    if not url:
        parser.error("CATALOGUE_DATABASE_URL must be set")
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            if args.undo:
                print(f"restored {undo(db, args.undo)} books")
                return
            report = scan(db, apply=args.apply, tag=args.tag, samples=args.samples, limit=args.limit)
            text = markdown(report)
            if args.report:
                with open(args.report, "w", encoding="utf-8") as handle:
                    handle.write(text)
            print(text if not args.report else f"report written to {args.report}\n" + text.split("## Before")[0])
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
