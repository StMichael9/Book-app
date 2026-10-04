"""Add resumable catalogue import state and unique Open Library work IDs.

Revision ID: c74a8be41209
Revises: bfb910a8ac31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c74a8be41209"
down_revision = "bfb910a8ac31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicate = op.get_bind().execute(sa.text(
        "SELECT source_id FROM books WHERE source_id IS NOT NULL "
        "GROUP BY source_id HAVING count(*) > 1 LIMIT 1"
    )).first()
    if duplicate:
        raise RuntimeError("Resolve duplicate books.source_id values before applying the import migration")
    op.drop_index("ix_books_source_id", table_name="books")
    op.create_index("ix_books_source_id", "books", ["source_id"], unique=True)

    op.create_table(
        "catalogue_import_runs",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("works_url", sa.Text(), nullable=False),
        sa.Column("authors_url", sa.Text(), nullable=False),
        sa.Column("editions_url", sa.Text(), nullable=False),
        sa.Column("category_hash", sa.String(64), nullable=False),
        sa.Column("max_books", sa.Integer(), nullable=False),
        sa.Column("phase", sa.String(20), nullable=False),
        sa.Column("checkpoint_line", sa.Integer(), nullable=False),
        sa.Column("merge_cursor", sa.String(100), nullable=True),
        sa.Column("selected_count", sa.Integer(), nullable=False),
        sa.Column("merged_count", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "catalogue_stage_works",
        sa.Column("run_id", sa.String(80), sa.ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source_id", sa.String(100), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("published_year", sa.Integer(), nullable=True),
        sa.Column("cover_image_url", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=False),
    )
    op.execute("CREATE INDEX ix_catalogue_stage_works_title_hash ON catalogue_stage_works (md5(title))")
    op.create_table(
        "catalogue_stage_work_authors",
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("source_id", sa.String(100), primary_key=True),
        sa.Column("author_key", sa.String(100), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_catalogue_stage_work_authors_author",
        "catalogue_stage_work_authors", ["run_id", "author_key"]
    )
    op.create_table(
        "catalogue_stage_authors",
        sa.Column("run_id", sa.String(80), sa.ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("author_key", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(225), nullable=False),
    )
    op.create_table(
        "catalogue_stage_editions",
        sa.Column("run_id", sa.String(80), sa.ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source_id", sa.String(100), primary_key=True),
        sa.Column("edition_key", sa.String(100), nullable=False),
        sa.Column("quality", sa.Integer(), nullable=False),
        sa.Column("isbn13", sa.String(13), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("catalogue_stage_editions")
    op.drop_table("catalogue_stage_authors")
    op.drop_index("ix_catalogue_stage_work_authors_author", table_name="catalogue_stage_work_authors")
    op.drop_table("catalogue_stage_work_authors")
    op.drop_table("catalogue_stage_works")
    op.drop_table("catalogue_import_runs")
    op.drop_index("ix_books_source_id", table_name="books")
    op.create_index("ix_books_source_id", "books", ["source_id"], unique=False)
