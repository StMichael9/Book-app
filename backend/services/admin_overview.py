"""Headline numbers for the admin dashboard (GET /admin/overview): counts only, nothing per person.

Three statements however many readers there are: one aggregate here, the weekly-active-readers series (G2) and the billing block.
Readers exclude admins and test accounts (same rule as growth_metrics). Clubs, loans and imports are counted as they are.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from services import billing, growth_metrics

OVERVIEW_SQL = text("""
    WITH elig AS (SELECT id, created_at FROM users
                  WHERE lower(email) <> ALL(:admins)
                    AND lower(email) NOT LIKE '%@example.%' AND lower(email) NOT LIKE '%.test' AND lower(email) NOT LIKE '%.invalid'),
         active_clubs AS (
             SELECT club_id FROM club_members WHERE joined_at >= :since30
             UNION SELECT b.club_id FROM club_posts p JOIN club_books b ON b.id = p.club_book_id
                   WHERE p.created_at >= :since30 AND p.deleted_at IS NULL)
    SELECT (SELECT count(*) FROM elig) AS readers,
           (SELECT count(*) FROM elig WHERE created_at >= :since7) AS new_7d,
           (SELECT count(*) FROM elig WHERE created_at >= :since30) AS new_30d,
           (SELECT count(*) FROM clubs) AS clubs_total,
           (SELECT count(*) FROM active_clubs) AS clubs_active,
           (SELECT count(*) FROM loans WHERE ended_on IS NULL) AS open_loans,
           (SELECT count(*) FROM library_import_runs
             WHERE updated_at >= :since30 AND phase IN ('completed', 'completed_with_issues')) AS imports_30d
""")


def overview(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    row = db.execute(OVERVIEW_SQL, {"admins": growth_metrics._admins(), "since7": now - growth_metrics._days(7),
                                    "since30": now - growth_metrics._days(30)}).one()
    weekly = growth_metrics.weekly_active_readers(db, now)
    block = billing.billing_block(db)
    return {"readers": {"total": row.readers, "new_7d": row.new_7d, "new_30d": row.new_30d,
                        "weekly_active": weekly[0]["readers"] if weekly else 0},
            "clubs": {"total": row.clubs_total, "active_30d": row.clubs_active},
            "open_loans": row.open_loans, "imports_completed_30d": row.imports_30d,
            "subscriptions": {"active": block["active_subscriptions"], "mrr_minor_units": block["mrr_minor_units"]}}
