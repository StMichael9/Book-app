import enum
import uuid
from sqlalchemy import String, Text, Integer, Table, Column, ForeignKey, UniqueConstraint, UUID, DateTime, func, select
from sqlalchemy.orm import Mapped, mapped_column, relationship, column_property
from database import Base
from datetime import datetime

# ASSOCIATION (JOIN) TABLES

book_authors = Table(
    "book_authors",
    Base.metadata,
    Column("book_id", Integer, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("author_id", Integer, ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True),
)

book_tags = Table(
    "book_tags",
    Base.metadata,
    Column("book_id", Integer, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


# MODELS
class User(Base):
    __tablename__ = 'users'

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # relationships
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )
    books: Mapped[list["UserBook"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )
    preferences: Mapped[list["UserPreference"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )

class UserPreference(Base):
    __tablename__ = 'user_preferences'
    __table_args__ = (UniqueConstraint('user_id', 'tag_id', name='uq_user_tag_pref'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True)
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="preferences")
    tag: Mapped["Tag"] = relationship(back_populates="user_preferences")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")



class Book(Base):
    __tablename__ = 'books'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    authors: Mapped[list["Author"]] = relationship(
        secondary=book_authors,
        back_populates="books"
    )
    tags: Mapped[list["Tag"]] = relationship(
        secondary=book_tags,
        back_populates="books"
    )
    user_books: Mapped[list["UserBook"]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan"
    )

class UserBookStatus(str, enum.Enum):
    owned = "owned"
    want = "want"


class UserBook(Base):
    __tablename__ = 'user_books'
    __table_args__ = (UniqueConstraint('user_id', 'book_id', name='uq_user_book'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id: Mapped[int] = mapped_column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[UserBookStatus] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # relationships
    user: Mapped["User"] = relationship(back_populates="books")
    book: Mapped["Book"] = relationship(back_populates="user_books")

class Author(Base):
    __tablename__ = 'authors'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True, unique=True)

    # Relationships
    books: Mapped[list["Book"]] = relationship(
        secondary=book_authors,
        back_populates="authors"
    )

class TagType(str, enum.Enum):
    genre = "genre"
    mood = "mood"
    theme = "theme"

class Tag(Base):
    __tablename__ = 'tags'
    __table_args__ = (UniqueConstraint('name', 'type', name='uq_tag_name_type'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True)
    type: Mapped[TagType] = mapped_column(nullable=False)

    # Relationships
    books: Mapped[list["Book"]] = relationship(
        secondary=book_tags,
        back_populates="tags"
    )
    user_preferences: Mapped[list["UserPreference"]] = relationship(
        back_populates="tag",
        cascade="all, delete-orphan"
    )


# COMPUTED COLUMNS — must be defined after Book and UserBook exist, since they
# reference both classes directly (not by string name like the relationships above).

Book.owned_count = column_property(
    select(func.count(UserBook.id))
    .where(UserBook.book_id == Book.id, UserBook.status == UserBookStatus.owned)
    .correlate_except(UserBook)
    .scalar_subquery()
)

Book.want_count = column_property(
    select(func.count(UserBook.id))
    .where(UserBook.book_id == Book.id, UserBook.status == UserBookStatus.want)
    .correlate_except(UserBook)
    .scalar_subquery()
)