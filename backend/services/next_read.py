"""Bounded, owner-scoped decision support; no learned profile or external API."""
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import Integer, Text, and_, case, cast, false, func, literal, null, select, union_all

from models import Author, Book, ReadingAttempt, Tag, TagType, UserBook, UserPreference, book_authors, book_tags
from reading_schemas import NextReadChoice, NextReadResult

INTEREST_TYPES = (TagType.genre, TagType.topic, TagType.form, TagType.audience)


class NextReadService:
    def __init__(self, db):
        self.db = db

    def choices(self, user_id, query):
        current = select(ReadingAttempt.id).where(ReadingAttempt.user_book_id == UserBook.id,
            ReadingAttempt.state.in_(["reading", "paused"])).correlate(UserBook).exists()
        prior = select(ReadingAttempt.id).where(ReadingAttempt.user_book_id == UserBook.id,
            ReadingAttempt.state.in_(["finished", "dnf"])).correlate(UserBook).exists()
        key = case((Book.id.is_not(None), func.concat("book:", Book.id)),
                   else_=func.concat("entry:", UserBook.id))
        # The scope is built from a few narrow columns: it is scanned, counted and sorted for every catalogue book.
        # Titles, covers and the rest are read afterwards for just the handful of rows that are shown.
        # How many of the reader's chosen subjects each book has: one grouped pass over just those tags' rows, joined in,
        # rather than a correlated lookup for every catalogue book. No chosen subjects means an empty grouped set.
        preferred_tags = select(UserPreference.tag_id).where(UserPreference.user_id == user_id)
        counts = select(book_tags.c.book_id.label("book_id"), func.count().label("n")).where(
            book_tags.c.tag_id.in_(preferred_tags)).group_by(book_tags.c.book_id).subquery("preference_counts")
        matches_column = func.coalesce(counts.c.n, 0).label("preference_matches")
        columns = (key.label("key"), UserBook.id.label("entry_id"), Book.id.label("book_id"), Book.source_id,
            Book.page_count, func.coalesce(UserBook.is_owned, False).label("owned"), matches_column)
        detail_columns = (key.label("key"), UserBook.id.label("entry_id"), UserBook.version,
            Book.id.label("book_id"), Book.title, Book.source_id, Book.cover_image_url,
            Book.page_count, Book.isbn13, UserBook.private_title, UserBook.private_author, UserBook.private_catalogue,
            func.coalesce(UserBook.is_owned, False).label("owned"),
            func.coalesce(UserBook.is_wanted, False).label("wanted"), prior.label("revisit"))
        if query.source == "want":
            base = select(*columns).select_from(UserBook).outerjoin(Book, Book.id == UserBook.book_id)\
                .outerjoin(counts, counts.c.book_id == Book.id)\
                .where(UserBook.user_id == user_id, UserBook.is_wanted.is_(True), ~current)
        else:
            # Explicit catalogue exploration is not padding the queue. Include
            # unread owned books, but not queued books or unrequested revisits.
            # Two branches that together equal "every book, left-joined to the reader's entry":
            #  - listed books the reader has no entry for (nothing to check: not reading, not finished, not wanted);
            #  - the reader's own entries for catalogue books, which are the only rows that need the attempt checks.
            # Checking attempts for every catalogue book made PostgreSQL probe reading_attempts once per book.
            # NOT IN (a small list of the reader's own book ids) is hashed once; a per-book anti-join probe is slower.
            own_books = select(UserBook.book_id).where(UserBook.user_id == user_id, UserBook.book_id.is_not(None))
            others = select((literal("book:") + cast(Book.id, Text)).label("key"), cast(null(), Integer).label("entry_id"), Book.id.label("book_id"), Book.source_id,
                            Book.page_count, false().label("owned"), matches_column).select_from(Book)\
                .outerjoin(counts, counts.c.book_id == Book.id)\
                .where(Book.is_listed.is_(True), Book.id.not_in(own_books))
            own = select(*columns).select_from(UserBook).join(Book, Book.id == UserBook.book_id)\
                .outerjoin(counts, counts.c.book_id == Book.id)\
                .where(UserBook.user_id == user_id, ~current, ~prior, UserBook.is_wanted.is_not(True))
            if query.owned_only:
                others, own = None, own.where(UserBook.is_owned.is_(True))
            if query.max_pages is not None:
                pages = (Book.page_count > 0, Book.page_count <= query.max_pages)
                others = None if others is None else others.where(*pages)
                own = own.where(*pages)
            base = own if others is None else union_all(others, own)
        if query.source == "want":
            if query.owned_only:
                base = base.where(UserBook.is_owned.is_(True))
            if query.max_pages is not None:
                base = base.where(Book.page_count > 0, Book.page_count <= query.max_pages)
        scope = base.cte("next_scope")

        interest = None
        if query.interest_id is not None:
            interest = self.db.scalar(select(Tag).where(Tag.id == query.interest_id, Tag.type.in_(INTEREST_TYPES)))
            if interest is None:
                raise HTTPException(422, detail="Choose a supported discovery subject")
        interest_order = [func.lower(Tag.name), Tag.id]
        if interest is not None:
            # Keep a covered selected subject inside the bounded options. Only
            # absence from the full scoped aggregate proves zero coverage.
            interest_order.insert(0, case((Tag.id == interest.id, 0), else_=1))
        interests = [dict(row) for row in self.db.execute(select(Tag.id, Tag.name, Tag.type,
            func.count().label("count")).join(book_tags, book_tags.c.tag_id == Tag.id)
            .join(scope, scope.c.book_id == book_tags.c.book_id).where(Tag.type.in_(INTEREST_TYPES))
            .group_by(Tag.id).order_by(*interest_order).limit(40)).mappings()]
        for item in interests:
            item["type"] = item["type"].value
        if interest is not None and not any(item["id"] == interest.id for item in interests):
            interests = interests[:39] + [{"id": interest.id, "name": interest.name, "type": interest.type.value, "count": 0}]
        eligible = select(scope)
        if interest is not None:
            eligible = eligible.where(select(book_tags.c.book_id).where(
                book_tags.c.book_id == scope.c.book_id, book_tags.c.tag_id == interest.id).exists())
        eligible = eligible.cte("next_eligible")
        eligible_count, known_pages = self.db.execute(select(func.count(),
            func.count().filter(eligible.c.page_count > 0)).select_from(eligible)).one()

        # Index-bounded tag lookup inside this one SQL statement, not an
        # application query per book. A catalogue-wide grouped outer join can
        # be repeatedly rebuilt when a fresh bulk load has stale statistics.
        matches = eligible.c.preference_matches
        score = func.least(matches, 3) * 2 + case((eligible.c.owned, 1), else_=0)
        identity = func.coalesce(eligible.c.source_id, eligible.c.key)
        tie = func.md5(func.concat(identity, ":", str(query.session_id), ":", query.rotation))
        candidates = select(eligible)
        if query.exclude:
            candidates = candidates.where(eligible.c.key.not_in(query.exclude))
        remaining = self.db.scalar(select(func.count()).select_from(eligible).where(
            eligible.c.key.not_in(query.exclude))) if query.exclude else eligible_count
        ordering = [score.desc()]
        if query.max_pages is not None:
            ordering.append(eligible.c.page_count.asc())
        picked = self.db.execute(candidates.order_by(*ordering, tie, eligible.c.key).limit(60)).mappings().all()
        book_ids = [row["book_id"] for row in picked if row["book_id"] is not None]
        private_ids = [row["entry_id"] for row in picked if row["book_id"] is None and row["entry_id"] is not None]
        details = {}
        if book_ids:
            for row in self.db.execute(select(*detail_columns).select_from(Book).outerjoin(
                    UserBook, and_(UserBook.book_id == Book.id, UserBook.user_id == user_id))
                    .where(Book.id.in_(book_ids))).mappings():
                details[row["key"]] = row
        if private_ids:
            for row in self.db.execute(select(*detail_columns).select_from(UserBook).outerjoin(
                    Book, Book.id == UserBook.book_id).where(UserBook.user_id == user_id, UserBook.id.in_(private_ids))).mappings():
                details[row["key"]] = row
        rows = [{**details[row["key"]], "preference_matches": row["preference_matches"]}
                for row in picked if row["key"] in details]
        authors = defaultdict(list)
        ids = [row["book_id"] for row in rows if row["book_id"] is not None]
        if ids:
            for book_id, author_id, name in self.db.execute(select(book_authors.c.book_id, Author.id, Author.name)
                .join(Author, Author.id == book_authors.c.author_id).where(book_authors.c.book_id.in_(ids))
                .order_by(book_authors.c.book_id, Author.id)):
                authors[book_id].append({"id": author_id, "name": name})

        def author_keys(row):
            if row["book_id"] is not None:
                return {f"author:{author['id']}" for author in authors[row["book_id"]]}
            # A diversity hint, never identity matching, deduplication or merge.
            return {"private:" + row["private_author"].strip().casefold()} if row["private_author"] else set()

        selected, used_authors = [], set()
        for row in rows:
            keys = author_keys(row)
            if not keys.intersection(used_authors):
                selected.append(row); used_authors.update(keys)
            if len(selected) == 3:
                break
        for row in rows:
            if len(selected) == 3:
                break
            if not any(item["key"] == row["key"] for item in selected):
                selected.append(row)
        items = []
        for row in selected:
            reasons = [{"code": "interest", "value": interest.name}] if interest is not None else []
            if query.max_pages is not None:
                reasons.append({"code": "pages", "value": row["page_count"]})
            reasons.append({"code": query.source})
            if row["owned"]:
                reasons.append({"code": "owned"})
            if row["preference_matches"] and interest is None:
                reasons.append({"code": "preferences"})
            book = None if row["book_id"] is None else {"id": row["book_id"], "title": row["title"],
                "cover_image_url": row["cover_image_url"], "page_count": row["page_count"],
                "isbn13": row["isbn13"], "authors": authors[row["book_id"]]}
            items.append(NextReadChoice(key=row["key"], entry_id=row["entry_id"], version=row["version"], book=book,
                private_title=row["private_title"], private_author=row["private_author"], private_catalogue=row["private_catalogue"],
                is_owned=row["owned"], is_wanted=row["wanted"], revisit=row["revisit"], reasons=reasons))
        return NextReadResult(source=query.source, session_id=query.session_id, rotation=query.rotation,
            items=items, eligible_count=eligible_count, remaining_count=remaining,
            interests=interests, known_page_count=known_pages)
