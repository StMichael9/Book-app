"""Aggregate, cookie-less event counters: one row per day, event name, source and placement, holding only a count.

Revision ID: e5b8c2d41a96
Revises: d4f2a9c7b158
"""
import sqlalchemy as sa
from alembic import op

revision = 'e5b8c2d41a96'
down_revision = 'd4f2a9c7b158'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'event_counts',
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('src', sa.Text(), nullable=False, server_default=''),
        sa.Column('placement', sa.Text(), nullable=False, server_default=''),
        sa.Column('count', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('day', 'name', 'src', 'placement'),
    )


def downgrade():
    op.drop_table('event_counts')
