"""Aggregate, cookie-less event counters. One row per (day, name, src, placement) holds a count and nothing else:
no user, address, user agent or timestamp finer than the day is ever stored."""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from models import EventCount, User

CLIENT_NAMES = frozenset({"register_started", "save_prompt_shown", "guest_search_empty",
                          "get_copy_click", "share_click", "share_visit"})
SERVER_NAMES = frozenset({"register_completed"})
SOURCES = frozenset({"landing", "noresults", "saveprompt", "share", "import", "profile"})
PLACEMENTS = frozenset({"book_page", "want_card"})
MAX_EVENTS_PER_MINUTE = 600
MAX_BODY_BYTES = 1024


class _Window:
    """A per-process cap on events per minute; beyond it events are dropped quietly."""

    def __init__(self, limit: int):
        self.limit, self.stamps, self.lock = limit, deque(), threading.Lock()

    def allow(self) -> bool:
        now = time.monotonic()
        with self.lock:
            while self.stamps and now - self.stamps[0] > 60:
                self.stamps.popleft()
            if len(self.stamps) >= self.limit:
                return False
            self.stamps.append(now)
            return True

    def reset(self) -> None:
        with self.lock:
            self.stamps.clear()


window = _Window(MAX_EVENTS_PER_MINUTE)


def clean_source(value) -> str:
    return value if isinstance(value, str) and value in SOURCES else ""


def parse_event(raw: bytes) -> tuple[str, str, str] | None:
    """The (name, src, placement) of a valid client event, else None. Accepts JSON sent as text/plain too."""
    if not raw or len(raw) > MAX_BODY_BYTES:
        return None
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(body, dict) or body.get("name") not in CLIENT_NAMES:
        return None
    src, placement = body.get("src", ""), body.get("placement", "")
    src = "" if src is None else src
    placement = "" if placement is None else placement
    if src != "" and src not in SOURCES or placement != "" and placement not in PLACEMENTS:
        return None
    return body["name"], src, placement


def record_event(db: Session, name: str, src: str = "", placement: str = "") -> None:
    day = datetime.now(timezone.utc).date()
    statement = insert(EventCount).values(day=day, name=name, src=src, placement=placement, count=1)
    db.execute(statement.on_conflict_do_update(
        index_elements=["day", "name", "src", "placement"],
        set_={"count": EventCount.count + 1}))
    db.commit()


def metrics(db: Session, days: int) -> dict:
    since = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    rows = db.execute(select(EventCount).where(EventCount.day >= since)
                      .order_by(EventCount.day, EventCount.name, EventCount.src, EventCount.placement)).scalars().all()
    totals: dict[str, int] = {}
    for row in rows:
        totals[row.name] = totals.get(row.name, 0) + row.count
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    new_accounts = db.scalar(select(func.count()).select_from(User).where(User.created_at >= cutoff)) or 0
    active = db.scalar(text("""
        SELECT count(*) FROM (
            SELECT u.id FROM users u
            JOIN user_books b ON b.user_id = u.id AND (b.is_owned OR b.is_wanted)
                 AND b.created_at <= u.created_at + interval '7 days'
            WHERE u.created_at >= :cutoff
            GROUP BY u.id HAVING count(*) >= 3
        ) AS cohort
    """), {"cutoff": cutoff}) or 0
    return {
        "days": days, "since": since.isoformat(),
        "counts": [{"day": row.day.isoformat(), "name": row.name, "src": row.src,
                    "placement": row.placement, "count": row.count} for row in rows],
        "totals": totals,
        "new_accounts": new_accounts,
        "new_accounts_with_3_saves_in_7_days": active,
    }
