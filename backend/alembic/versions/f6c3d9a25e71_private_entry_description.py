"""A reader's private entry may keep a description from an imported spreadsheet.

Revision ID: f6c3d9a25e71
Revises: e5b8c2d41a96
"""
import sqlalchemy as sa
from alembic import op

revision = 'f6c3d9a25e71'
down_revision = 'e5b8c2d41a96'
branch_labels = None
depends_on = None

IDENTITY = ("(book_id IS NOT NULL AND private_title IS NULL AND private_author IS NULL{extra}) OR "
            "(book_id IS NULL AND private_title IS NOT NULL AND char_length(btrim(private_title)) BETWEEN 1 AND 500)")


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('user_books', sa.Column('private_description', sa.Text(), nullable=True))
    op.drop_constraint('ck_user_book_identity', 'user_books', type_='check')
    op.create_check_constraint('ck_user_book_identity', 'user_books', IDENTITY.format(extra=" AND private_description IS NULL"))
    op.create_check_constraint('ck_user_book_description', 'user_books',
                               'private_description IS NULL OR char_length(private_description) <= 5000')


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint('ck_user_book_description', 'user_books', type_='check')
    op.drop_constraint('ck_user_book_identity', 'user_books', type_='check')
    op.create_check_constraint('ck_user_book_identity', 'user_books', IDENTITY.format(extra=""))
    op.drop_column('user_books', 'private_description')
