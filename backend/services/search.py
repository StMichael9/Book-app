from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from models import Book, Author, Tag


class SearchService:
    def __init__(self, db: Session):
        self.db = db

    def search_books(self, book: str = None, author: str = None, tag: str = None):
        # Eager-load authors/tags in 2 extra batched queries instead of one
        # lazy-loaded query PER book PER relationship (the N+1 problem) -
        # without this, a 50-book page fires 100+ queries instead of 3.
        query = (
            select(Book)
            .join(Book.authors)
            .join(Book.tags)
            .distinct()
            .options(selectinload(Book.authors), selectinload(Book.tags))
        )
        if book is not None:
            query = query.where(Book.title.ilike(f"%{book}%"))
        if author is not None:
            query = query.where(Author.name.ilike(f"%{author}%"))
        if tag is not None:
            query = query.where(Tag.name == tag)

        return query
