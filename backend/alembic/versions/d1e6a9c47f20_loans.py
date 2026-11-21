"""Lending: one small `loans` table (T75).

Additive. A loan belongs to a library entry (deleted with it). At most one OPEN loan per entry and direction (partial unique index);
closed loans stay as history. The optional share token is unique and only for 'lent'.

Revision ID: d1e6a9c47f20
Revises: c5d8f1b34e76
"""
import sqlalchemy as sa
from alembic import op

revision = 'd1e6a9c47f20'
down_revision = 'c5d8f1b34e76'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'loans',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_book_id', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(length=10), nullable=False),
        sa.Column('person_name', sa.Text(), nullable=False),
        sa.Column('started_on', sa.Date(), nullable=False, server_default=sa.func.current_date()),
        sa.Column('due_on', sa.Date(), nullable=True),
        sa.Column('ended_on', sa.Date(), nullable=True),
        sa.Column('share_token', sa.Text(), nullable=True),
        sa.Column('share_revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('borrower_said_back_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('request_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_book_id'], ['user_books.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('share_token'),
        sa.UniqueConstraint('user_book_id', 'request_id', name='uq_loan_request'),
        sa.CheckConstraint("direction IN ('lent', 'borrowed')", name='ck_loan_direction'),
        sa.CheckConstraint("char_length(btrim(person_name)) BETWEEN 1 AND 80", name='ck_loan_person'),
        sa.CheckConstraint("due_on IS NULL OR due_on >= started_on", name='ck_loan_due'),
        sa.CheckConstraint("ended_on IS NULL OR ended_on >= started_on", name='ck_loan_ended'),
        sa.CheckConstraint("share_token IS NULL OR direction = 'lent'", name='ck_loan_share_lent'),
    )
    op.create_index('uq_loan_open', 'loans', ['user_book_id', 'direction'], unique=True, postgresql_where=sa.text('ended_on IS NULL'))
    op.create_index('ix_loans_user_book_id', 'loans', ['user_book_id'])


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index('ix_loans_user_book_id', table_name='loans')
    op.drop_index('uq_loan_open', table_name='loans')
    op.drop_table('loans')
