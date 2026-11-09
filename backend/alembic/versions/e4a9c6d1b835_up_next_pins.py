"""Up next pins: the reader's own 1-5 ordered picks for what to read next, stored on the entry.

Pinning is not an edit of the entry, so the version-bump trigger now ignores a change to up_next_position alone (a pin
must not make a later edit from another page look stale).

Revision ID: e4a9c6d1b835
Revises: d2b7c4e9f1a3
"""
import sqlalchemy as sa
from alembic import op

revision = 'e4a9c6d1b835'
down_revision = 'd2b7c4e9f1a3'
branch_labels = None
depends_on = None

FUNCTION = """
    CREATE OR REPLACE FUNCTION bookvane_library_compatibility() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NOT NEW.is_owned AND NOT NEW.is_wanted AND NEW.status IS NOT NULL THEN
          NEW.is_owned := NEW.status::text = 'owned';
          NEW.is_wanted := NEW.status::text = 'want';
        END IF;
      ELSE
        IF NEW.status IS DISTINCT FROM OLD.status AND
           NEW.is_owned = OLD.is_owned AND NEW.is_wanted = OLD.is_wanted THEN
          NEW.is_owned := COALESCE(NEW.status::text = 'owned', false);
          NEW.is_wanted := COALESCE(NEW.status::text = 'want', false);
        END IF;
        IF {changed} AND NEW.version = OLD.version THEN
          NEW.version := OLD.version + 1;
        END IF;
      END IF;
      NEW.status := CASE WHEN NEW.is_owned THEN 'owned'::userbookstatus
                         WHEN NEW.is_wanted THEN 'want'::userbookstatus ELSE NULL END;
      RETURN NEW;
    END $$;
"""
CHANGED_ANY = "NEW IS DISTINCT FROM OLD"
CHANGED_BESIDES_PIN = "(to_jsonb(NEW) - 'up_next_position') IS DISTINCT FROM (to_jsonb(OLD) - 'up_next_position')"


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column('user_books', sa.Column('up_next_position', sa.SmallInteger(), nullable=True))
    op.create_check_constraint('ck_user_book_up_next', 'user_books', 'up_next_position IS NULL OR up_next_position BETWEEN 1 AND 5')
    op.create_index('uq_user_book_up_next', 'user_books', ['user_id', 'up_next_position'], unique=True,
                    postgresql_where=sa.text('up_next_position IS NOT NULL'))
    op.execute(FUNCTION.format(changed=CHANGED_BESIDES_PIN))


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(FUNCTION.format(changed=CHANGED_ANY))
    op.drop_index('uq_user_book_up_next', table_name='user_books')
    op.drop_constraint('ck_user_book_up_next', 'user_books', type_='check')
    op.drop_column('user_books', 'up_next_position')
