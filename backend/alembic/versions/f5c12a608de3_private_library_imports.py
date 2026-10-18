"""Private library import checkpoints and replay identities (disabled rollout).

Revision ID: f5c12a608de3
Revises: ef41a83d9012
"""
from alembic import op
import sqlalchemy as sa

revision = "f5c12a608de3"
down_revision = "ef41a83d9012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    op.create_unique_constraint("uq_user_book_owner", "user_books", ["id", "user_id"])
    op.create_unique_constraint("uq_attempt_entry", "reading_attempts", ["id", "user_book_id"])
    # Explicit frozen DDL: historical migrations never import evolving ORM models.
    op.execute("""
      CREATE TABLE library_import_runs (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source varchar(20) NOT NULL, scope varchar(80) NOT NULL DEFAULT 'default',
        adapter_version integer NOT NULL DEFAULT 1, headers jsonb NOT NULL,
        mapping jsonb NOT NULL DEFAULT '{}', options jsonb NOT NULL DEFAULT '{}',
        creation_fingerprint varchar(64) NOT NULL, phase varchar(24) NOT NULL DEFAULT 'uploading',
        row_count integer NOT NULL DEFAULT 0, batch_count integer NOT NULL DEFAULT 0,
        stage_bytes integer NOT NULL DEFAULT 0, event_count integer NOT NULL DEFAULT 0, input_bytes integer NOT NULL DEFAULT 0,
        analyze_cursor integer NOT NULL DEFAULT 0, group_cursor integer NOT NULL DEFAULT 0,
        revision integer NOT NULL DEFAULT 1, confirmed_revision integer, manifest_hash varchar(64),
        summary jsonb NOT NULL DEFAULT '{}', last_error varchar(80),
        expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
        report_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_library_import_run_owner UNIQUE(id,user_id),
        CONSTRAINT ck_library_import_source CHECK(source IN ('goodreads','storygraph','bookvane','generic','paste')),
        CONSTRAINT ck_library_import_phase CHECK(phase IN ('uploading','analyzing','grouping','preview_ready','applying','completed','completed_with_issues','cancelled','expired','failed')),
        CONSTRAINT ck_library_import_count CHECK(row_count BETWEEN 0 AND 20000 AND batch_count BETWEEN 0 AND 20000),
        CONSTRAINT ck_library_import_bytes CHECK(stage_bytes BETWEEN 0 AND 33554432),
        CONSTRAINT ck_library_import_events CHECK(event_count BETWEEN 0 AND 50000),
        CONSTRAINT ck_library_import_input_bytes CHECK(input_bytes BETWEEN 0 AND 20971520),
        CONSTRAINT ck_library_import_config_size CHECK(octet_length(headers::text) <= 65536 AND octet_length(mapping::text) <= 65536)
      );
      CREATE UNIQUE INDEX uq_library_import_active_owner ON library_import_runs(user_id)
        WHERE phase IN ('uploading','analyzing','grouping','preview_ready','applying');
      CREATE INDEX ix_library_import_owner_created ON library_import_runs(user_id,created_at,id);
      CREATE INDEX ix_library_import_expiry ON library_import_runs(expires_at,phase);
      CREATE TABLE library_import_rows (
        run_id uuid NOT NULL, ordinal integer NOT NULL, user_id uuid NOT NULL,
        batch_ordinal integer NOT NULL, batch_hash varchar(64) NOT NULL, batch_length integer NOT NULL,
        payload jsonb, row_hash varchar(64) NOT NULL, record_key varchar(64) NOT NULL,
        target_key varchar(100), candidates jsonb NOT NULL DEFAULT '[]', plan jsonb NOT NULL DEFAULT '{}',
        decision varchar(24), disposition varchar(32) NOT NULL DEFAULT 'pending', error_code varchar(80),
        result_entry_id integer REFERENCES user_books(id) ON DELETE SET NULL,
        PRIMARY KEY(run_id,ordinal),
        CONSTRAINT fk_import_row_owner FOREIGN KEY(run_id,user_id) REFERENCES library_import_runs(id,user_id) ON DELETE CASCADE,
        CONSTRAINT fk_import_row_result_owner FOREIGN KEY(result_entry_id,user_id) REFERENCES user_books(id,user_id) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT ck_import_row_ordinal CHECK(ordinal BETWEEN 1 AND 20000 AND batch_ordinal BETWEEN 0 AND 19999),
        CONSTRAINT ck_import_row_payload CHECK(payload IS NULL OR octet_length(payload::text) <= 262144),
        CONSTRAINT ck_import_row_plan CHECK(octet_length(candidates::text) <= 16384 AND octet_length(plan::text) <= 262144)
      );
      CREATE INDEX ix_import_row_record ON library_import_rows(run_id,record_key,ordinal);
      CREATE INDEX ix_import_row_target ON library_import_rows(run_id,target_key,ordinal);
      CREATE INDEX ix_import_row_disposition ON library_import_rows(run_id,disposition,ordinal);
      CREATE INDEX ix_import_row_result_entry ON library_import_rows(result_entry_id);
      CREATE TABLE imported_library_records (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_book_id integer REFERENCES user_books(id) ON DELETE SET NULL,
        source varchar(20) NOT NULL, scope varchar(80) NOT NULL, record_key varchar(64) NOT NULL,
        accepted_hash varchar(64) NOT NULL, context jsonb NOT NULL DEFAULT '{}', removed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_imported_record_owner UNIQUE(id,user_id),
        CONSTRAINT uq_imported_record_target UNIQUE(id,user_id,user_book_id),
        CONSTRAINT uq_imported_record_source UNIQUE(user_id,source,scope,record_key),
        CONSTRAINT fk_imported_record_target_owner FOREIGN KEY(user_book_id,user_id) REFERENCES user_books(id,user_id) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT ck_imported_record_context CHECK(octet_length(context::text) <= 262144)
      );
      CREATE INDEX ix_imported_record_owner_entry ON imported_library_records(user_id,user_book_id);
      CREATE INDEX ix_imported_record_entry ON imported_library_records(user_book_id);
      CREATE TABLE imported_read_links (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        record_id uuid NOT NULL, user_book_id integer REFERENCES user_books(id) ON DELETE SET NULL,
        attempt_id uuid REFERENCES reading_attempts(id) ON DELETE SET NULL,
        event_key varchar(64) NOT NULL, event_hash varchar(64) NOT NULL, removed boolean NOT NULL DEFAULT false,
        CONSTRAINT uq_imported_read_event UNIQUE(record_id,event_key),
        CONSTRAINT fk_imported_read_record_owner FOREIGN KEY(record_id,user_id) REFERENCES imported_library_records(id,user_id) ON DELETE CASCADE,
        CONSTRAINT fk_imported_read_record_target FOREIGN KEY(record_id,user_id,user_book_id) REFERENCES imported_library_records(id,user_id,user_book_id) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT fk_imported_read_target_owner FOREIGN KEY(user_book_id,user_id) REFERENCES user_books(id,user_id) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT fk_imported_read_attempt_target FOREIGN KEY(attempt_id,user_book_id) REFERENCES reading_attempts(id,user_book_id) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT ck_imported_read_target CHECK(attempt_id IS NULL OR user_book_id IS NOT NULL)
      );
      CREATE INDEX ix_imported_read_attempt ON imported_read_links(attempt_id);
      CREATE INDEX ix_imported_read_owner_entry ON imported_read_links(user_id,user_book_id);
      CREATE INDEX ix_imported_read_entry ON imported_read_links(user_book_id);
    """)
    # Deletions through either old application code or direct SQL cannot leave
    # private text behind or make a later upload resurrect removed history.
    op.execute("""
      CREATE FUNCTION bookvane_import_entry_removal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE imported_read_links SET attempt_id=NULL, user_book_id=NULL, removed=true
          WHERE user_book_id=OLD.id AND user_id=OLD.user_id;
        UPDATE imported_library_records SET user_book_id=NULL, context='{}', removed=true
          WHERE user_book_id=OLD.id AND user_id=OLD.user_id;
        RETURN OLD;
      END $$;
      CREATE TRIGGER bookvane_import_entry_removal BEFORE DELETE ON user_books
        FOR EACH ROW EXECUTE FUNCTION bookvane_import_entry_removal();
      CREATE FUNCTION bookvane_import_attempt_removal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE imported_read_links SET attempt_id=NULL, removed=true WHERE attempt_id=OLD.id;
        RETURN OLD;
      END $$;
      CREATE TRIGGER bookvane_import_attempt_removal BEFORE DELETE ON reading_attempts
        FOR EACH ROW EXECUTE FUNCTION bookvane_import_attempt_removal();
    """)


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    populated = op.get_bind().execute(sa.text("""
      SELECT EXISTS(SELECT 1 FROM library_import_runs) OR
             EXISTS(SELECT 1 FROM imported_library_records) OR EXISTS(SELECT 1 FROM imported_read_links)
    """)).scalar_one()
    if populated:
        raise RuntimeError("Private import data exists. Disable importing and forward-fix; do not discard history or replay protection.")
    op.execute("DROP TRIGGER bookvane_import_attempt_removal ON reading_attempts")
    op.execute("DROP TRIGGER bookvane_import_entry_removal ON user_books")
    op.execute("DROP FUNCTION bookvane_import_attempt_removal()")
    op.execute("DROP FUNCTION bookvane_import_entry_removal()")
    for table in ("imported_read_links", "imported_library_records", "library_import_rows", "library_import_runs"):
        op.drop_table(table)
    op.drop_constraint("uq_attempt_entry", "reading_attempts", type_="unique")
    op.drop_constraint("uq_user_book_owner", "user_books", type_="unique")
