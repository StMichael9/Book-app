"""Derived books.is_complete so discovery can show only fully described catalogue books.

Revision ID: c8a14d7f2b36
Revises: b3e7c5a91f20
"""
from alembic import op

revision = 'c8a14d7f2b36'
down_revision = 'b3e7c5a91f20'
branch_labels = None
depends_on = None

# Author presence is not here: a generated column cannot read another table. The importer
# guarantees authors and the backfill report counts author-less books.
# Blank means missing: trim spaces, tabs and line breaks (btrim alone strips only spaces).
BLANK_CHARS = "chr(32) || chr(9) || chr(13) || chr(10)"
IS_COMPLETE = (f"cover_image_url IS NOT NULL AND btrim(cover_image_url, {BLANK_CHARS}) <> '' AND description IS NOT NULL "
               f"AND btrim(description, {BLANK_CHARS}) <> '' AND page_count IS NOT NULL AND page_count > 0 AND published_year IS NOT NULL")


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    op.execute(f"ALTER TABLE books ADD COLUMN is_complete boolean GENERATED ALWAYS AS ({IS_COMPLETE}) STORED")
    op.execute("CREATE INDEX ix_books_complete ON books (id) WHERE is_complete")


def downgrade():
    # Derived data only: dropping the column loses nothing.
    op.execute("DROP INDEX ix_books_complete")
    op.execute("ALTER TABLE books DROP COLUMN is_complete")
