"""Bounded, owner-scoped decision support; no learned profile or external API."""
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import and_, case, func, select

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
        columns = (key.label("key"), UserBook.id.label("entry_id"), UserBook.version,
            Book.id.label("book_id"), Book.title, Book.source_id, Book.cover_image_url,
            Book.page_count, Book.isbn13, UserBook.private_title, UserBook.private_author,
            func.coalesce(UserBook.is_owned, False).label("owned"),
            func.coalesce(UserBook.is_wanted, False).label("wanted"), prior.label("revisit"))
        if query.source == "want":
            base = select(*columns).select_from(UserBook).outerjoin(Book, Book.id == UserBook.book_id)\
                .where(UserBook.user_id == user_id, UserBook.is_wanted.is_(True), ~current)
        else:
            # Explicit catalogue exploration is not padding the queue. Include
            # unread owned books, but not queued books or unrequested revisits.
            base = select(*columns).select_from(Book).outerjoin(UserBook,
                and_(UserBook.book_id == Book.id, UserBook.user_id == user_id))\
                .where(~current, ~prior, UserBook.is_wanted.is_not(True))
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
        interests = [dict(row) for row in self.db.execute(select(Tag.id, Tag.name, Tag.type,
            func.count().label("count")).join(book_tags, book_tags.c.tag_id == Tag.id)
            .join(scope, scope.c.book_id == book_tags.c.book_id).where(Tag.type.in_(INTEREST_TYPES))
            .group_by(Tag.id).order_by(func.lower(Tag.name), Tag.id).limit(40)).mappings()]
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
        preferred_tags = select(UserPreference.tag_id).where(UserPreference.user_id == user_id)
        matches = select(func.count()).select_from(book_tags).where(
            book_tags.c.book_id == eligible.c.book_id,
            book_tags.c.tag_id.in_(preferred_tags)).correlate(eligible).scalar_subquery()
        score = func.least(matches, 3) * 2 + case((eligible.c.owned, 1), else_=0)
        identity = func.coalesce(eligible.c.source_id, eligible.c.key)
        tie = func.md5(func.concat(identity, ":", str(query.session_id), ":", query.rotation))
        candidates = select(eligible, matches.label("preference_matches"))
        if query.exclude:
            candidates = candidates.where(eligible.c.key.not_in(query.exclude))
        remaining = self.db.scalar(select(func.count()).select_from(eligible).where(
            eligible.c.key.not_in(query.exclude))) if query.exclude else eligible_count
        ordering = [score.desc()]
        if query.max_pages is not None:
            ordering.append(eligible.c.page_count.asc())
        rows = self.db.execute(candidates.order_by(*ordering, tie, eligible.c.key).limit(60)).mappings().all()
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
                private_title=row["private_title"], private_author=row["private_author"],
                is_owned=row["owned"], is_wanted=row["wanted"], revisit=row["revisit"], reasons=reasons))
        return NextReadResult(source=query.source, session_id=query.session_id, rotation=query.rotation,
            items=items, eligible_count=eligible_count, remaining_count=remaining,
            interests=interests, known_page_count=known_pages)
