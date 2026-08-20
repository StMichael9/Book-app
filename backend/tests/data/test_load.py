from __future__ import annotations

import importlib
import sys

import pandas as pd
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload


@pytest.fixture()
def loader_environment(app_modules, monkeypatch):
    database = app_modules["database"]
    models = app_modules["models"]
    session_factory = database.SessionLocal

    database.Base.metadata.create_all(bind=database.engine)

    def reset_database() -> None:
        with session_factory() as session:
            session.execute(delete(models.book_tags))
            session.execute(delete(models.book_authors))
            session.execute(delete(models.Book))
            session.execute(delete(models.Author))
            session.execute(delete(models.Tag))
            session.commit()

    def run_loader(rows: list[dict[str, object]]) -> None:
        dataframe = pd.DataFrame(rows)

        monkeypatch.setattr(pd, "read_json", lambda *args, **kwargs: dataframe)
        monkeypatch.setattr(database, "SessionLocal", lambda: session_factory())

        sys.modules.pop("data.load", None)
        importlib.import_module("data.load")

    return {
        "database": database,
        "models": models,
        "reset_database": reset_database,
        "run_loader": run_loader,
        "session_factory": session_factory,
    }


def test_load_creates_expected_records_links_and_null_year(loader_environment):
    env = loader_environment
    models = env["models"]

    rows = [
        {
            "title": "Standalone Book",
            "author": "New Author",
            "genre": ["fantasy"],
            "first_publish_year": 2024,
        },
        {
            "title": "Genre Stack",
            "author": "New Author",
            "genre": ["mystery", "horror"],
            "first_publish_year": None,
        },
    ]

    env["reset_database"]()
    env["run_loader"](rows)

    with env["session_factory"]() as session:
        books = {
            book.title: book
            for book in session.execute(
                select(models.Book).options(selectinload(models.Book.tags))
            ).scalars().all()
        }
        authors = {
            author.name: author
            for author in session.execute(
                select(models.Author).options(selectinload(models.Author.books))
            ).scalars().all()
        }
        tags = {
            tag.name: tag
            for tag in session.execute(
                select(models.Tag).options(selectinload(models.Tag.books))
            ).scalars().all()
        }

    assert set(books) == {"Standalone Book", "Genre Stack"}
    assert set(authors) == {"New Author"}
    assert set(tags) == {"fantasy", "mystery", "horror"}

    assert books["Standalone Book"].published_year == 2024
    assert books["Genre Stack"].published_year is None

    assert {tag.name for tag in books["Standalone Book"].tags} == {"fantasy"}
    assert {tag.name for tag in books["Genre Stack"].tags} == {"mystery", "horror"}
    assert {book.title for book in authors["New Author"].books} == {
        "Standalone Book",
        "Genre Stack",
    }


def test_load_is_idempotent_and_reuses_existing_author_and_tags(loader_environment):
    env = loader_environment
    models = env["models"]

    rows = [
        {
            "title": "Standalone Book",
            "author": "New Author",
            "genre": ["fantasy"],
            "first_publish_year": 2024,
        },
        {
            "title": "Genre Stack",
            "author": "New Author",
            "genre": ["mystery", "horror"],
            "first_publish_year": None,
        },
    ]

    env["reset_database"]()
    env["run_loader"](rows)
    env["run_loader"](rows)

    with env["session_factory"]() as session:
        books = session.execute(
            select(models.Book).options(selectinload(models.Book.tags))
        ).scalars().all()
        authors = session.execute(
            select(models.Author).options(selectinload(models.Author.books))
        ).scalars().all()
        tags = session.execute(
            select(models.Tag).options(selectinload(models.Tag.books))
        ).scalars().all()

        new_author = session.execute(
            select(models.Author)
            .options(selectinload(models.Author.books))
            .where(models.Author.name == "New Author")
        ).scalar_one()
        standalone_book = session.execute(
            select(models.Book)
            .options(selectinload(models.Book.tags))
            .where(models.Book.title == "Standalone Book")
        ).scalar_one()
        genre_stack = session.execute(
            select(models.Book)
            .options(selectinload(models.Book.tags))
            .where(models.Book.title == "Genre Stack")
        ).scalar_one()

    assert len(books) == 2
    assert len(authors) == 1
    assert len(tags) == 3

    assert {book.title for book in new_author.books} == {"Standalone Book", "Genre Stack"}
    assert {tag.name for tag in standalone_book.tags} == {"fantasy"}
    assert {tag.name for tag in genre_stack.tags} == {"mystery", "horror"}
