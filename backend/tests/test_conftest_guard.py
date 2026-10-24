from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text

from conftest import missing_migration_objects


@pytest.fixture()
def connection(test_database_url: str):
    engine = create_engine(test_database_url)
    try:
        with engine.connect() as conn:
            yield conn
    finally:
        engine.dispose()


def test_migrated_database_reports_nothing_missing(connection):
    assert missing_migration_objects(connection) == []


def test_dropped_trigger_is_reported(connection):
    transaction = connection.begin()
    try:
        connection.execute(text("DROP TRIGGER bookvane_import_entry_removal ON user_books"))
        assert missing_migration_objects(connection) == ["trigger bookvane_import_entry_removal"]
    finally:
        transaction.rollback()
    assert missing_migration_objects(connection) == []
