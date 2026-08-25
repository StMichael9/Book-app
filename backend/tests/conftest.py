from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_TEST_FILE = PROJECT_ROOT / ".env.test"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _read_env_value(file_path: Path, key: str) -> str | None:
    if not file_path.exists():
        return None

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def _resolve_test_database_url() -> str | None:
    direct_env = os.getenv("DATABASE_URL_TEST") or os.getenv("TEST_DATABASE_URL")
    if direct_env:
        return direct_env

    return _read_env_value(ENV_TEST_FILE, "DATABASE_URL")


@pytest.fixture(scope="session")
def test_database_url() -> str:
    database_url = _resolve_test_database_url()
    if not database_url:
        pytest.skip(
            "Set DATABASE_URL_TEST, TEST_DATABASE_URL, or backend/.env.test before running the test suite."
        )
    return database_url


@pytest.fixture(scope="session")
def app_modules(test_database_url: str):
    os.environ["DATABASE_URL"] = test_database_url

    import database
    import main
    import models

    return {
        "database": database,
        "main": main,
        "models": models,
    }


@pytest.fixture()
def db_session(app_modules) -> Session:
    database = app_modules["database"]
    models = app_modules["models"]

    database.Base.metadata.create_all(bind=database.engine)

    session = database.SessionLocal()

    session.execute(delete(models.Book))
    session.execute(delete(models.Author))
    session.execute(delete(models.Tag))
    session.commit()

    authors = {
        "rowling": models.Author(name="J.K. Rowling"),
        "tolkien": models.Author(name="J.R.R. Tolkien"),
        "stoker": models.Author(name="Bram Stoker"),
        "gaiman": models.Author(name="Neil Gaiman"),
        "pratchett": models.Author(name="Terry Pratchett"),
    }

    tags = {
        "fantasy": models.Tag(name="fantasy", type=models.TagType.genre),
        "magic": models.Tag(name="magic", type=models.TagType.theme),
        "epic": models.Tag(name="epic", type=models.TagType.theme),
        "horror": models.Tag(name="horror", type=models.TagType.genre),
        "gothic": models.Tag(name="gothic", type=models.TagType.theme),
        "humor": models.Tag(name="humor", type=models.TagType.mood),
    }

    books = {
        "harry": models.Book(
            title="Harry Potter and the Sorcerer's Stone",
            subtitle=None,
            description="A young wizard starts his education.",
            published_year=1997,
            page_count=309,
        ),
        "fellowship": models.Book(
            title="The Fellowship of the Ring",
            subtitle=None,
            description="The first part of the journey to destroy the ring.",
            published_year=1954,
            page_count=423,
        ),
        "dracula": models.Book(
            title="Dracula",
            subtitle=None,
            description="A gothic horror novel.",
            published_year=1897,
            page_count=418,
        ),
        "good_omens": models.Book(
            title="Good Omens",
            subtitle=None,
            description="An apocalypse comedy with two authors.",
            published_year=1990,
            page_count=288,
        ),
        "unknown_year": models.Book(
            title="The Lost Codex",
            subtitle=None,
            description="A deliberately yearless fixture.",
            published_year=None,
            page_count=123,
        ),
    }

    books["harry"].authors.append(authors["rowling"])
    books["harry"].tags.extend([tags["fantasy"], tags["magic"]])

    books["fellowship"].authors.append(authors["tolkien"])
    books["fellowship"].tags.extend([tags["fantasy"], tags["epic"]])

    books["dracula"].authors.append(authors["stoker"])
    books["dracula"].tags.extend([tags["horror"], tags["gothic"]])

    books["good_omens"].authors.extend([authors["gaiman"], authors["pratchett"]])
    books["good_omens"].tags.extend([tags["fantasy"], tags["humor"], tags["epic"]])

    books["unknown_year"].authors.append(authors["stoker"])
    books["unknown_year"].tags.append(tags["gothic"])

    session.add_all([*authors.values(), *tags.values(), *books.values()])
    session.commit()

    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded_books(db_session: Session, app_modules) -> dict[str, object]:
    models = app_modules["models"]
    books = db_session.execute(select(models.Book)).scalars().all()
    return {book.title: book for book in books}


@pytest.fixture()
def client(app_modules, db_session: Session):
    database = app_modules["database"]
    main = app_modules["main"]

    def override_get_db():
        yield db_session

    main.app.dependency_overrides[database.get_db] = override_get_db

    try:
        with TestClient(main.app) as test_client:
            yield test_client
    finally:
        main.app.dependency_overrides.clear()