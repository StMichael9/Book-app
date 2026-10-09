"""Add explicit product-update signups and optional book ISBN-13.

Revision ID: 124ada5d57f0
Revises: 875f4bd67a1c
"""
from alembic import op
import sqlalchemy as sa

revision = "124ada5d57f0"
down_revision = "875f4bd67a1c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_signups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("books", sa.Column("isbn13", sa.String(13), nullable=True))
    op.create_index("ix_books_isbn13", "books", ["isbn13"])


def downgrade() -> None:
    op.drop_index("ix_books_isbn13", table_name="books")
    op.drop_column("books", "isbn13")
    op.drop_table("email_signups")
