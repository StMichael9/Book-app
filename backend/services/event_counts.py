"""Aggregate, cookie-less event counters. One row per (day, name, src, placement, ref) holds a count and nothing else:
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
from services import growth_metrics

# Scan phases B and C (T80, T81): how a scan ended, which engine read it, and which fallback a reader used.
SCAN_PHASE_EVENTS = ("scan_timeout", "scan_non_isbn", "scan_typed", "scan_engine_native", "scan_engine_wasm",
                     "scan_snap_isbn", "scan_snap_cover", "scan_library_code")
CLIENT_NAMES = frozenset({"register_started", "save_prompt_shown", "guest_search_empty",
                          "get_copy_click", "share_click", "share_visit", "landing_visit", "scan_opened", "scan_added",
                          *SCAN_PHASE_EVENTS})
SERVER_NAMES = frozenset({"register_completed", "search_run", "search_empty",
                          "loan_created", "loan_link_created", "loan_link_opened", "loan_back",
                          "checkout_started", "patron_started", "club_plus_started", "subscription_canceled",
                          "club_created", "club_joined"})
SOURCES = frozenset({"landing", "noresults", "saveprompt", "share", "import", "profile", "switch"})
# Where a visit came from (the `ref` of a shared link). Anything else counts as no ref.
REFS = frozenset({"tt", "ig", "rd", "ph", "yt", "x", "club", "share", "email", "loan"})
MAX_SCAN_ADDED = 100
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


def clean_ref(value) -> str:
    return value if isinstance(value, str) and value in REFS else ""


def parse_event(raw: bytes) -> tuple[str, str, str, str, int] | None:
    """The (name, src, placement, ref, n) of a valid client event, else None. Accepts JSON sent as text/plain too.
    An unknown ref counts as none. `n` is 1 except for scan_added, which carries 1 to 100 books and is refused outside that."""
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
    n = 1
    if body["name"] == "scan_added":
        n = body.get("n", 1)
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_SCAN_ADDED:
            return None
    return body["name"], src, placement, clean_ref(body.get("ref")), n


def record_event(db: Session, name: str, src: str = "", placement: str = "", ref: str = "", n: int = 1) -> None:
    day = datetime.now(timezone.utc).date()
    statement = insert(EventCount).values(day=day, name=name, src=src, placement=placement, ref=ref, count=n)
    db.execute(statement.on_conflict_do_update(
        index_elements=["day", "name", "src", "placement", "ref"],
        set_={"count": EventCount.count + n}))
    db.commit()


def record_server_event(name: str) -> None:
    """Count one server-side event from a background task, on its own short session. Never raises."""
    from database import SessionLocal
    if name not in SERVER_NAMES:
        return
    try:
        with SessionLocal() as session:
            record_event(session, name)
    except Exception:  # noqa: BLE001 - a counter must never affect a reader
        pass


def _share(part: int, whole: int) -> float | None:
    return round(part / whole, 3) if whole else None


def channels(rows) -> dict:
    """Visits (landing_visit), sign-ups (register_completed) and conversion by ref, per day and in total. Computed from the
    counter rows already read; a visit with no ref is the empty string."""
    per_day: dict[tuple[str, str], list[int]] = {}
    total: dict[str, list[int]] = {}
    for row in rows:
        if row.name not in ("landing_visit", "register_completed"):
            continue
        slot = 0 if row.name == "landing_visit" else 1
        per_day.setdefault((row.day.isoformat(), row.ref), [0, 0])[slot] += row.count
        total.setdefault(row.ref, [0, 0])[slot] += row.count
    return {"by_day": [{"day": day, "ref": ref, "visits": v, "signups": s, "conversion": _share(s, v)}
                       for (day, ref), (v, s) in sorted(per_day.items())],
            "totals": [{"ref": ref, "visits": v, "signups": s, "conversion": _share(s, v)} for ref, (v, s) in sorted(total.items())]}


def scans(rows) -> dict:
    """Scan sheets opened, books added from them, and books per opened sheet, per day and in total; plus phase B/C event totals."""
    per_day: dict[str, list[int]] = {}
    for row in rows:
        if row.name in ("scan_opened", "scan_added"):
            per_day.setdefault(row.day.isoformat(), [0, 0])[0 if row.name == "scan_opened" else 1] += row.count
    opened = sum(v[0] for v in per_day.values())
    added = sum(v[1] for v in per_day.values())
    phase = {name: 0 for name in SCAN_PHASE_EVENTS}
    for row in rows:
        if row.name in phase:
            phase[row.name] += row.count
    return {"opened": opened, "added": added, "books_per_scan": _share(added, opened), "events": phase,
            "by_day": [{"day": day, "opened": o, "added": a, "books_per_scan": _share(a, o)} for day, (o, a) in sorted(per_day.items())]}


def metrics(db: Session, days: int) -> dict:
    since = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    rows = db.execute(select(EventCount).where(EventCount.day >= since)
                      .order_by(EventCount.day, EventCount.name, EventCount.src, EventCount.placement, EventCount.ref)).scalars().all()
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
                    "placement": row.placement, "ref": row.ref, "count": row.count} for row in rows],
        "totals": totals,
        "channels": channels(rows),
        "scans": scans(rows),
        **growth_metrics.growth_block(db, days),
        "new_accounts": new_accounts,
        "new_accounts_with_3_saves_in_7_days": active,
    }
