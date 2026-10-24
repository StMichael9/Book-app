"""Additive English/alternate title aliases so search finds works stored under original-language titles.

Revision ID: b3e7c5a91f20
Revises: a17d09c25ef1
"""
from alembic import op
import sqlalchemy as sa

revision = 'b3e7c5a91f20'
down_revision = 'a17d09c25ef1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        'book_title_aliases',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('book_id', sa.Integer(), sa.ForeignKey('books.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('language', sa.String(8), nullable=True),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.CheckConstraint('char_length(btrim(title)) BETWEEN 1 AND 500', name='ck_book_title_aliases_title_length'),
        sa.CheckConstraint("source IN ('openlibrary_edition')", name='ck_book_title_aliases_source'),
    )
    op.create_index('uq_book_title_alias', 'book_title_aliases', ['book_id', sa.text('lower(title)')], unique=True)
    op.create_index('ix_book_title_aliases_book', 'book_title_aliases', ['book_id'])
    op.create_index('ix_book_title_aliases_title_trgm', 'book_title_aliases', ['title'],
                    postgresql_using='gin', postgresql_ops={'title': 'gin_trgm_ops'})
    # New table starts empty; the backfill is a separate, explicit tool.


def downgrade():
    # Never silently destroy aliases that were loaded after this revision.
    op.execute("DO $$ BEGIN IF EXISTS(SELECT 1 FROM book_title_aliases) THEN RAISE EXCEPTION 'Retain title aliases; empty the table deliberately or forward-fix instead'; END IF; END $$")
    op.drop_index('ix_book_title_aliases_title_trgm', table_name='book_title_aliases')
    op.drop_index('ix_book_title_aliases_book', table_name='book_title_aliases')
    op.drop_index('uq_book_title_alias', table_name='book_title_aliases')
    op.drop_table('book_title_aliases')
    # Keep pg_trgm: other objects use it.
