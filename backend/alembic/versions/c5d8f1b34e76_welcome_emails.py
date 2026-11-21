"""Welcome emails: users.welcome_step and users.email_tips (T73 G4).

Both columns are added with defaults (email_tips is an opt-in: false for everyone, including existing accounts), so existing rows are filled without a rewrite of any size that matters (Postgres 11+ keeps a
constant default in the catalogue). Accounts already older than 30 days are marked as finished (welcome_step 3) so the first send
never reaches them.

Revision ID: c5d8f1b34e76
Revises: b9c4e7a12d03
"""
import sqlalchemy as sa
from alembic import op

revision = 'c5d8f1b34e76'
down_revision = 'b9c4e7a12d03'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('users', sa.Column('welcome_step', sa.SmallInteger(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('email_tips', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_check_constraint('ck_user_welcome_step', 'users', 'welcome_step BETWEEN 0 AND 3')
    op.execute("UPDATE users SET welcome_step = 3 WHERE created_at < now() - interval '30 days'")


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint('ck_user_welcome_step', 'users', type_='check')
    op.drop_column('users', 'email_tips')
    op.drop_column('users', 'welcome_step')
