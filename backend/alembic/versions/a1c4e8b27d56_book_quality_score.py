"""Book quality score: books.quality_score (0-100) and a listing rule that hides books scored under 60 (never deletes them).

`is_listed` is a generated column, so its expression is replaced by dropping and re-adding it (and its covering index).

Revision ID: a1c4e8b27d56
Revises: d2b7c4e9f1a3
"""
import sqlalchemy as sa
from alembic import op

revision = 'a1c4e8b27d56'
down_revision = 'd2b7c4e9f1a3'
branch_labels = None
depends_on = None

BLANK = "chr(32) || chr(9) || chr(13) || chr(10)"
BASE = (f"cover_image_url IS NOT NULL AND btrim(cover_image_url, {BLANK}) <> '' "
        "AND page_count IS NOT NULL AND page_count > 0 AND published_year IS NOT NULL")
NEW = BASE + " AND (quality_score IS NULL OR quality_score >= 60)"
INDEX = "CREATE INDEX ix_books_listed ON books (id) INCLUDE (page_count, source_id) WHERE is_listed"


def _regenerate(expression):
    op.execute("DROP INDEX IF EXISTS ix_books_listed")
    op.execute("ALTER TABLE books DROP COLUMN is_listed")
    op.execute(f"ALTER TABLE books ADD COLUMN is_listed boolean GENERATED ALWAYS AS ({expression}) STORED")
    op.execute(INDEX)


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('books', sa.Column('quality_score', sa.SmallInteger(), nullable=True))
    op.create_check_constraint('ck_books_quality_score', 'books', 'quality_score IS NULL OR quality_score BETWEEN 0 AND 100')
    _regenerate(NEW)


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    _regenerate(BASE)
    op.drop_constraint('ck_books_quality_score', 'books', type_='check')
    op.drop_column('books', 'quality_score')
