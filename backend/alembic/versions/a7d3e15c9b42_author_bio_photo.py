"""Author pages: a short bio and an Open Library photo id on each author (T71).

Additive and nullable: nothing is rewritten. The importer fills the columns for new and refreshed authors and a maintenance
task fills the existing ones. The staging table gets the same two columns so the importer can carry them to the merge.

Revision ID: a7d3e15c9b42
Revises: f4b8d2a60e17
"""
import sqlalchemy as sa
from alembic import op

revision = 'a7d3e15c9b42'
down_revision = 'f4b8d2a60e17'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('authors', sa.Column('bio', sa.Text(), nullable=True))
    op.add_column('authors', sa.Column('photo_id', sa.Integer(), nullable=True))
    op.add_column('authors', sa.Column('bio_source', sa.String(length=20), nullable=True))
    op.create_check_constraint('ck_author_bio_length', 'authors', 'bio IS NULL OR char_length(bio) <= 600')
    op.add_column('catalogue_stage_authors', sa.Column('bio', sa.Text(), nullable=True))
    op.add_column('catalogue_stage_authors', sa.Column('photo_id', sa.Integer(), nullable=True))


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column('catalogue_stage_authors', 'photo_id')
    op.drop_column('catalogue_stage_authors', 'bio')
    op.drop_constraint('ck_author_bio_length', 'authors', type_='check')
    op.drop_column('authors', 'bio_source')
    op.drop_column('authors', 'photo_id')
    op.drop_column('authors', 'bio')
