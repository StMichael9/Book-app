"""Nullable metadata for confirmed private catalogue selections; no public promotion.

Revision ID: a17d09c25ef1
Revises: f5c12a608de3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a17d09c25ef1'
down_revision = 'f5c12a608de3'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    op.add_column('user_books',sa.Column('private_catalogue',postgresql.JSONB(),nullable=True))
    op.create_index('uq_private_catalogue_work','user_books',['user_id',sa.text("(private_catalogue ->> 'work_id')")],unique=True,
                    postgresql_where=sa.text('private_catalogue IS NOT NULL'))
    # New feature is disabled by default. No existing row/data backfill.


def downgrade():
    # Never silently destroy provenance after readers have used this feature.
    op.execute("DO $$ BEGIN IF EXISTS(SELECT 1 FROM user_books WHERE private_catalogue IS NOT NULL) THEN RAISE EXCEPTION 'Retain catalogue provenance; disable the feature or forward-fix instead'; END IF; END $$")
    op.drop_index('uq_private_catalogue_work',table_name='user_books')
    op.drop_column('user_books','private_catalogue')
