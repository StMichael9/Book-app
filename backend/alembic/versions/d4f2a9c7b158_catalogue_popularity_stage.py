"""Importer staging for popular, complete catalogue growth: a popularity allowlist and staged title aliases.

Both are scratch data of the catalogue importer (emptied when a run completes); nothing here is user or catalogue data.

Revision ID: d4f2a9c7b158
Revises: c8a14d7f2b36
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'd4f2a9c7b158'
down_revision = 'c8a14d7f2b36'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'catalogue_stage_popularity',
        sa.Column('run_id', sa.String(length=80), nullable=False),
        sa.Column('source_id', sa.String(length=100), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['catalogue_import_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('run_id', 'source_id'),
    )
    op.add_column('catalogue_stage_works', sa.Column(
        'title_aliases', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade():
    op.drop_column('catalogue_stage_works', 'title_aliases')
    op.drop_table('catalogue_stage_popularity')
