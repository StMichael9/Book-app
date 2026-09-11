from sqlalchemy import distinct, func, select, exists
from sqlalchemy.orm import Session, selectinload
from models import Book, Author, Tag, User, book_tags


class SearchService:
    def __init__(self, db: Session):
        self.db = db

    def search_books(self, book: str = None, author: str = None, tags: list[str] = None, current_user: User | None = None):
        query = (
            select(Book)
            .join(Book.authors)
            .join(Book.tags)
            .group_by(Book.id)
            .options(selectinload(Book.authors), selectinload(Book.tags))
        )
        if book is not None:
            query = query.where(Book.title.ilike(f"%{book}%"))
        if author is not None:
            query = query.where(Author.name.ilike(f"%{author}%"))
        if tags:
            query = (
                query.where(Tag.name.in_(tags))
                .having(func.count(distinct(Tag.id)) >= len(tags))
            )

        if current_user is not None:
            preferred_tag_ids = [p.tag_id for p in current_user.preferences]
            if preferred_tag_ids:
                preference_match = exists(
                    select(book_tags.c.book_id)
                    .where(book_tags.c.book_id == Book.id)
                    .where(book_tags.c.tag_id.in_(preferred_tag_ids))
                )
                query = query.order_by(preference_match.desc())

        return query