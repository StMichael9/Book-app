import enum
import uuid
from sqlalchemy import String, Text, Integer, BigInteger, Boolean, Float, Table, Column, ForeignKey, UniqueConstraint, CheckConstraint, UUID, Date, DateTime, Index, func, select, text
from sqlalchemy.orm import Mapped, mapped_column, relationship, column_property
from sqlalchemy.dialects.postgresql import JSONB
from database import Base
from datetime import date, datetime

# ASSOCIATION (JOIN) TABLES

book_authors = Table(
    "book_authors",
    Base.metadata,
    Column("book_id", Integer, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("author_id", Integer, ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True),
    Column("source_managed", Boolean, nullable=False, server_default="false"),
)

book_tags = Table(
    "book_tags",
    Base.metadata,
    Column("book_id", Integer, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Column("source_managed", Boolean, nullable=False, server_default="false"),
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
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # relationships
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
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


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


class EmailSignup(Base):
    __tablename__ = "email_signups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="landing")
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())



class Book(Base):
    __tablename__ = 'books'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True, index=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    isbn13: Mapped[str | None] = mapped_column(String(13), nullable=True, index=True)
    source_managed_fields: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    preferred_edition_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("editions.id", ondelete="SET NULL", use_alter=True), nullable=True
    )

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
        passive_deletes="all"
    )
    editions: Mapped[list["Edition"]] = relationship(
        back_populates="book", foreign_keys="Edition.book_id"
    )

class UserBookStatus(str, enum.Enum):
    owned = "owned"
    want = "want"


class UserBook(Base):
    __tablename__ = 'user_books'
    __table_args__ = (
        UniqueConstraint('user_id', 'book_id', name='uq_user_book'),
        UniqueConstraint('id', 'user_id', name='uq_user_book_owner'),
        UniqueConstraint('user_id', 'create_request_id', name='uq_user_book_request'),
        CheckConstraint("version >= 1", name="ck_user_book_version"),
        CheckConstraint("save_note IS NULL OR char_length(save_note) <= 500", name="ck_user_book_note"),
        CheckConstraint("(book_id IS NOT NULL AND private_title IS NULL AND private_author IS NULL) OR "
                        "(book_id IS NULL AND private_title IS NOT NULL AND char_length(btrim(private_title)) BETWEEN 1 AND 500)",
                        name="ck_user_book_identity"),
        CheckConstraint("private_author IS NULL OR char_length(private_author) <= 500", name="ck_user_book_author"),
        CheckConstraint("(create_request_id IS NULL) = (creation_fingerprint IS NULL)", name="ck_user_book_request"),
        CheckConstraint("status::text IS NOT DISTINCT FROM (CASE WHEN is_owned THEN 'owned' WHEN is_wanted THEN 'want' ELSE NULL END)",
                        name="ck_user_book_projection"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("books.id", ondelete="RESTRICT"), nullable=True, index=True)
    status: Mapped[UserBookStatus | None] = mapped_column(nullable=True)
    is_owned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_wanted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    save_note: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    private_title: Mapped[str | None] = mapped_column(Text)
    private_author: Mapped[str | None] = mapped_column(Text)
    create_request_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    creation_fingerprint: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # relationships
    user: Mapped["User"] = relationship(back_populates="books")
    book: Mapped["Book | None"] = relationship(back_populates="user_books")
    attempts: Mapped[list["ReadingAttempt"]] = relationship(back_populates="entry", cascade="all, delete-orphan", passive_deletes=True)

    def __init__(self, **kwargs):
        # Preserve legacy ORM construction while canonical writers set both flags.
        status = kwargs.get("status")
        kwargs.setdefault("is_owned", status == UserBookStatus.owned)
        kwargs.setdefault("is_wanted", status == UserBookStatus.want)
        if "status" not in kwargs:
            kwargs["status"] = UserBookStatus.owned if kwargs["is_owned"] else UserBookStatus.want if kwargs["is_wanted"] else None
        super().__init__(**kwargs)


class ReadingAttempt(Base):
    __tablename__ = "reading_attempts"
    __table_args__ = (
        UniqueConstraint('id', 'user_book_id', name='uq_attempt_entry'),
        CheckConstraint("state IN ('reading','paused','finished','dnf')", name="ck_attempt_state"),
        CheckConstraint("origin IN ('native','import')", name="ck_attempt_origin"),
        CheckConstraint("started_via IS NULL OR started_via IN ('library','discovery','next_read')", name="ck_attempt_started_via"),
        CheckConstraint("started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on", name="ck_attempt_dates"),
        CheckConstraint("ended_on IS NULL OR state IN ('finished','dnf')", name="ck_attempt_end_state"),
        CheckConstraint("note IS NULL OR char_length(note) <= 2000", name="ck_attempt_note"),
        CheckConstraint("reaction IS NULL OR reaction IN ('loved','liked','not_for_me')", name="ck_attempt_reaction"),
        CheckConstraint("total_pages IS NULL OR total_pages > 0", name="ck_attempt_total_pages"),
        CheckConstraint("(progress_unit IS NULL AND progress_value IS NULL) OR "
                        "(progress_unit IS NOT NULL AND progress_value IS NOT NULL AND "
                        "((progress_unit = 'percent' AND progress_value BETWEEN 0 AND 100) OR "
                        "(progress_unit = 'pages' AND progress_value >= 0 AND (total_pages IS NULL OR progress_value <= total_pages))))",
                        name="ck_attempt_progress"),
        Index("uq_attempt_active", "user_book_id", unique=True, postgresql_where=text("state IN ('reading','paused')")),
        Index("ix_attempt_entry_created", "user_book_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    user_book_id: Mapped[int] = mapped_column(ForeignKey("user_books.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    started_on: Mapped[date | None] = mapped_column(Date)
    ended_on: Mapped[date | None] = mapped_column(Date)
    progress_unit: Mapped[str | None] = mapped_column(String(10))
    progress_value: Mapped[int | None] = mapped_column(Integer)
    total_pages: Mapped[int | None] = mapped_column(Integer)
    edition_id: Mapped[int | None] = mapped_column(ForeignKey("editions.id", ondelete="SET NULL"))
    edition_source_id: Mapped[str | None] = mapped_column(String(100))
    edition_format: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    reaction: Mapped[str | None] = mapped_column(String(16))
    creation_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    started_via: Mapped[str | None] = mapped_column(String(16))
    origin: Mapped[str] = mapped_column(String(10), nullable=False, default="native", server_default="native")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    entry: Mapped["UserBook"] = relationship(back_populates="attempts")

class Author(Base):
    __tablename__ = 'authors'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True)
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True, index=True)
    source_managed_name: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Relationships
    books: Mapped[list["Book"]] = relationship(
        secondary=book_authors,
        back_populates="authors"
    )

class TagType(str, enum.Enum):
    genre = "genre"
    mood = "mood"
    theme = "theme"
    topic = "topic"
    audience = "audience"
    form = "form"

class Tag(Base):
    __tablename__ = 'tags'
    __table_args__ = (UniqueConstraint('name', 'type', name='uq_tag_name_type'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(225), nullable=False, index=True)
    type: Mapped[TagType] = mapped_column(nullable=False)
    visible_in_v2: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    # Relationships
    books: Mapped[list["Book"]] = relationship(
        secondary=book_tags,
        back_populates="tags"
    )
    user_preferences: Mapped[list["UserPreference"]] = relationship(
        back_populates="tag",
        cascade="all, delete-orphan"
    )


class Edition(Base):
    __tablename__ = "editions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    page_count: Mapped[int | None] = mapped_column(Integer)
    languages: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    publication_date: Mapped[str | None] = mapped_column(Text)
    publishers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    physical_format: Mapped[str | None] = mapped_column(Text)
    cover_image_url: Mapped[str | None] = mapped_column(Text)
    book: Mapped["Book"] = relationship(back_populates="editions", foreign_keys=[book_id])
    isbns: Mapped[list["EditionISBN"]] = relationship(back_populates="edition", cascade="all, delete-orphan")


class EditionISBN(Base):
    __tablename__ = "edition_isbns"

    edition_id: Mapped[int] = mapped_column(Integer, ForeignKey("editions.id", ondelete="CASCADE"), primary_key=True)
    isbn13: Mapped[str] = mapped_column(String(13), primary_key=True, index=True)
    derived_from_isbn10: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    edition: Mapped["Edition"] = relationship(back_populates="isbns")


class CatalogueSourceAlias(Base):
    __tablename__ = "catalogue_source_aliases"

    old_source_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    canonical_source_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)


# Catalogue import state is kept in PostgreSQL, never in local JSON files.
class CatalogueImportRun(Base):
    __tablename__ = "catalogue_import_runs"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    works_url: Mapped[str] = mapped_column(Text, nullable=False)
    authors_url: Mapped[str] = mapped_column(Text, nullable=False)
    editions_url: Mapped[str] = mapped_column(Text, nullable=False)
    redirects_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    deletes_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_manifest: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    category_weights: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    max_database_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    target_books: Mapped[int] = mapped_column(BigInteger, nullable=False)
    baseline_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    shortlist_factor: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    phase: Mapped[str] = mapped_column(String(20), nullable=False, default="works")
    checkpoint_line: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    merge_cursor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    selected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    merged_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    peak_database_mb: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    peak_staging_mb: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    category_seen_counts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    report: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogueStageWork(Base):
    __tablename__ = "catalogue_stage_works"

    run_id: Mapped[str] = mapped_column(
        String(80), ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    categories: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    quality: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    forced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allocation_category: Mapped[str | None] = mapped_column(String(80))
    legacy_book_id: Mapped[int | None] = mapped_column(Integer)


class CatalogueStageAuthorCount(Base):
    __tablename__ = "catalogue_stage_author_counts"

    run_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    author_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    selected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CatalogueStageCandidate(Base):
    __tablename__ = "catalogue_stage_candidates"

    run_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    category: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    quality: Mapped[int] = mapped_column(Integer, nullable=False)
    tie_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class CatalogueStageWorkAuthor(Base):
    __tablename__ = "catalogue_stage_work_authors"
    __table_args__ = (Index("ix_catalogue_stage_work_authors_author", "run_id", "author_key"),)

    run_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    author_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class CatalogueStageAuthor(Base):
    __tablename__ = "catalogue_stage_authors"

    run_id: Mapped[str] = mapped_column(
        String(80), ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True
    )
    author_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(225), nullable=False)


class CatalogueStageEdition(Base):
    __tablename__ = "catalogue_stage_editions"

    run_id: Mapped[str] = mapped_column(
        String(80), ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    edition_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    quality: Mapped[int] = mapped_column(Integer, nullable=False)
    isbns: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    languages: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    publication_date: Mapped[str | None] = mapped_column(Text)
    publishers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    physical_format: Mapped[str | None] = mapped_column(Text)
    cover_image_url: Mapped[str | None] = mapped_column(Text)


class CatalogueImportIssue(Base):
    __tablename__ = "catalogue_import_issues"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(100))
    detail: Mapped[str] = mapped_column(Text, nullable=False)


Index("uq_tags_lower_name", func.lower(Tag.name), unique=True)
Index("ix_catalogue_stage_candidates_rank", CatalogueStageCandidate.run_id,
      CatalogueStageCandidate.category, CatalogueStageCandidate.quality,
      CatalogueStageCandidate.tie_hash)
Index("ix_catalogue_stage_works_title_hash", func.md5(CatalogueStageWork.title))


# COMPUTED COLUMNS — must be defined after Book and UserBook exist, since they
# reference both classes directly (not by string name like the relationships above).

Book.owned_count = column_property(
    select(func.count(UserBook.id))
    .where(UserBook.book_id == Book.id, UserBook.is_owned.is_(True))
    .correlate_except(UserBook)
    .scalar_subquery()
)

Book.want_count = column_property(
    select(func.count(UserBook.id))
    .where(UserBook.book_id == Book.id, UserBook.is_wanted.is_(True))
    .correlate_except(UserBook)
    .scalar_subquery()
)

# Keep ORM metadata aligned with the search/index migration so fresh schema
# creation in disposable tests matches Alembic-managed environments.
Index("ix_books_title_trgm", Book.title, postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"})
Index("ix_authors_name_trgm", Author.name, postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"})
Index("ix_book_tags_tag_book", book_tags.c.tag_id, book_tags.c.book_id)
Index("ix_user_books_user_status", UserBook.user_id, UserBook.status)
Index("ix_user_books_user_id_page", UserBook.user_id, UserBook.id)

# Register the separate private-import responsibility with the shared metadata.
from library_import_models import ImportedLibraryRecord, ImportedReadLink, LibraryImportRow, LibraryImportRun  # noqa: E402,F401
