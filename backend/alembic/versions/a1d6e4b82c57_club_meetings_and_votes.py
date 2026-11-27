"""Clubs: meetings with RSVPs, and book suggestions with votes.

Additive: four new tables and their indexes, nothing existing is changed or rewritten. No background job reads any of them: what is
"next" is worked out when a page is read. Club foreign keys cascade so deleting a club removes everything; a deleted account takes its
RSVPs, votes and suggestions with it, while a meeting it created stays for the club (created_by is set to NULL).

Revision ID: a1d6e4b82c57
Revises: f8a2c5d17e93
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'a1d6e4b82c57'
down_revision = 'f8a2c5d17e93'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'club_meetings',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('club_id', sa.Integer(), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('place', sa.String(200)),
        sa.Column('link', sa.String(500)),
        sa.Column('questions', postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('created_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('place IS NULL OR char_length(place) <= 200', name='ck_club_meeting_place'),
        sa.CheckConstraint("link IS NULL OR (link LIKE 'https://%' AND char_length(link) <= 500)", name='ck_club_meeting_link'),
        sa.CheckConstraint('cardinality(questions) <= 5', name='ck_club_meeting_questions'),
    )
    op.create_index('ix_club_meetings_club_starts', 'club_meetings', ['club_id', 'starts_at'])
    op.create_table(
        'club_meeting_rsvps',
        sa.Column('meeting_id', sa.Integer(), sa.ForeignKey('club_meetings.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('status', sa.String(5), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('going', 'maybe', 'no')", name='ck_club_rsvp_status'),
    )
    op.create_index('ix_club_meeting_rsvps_user', 'club_meeting_rsvps', ['user_id'])
    op.create_table(
        'club_suggestions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('club_id', sa.Integer(), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('book_id', sa.Integer(), sa.ForeignKey('books.id', ondelete='CASCADE'), nullable=False),
        sa.Column('suggested_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('note', sa.String(200)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('club_id', 'book_id', name='uq_club_suggestion_book'),
        sa.CheckConstraint('note IS NULL OR char_length(note) <= 200', name='ck_club_suggestion_note'),
    )
    op.create_index('ix_club_suggestions_club_id', 'club_suggestions', ['club_id'])
    op.create_index('ix_club_suggestions_user', 'club_suggestions', ['suggested_by'])
    op.create_table(
        'club_votes',
        sa.Column('suggestion_id', sa.Integer(), sa.ForeignKey('club_suggestions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    )
    op.create_index('ix_club_votes_user', 'club_votes', ['user_id'])


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    for table in ('club_votes', 'club_suggestions', 'club_meeting_rsvps', 'club_meetings'):
        if op.get_bind().execute(sa.text(f'SELECT EXISTS (SELECT 1 FROM {table})')).scalar():
            raise RuntimeError(f'{table} has rows; refusing to drop it on downgrade')
    op.drop_table('club_votes')
    op.drop_table('club_suggestions')
    op.drop_table('club_meeting_rsvps')
    op.drop_table('club_meetings')
