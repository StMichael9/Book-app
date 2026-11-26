"""Clubs: when a member last opened the club, and the owner's size limit.

Additive. `club_members.last_seen_at` is nullable with no default (a metadata-only change): the "new posts" count is worked out when the
page is read, from the posts since this time. `clubs.member_limit` is the owner's size limit, 2 to 25, defaulting to 25 (a constant default,
also metadata-only on Postgres 11+). Nothing is rewritten and no background job reads either column.

Revision ID: f8a2c5d17e93
Revises: f3c9b2d84e17
"""
import sqlalchemy as sa
from alembic import op

revision = 'f8a2c5d17e93'
down_revision = 'f3c9b2d84e17'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('club_members', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('clubs', sa.Column('member_limit', sa.Integer(), nullable=False, server_default='25'))
    op.create_check_constraint('ck_club_member_limit', 'clubs', 'member_limit BETWEEN 2 AND 25')


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint('ck_club_member_limit', 'clubs', type_='check')
    op.drop_column('clubs', 'member_limit')
    op.drop_column('club_members', 'last_seen_at')
