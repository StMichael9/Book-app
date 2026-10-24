"""Private import staging and durable replay identities; no catalogue writes.

Only SQL metadata is imported here. Domain services import these classes through
models, so registering the tables introduces no model/service circular imports.
"""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class LibraryImportRun(Base):
    __tablename__ = "library_import_runs"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_library_import_run_owner"),
        CheckConstraint("source IN ('goodreads','storygraph','bookvane','generic','paste')", name="ck_library_import_source"),
        CheckConstraint("phase IN ('uploading','analyzing','grouping','preview_ready','applying','completed','completed_with_issues','cancelled','expired','failed')", name="ck_library_import_phase"),
        CheckConstraint("row_count BETWEEN 0 AND 20000 AND batch_count BETWEEN 0 AND 20000", name="ck_library_import_count"),
        CheckConstraint("stage_bytes BETWEEN 0 AND 33554432", name="ck_library_import_bytes"),
        CheckConstraint("event_count BETWEEN 0 AND 50000", name="ck_library_import_events"),
        CheckConstraint("input_bytes BETWEEN 0 AND 20971520", name="ck_library_import_input_bytes"),
        CheckConstraint("octet_length(headers::text) <= 65536 AND octet_length(mapping::text) <= 65536", name="ck_library_import_config_size"),
        Index("uq_library_import_active_owner", "user_id", unique=True,
              postgresql_where=text("phase IN ('uploading','analyzing','grouping','preview_ready','applying')")),
        Index("ix_library_import_owner_created", "user_id", "created_at", "id"),
        Index("ix_library_import_expiry", "expires_at", "phase"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    scope: Mapped[str] = mapped_column(String(80), nullable=False, default="default")
    adapter_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    headers: Mapped[list] = mapped_column(JSONB, nullable=False)
    mapping: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    options: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    creation_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    phase: Mapped[str] = mapped_column(String(24), nullable=False, default="uploading")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    batch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stage_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    analyze_cursor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    group_cursor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    confirmed_revision: Mapped[int | None] = mapped_column(Integer)
    manifest_hash: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_error: Mapped[str | None] = mapped_column(String(80))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
        server_default=text("now() + interval '7 days'"))
    report_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
        server_default=text("now() + interval '30 days'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class LibraryImportRow(Base):
    __tablename__ = "library_import_rows"
    __table_args__ = (
        ForeignKeyConstraint(["run_id", "user_id"], ["library_import_runs.id", "library_import_runs.user_id"], ondelete="CASCADE", name="fk_import_row_owner"),
        ForeignKeyConstraint(["result_entry_id", "user_id"], ["user_books.id", "user_books.user_id"], deferrable=True, initially="DEFERRED", name="fk_import_row_result_owner"),
        CheckConstraint("ordinal BETWEEN 1 AND 20000 AND batch_ordinal BETWEEN 0 AND 19999", name="ck_import_row_ordinal"),
        CheckConstraint("payload IS NULL OR octet_length(payload::text) <= 262144", name="ck_import_row_payload"),
        CheckConstraint("octet_length(candidates::text) <= 16384 AND octet_length(plan::text) <= 262144", name="ck_import_row_plan"),
        Index("ix_import_row_record", "run_id", "record_key", "ordinal"),
        Index("ix_import_row_target", "run_id", "target_key", "ordinal"),
        Index("ix_import_row_disposition", "run_id", "disposition", "ordinal"),
        Index("ix_import_row_result_entry", "result_entry_id"),
    )
    run_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID, nullable=False)
    batch_ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    batch_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    batch_length: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    record_key: Mapped[str] = mapped_column(String(64), nullable=False)
    target_key: Mapped[str | None] = mapped_column(String(100))
    candidates: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    plan: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    decision: Mapped[str | None] = mapped_column(String(24))
    disposition: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    error_code: Mapped[str | None] = mapped_column(String(80))
    result_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_books.id", ondelete="SET NULL"))


class ImportedLibraryRecord(Base):
    __tablename__ = "imported_library_records"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_imported_record_owner"),
        UniqueConstraint("id", "user_id", "user_book_id", name="uq_imported_record_target"),
        UniqueConstraint("user_id", "source", "scope", "record_key", name="uq_imported_record_source"),
        ForeignKeyConstraint(["user_book_id", "user_id"], ["user_books.id", "user_books.user_id"],
            deferrable=True, initially="DEFERRED", name="fk_imported_record_target_owner"),
        CheckConstraint("octet_length(context::text) <= 262144", name="ck_imported_record_context"),
        Index("ix_imported_record_owner_entry", "user_id", "user_book_id"),
        Index("ix_imported_record_entry", "user_book_id"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_book_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_books.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    scope: Mapped[str] = mapped_column(String(80), nullable=False)
    record_key: Mapped[str] = mapped_column(String(64), nullable=False)
    accepted_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ImportedReadLink(Base):
    __tablename__ = "imported_read_links"
    __table_args__ = (
        UniqueConstraint("record_id", "event_key", name="uq_imported_read_event"),
        ForeignKeyConstraint(["record_id", "user_id"], ["imported_library_records.id", "imported_library_records.user_id"],
            ondelete="CASCADE", name="fk_imported_read_record_owner"),
        ForeignKeyConstraint(["record_id", "user_id", "user_book_id"],
            ["imported_library_records.id", "imported_library_records.user_id", "imported_library_records.user_book_id"],
            deferrable=True, initially="DEFERRED", name="fk_imported_read_record_target"),
        ForeignKeyConstraint(["user_book_id", "user_id"], ["user_books.id", "user_books.user_id"],
            deferrable=True, initially="DEFERRED", name="fk_imported_read_target_owner"),
        ForeignKeyConstraint(["attempt_id", "user_book_id"], ["reading_attempts.id", "reading_attempts.user_book_id"],
            deferrable=True, initially="DEFERRED", name="fk_imported_read_attempt_target"),
        CheckConstraint("attempt_id IS NULL OR user_book_id IS NOT NULL", name="ck_imported_read_target"),
        Index("ix_imported_read_attempt", "attempt_id"),
        Index("ix_imported_read_owner_entry", "user_id", "user_book_id"),
        Index("ix_imported_read_entry", "user_book_id"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    record_id: Mapped[UUID] = mapped_column(PGUUID, nullable=False)
    user_book_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_books.id", ondelete="SET NULL"))
    attempt_id: Mapped[UUID | None] = mapped_column(PGUUID, ForeignKey("reading_attempts.id", ondelete="SET NULL"))
    event_key: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
