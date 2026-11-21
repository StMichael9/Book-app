"""Weekly active readers, week-1 return and import counts for /admin/metrics (T73 G2, G5).

Everything is computed at read time from tables that already exist; nothing is stored per reader and nothing here leaves the
admin page. Counts only: no account id, email or book is ever returned.

An ACTIVE READER in a 7-day window is a distinct account (not an admin, not a test account) with any of:
  - a library entry (`user_books`) created or updated,
  - a reading (`reading_attempts`) updated,
  - a progress day (`reading_progress_days`) written,
  - a reading note written or edited (`reading_notes.written_at` / `edited_at`; migrated notes carry no date and do not count),
  - a library import run (`library_import_runs`) started.
Windows are rolling 7-day windows ending now, newest first (index 0 = the last 7 days). Test accounts are those with an
example.* address or a .test / .invalid domain.

WEEK-1 RETURN, per sign-up week: of the accounts created in that week, the share that were active again on days 7 to 13 after
their own sign-up. Only accounts old enough for that window to be over (14 days) are measured; the rest are not counted yet.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

WEEKS = 8

_ELIGIBLE = """
    SELECT id, created_at FROM users
    WHERE lower(email) <> ALL(:admins)
      AND lower(email) NOT LIKE '%@example.%' AND lower(email) NOT LIKE '%.test' AND lower(email) NOT LIKE '%.invalid'
"""

_ACTIVITY = """
    SELECT b.user_id, b.created_at AS at FROM user_books b WHERE b.created_at >= :floor
    UNION ALL SELECT b.user_id, b.updated_at FROM user_books b WHERE b.updated_at >= :floor
    UNION ALL SELECT b.user_id, a.updated_at FROM reading_attempts a JOIN user_books b ON b.id = a.user_book_id WHERE a.updated_at >= :floor
    UNION ALL SELECT b.user_id, d.updated_at FROM reading_progress_days d JOIN reading_attempts a ON a.id = d.attempt_id
              JOIN user_books b ON b.id = a.user_book_id WHERE d.updated_at >= :floor
    UNION ALL SELECT b.user_id, n.written_at FROM reading_notes n JOIN reading_attempts a ON a.id = n.attempt_id
              JOIN user_books b ON b.id = a.user_book_id WHERE n.written_at >= :floor
    UNION ALL SELECT b.user_id, n.edited_at FROM reading_notes n JOIN reading_attempts a ON a.id = n.attempt_id
              JOIN user_books b ON b.id = a.user_book_id WHERE n.edited_at >= :floor
    UNION ALL SELECT r.user_id, r.created_at FROM library_import_runs r WHERE r.created_at >= :floor
"""

WAR_SQL = text(f"""
    WITH elig AS ({_ELIGIBLE}), act AS ({_ACTIVITY})
    SELECT w.i AS week, count(DISTINCT a.user_id) AS readers
    FROM generate_series(0, :last) AS w(i)
    LEFT JOIN act a ON a.at >= :now - (w.i + 1) * interval '7 days' AND a.at < :now - w.i * interval '7 days'
                   AND a.user_id IN (SELECT id FROM elig)
    GROUP BY w.i ORDER BY w.i
""")

COHORT_SQL = text(f"""
    WITH elig AS ({_ELIGIBLE}), act AS ({_ACTIVITY})
    SELECT w.i AS week,
           count(u.id) AS new_accounts,
           count(u.id) FILTER (WHERE u.created_at + interval '14 days' <= :now) AS measured,
           count(u.id) FILTER (WHERE u.created_at + interval '14 days' <= :now AND EXISTS (
               SELECT 1 FROM act a WHERE a.user_id = u.id
                 AND a.at >= u.created_at + interval '7 days' AND a.at < u.created_at + interval '14 days')) AS returned
    FROM generate_series(0, :last) AS w(i)
    LEFT JOIN elig u ON u.created_at >= :now - (w.i + 1) * interval '7 days' AND u.created_at < :now - w.i * interval '7 days'
    GROUP BY w.i ORDER BY w.i
""")

IMPORTS_SQL = text("""
    SELECT day, sum(started) AS started, sum(completed) AS completed FROM (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, 1 AS started, 0 AS completed FROM library_import_runs
        WHERE created_at >= :since
        UNION ALL
        SELECT (updated_at AT TIME ZONE 'UTC')::date, 0, 1 FROM library_import_runs
        WHERE updated_at >= :since AND phase IN ('completed', 'completed_with_issues')
    ) AS x WHERE day >= (:since AT TIME ZONE 'UTC')::date GROUP BY day ORDER BY day
""")


def _admins() -> list[str]:
    from database import settings
    return [item.strip().casefold() for item in settings.admin_emails.split(",") if item.strip()] or [""]


def weekly_active_readers(db: Session, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    floor = now.replace(microsecond=0) - _days(7 * WEEKS + 14)
    rows = db.execute(WAR_SQL, {"admins": _admins(), "floor": floor, "now": now, "last": WEEKS - 1}).all()
    return [{"weeks_ago": row.week, "ends": (now - _days(7 * row.week)).date().isoformat(), "readers": row.readers} for row in rows]


def week_one_return(db: Session, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    floor = now.replace(microsecond=0) - _days(7 * WEEKS + 14)
    rows = db.execute(COHORT_SQL, {"admins": _admins(), "floor": floor, "now": now, "last": WEEKS - 1}).all()
    return [{"weeks_ago": row.week, "signed_up": row.new_accounts, "measured": row.measured, "returned": row.returned,
             "share": round(row.returned / row.measured, 3) if row.measured else None} for row in rows]


def import_runs(db: Session, days: int, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    rows = db.execute(IMPORTS_SQL, {"since": now - _days(days - 1)}).all()
    return [{"day": row.day.isoformat(), "started": int(row.started), "completed": int(row.completed)} for row in rows]


def _days(count: int):
    from datetime import timedelta
    return timedelta(days=count)


def growth_block(db: Session, days: int = 30) -> dict:
    """The G2 and G5 parts of /admin/metrics: three statements however many readers there are."""
    return {"weekly_active_readers": weekly_active_readers(db), "week_one_return": week_one_return(db),
            "imports": import_runs(db, days),
            "definitions": {"active_reader": "A distinct non-admin, non-test account with a library entry, reading, progress day, "
                                             "note or import run created or updated in the 7-day window.",
                            "week_one_return": "Of the accounts created in a week and at least 14 days old, the share active on "
                                               "days 7 to 13 after sign-up."}}
