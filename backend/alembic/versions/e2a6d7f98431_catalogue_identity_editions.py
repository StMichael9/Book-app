"""Normalize catalogue identities, editions, taxonomy, and import staging.

Revision ID: e2a6d7f98431
Revises: c74a8be41209
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e2a6d7f98431"
down_revision = "c74a8be41209"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    active = connection.execute(sa.text(
        "SELECT id FROM catalogue_import_runs WHERE phase <> 'complete' LIMIT 1"
    )).first()
    if active:
        raise RuntimeError(f"Finish or explicitly abandon catalogue run {active.id} before migrating")
    duplicate = connection.execute(sa.text(
        "SELECT lower(name) AS name FROM tags GROUP BY lower(name) HAVING count(*) > 1 LIMIT 1"
    )).first()
    if duplicate:
        raise RuntimeError(f"Review same-name tags across types before migration: {duplicate.name}")

    with op.get_context().autocommit_block():
        for value in ("topic", "audience", "form"):
            op.execute(f"ALTER TYPE tagtype ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column("book_authors", sa.Column("source_managed", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("book_tags", sa.Column("source_managed", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("books", sa.Column("source_managed_fields", sa.Integer(), server_default="0", nullable=False))
    op.add_column("authors", sa.Column("source_id", sa.String(100)))
    op.add_column("authors", sa.Column("source_managed_name", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.drop_index("ix_authors_name", table_name="authors")
    op.create_index("ix_authors_name", "authors", ["name"])
    op.create_index("ix_authors_source_id", "authors", ["source_id"], unique=True)
    op.add_column("tags", sa.Column("visible_in_v2", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.create_index("uq_tags_lower_name", "tags", [sa.text("lower(name)")], unique=True)
    connection.execute(sa.text("UPDATE tags SET type = 'form' WHERE lower(name) IN ('poetry', 'drama')"))
    connection.execute(sa.text("UPDATE tags SET type = 'audience' WHERE lower(name) = 'young_adult'"))
    connection.execute(sa.text("UPDATE tags SET type = 'topic' WHERE lower(name) IN ('history', 'philosophy')"))
    connection.execute(sa.text("UPDATE tags SET type = 'genre' WHERE lower(name) IN ("
                               "'fantasy', 'mystery', 'horror', 'romance', 'science_fiction', "
                               "'thriller', 'biography', 'adventure', 'humor', 'classics')"))

    op.create_table(
        "editions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(100), nullable=False, unique=True),
        sa.Column("page_count", sa.Integer()),
        sa.Column("languages", JSONB(), nullable=False),
        sa.Column("publication_date", sa.Text()),
        sa.Column("publishers", JSONB(), nullable=False),
        sa.Column("physical_format", sa.Text()),
        sa.Column("cover_image_url", sa.Text()),
    )
    op.create_index("ix_editions_book_id", "editions", ["book_id"])
    op.create_table(
        "edition_isbns",
        sa.Column("edition_id", sa.Integer(), sa.ForeignKey("editions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("isbn13", sa.String(13), primary_key=True),
        sa.Column("derived_from_isbn10", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("ix_edition_isbns_isbn13", "edition_isbns", ["isbn13"])
    op.add_column("books", sa.Column("preferred_edition_id", sa.Integer()))
    op.create_foreign_key(
        "fk_books_preferred_edition", "books", "editions", ["preferred_edition_id"], ["id"], ondelete="SET NULL"
    )
    op.create_table(
        "catalogue_source_aliases",
        sa.Column("old_source_id", sa.String(100), primary_key=True),
        sa.Column("canonical_source_id", sa.String(100), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
    )
    op.create_index("ix_catalogue_source_aliases_canonical_source_id", "catalogue_source_aliases", ["canonical_source_id"])

    op.add_column("catalogue_import_runs", sa.Column("redirects_url", sa.Text(), server_default="", nullable=False))
    op.add_column("catalogue_import_runs", sa.Column("deletes_url", sa.Text(), server_default="", nullable=False))
    op.alter_column("catalogue_import_runs", "max_books", new_column_name="target_books", type_=sa.BigInteger())
    op.add_column("catalogue_import_runs", sa.Column("baseline_count", sa.BigInteger(), server_default="0", nullable=False))
    op.add_column("catalogue_import_runs", sa.Column("shortlist_factor", sa.Integer(), server_default="2", nullable=False))
    op.add_column("catalogue_import_runs", sa.Column("peak_database_mb", sa.Float(), server_default="0", nullable=False))
    op.add_column("catalogue_import_runs", sa.Column("peak_staging_mb", sa.Float(), server_default="0", nullable=False))
    op.add_column("catalogue_import_runs", sa.Column("category_seen_counts", JSONB(), server_default="{}", nullable=False))
    op.create_table(
        "catalogue_import_issues",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("catalogue_import_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("source_id", sa.String(100)),
        sa.Column("detail", sa.Text(), nullable=False),
    )
    op.create_index("ix_catalogue_import_issues_run_id", "catalogue_import_issues", ["run_id"])

    # Earlier staging can only be discarded when no run is unfinished.
    op.drop_table("catalogue_stage_editions")
    op.create_table(
        "catalogue_stage_editions",
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("edition_key", sa.String(100), primary_key=True),
        sa.Column("source_id", sa.String(100), nullable=False),
        sa.Column("quality", sa.Integer(), nullable=False),
        sa.Column("isbns", JSONB(), nullable=False),
        sa.Column("page_count", sa.Integer()),
        sa.Column("languages", JSONB(), nullable=False),
        sa.Column("publication_date", sa.Text()),
        sa.Column("publishers", JSONB(), nullable=False),
        sa.Column("physical_format", sa.Text()),
        sa.Column("cover_image_url", sa.Text()),
    )
    op.create_index("ix_catalogue_stage_editions_source_id", "catalogue_stage_editions", ["source_id"])
    op.add_column("catalogue_stage_works", sa.Column("categories", JSONB(), server_default="[]", nullable=False))
    op.add_column("catalogue_stage_works", sa.Column("quality", sa.Integer(), server_default="0", nullable=False))
    op.add_column("catalogue_stage_works", sa.Column("selected", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("catalogue_stage_works", sa.Column("forced", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("catalogue_stage_works", sa.Column("allocation_category", sa.String(80)))
    op.add_column("catalogue_stage_works", sa.Column("legacy_book_id", sa.Integer()))
    op.create_table(
        "catalogue_stage_author_counts",
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("author_key", sa.String(100), primary_key=True),
        sa.Column("selected_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "catalogue_stage_candidates",
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("category", sa.String(80), primary_key=True),
        sa.Column("source_id", sa.String(100), primary_key=True),
        sa.Column("quality", sa.Integer(), nullable=False),
        sa.Column("tie_hash", sa.String(64), nullable=False),
    )
    op.create_index(
        "ix_catalogue_stage_candidates_rank", "catalogue_stage_candidates",
        ["run_id", "category", "quality", "tie_hash"]
    )


def downgrade() -> None:
    raise RuntimeError("Catalogue identity migration is intentionally irreversible; restore a reviewed backup")
