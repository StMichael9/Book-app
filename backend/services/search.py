from sqlalchemy import case, select, exists, or_, union
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
    ):
        query = (
            select(Book)
            .where(Book.is_listed.is_(True))
            .order_by(Book.id)
        )
        title_rank = None
        if book is not None:
            # LIKE wildcards in the reader's text are literal; an alias is another way to find the same book.
            pattern = "%" + book.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            # Two uncorrelated trigram-indexable selects; an OR with a correlated EXISTS defeats ix_books_title_trgm.
            title_ids = select(Book.id).where(Book.title.ilike(pattern, escape="\\"))
            alias_ids = select(BookTitleAlias.book_id).where(BookTitleAlias.title.ilike(pattern, escape="\\"))
            query = query.where(Book.id.in_(union(title_ids, alias_ids)))
            title_rank = case((Book.title.ilike(pattern, escape="\\"), 0), else_=1)
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

        if sort == "popular":
            # An explicit sort wins over the reader's subject order; a text match still ranks closest titles first.
            query = query.order_by(None).order_by(*([title_rank] if title_rank is not None else []),
                                                  Book.popularity.desc().nulls_last(), Book.id)
        return query
