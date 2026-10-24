"""Add the V3 reading library without replacing V2 identities.

Revision ID: ef41a83d9012
Revises: d9b6e1f2a3c4
"""
from alembic import op
import sqlalchemy as sa

revision = "ef41a83d9012"
down_revision = "d9b6e1f2a3c4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    for column in (
        sa.Column("is_owned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_wanted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("save_note", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("private_title", sa.Text()), sa.Column("private_author", sa.Text()),
        sa.Column("create_request_id", sa.UUID()), sa.Column("creation_fingerprint", sa.String(64)),
    ):
        op.add_column("user_books", column)
    # Direct SQL preserves all original IDs and timestamps; no finished reads inferred.
    op.execute("UPDATE user_books SET is_owned = (status::text = 'owned'), is_wanted = (status::text = 'want')")
    op.alter_column("user_books", "status", nullable=True)
    op.alter_column("user_books", "book_id", nullable=True)
    connection = op.get_bind()
    foreign_key = next(fk for fk in sa.inspect(connection).get_foreign_keys("user_books") if fk["constrained_columns"] == ["book_id"])
    op.drop_constraint(foreign_key["name"], "user_books", type_="foreignkey")
    op.create_foreign_key("user_books_book_id_fkey", "user_books", "books", ["book_id"], ["id"], ondelete="RESTRICT")
    op.create_unique_constraint("uq_user_book_request", "user_books", ["user_id", "create_request_id"])
    for name, expression in (
        ("ck_user_book_version", "version >= 1"),
        ("ck_user_book_note", "save_note IS NULL OR char_length(save_note) <= 500"),
        ("ck_user_book_identity", "(book_id IS NOT NULL AND private_title IS NULL AND private_author IS NULL) OR (book_id IS NULL AND private_title IS NOT NULL AND char_length(btrim(private_title)) BETWEEN 1 AND 500)"),
        ("ck_user_book_author", "private_author IS NULL OR char_length(private_author) <= 500"),
        ("ck_user_book_request", "(create_request_id IS NULL) = (creation_fingerprint IS NULL)"),
        ("ck_user_book_projection", "status::text IS NOT DISTINCT FROM (CASE WHEN is_owned THEN 'owned' WHEN is_wanted THEN 'want' ELSE NULL END)"),
    ):
        op.create_check_constraint(name, "user_books", expression)
    op.create_index("ix_user_books_user_id_page", "user_books", ["user_id", "id"])
    op.create_table(
        "reading_attempts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_book_id", sa.Integer(), sa.ForeignKey("user_books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("started_on", sa.Date()), sa.Column("ended_on", sa.Date()),
        sa.Column("progress_unit", sa.String(10)), sa.Column("progress_value", sa.Integer()),
        sa.Column("total_pages", sa.Integer()),
        sa.Column("edition_id", sa.Integer(), sa.ForeignKey("editions.id", ondelete="SET NULL")),
        sa.Column("edition_source_id", sa.String(100)), sa.Column("edition_format", sa.String(200)),
        sa.Column("note", sa.Text()), sa.Column("reaction", sa.String(16)),
        sa.Column("creation_fingerprint", sa.String(64), nullable=False),
        sa.Column("started_via", sa.String(16)),
        sa.Column("origin", sa.String(10), nullable=False, server_default="native"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("state IN ('reading','paused','finished','dnf')", name="ck_attempt_state"),
        sa.CheckConstraint("origin IN ('native','import')", name="ck_attempt_origin"),
        sa.CheckConstraint("started_via IS NULL OR started_via IN ('library','discovery','next_read')", name="ck_attempt_started_via"),
        sa.CheckConstraint("started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on", name="ck_attempt_dates"),
        sa.CheckConstraint("ended_on IS NULL OR state IN ('finished','dnf')", name="ck_attempt_end_state"),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 2000", name="ck_attempt_note"),
        sa.CheckConstraint("reaction IS NULL OR reaction IN ('loved','liked','not_for_me')", name="ck_attempt_reaction"),
        sa.CheckConstraint("total_pages IS NULL OR total_pages > 0", name="ck_attempt_total_pages"),
        sa.CheckConstraint("(progress_unit IS NULL AND progress_value IS NULL) OR (progress_unit IS NOT NULL AND progress_value IS NOT NULL AND ((progress_unit = 'percent' AND progress_value BETWEEN 0 AND 100) OR (progress_unit = 'pages' AND progress_value >= 0 AND (total_pages IS NULL OR progress_value <= total_pages))))", name="ck_attempt_progress"),
    )
    op.create_index("uq_attempt_active", "reading_attempts", ["user_book_id"], unique=True, postgresql_where=sa.text("state IN ('reading','paused')"))
    op.create_index("ix_attempt_entry_created", "reading_attempts", ["user_book_id", "created_at", "id"])
    # Bridge old status-only writes during the migration/backend rollout window.
    # New canonical writers change flags and explicitly compute their projection.
    op.execute("""
        CREATE FUNCTION bookvane_library_compatibility() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NOT NEW.is_owned AND NOT NEW.is_wanted AND NEW.status IS NOT NULL THEN
              NEW.is_owned := NEW.status::text = 'owned';
              NEW.is_wanted := NEW.status::text = 'want';
            END IF;
          ELSE
            IF NEW.status IS DISTINCT FROM OLD.status AND
               NEW.is_owned = OLD.is_owned AND NEW.is_wanted = OLD.is_wanted THEN
              NEW.is_owned := COALESCE(NEW.status::text = 'owned', false);
              NEW.is_wanted := COALESCE(NEW.status::text = 'want', false);
            END IF;
            IF NEW IS DISTINCT FROM OLD AND NEW.version = OLD.version THEN
              NEW.version := OLD.version + 1;
            END IF;
          END IF;
          NEW.status := CASE WHEN NEW.is_owned THEN 'owned'::userbookstatus
                             WHEN NEW.is_wanted THEN 'want'::userbookstatus ELSE NULL END;
          RETURN NEW;
        END $$;
        CREATE TRIGGER bookvane_library_compatibility BEFORE INSERT OR UPDATE ON user_books
        FOR EACH ROW EXECUTE FUNCTION bookvane_library_compatibility();
    """)


def downgrade():
    connection = op.get_bind()
    unsafe = connection.execute(sa.text("""
        SELECT EXISTS(SELECT 1 FROM reading_attempts) OR EXISTS(
          SELECT 1 FROM user_books WHERE book_id IS NULL OR save_note IS NOT NULL OR
          create_request_id IS NOT NULL OR is_owned = is_wanted
        )
    """)).scalar_one()
    if unsafe:
        raise RuntimeError("V3 reader data exists. Disable features and forward-fix; downgrade would lose private data.")
    op.execute("DROP TRIGGER bookvane_library_compatibility ON user_books")
    op.execute("DROP FUNCTION bookvane_library_compatibility()")
    op.drop_table("reading_attempts")
    for name in ("ck_user_book_version", "ck_user_book_note", "ck_user_book_identity", "ck_user_book_author", "ck_user_book_request", "ck_user_book_projection", "uq_user_book_request"):
        op.drop_constraint(name, "user_books")
    op.drop_index("ix_user_books_user_id_page", table_name="user_books")
    op.drop_constraint("user_books_book_id_fkey", "user_books", type_="foreignkey")
    op.create_foreign_key("user_books_book_id_fkey", "user_books", "books", ["book_id"], ["id"], ondelete="CASCADE")
    op.alter_column("user_books", "book_id", nullable=False)
    op.alter_column("user_books", "status", nullable=False)
    for column in ("creation_fingerprint", "create_request_id", "private_author", "private_title", "version", "save_note", "is_wanted", "is_owned"):
        op.drop_column("user_books", column)
