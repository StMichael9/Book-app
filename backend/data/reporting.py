"""Reporting responsibilities for the bounded catalogue importer."""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from data.config import ImportConfig
from models import Author, Book, CatalogueImportIssue, CatalogueImportRun, CatalogueStageWork, Edition


class CapacityPause(RuntimeError):
    """The safety margin was reached; scratch data must be released."""


def _stage_mb(session: Session) -> float:
    names = (
        "catalogue_stage_works", "catalogue_stage_work_authors", "catalogue_stage_authors",
        "catalogue_stage_editions", "catalogue_stage_candidates", "catalogue_stage_author_counts",
    )
    # One round trip for the same exact measurements; missing migrations must
    # still fail rather than silently understating staging usage.
    sizes = session.execute(text("""
        SELECT pg_total_relation_size(to_regclass(name))
        FROM unnest(CAST(:names AS text[])) AS stages(name)
    """), {"names": list(names)}).scalars().all()
    if any(size is None for size in sizes):
        raise RuntimeError("Missing catalogue staging tables; apply migrations before importing")
    return sum(sizes) / 1048576.0


def _check_storage(session: Session, run: CatalogueImportRun, config: ImportConfig) -> None:
    total = float(session.execute(text("SELECT pg_database_size(current_database()) / 1048576.0")).scalar_one())
    run.peak_database_mb = max(run.peak_database_mb or 0, total)
    run.peak_staging_mb = max(run.peak_staging_mb or 0, _stage_mb(session))
    if total >= config.max_database_mb:
        raise CapacityPause(f"Database reached {total:.1f} MiB, guard is {config.max_database_mb} MiB")


def _issue(session: Session, run_id: str, code: str, source_id: str | None, detail: str) -> None:
    session.add(CatalogueImportIssue(run_id=run_id, code=code, source_id=source_id, detail=detail[:2000]))


def _count_skipped(run: CatalogueImportRun, phase: str, count: int) -> None:
    if count:
        report = dict(run.report or {})
        skipped = dict(report.get("skipped_by_phase", {}))
        skipped[phase] = skipped.get(phase, 0) + count
        report["skipped_by_phase"] = skipped
        run.report = report


def _release_staging(session: Session, run: CatalogueImportRun) -> None:
    session.execute(text("""
        TRUNCATE catalogue_stage_author_counts, catalogue_stage_candidates,
                 catalogue_stage_work_authors, catalogue_stage_editions,
                 catalogue_stage_authors, catalogue_stage_works
    """))
    run.checkpoint_line = 0


def _build_report(session: Session, run: CatalogueImportRun) -> dict:
    book_total = session.scalar(select(func.count()).select_from(Book)) or 0
    selected = dict(session.execute(select(
        CatalogueStageWork.allocation_category, func.count()
    ).where(CatalogueStageWork.run_id == run.id,
            CatalogueStageWork.selected.is_(True)).group_by(
                CatalogueStageWork.allocation_category
    )).all())
    sizes = dict(session.execute(text("""
        SELECT relname, pg_total_relation_size(oid)
        FROM pg_class
        WHERE relname IN ('books', 'authors', 'tags', 'book_authors', 'book_tags',
                          'editions', 'edition_isbns') AND relkind = 'r'
    """)).all())
    indexes = dict(session.execute(text("""
        SELECT indexrelname, pg_relation_size(indexrelid)
        FROM pg_stat_user_indexes
        WHERE relname IN ('books', 'authors', 'tags', 'book_authors', 'book_tags',
                          'editions', 'edition_isbns')
    """)).all())
    return {
        "capacity_replays": list((run.report or {}).get("capacity_replays", [])),
        "alias_scope": (run.report or {}).get("alias_scope", "full"),
        "aliases_before_compaction": (run.report or {}).get("aliases_before_compaction"),
        "alias_retained_count": (run.report or {}).get("alias_retained_count"),
        "skipped_by_phase": dict((run.report or {}).get("skipped_by_phase", {})),
        "verified_dumps": dict((run.report or {}).get("verified_dumps", {})),
        "target_books": run.target_books,
        "baseline_books": run.baseline_count,
        "total_books": book_total,
        "source_identified_books": session.scalar(select(func.count()).select_from(Book).where(
            Book.source_id.is_not(None)
        )) or 0,
        "allocation_by_category": {key: value for key, value in selected.items() if key},
        "books_with_cover": session.scalar(select(func.count()).select_from(Book).where(
            Book.cover_image_url.is_not(None)
        )) or 0,
        "books_with_description": session.scalar(select(func.count()).select_from(Book).where(
            Book.description.is_not(None)
        )) or 0,
        "books_with_isbn13": session.scalar(select(func.count()).select_from(Book).where(
            Book.isbn13.is_not(None)
        )) or 0,
        "author_count": session.scalar(select(func.count()).select_from(Author)) or 0,
        "edition_count": session.scalar(select(func.count()).select_from(Edition)) or 0,
        "database_mb": float(session.execute(text(
            "SELECT pg_database_size(current_database()) / 1048576.0"
        )).scalar_one()),
        "peak_database_mb": run.peak_database_mb,
        "peak_staging_mb": run.peak_staging_mb,
        "table_total_bytes": sizes,
        "index_bytes": indexes,
        "issues_by_code": dict(session.execute(select(
            CatalogueImportIssue.code, func.count()
        ).where(CatalogueImportIssue.run_id == run.id).group_by(
            CatalogueImportIssue.code
        )).all()),
    }
