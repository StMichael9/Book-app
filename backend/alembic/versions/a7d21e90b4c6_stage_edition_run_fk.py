"""Keep staged editions attached to their import run.

Revision ID: a7d21e90b4c6
Revises: f3c81b750ad9
"""
from alembic import op

revision = "a7d21e90b4c6"
down_revision = "f3c81b750ad9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_foreign_key(
        "fk_catalogue_stage_editions_run",
        "catalogue_stage_editions", "catalogue_import_runs",
        ["run_id"], ["id"], ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_catalogue_stage_editions_run", "catalogue_stage_editions", type_="foreignkey"
    )
