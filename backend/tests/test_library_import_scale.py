"""Opt-in generated-library measurement. Never runs on Neon or real catalogues."""
import json
import os
from time import perf_counter
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, text

from library_import_schemas import ConfirmImport, FinalizeImport, StartImport, UploadImportBatch
from services.library_imports.formats import digest


@pytest.mark.skipif(os.getenv("M5_IMPORT_BENCHMARK") != "yes", reason="Explicit isolated M5 scale measurement")
def test_generated_1k_10k_20k_libraries(app_modules, db_session):
    from models import User, UserBook
    from services.library import LibraryService
    from services.library_imports.workflow import ImportWorkflow
    from services.reading import ReadingService
    engine = app_modules["database"].engine
    assert engine.url.host == "127.0.0.1" and engine.url.port == 55433 and engine.url.username == "bookvane_v3_test"
    assert "test" in engine.url.database and os.getenv("BOOKVANE_TEST_DB_ISOLATED") == "yes"
    required = {"ix_import_row_result_entry", "ix_imported_record_entry", "ix_imported_read_entry"}
    installed = set(db_session.scalars(text("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('ix_import_row_result_entry','ix_imported_record_entry','ix_imported_read_entry')")))
    assert installed == required, "Use a freshly migrated final-schema target; metadata.create_all does not retrofit draft indexes"
    # Set-based generated fixture only, not the administrative ingestion pipeline.
    # There is no source download, growing local file, or retained Python catalogue.
    db_session.execute(text("""
      INSERT INTO authors(name,source_id) SELECT 'M5 synthetic author ' || n, '/authors/OL' || (990000000+n) || 'A'
      FROM generate_series(1,100) n;
      INSERT INTO books(title,source_id,description,page_count)
      SELECT 'M5 synthetic catalogue ' || n, '/works/OL' || (990000000+n) || 'W', repeat('Generated test description. ',8),350
      FROM generate_series(1,50000) n;
      INSERT INTO book_authors(book_id,author_id)
      SELECT b.id,a.id FROM books b JOIN authors a ON
        a.source_id='/authors/OL' || (990000001+((substring(b.source_id from '[0-9]+')::bigint-990000001)%100)) || 'A'
      WHERE b.source_id LIKE '/works/OL990%';
      ANALYZE books; ANALYZE authors; ANALYZE book_authors;
    """))
    db_session.commit()
    headers = ["version", "record_id", "title", "author", "work_source_id", "status", "finished_on"]
    # Optional targeted rerun after a machine interruption; the normal gate
    # still exercises all three sizes. This never changes production limits.
    counts = tuple(int(value) for value in os.getenv("M5_IMPORT_BENCHMARK_ROWS", "1000,10000,20000").split(","))
    assert counts and len(counts) == len(set(counts)) and set(counts) <= {1000, 10000, 20000}
    users = []
    try:
        for count in counts:
            user = User(email=f"m5-scale-{count}-{uuid4().hex}@example.com", hashed_password="synthetic")
            db_session.add(user)
            db_session.commit()
            owner = user.id
            users.append(owner)
            workflow = ImportWorkflow(db_session)
            phase_seconds, maximum_step, manifest = {}, 0, []
            before = db_session.scalar(text("SELECT pg_database_size(current_database())"))
            started = perf_counter()
            run = workflow.start(owner, StartImport(id=uuid4(), headers=headers))
            phase = perf_counter()
            for offset in range(0, count, 100):
                rows = []
                for index in range(offset, min(offset + 100, count)):
                    n = index + 1
                    catalogue = n % 2 == 0
                    rows.append(["1", f"scale-{n}", f"M5 synthetic catalogue {n}" if catalogue else f"M5 private title {n}",
                        f"M5 synthetic author {1+(n-1)%100}" if catalogue else "Synthetic private author",
                        f"/works/OL{990000000+n}W" if catalogue else "", "finished" if n % 10 == 0 else "want",
                        "2025-01-01" if n % 10 == 0 else ""])
                step = perf_counter()
                result = workflow.upload(owner, run["id"], offset // 100, UploadImportBatch(rows=rows))
                maximum_step = max(maximum_step, perf_counter() - step)
                manifest.append({"ordinal": offset // 100, "hash": result["batch_hash"], "length": len(rows)})
            phase_seconds["upload"] = round(perf_counter() - phase, 3)
            run = workflow.finalize(owner, run["id"], FinalizeImport(row_count=count, batch_count=len(manifest), manifest_hash=digest(manifest)))
            phase = perf_counter()
            while run["phase"] in ("analyzing", "grouping"):
                step = perf_counter()
                run = workflow.advance_analysis(owner, run["id"])
                maximum_step = max(maximum_step, perf_counter() - step)
            phase_seconds["analysis_grouping"] = round(perf_counter() - phase, 3)
            assert run["summary"]["dispositions"] == {"ready": count}
            staging = db_session.scalar(text("SELECT pg_total_relation_size('library_import_rows')"))
            logical_staging = db_session.scalar(text("SELECT stage_bytes FROM library_import_runs WHERE id=:id"), {"id": run["id"]})
            run = workflow.confirm(owner, run["id"], ConfirmImport(expected_revision=run["revision"], manifest_hash=run["manifest_hash"], approve_private=True, skip_unresolved=False))
            phase = perf_counter()
            while run["phase"] == "applying":
                step = perf_counter()
                run = workflow.advance_apply(owner, run["id"])
                maximum_step = max(maximum_step, perf_counter() - step)
            phase_seconds["apply"] = round(perf_counter() - phase, 3)
            assert run["phase"] == "completed", run["summary"]
            assert run["summary"]["applied"]["added_entries"] == count
            assert run["summary"]["applied"]["added_reads"] == count // 10
            home_start = perf_counter()
            ReadingService(db_session).home(owner)
            home_seconds = perf_counter() - home_start
            page_start = perf_counter()
            page = LibraryService(db_session).page(owner)
            page_seconds = perf_counter() - page_start
            assert page.total == count and len(page.items) == 25
            after = db_session.scalar(text("SELECT pg_database_size(current_database())"))
            print("M5_SCALE " + json.dumps({"rows": count, "catalogue_fixture": 50000, "seconds": round(perf_counter()-started,3),
                "phases": phase_seconds, "maximum_step_seconds": round(maximum_step,3),
                "logical_staging_mib": round(logical_staging/1048576,3), "staging_table_indexes_mib": round(staging/1048576,3),
                "database_mib": round(after/1048576,3), "database_growth_mib": round((after-before)/1048576,3),
                "home_after_seconds": round(home_seconds,3), "library_after_seconds": round(page_seconds,3)}), flush=True)
            assert maximum_step < 15, "Investigate measured request budget before shipping"
    finally:
        db_session.rollback()
        if users:
            db_session.execute(delete(User).where(User.id.in_(users)))
            db_session.commit()
