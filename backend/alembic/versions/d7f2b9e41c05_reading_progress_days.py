"""Daily progress history for the reading journal: one row per reading and reader-local day (first and last value saved).

Additive: a new table only; reading_attempts is untouched. History starts at release (no backfill). Rows go with their reading
(ON DELETE CASCADE). Downgrade refuses to drop a table that holds a reader's history.

Revision ID: d7f2b9e41c05
Revises: c3e6a0b42d79
"""
import sqlalchemy as sa
from alembic import op

revision = 'd7f2b9e41c05'
down_revision = 'c3e6a0b42d79'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'reading_progress_days',
        sa.Column('attempt_id', sa.UUID(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('unit', sa.String(length=10), nullable=False),
        sa.Column('first_value', sa.Integer(), nullable=False),
        sa.Column('last_value', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['attempt_id'], ['reading_attempts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('attempt_id', 'day'),
        sa.CheckConstraint("unit IN ('pages','percent')", name='ck_progress_day_unit'),
        sa.CheckConstraint("(unit = 'percent' AND first_value BETWEEN 0 AND 100 AND last_value BETWEEN 0 AND 100) OR "
                           "(unit = 'pages' AND first_value >= 0 AND last_value >= 0)", name='ck_progress_day_values'),
    )


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    # In SQL, so the same guard holds in online and offline (--sql) runs.
    op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM reading_progress_days) THEN "
               "RAISE EXCEPTION 'reading_progress_days holds reading history; refusing to drop it'; END IF; END $$")
    op.drop_table('reading_progress_days')
