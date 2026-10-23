from sqlalchemy import case, select, exists, or_
from sqlalchemy.orm import Session, selectinload
from models import Book, BookTitleAlias, Author, Tag, User, UserBook, UserBookStatus, book_tags


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
    ):
        query = (
            select(Book)
            .options(selectinload(Book.authors), selectinload(Book.tags))
            .order_by(Book.id)
        )
        title_rank = None
        if book is not None:
            # LIKE wildcards in the reader's text are literal; an alias is another way to find the same book.
            pattern = "%" + book.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            alias_match = exists(select(BookTitleAlias.id).where(
                BookTitleAlias.book_id == Book.id, BookTitleAlias.title.ilike(pattern, escape="\\")))
            query = query.where(or_(Book.title.ilike(pattern, escape="\\"), alias_match))
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

            preferred_tag_ids = [p.tag_id for p in current_user.preferences]
            if preferred_tag_ids:
                preference_match = exists(
                    select(book_tags.c.book_id)
                    .where(book_tags.c.book_id == Book.id)
                    .where(book_tags.c.tag_id.in_(preferred_tag_ids))
                )
                query = query.order_by(None).order_by(
                    *([title_rank] if title_rank is not None else []), preference_match.desc(), Book.id)

        return query
