"""Channel counters: add `ref` to event_counts and to its primary key (T73 G1).

Existing rows get ref '' and keep their counts. The key becomes (day, name, src, placement, ref). The table is small (one row
per day, event and source), so the rewrite is instant.

Revision ID: b9c4e7a12d03
Revises: e3a7c1f95b28
"""
import sqlalchemy as sa
from alembic import op

revision = 'b9c4e7a12d03'
down_revision = 'e3a7c1f95b28'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('event_counts', sa.Column('ref', sa.Text(), nullable=False, server_default=''))
    op.drop_constraint('event_counts_pkey', 'event_counts', type_='primary')
    op.create_primary_key('event_counts_pkey', 'event_counts', ['day', 'name', 'src', 'placement', 'ref'])


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    # Rows that differ only by ref are summed back into one row per (day, name, src, placement).
    op.execute("DROP TABLE IF EXISTS event_counts_fold")
    op.execute("""
        CREATE TEMP TABLE event_counts_fold AS
        SELECT day, name, src, placement, sum(count)::integer AS count FROM event_counts GROUP BY day, name, src, placement
    """)
    op.execute("DELETE FROM event_counts")
    op.drop_constraint('event_counts_pkey', 'event_counts', type_='primary')
    op.drop_column('event_counts', 'ref')
    op.create_primary_key('event_counts_pkey', 'event_counts', ['day', 'name', 'src', 'placement'])
    op.execute("INSERT INTO event_counts (day, name, src, placement, count) SELECT day, name, src, placement, count FROM event_counts_fold")
    op.execute("DROP TABLE event_counts_fold")
