"""Profile v1: a private-by-default reader profile with an optional public username, and reading lists.

Revision ID: a7d4e2b9c683
Revises: f6c3d9a25e71
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'a7d4e2b9c683'
down_revision = 'f6c3d9a25e71'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('users', sa.Column('display_name', sa.String(40), nullable=True))
    op.add_column('users', sa.Column('bio', sa.String(160), nullable=True))
    op.add_column('users', sa.Column('handle', sa.String(30), nullable=True))
    op.add_column('users', sa.Column('profile_public', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('users', sa.Column('profile_prompted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_users_handle', 'users', ['handle'])
    op.create_check_constraint('ck_user_handle', 'users', "handle IS NULL OR handle ~ '^[a-z0-9-]{3,30}$'")
    op.create_table(
        'reading_lists',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', postgresql.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('description', sa.String(280), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_reading_lists_user_id', 'reading_lists', ['user_id'])
    op.create_table(
        'reading_list_items',
        sa.Column('list_id', sa.Integer(), sa.ForeignKey('reading_lists.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('book_id', sa.Integer(), sa.ForeignKey('books.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('position', sa.Integer(), nullable=False),
    )
    op.create_index('ix_reading_list_items_order', 'reading_list_items', ['list_id', 'position'])


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_table('reading_list_items')
    op.drop_table('reading_lists')
    op.drop_constraint('ck_user_handle', 'users', type_='check')
    op.drop_constraint('uq_users_handle', 'users', type_='unique')
    for column in ('profile_prompted_at', 'profile_public', 'handle', 'bio', 'display_name'):
        op.drop_column('users', column)
