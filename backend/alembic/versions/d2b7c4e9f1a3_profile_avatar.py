"""Profile avatar: the reader's chosen icon and colour (both optional; the allow-lists live in the profile service).

Revision ID: d2b7c4e9f1a3
Revises: c9f2a6d83e15
"""
import sqlalchemy as sa
from alembic import op

revision = 'd2b7c4e9f1a3'
down_revision = 'c9f2a6d83e15'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('users', sa.Column('avatar_icon', sa.String(20), nullable=True))
    op.add_column('users', sa.Column('avatar_color', sa.String(12), nullable=True))


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column('users', 'avatar_color')
    op.drop_column('users', 'avatar_icon')
