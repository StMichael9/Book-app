"""Free book clubs (T78A): clubs, members, invites, books, checkpoints, posts and reports.

Additive. Private and invite-only: nothing here is read by a public page. `entitlements.club_id` (T77A) gets its foreign key.

Revision ID: f3c9b2d84e17
Revises: e4a8f2c19b36
"""
import sqlalchemy as sa
from alembic import op

revision = 'f3c9b2d84e17'
down_revision = 'e4a8f2c19b36'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'clubs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('owner_id', sa.UUID(), nullable=False),
        sa.Column('visibility', sa.String(length=10), nullable=False, server_default='invite'),
        sa.Column('color', sa.String(length=12), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint("char_length(btrim(name)) BETWEEN 1 AND 80", name='ck_club_name'),
        sa.CheckConstraint("description IS NULL OR char_length(description) <= 500", name='ck_club_description'),
        sa.CheckConstraint("visibility = 'invite'", name='ck_club_visibility'),
    )
    op.create_index('ix_clubs_owner_id', 'clubs', ['owner_id'])
    op.create_table(
        'club_members',
        sa.Column('club_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(length=10), nullable=False, server_default='member'),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('share_progress', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint('club_id', 'user_id'),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint("role IN ('owner', 'admin', 'member')", name='ck_club_member_role'),
    )
    op.create_index('uq_club_one_owner', 'club_members', ['club_id'], unique=True, postgresql_where=sa.text("role = 'owner'"))
    op.create_index('ix_club_members_user_id', 'club_members', ['user_id'])
    op.create_table(
        'club_invites',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('token', sa.Text(), nullable=False),
        sa.Column('club_id', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('uses', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('token'),
        sa.CheckConstraint("max_uses IS NULL OR max_uses BETWEEN 1 AND 1000", name='ck_club_invite_uses'),
    )
    op.create_index('ix_club_invites_club_id', 'club_invites', ['club_id'])
    op.create_table(
        'club_books',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('club_id', sa.Integer(), nullable=False),
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='upcoming'),
        sa.Column('starts_on', sa.Date(), nullable=True),
        sa.Column('ends_on', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='RESTRICT'),
        sa.CheckConstraint("status IN ('current', 'upcoming', 'past')", name='ck_club_book_status'),
        sa.CheckConstraint("starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on", name='ck_club_book_dates'),
    )
    op.create_index('uq_club_one_current_book', 'club_books', ['club_id'], unique=True, postgresql_where=sa.text("status = 'current'"))
    op.create_index('ix_club_books_club_id', 'club_books', ['club_id'])
    op.create_table(
        'club_checkpoints',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('club_book_id', sa.Integer(), nullable=False),
        sa.Column('unit', sa.String(length=10), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False),
        sa.Column('due_on', sa.Date(), nullable=True),
        sa.Column('label', sa.String(length=80), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['club_book_id'], ['club_books.id'], ondelete='CASCADE'),
        sa.CheckConstraint("unit IN ('pages', 'percent')", name='ck_club_checkpoint_unit'),
        sa.CheckConstraint("(unit = 'percent' AND value BETWEEN 0 AND 100) OR (unit = 'pages' AND value >= 0)", name='ck_club_checkpoint_value'),
    )
    op.create_index('ix_club_checkpoints_book', 'club_checkpoints', ['club_book_id'])
    op.create_table(
        'club_posts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('club_book_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('anchor_unit', sa.String(length=10), nullable=True),
        sa.Column('anchor_value', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hidden_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['club_book_id'], ['club_books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint("char_length(btrim(body)) BETWEEN 1 AND 2000 OR deleted_at IS NOT NULL", name='ck_club_post_body'),
        sa.CheckConstraint("(anchor_unit IS NULL AND anchor_value IS NULL) OR (anchor_unit IN ('pages', 'percent') AND anchor_value >= 0 "
                           "AND (anchor_unit = 'pages' OR anchor_value <= 100))", name='ck_club_post_anchor'),
    )
    op.create_index('ix_club_posts_book_id', 'club_posts', ['club_book_id', 'id'])
    op.create_table(
        'club_reports',
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('reporter_id', sa.UUID(), nullable=False),
        sa.Column('reason', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('post_id', 'reporter_id'),
        sa.ForeignKeyConstraint(['post_id'], ['club_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_foreign_key('fk_entitlements_club', 'entitlements', 'clubs', ['club_id'], ['id'], ondelete='RESTRICT')


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint('fk_entitlements_club', 'entitlements', type_='foreignkey')
    for table in ('club_reports', 'club_posts', 'club_checkpoints', 'club_books', 'club_invites', 'club_members', 'clubs'):
        op.drop_table(table)
