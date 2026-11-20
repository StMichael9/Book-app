"""Reading notes: one row per note, each with its own dates and a snapshot of the reading's progress.

Additive: a new table, then a set-based backfill that splits every non-blank reading_attempts.note on blank lines (no Python
loop). Migrated notes have no written_at, edited_at or progress. reading_attempts.note stays but is no longer written; dropping
it is a later change. Downgrade joins the notes back into reading_attempts.note (2,000 characters at most) and drops the table.

Revision ID: f4b8d2a60e17
Revises: d7f2b9e41c05
"""
import sqlalchemy as sa
from alembic import op

revision = 'f4b8d2a60e17'
down_revision = 'd7f2b9e41c05'
branch_labels = None
depends_on = None


BACKFILL = r"""
        INSERT INTO reading_notes (attempt_id, text, request_id)
        SELECT part.attempt_id, part.text, gen_random_uuid()
        FROM (
            SELECT a.id AS attempt_id, regexp_replace(piece.value, '^\s+|\s+$', '', 'g') AS text, a.id AS sort_attempt, piece.ordinality AS position
            FROM reading_attempts a
            CROSS JOIN LATERAL regexp_split_to_table(a.note, '\n\s*\n') WITH ORDINALITY AS piece(value, ordinality)
            WHERE a.note ~ '\S'
        ) part
        WHERE part.text <> ''
        ORDER BY part.sort_attempt, part.position
    """

# The column is never written after the upgrade, so clear it first: an attempt whose notes were all deleted must not get its old text back.
CLEAR = "UPDATE reading_attempts SET note = NULL WHERE note IS NOT NULL"

RESTORE = r"""
        UPDATE reading_attempts a
        SET note = left(joined.text, 2000)
        FROM (SELECT attempt_id, string_agg(text, E'\n\n' ORDER BY id) AS text FROM reading_notes GROUP BY attempt_id) joined
        WHERE joined.attempt_id = a.id
    """


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'reading_notes',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('attempt_id', sa.UUID(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('written_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('progress_unit', sa.String(length=10), nullable=True),
        sa.Column('progress_value', sa.Integer(), nullable=True),
        sa.Column('request_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['attempt_id'], ['reading_attempts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('attempt_id', 'request_id', name='uq_reading_note_request'),
        sa.CheckConstraint('char_length(btrim(text)) BETWEEN 1 AND 2000', name='ck_reading_note_text'),
        sa.CheckConstraint(
            "(progress_unit IS NULL AND progress_value IS NULL) OR "
            "(progress_unit IS NOT NULL AND progress_value IS NOT NULL AND "
            "((progress_unit = 'percent' AND progress_value BETWEEN 0 AND 100) OR "
            "(progress_unit = 'pages' AND progress_value >= 0)))", name='ck_reading_note_progress'),
    )
    op.create_index('ix_reading_notes_attempt_id_id', 'reading_notes', ['attempt_id', 'id'])
    # One set-based statement. WITH ORDINALITY keeps the order of the parts, and ids are assigned in that order.
    op.execute(sa.text(BACKFILL))


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(sa.text(CLEAR))
    op.execute(sa.text(RESTORE))
    op.drop_index('ix_reading_notes_attempt_id_id', table_name='reading_notes')
    op.drop_table('reading_notes')
