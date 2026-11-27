"""Clubs: short invite codes (join by code or QR).

Additive. `club_invites.code` is nullable with no default (a metadata-only change). The unique index covers invites that are not revoked
(an expiry depends on the clock, so it cannot be part of an index): a revoked invite frees its code. Invites that are live today get a
code from the plain SQL below: no job, no application code, deterministic, one UPDATE over a handful of rows. The code is the row's
position scrambled by an affine map that is one-to-one modulo 31^6 (the multiplier is coprime to 31), so no two rows can collide; new
invites get random codes from the application.

Revision ID: b7c3f5a91d24
Revises: a1d6e4b82c57
"""
import sqlalchemy as sa
from alembic import op

revision = 'b7c3f5a91d24'
down_revision = 'a1d6e4b82c57'
branch_labels = None
depends_on = None

# A..Z without I, L and O, then 2..9: 31 characters, six of them. 31^6 = 887503681.
BACKFILL = """
WITH numbered AS (
    SELECT id, ((row_number() OVER (ORDER BY created_at, id))::bigint * 740297423 + 91234567) % 887503681 AS v
    FROM club_invites
    WHERE code IS NULL AND revoked_at IS NULL AND expires_at > now()
)
UPDATE club_invites AS ci SET code =
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', ((n.v / 28629151) % 31)::int + 1, 1) ||
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', ((n.v / 923521) % 31)::int + 1, 1) ||
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', ((n.v / 29791) % 31)::int + 1, 1) ||
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', ((n.v / 961) % 31)::int + 1, 1) ||
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', ((n.v / 31) % 31)::int + 1, 1) ||
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (n.v % 31)::int + 1, 1)
FROM numbered AS n WHERE ci.id = n.id
"""


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('club_invites', sa.Column('code', sa.String(6), nullable=True))
    op.execute(BACKFILL)
    op.create_index('uq_club_invites_code', 'club_invites', ['code'], unique=True,
                    postgresql_where=sa.text('revoked_at IS NULL AND code IS NOT NULL'))


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index('uq_club_invites_code', table_name='club_invites')
    op.drop_column('club_invites', 'code')
