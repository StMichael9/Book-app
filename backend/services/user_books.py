from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from models import UserBook, UserBookStatus, Book


class UserBookService:
    def __init__(self, db: Session):
        self.db = db

    def set_status(self, user_id, book_id: int, status: UserBookStatus) -> UserBook:
        book = self.db.get(Book, book_id)
        if not book:
            return None  # route turns this into a 404

        statement = insert(UserBook).values(user_id=user_id, book_id=book_id, status=status)
        statement = statement.on_conflict_do_update(
            constraint="uq_user_book",
            set_={"status": status, "updated_at": datetime.now(timezone.utc)},
        ).returning(UserBook.id)
        entry_id = self.db.execute(statement).scalar_one()
        self.db.commit()
        return self.db.get(UserBook, entry_id)

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
