"""Persist catalogue import measurements before staging cleanup.

Revision ID: f3c81b750ad9
Revises: e2a6d7f98431
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f3c81b750ad9"
down_revision = "e2a6d7f98431"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalogue_import_runs", sa.Column(
        "report", JSONB(), nullable=False, server_default="{}"
    ))


def downgrade() -> None:
    op.drop_column("catalogue_import_runs", "report")
