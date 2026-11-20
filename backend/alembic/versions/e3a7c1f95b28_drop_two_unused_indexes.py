"""Drop two indexes no query uses (T66): ix_books_complete and ix_book_title_aliases_title_trgm.

Revision ID: e3a7c1f95b28
Revises: d7f2b9e41c05
"""
from alembic import op

revision = "e3a7c1f95b28"
down_revision = "d7f2b9e41c05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only maintenance counts read is_complete, and they scan the table; alias ILIKE searches seq-scan at this size whether or not
    # the trigram index exists (EXPLAIN at 55k books / 30k aliases). About 5.8 MB at 55k books, about 10 MB at 100k.
    op.execute("DROP INDEX IF EXISTS ix_books_complete")
    op.execute("DROP INDEX IF EXISTS ix_book_title_aliases_title_trgm")


def downgrade() -> None:
    op.execute("CREATE INDEX ix_books_complete ON books (id) WHERE is_complete")
    op.execute("CREATE INDEX ix_book_title_aliases_title_trgm ON book_title_aliases USING gin (title gin_trgm_ops)")
