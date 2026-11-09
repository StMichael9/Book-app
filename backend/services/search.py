import re

from sqlalchemy import case, func, literal, select, exists, or_, union
from sqlalchemy.orm import Session
from models import Book, BookTitleAlias, Author, Tag, User, UserBook, UserBookStatus, UserPreference, book_tags


class SearchService:
    def __init__(self, db: Session):
        self.db = db

    def search_books(
        self,
        book: str = None,
        author: str = None,
        tags: list[str] = None,
        current_user: User | None = None,
        exclude_owned: bool = False,
        shelf_status: UserBookStatus | None = None,
        sort: str | None = None,
        fuzzy: bool = False,
    ):
        query = (
            select(Book)
            .where(Book.is_listed.is_(True))
            .order_by(Book.id)
        )
        title_rank = None
        if book is not None:
            # Titles, aliases and the reader's words are all folded by the same database function (bookvane_search_key), so
            # "1984", "Nineteen Eighty-Four" and "nineteen eighty four" meet. The key never contains % or _, so a LIKE built
            # from it cannot be turned into a wildcard by the reader.
            if not re.search(r"[^\W_]", book):
                # Nothing to fold ("%", "_"): match the characters themselves, with LIKE wildcards kept literal.
                pattern = "%" + book.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                title_ids = select(Book.id).where(Book.title.ilike(pattern, escape="\\"))
                alias_ids = select(BookTitleAlias.book_id).where(BookTitleAlias.title.ilike(pattern, escape="\\"))
                query = query.where(Book.id.in_(union(title_ids, alias_ids)))
                title_rank = case((Book.title.ilike(pattern, escape="\\"), 0), else_=3)
            else:
                key = func.bookvane_search_key(book)
                if fuzzy:
                    # Typos ("hary poter"): only tried when the exact, prefix and substring matches found nothing.
                    title_ids = select(Book.id).where(func.word_similarity(key, Book.title_key) >= 0.4)
                    alias_ids = select(BookTitleAlias.book_id).where(func.word_similarity(key, BookTitleAlias.title_key) >= 0.4)
                else:
                    title_ids = select(Book.id).where(or_(Book.title_key == key, Book.title_key.like(key.concat("%")),
                                                          Book.title_key.like(literal("%").concat(key).concat("%"))))
                    alias_ids = select(BookTitleAlias.book_id).where(or_(
                        BookTitleAlias.title_key == key, BookTitleAlias.title_key.like(key.concat("%")),
                        BookTitleAlias.title_key.like(literal("%").concat(key).concat("%"))))
                query = query.where(Book.id.in_(union(title_ids, alias_ids)))
                # A match on the book's own title ranks before one that only an alias gives.
                title_rank = case((Book.title_key == key, 0), (Book.title_key.like(key.concat("%")), 1),
                                  (Book.title_key.like(literal("%").concat(key).concat("%")), 2), else_=3)
            query = query.order_by(None).order_by(title_rank, Book.id)
        if author is not None:
            query = query.where(Book.authors.any(Author.name.ilike(f"%{author}%")))
        if tags:
            for tag in set(tags):
                if tag == "history":
                    query = query.where(Book.tags.any(or_(
                        Tag.name == "history", Tag.name == "historical_fiction"
                    )))
                else:
                    query = query.where(Book.tags.any(Tag.name == tag))

        if current_user is not None:
            if exclude_owned:
                owned_match = exists(
                    select(UserBook.id)
                    .where(UserBook.book_id == Book.id)
                    .where(UserBook.user_id == current_user.id)
                    .where(UserBook.is_owned.is_(True))
                )
                query = query.where(~owned_match)

            if shelf_status is not None:
                status_match = exists(
                    select(UserBook.id)
                    .where(UserBook.book_id == Book.id)
                    .where(UserBook.user_id == current_user.id)
                    .where((UserBook.is_owned if shelf_status == UserBookStatus.owned else UserBook.is_wanted).is_(True))
                )
                query = query.where(status_match)

            # The reader's subjects are matched inside the same statement; reading them first would cost a round trip.
            # A reader with no saved subjects matches nothing, so the order is simply by id as before.
            preference_match = exists(
                select(book_tags.c.book_id)
                .where(book_tags.c.book_id == Book.id)
                .where(book_tags.c.tag_id.in_(
                    select(UserPreference.tag_id).where(UserPreference.user_id == current_user.id)))
            )
            query = query.order_by(None).order_by(
                *([title_rank] if title_rank is not None else []), preference_match.desc(), Book.id)

        if (book is not None or author is not None) and sort is None:
            # A typed search puts the closest title first (exact, prefix, substring, typo), then the most popular.
            query = query.order_by(None).order_by(*([title_rank] if title_rank is not None else []),
                                                  Book.popularity.desc().nulls_last(), Book.id)
        if sort == "popular":
            # An explicit sort wins over the reader's subject order; a text match still ranks closest titles first.
            query = query.order_by(None).order_by(*([title_rank] if title_rank is not None else []),
                                                  Book.popularity.desc().nulls_last(), Book.id)
        return query
