import uuid
import enum
from sqlalchemy import String, Text, Integer, Uuid, Table, Column, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


# ASSOCIATION (JOIN) TABLES

book_authors = Table(
    "book_authors",
    Base.metadata,
    Column("book_id", Uuid, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("author_id", Uuid, ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True),
)

book_tags = Table(
    "book_tags",
    Base.metadata,
    Column("book_id", Uuid, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Uuid, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


# MODELS


class Book(Base):
    __tablename__ = 'books'

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
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

class Author(Base):
    __tablename__ = 'authors' 

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True)

    # Relationships
    books:Mapped[list["Book"]] = relationship(
        secondary=book_authors,
        back_populates="authors"
    )

class TagType(str, enum.Enum):
    genre = "genre"
    mood = "mood"
    theme = "theme"

class Tag(Base):
    __tablename__ = 'tags'
    

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True)
    type: Mapped[TagType] = mapped_column(nullable=False)

    # Relationships
    books: Mapped[list["Book"]] = relationship(
        secondary=book_tags, 
        back_populates="tags"
    )







    