"""Index substring search and common collection filters.

Revision ID: bfb910a8ac31
Revises: 124ada5d57f0
"""
from alembic import op
import sqlalchemy as sa

revision = "bfb910a8ac31"
down_revision = "124ada5d57f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_books_title_trgm", "books", ["title"],
        postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_authors_name_trgm", "authors", ["name"],
        postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.create_index("ix_book_tags_tag_book", "book_tags", ["tag_id", "book_id"])
    op.create_index("ix_user_books_user_status", "user_books", ["user_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_user_books_user_status", table_name="user_books")
    op.drop_index("ix_book_tags_tag_book", table_name="book_tags")
    op.drop_index("ix_authors_name_trgm", table_name="authors")
    op.drop_index("ix_books_title_trgm", table_name="books")
    # Keep pg_trgm: other objects or extensions may use it.
