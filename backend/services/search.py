from sqlalchemy import select
from sqlalchemy.orm import Session
from models import Book, Author, Tag

class SearchService:
    def __init__(self, db:Session):
        self.db = db

    def search_books(self, book: str = None, author: str = None, tag: str = None):
        query = select(Book).join(Book.authors).join(Book.tags).distinct()
        if book is not None:
            query = query.where(Book.title.ilike(f"%{book}%"))
        if author is not None:
            query = query.where(Author.name.ilike(f"%{author}%"))
        if tag is not None:
            query = query.where(Tag.name == tag)

        return query