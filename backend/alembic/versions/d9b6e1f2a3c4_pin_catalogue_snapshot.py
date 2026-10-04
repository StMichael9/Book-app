"""Pin source metadata and run options for no-input catalogue resume.

Revision ID: d9b6e1f2a3c4
Revises: a7d21e90b4c6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "d9b6e1f2a3c4"
down_revision = "a7d21e90b4c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalogue_import_runs", sa.Column("snapshot_id", sa.String(80), nullable=True))
    op.add_column("catalogue_import_runs", sa.Column("source_manifest", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("catalogue_import_runs", sa.Column("category_weights", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("catalogue_import_runs", sa.Column("max_database_mb", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("catalogue_import_runs", "max_database_mb")
    op.drop_column("catalogue_import_runs", "category_weights")
    op.drop_column("catalogue_import_runs", "source_manifest")
    op.drop_column("catalogue_import_runs", "snapshot_id")
