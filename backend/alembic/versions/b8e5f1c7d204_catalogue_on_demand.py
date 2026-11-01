"""Catalogue on demand: listing/description split, provenance, the lookup queue, readers' private display override.

Revision ID: b8e5f1c7d204
Revises: a7d4e2b9c683
"""
import sqlalchemy as sa
from alembic import op

revision = 'b8e5f1c7d204'
down_revision = 'a7d4e2b9c683'
branch_labels = None
depends_on = None

BLANK = "chr(32) || chr(9) || chr(13) || chr(10)"
IS_LISTED = (f"cover_image_url IS NOT NULL AND btrim(cover_image_url, {BLANK}) <> '' "
             "AND page_count IS NOT NULL AND page_count > 0 AND published_year IS NOT NULL")
HAS_DESCRIPTION = f"description IS NOT NULL AND btrim(description, {BLANK}) <> ''"
IDENTITY_OLD = ("(book_id IS NOT NULL AND private_title IS NULL AND private_author IS NULL AND private_description IS NULL) OR "
                "(book_id IS NULL AND private_title IS NOT NULL AND char_length(btrim(private_title)) BETWEEN 1 AND 500)")
# A linked entry may keep the reader's own title, author and description as its display override.
IDENTITY_NEW = ("book_id IS NOT NULL OR "
                "(book_id IS NULL AND private_title IS NOT NULL AND char_length(btrim(private_title)) BETWEEN 1 AND 500)")


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('books', sa.Column('added_via', sa.String(20), nullable=True))
    op.add_column('books', sa.Column('added_at', sa.DateTime(timezone=True), nullable=True))
    op.execute(f"ALTER TABLE books ADD COLUMN is_listed boolean GENERATED ALWAYS AS ({IS_LISTED}) STORED")
    op.execute(f"ALTER TABLE books ADD COLUMN has_description boolean GENERATED ALWAYS AS ({HAS_DESCRIPTION}) STORED")
    op.execute("CREATE INDEX ix_books_listed ON books (id) WHERE is_listed")
    op.create_index('ix_books_added_at', 'books', ['added_at'], postgresql_where=sa.text('added_at IS NOT NULL'))
    op.alter_column('catalogue_import_issues', 'run_id', existing_type=sa.String(80), nullable=True)
    op.drop_constraint('ck_user_book_identity', 'user_books', type_='check')
    op.create_check_constraint('ck_user_book_identity', 'user_books', IDENTITY_NEW)
    op.create_table(
        'catalogue_lookups',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('key', sa.String(60), nullable=False, unique=True),
        sa.Column('isbn', sa.String(13), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('author', sa.Text(), nullable=True),
        sa.Column('status', sa.String(10), nullable=False, server_default='queued'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_try_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('result_book_id', sa.Integer(), sa.ForeignKey('books.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('queued','done','rejected','failed')", name='ck_lookup_status'),
    )
    op.create_index('ix_catalogue_lookups_due', 'catalogue_lookups', ['next_try_at'],
                    postgresql_where=sa.text("status IN ('queued','failed')"))
    op.create_table(
        'catalogue_lookup_waiters',
        sa.Column('lookup_id', sa.Integer(), sa.ForeignKey('catalogue_lookups.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_book_id', sa.Integer(), sa.ForeignKey('user_books.id', ondelete='CASCADE'), primary_key=True),
    )
    op.create_index('ix_lookup_waiters_entry', 'catalogue_lookup_waiters', ['user_book_id'])


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_table('catalogue_lookup_waiters')
    op.drop_table('catalogue_lookups')
    op.drop_constraint('ck_user_book_identity', 'user_books', type_='check')
    op.execute("UPDATE user_books SET private_title = NULL, private_author = NULL, private_description = NULL WHERE book_id IS NOT NULL")
    op.create_check_constraint('ck_user_book_identity', 'user_books', IDENTITY_OLD)
    op.execute("DELETE FROM catalogue_import_issues WHERE run_id IS NULL")
    op.alter_column('catalogue_import_issues', 'run_id', existing_type=sa.String(80), nullable=False)
    op.drop_index('ix_books_added_at', table_name='books')
    op.execute("DROP INDEX ix_books_listed")
    op.execute("ALTER TABLE books DROP COLUMN has_description")
    op.execute("ALTER TABLE books DROP COLUMN is_listed")
    op.drop_column('books', 'added_at')
    op.drop_column('books', 'added_via')
