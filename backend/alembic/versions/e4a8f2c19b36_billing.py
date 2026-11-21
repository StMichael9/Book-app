"""Billing foundation: billing_customers, entitlements, billing_events (T77A).

Additive. No card data is stored (Stripe keeps it). `entitlements.club_id` is a plain integer until the clubs tables exist.

Revision ID: e4a8f2c19b36
Revises: d1e6a9c47f20
"""
import sqlalchemy as sa
from alembic import op

revision = 'e4a8f2c19b36'
down_revision = 'd1e6a9c47f20'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        'billing_customers',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('stripe_customer_id', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('user_id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('stripe_customer_id'),
    )
    op.create_table(
        'entitlements',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('club_id', sa.Integer(), nullable=True),
        sa.Column('stripe_subscription_id', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('interval', sa.String(length=5), nullable=True),
        sa.Column('unit_amount', sa.Integer(), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('payment_failed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stripe_event_created', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('stripe_subscription_id'),
        sa.CheckConstraint("kind IN ('patron', 'club_plus')", name='ck_entitlement_kind'),
        sa.CheckConstraint("status IN ('active', 'trialing', 'past_due', 'canceled')", name='ck_entitlement_status'),
        sa.CheckConstraint("(kind = 'club_plus') = (club_id IS NOT NULL)", name='ck_entitlement_club'),
        sa.CheckConstraint("\"interval\" IS NULL OR \"interval\" IN ('month', 'year')", name='ck_entitlement_interval'),
    )
    op.create_index('ix_entitlements_user_id', 'entitlements', ['user_id'])
    op.create_index('ix_entitlements_club_id', 'entitlements', ['club_id'], postgresql_where=sa.text('club_id IS NOT NULL'))
    op.create_table(
        'billing_events',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('type', sa.Text(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_table('billing_events')
    op.drop_index('ix_entitlements_club_id', table_name='entitlements')
    op.drop_index('ix_entitlements_user_id', table_name='entitlements')
    op.drop_table('entitlements')
    op.drop_table('billing_customers')
