from sqlalchemy import select
from sqlalchemy.orm import Session
from models import Author, Tag


class AutocompleteService:
    def __init__(self, db: Session):
        self.db = db

    def suggest_authors(self, q: str, limit: int = 10):
        query = (
            select(Author)
            .where(Author.name.ilike(f"%{q}%"))
            .order_by(Author.name)
            .limit(limit)
        )
        return self.db.execute(query).scalars().all()

    def suggest_tags(self, q: str, limit: int = 10):
        query = (
            select(Tag)
            .where(Tag.name.ilike(f"%{q}%"))
            .order_by(Tag.name)
            .limit(limit)
        )
        return self.db.execute(query).scalars().all()