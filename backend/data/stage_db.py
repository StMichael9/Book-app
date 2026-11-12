"""The importer's scratch database (T48): a Postgres on the GitHub runner, so staging never fills the catalogue database.

When CATALOGUE_STAGE_DATABASE_URL is set the run, the staged works/authors/editions/candidates and the redirect table live
here; the catalogue database (Neon) holds only the books, and receives them at merge. Between segments of one run the stage
tables travel as a `pg_dump -Fc` workflow artifact (see `.github/workflows/catalogue-import.yml`). This database must hold
Open Library data only: `assert_open_library_only` refuses to run if anything else (a reader table, say) is present.
"""
from __future__ import annotations

import logging

from sqlalchemy import create_engine, inspect, text

from database import Base
from models import (CatalogueImportIssue, CatalogueImportRun, CatalogueSourceAlias, CatalogueStageAuthor,
                    CatalogueStageAuthorCount, CatalogueStageCandidate, CatalogueStageEdition, CatalogueStagePopularity,
                    CatalogueStageWork, CatalogueStageWorkAuthor)

log = logging.getLogger("bookvane.catalogue")

STAGE_MODELS = (CatalogueImportRun, CatalogueImportIssue, CatalogueSourceAlias, CatalogueStageWork, CatalogueStagePopularity,
                CatalogueStageAuthorCount, CatalogueStageCandidate, CatalogueStageWorkAuthor, CatalogueStageAuthor,
                CatalogueStageEdition)
STAGE_TABLES = tuple(model.__table__.name for model in STAGE_MODELS)


def assert_open_library_only(engine) -> None:
    """The stage database may hold only the importer's own tables, and none of them may hold anything about a reader."""
    present = set(inspect(engine).get_table_names())
    extra = present - set(STAGE_TABLES)
    if extra:
        raise RuntimeError("The stage database holds tables outside the Open Library staging set: " + ", ".join(sorted(extra)))


def open_stage_engine(config):
    """Connect to the stage database and make sure its tables exist (a fresh runner starts empty)."""
    engine = create_engine(config.stage_database_url, pool_pre_ping=True)
    assert_open_library_only(engine)
    Base.metadata.create_all(engine, tables=[model.__table__ for model in STAGE_MODELS])
    assert_open_library_only(engine)
    return engine


def stage_size_mb(engine) -> float:
    with engine.connect() as connection:
        return float(connection.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())


def copy_stage_tables(source, target) -> int:
    """Copy every staging row from one stage database to another (what restoring a segment's artifact amounts to);
    returns the number of rows copied. Used by tests and as a fallback when pg_dump is unavailable."""
    copied = 0
    with source.connect() as read, target.begin() as write:
        for model in STAGE_MODELS:
            table = model.__table__
            rows = [dict(row._mapping) for row in read.execute(table.select())]
            for start in range(0, len(rows), 1000):
                write.execute(table.insert(), rows[start:start + 1000])
            copied += len(rows)
    return copied
