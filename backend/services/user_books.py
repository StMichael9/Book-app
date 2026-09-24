from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models import UserBook, UserBookStatus, Book


class UserBookService:
    def __init__(self, db: Session):
        self.db = db

    def set_status(self, user_id, book_id: int, status: UserBookStatus) -> UserBook:
        book = self.db.get(Book, book_id)
        if not book:
            return None  # route turns this into a 404

        existing = self.db.execute(
            select(UserBook).where(
                UserBook.user_id == user_id,
                UserBook.book_id == book_id,
            )
        ).scalars().one_or_none()

        if existing:
            existing.status = status
            existing.updated_at = datetime.now(timezone.utc)
            self.db.commit()
            self.db.refresh(existing)
            return existing

        new_entry = UserBook(user_id=user_id, book_id=book_id, status=status)
        self.db.add(new_entry)
        self.db.commit()
        self.db.refresh(new_entry)
        return new_entry

    def get_user_books(self, user_id, status: UserBookStatus | None = None):
        query = (
            select(UserBook)
            .where(UserBook.user_id == user_id)
            .options(selectinload(UserBook.book).selectinload(Book.authors), selectinload(UserBook.book).selectinload(Book.tags))
        )
        if status:
            query = query.where(UserBook.status == status)
        return self.db.execute(query).scalars().all()

    def delete_status(self, user_id, book_id: int) -> bool:
        existing = self.db.execute(
            select(UserBook).where(
                UserBook.user_id == user_id,
                UserBook.book_id == book_id,
            )
        ).scalars().one_or_none()

        if not existing:
            return False

        self.db.delete(existing)
        self.db.commit()
        return True