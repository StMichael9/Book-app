"""Popular sort: books.popularity (Open Library activity score) and the index that serves it.

Revision ID: c9f2a6d83e15
Revises: b8e5f1c7d204
"""
import sqlalchemy as sa
from alembic import op

revision = 'c9f2a6d83e15'
down_revision = 'b8e5f1c7d204'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('books', sa.Column('popularity', sa.Float(), nullable=True))
    op.execute("CREATE INDEX ix_books_popularity ON books (popularity DESC NULLS LAST, id)")


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DROP INDEX ix_books_popularity")
    op.drop_column('books', 'popularity')
