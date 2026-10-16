"""Fresh, populated local M4→M5 migration and deletion-guard rehearsal."""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def test_populated_upgrade_preserves_native_data_and_refuses_lossy_downgrade():
    url = os.getenv("LIBRARY_IMPORT_MIGRATION_DATABASE_URL")
    if not url:
        pytest.skip("Fresh disposable M5 migration target required")
    parsed = make_url(url)
    assert os.getenv("BOOKVANE_TEST_DB_ISOLATED") == "yes"
    assert parsed.host == "127.0.0.1" and parsed.port == 55433 and parsed.username == "bookvane_v3_test" and "test" in parsed.database
    engine = create_engine(url)
    root = Path(__file__).resolve().parents[1]
    environment = {**os.environ, "DATABASE_URL": url, "IS_DEV": "true",
        "SECRET_KEY": "m5-local-migration-test-not-a-live-secret", "RESEND_API_KEY": "", "PASSWORD_RESET_FROM": ""}
    def migrate(action, revision, succeeds=True):
        result = subprocess.run([sys.executable, "-m", "alembic", action, revision], cwd=root,
            env=environment, capture_output=True, text=True, timeout=120)
        assert (result.returncode == 0) is succeeds, result.stderr
        return result
    def snapshot():
        with engine.connect() as connection:
            return {name: connection.execute(text(f"SELECT * FROM {name} ORDER BY id")).mappings().all()
                for name in ("users", "books", "user_books", "reading_attempts", "user_preferences")}
    with engine.connect() as connection:
        assert not connection.scalar(text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user"))
        assert connection.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")) == 0
    migrate("upgrade", "ef41a83d9012")
    owner, other, native_attempt = uuid4(), uuid4(), uuid4()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users(id,email,hashed_password) VALUES (:id,'m5-migration-owner@example.test','fixture'),(:other,'m5-migration-other@example.test','fixture')"), {"id": owner, "other": other})
        connection.execute(text("INSERT INTO books(id,title) VALUES (701,'Retained catalogue work')"))
        connection.execute(text("INSERT INTO user_books(id,user_id,book_id,is_owned,is_wanted,save_note) VALUES (801,:id,701,true,true,'Native save reason')"), {"id": owner})
        connection.execute(text("INSERT INTO user_books(id,user_id,private_title,private_author,is_owned,is_wanted) VALUES (802,:other,'Private existing work','An Author',false,false)"), {"other": other})
        connection.execute(text("INSERT INTO reading_attempts(id,user_book_id,state,note,reaction,creation_fingerprint) VALUES (:id,801,'finished','Native reading note','liked',:hash)"), {"id": native_attempt, "hash": "a" * 64})
        connection.execute(text("INSERT INTO tags(id,name,type) VALUES (701,'migration-preference','genre')"))
        connection.execute(text("INSERT INTO user_preferences(id,user_id,tag_id,source_text) VALUES (901,:id,701,'Keep my preferences')"), {"id": owner})
    before = snapshot()
    migrate("upgrade", "head")
    assert snapshot() == before
    # An empty import migration can be rolled back without touching M4 data.
    migrate("downgrade", "ef41a83d9012")
    assert snapshot() == before
    migrate("upgrade", "head")
    source, link, run = uuid4(), uuid4(), uuid4()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO library_import_runs(id,user_id,source,headers,creation_fingerprint) VALUES (:id,:owner,'generic','[\"title\"]',:hash)"), {"id": run, "owner": owner, "hash": "b" * 64})
        connection.execute(text("INSERT INTO imported_library_records(id,user_id,user_book_id,source,scope,record_key,accepted_hash,context) VALUES (:id,:owner,801,'generic','default',:key,:hash,'{\"review\":\"Private imported review\"}')"), {"id": source, "owner": owner, "key": "c" * 64, "hash": "d" * 64})
        connection.execute(text("INSERT INTO imported_read_links(id,user_id,record_id,user_book_id,attempt_id,event_key,event_hash) VALUES (:id,:owner,:record,801,:attempt,:key,:hash)"), {"id": link, "owner": owner, "record": source, "attempt": native_attempt, "key": "e" * 64, "hash": "f" * 64})
    refused = migrate("downgrade", "ef41a83d9012", succeeds=False)
    assert "Private import data exists" in refused.stderr
    assert snapshot() == before
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM reading_attempts WHERE id=:id"), {"id": native_attempt})
        row = connection.execute(text("SELECT attempt_id,removed FROM imported_read_links WHERE id=:id"), {"id": link}).one()
        assert row == (None, True)
        connection.execute(text("DELETE FROM user_books WHERE id=801 AND user_id=:owner"), {"owner": owner})
        record = connection.execute(text("SELECT user_book_id,context,removed FROM imported_library_records WHERE id=:id"), {"id": source}).one()
        assert record == (None, {}, True)
        row = connection.execute(text("SELECT user_book_id,attempt_id,removed FROM imported_read_links WHERE id=:id"), {"id": link}).one()
        assert row == (None, None, True)
        assert connection.scalar(text("SELECT private_title FROM user_books WHERE id=802")) == "Private existing work"
        connection.execute(text("DELETE FROM users WHERE id=:id"), {"id": owner})
        assert connection.scalar(text("SELECT count(*) FROM imported_library_records")) == 0
        assert connection.scalar(text("SELECT count(*) FROM imported_read_links")) == 0
        assert connection.scalar(text("SELECT count(*) FROM library_import_runs")) == 0
    engine.dispose()
