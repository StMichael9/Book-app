"""Full-chain, populated upgrade and recovery checks on fresh local databases."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]


def safe_engine(variable):
    value = os.getenv(variable)
    if not value:
        pytest.skip(f"{variable} must identify a fresh isolated local migration-test database")
    url = make_url(value)
    if os.getenv("BOOKVANE_TEST_DB_ISOLATED") != "yes" or url.host != "127.0.0.1" or "test" not in (url.database or "") or url.username != "bookvane_v3_test":
        pytest.fail("Migration rehearsal requires the dedicated local test role/database")
    engine = create_engine(value)
    with engine.connect() as connection:
        assert not connection.scalar(text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user"))
    return engine, value


def migrate(url, action, revision, *, succeeds=True):
    environment = {**os.environ, "DATABASE_URL": url, "IS_DEV": "true",
                   "SECRET_KEY": "v3-local-test-key-with-at-least-32-bytes"}
    result = subprocess.run([sys.executable, "-m", "alembic", action, revision], cwd=ROOT,
        env=environment, capture_output=True, text=True, timeout=120)
    assert (result.returncode == 0) == succeeds, result.stderr
    return result


def snapshot(engine):
    with engine.connect() as connection:
        return {name: connection.execute(text(f"SELECT * FROM {name} ORDER BY id")).mappings().all()
                for name in ("users", "books", "user_books", "user_preferences")}


def test_full_chain_populated_backfill_safe_downgrade_and_recovery(tmp_path):
    engine, url = safe_engine("MIGRATION_DATABASE_URL")
    restore_engine, restore_url = safe_engine("MIGRATION_RESTORE_DATABASE_URL")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")) == 0, "Use a fresh rehearsal database"
    migrate(url, "upgrade", "d9b6e1f2a3c4")
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users(id,email,hashed_password) VALUES (:id,'migration@example.com','fixture')"), {"id": user_id})
        connection.execute(text("INSERT INTO books(id,title) VALUES (101,'Preserved one'),(102,'Preserved two')"))
        connection.execute(text("INSERT INTO tags(id,name,type) VALUES (101,'migration_fixture','genre')"))
        connection.execute(text("INSERT INTO user_books(id,user_id,book_id,status,created_at,updated_at) VALUES (201,:id,101,'owned','2025-01-01Z','2025-01-02Z'),(202,:id,102,'want','2025-02-01Z','2025-02-02Z')"), {"id": user_id})
        connection.execute(text("INSERT INTO user_preferences(id,user_id,tag_id,source_text) VALUES (301,:id,101,'Private fixture context')"), {"id": user_id})
    original = snapshot(engine)
    migrate(url, "upgrade", "head")
    migrated = snapshot(engine)
    for name in ("users", "books", "user_preferences"):
        assert migrated[name] == original[name]
    for before, after in zip(original["user_books"], migrated["user_books"]):
        assert all(after[key] == value for key, value in before.items())
        assert after["version"] == 1
        assert after["is_owned"] == (before["status"] == "owned")
        assert after["is_wanted"] == (before["status"] == "want")
    migrate(url, "downgrade", "d9b6e1f2a3c4")
    assert snapshot(engine) == original
    migrate(url, "upgrade", "head")
    # Old status-only SQL writes during rollout are synchronized by the trigger.
    with engine.begin() as connection:
        connection.execute(text("UPDATE user_books SET status='want' WHERE id=201"))
        row = connection.execute(text("SELECT is_owned,is_wanted,version FROM user_books WHERE id=201")).one()
        assert row == (False, True, 2)
        connection.execute(text("INSERT INTO reading_attempts(id,user_book_id,state,creation_fingerprint) VALUES (:id,201,'finished',:hash)"), {"id": uuid.uuid4(), "hash": "0" * 64})
    failure = migrate(url, "downgrade", "d9b6e1f2a3c4", succeeds=False)
    assert "downgrade would lose private data" in failure.stderr
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "a17d09c25ef1"
        assert connection.scalar(text("SELECT count(*) FROM reading_attempts")) == 1
    # Recovery rehearsal contains synthetic fixtures only; no production dump.
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO user_books(id,user_id,private_title,private_catalogue) VALUES (203,:id,'Private source fixture',CAST(:metadata AS jsonb))"),
            {'id':user_id,'metadata':'{"source":"openlibrary","work_id":"/works/OL1W","snapshot":"synthetic"}'})
    before_refusal = snapshot(engine)
    refusal = migrate(url,'downgrade','f5c12a608de3',succeeds=False)
    assert 'Retain catalogue provenance' in refusal.stderr
    assert snapshot(engine) == before_refusal
    binary_dir = Path(os.getenv("PG_BIN_DIR", "C:/Program Files/PostgreSQL/16/bin"))
    dump_binary = shutil.which("pg_dump") or str(binary_dir / "pg_dump.exe")
    restore_binary = shutil.which("pg_restore") or str(binary_dir / "pg_restore.exe")
    archive = tmp_path / "synthetic-m1.dump"
    dumped = subprocess.run([dump_binary, "--dbname", url, "--format=custom", "--file", str(archive)], capture_output=True, text=True, timeout=120)
    assert dumped.returncode == 0, dumped.stderr
    restored = subprocess.run([restore_binary, "--dbname", restore_url, "--no-owner", "--no-privileges", "--exit-on-error", str(archive)], capture_output=True, text=True, timeout=120)
    assert restored.returncode == 0, restored.stderr
    assert snapshot(restore_engine) == snapshot(engine)
    with restore_engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM reading_attempts")) == 1
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "a17d09c25ef1"
    engine.dispose()
    restore_engine.dispose()
