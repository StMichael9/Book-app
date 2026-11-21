"""The one place that answers "is this reader a Patron?" and "does this club have Club Plus?" (T77A).

An entitlement is live while its subscription is active or trialing, and for 7 days of GRACE after a failed payment (status
past_due, counted from the first failure). A canceled subscription is not live. A lapse never deletes anything: callers only
stop offering the extras, so free features keep working.

Every check is one indexed statement; the batch forms (`patron_ids`, `club_plus_ids`) answer for many readers or clubs in one
statement, so lists and member rows never cost one query each.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from models import Entitlement

GRACE_DAYS = 7


def _live(now: datetime):
    return or_(Entitlement.status.in_(("active", "trialing")),
               and_(Entitlement.status == "past_due", Entitlement.payment_failed_at.is_not(None),
                    Entitlement.payment_failed_at >= now - timedelta(days=GRACE_DAYS)))


def is_live(entitlement: Entitlement, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if entitlement.status in ("active", "trialing"):
        return True
    return (entitlement.status == "past_due" and entitlement.payment_failed_at is not None
            and entitlement.payment_failed_at >= now - timedelta(days=GRACE_DAYS))


def in_grace(entitlement: Entitlement, now: datetime | None = None) -> bool:
    return entitlement.status == "past_due" and is_live(entitlement, now)


def is_patron(db: Session, user, now: datetime | None = None) -> bool:
    """True while the reader has a live Patron subscription (grace included). `user` is a User or a user id."""
    user_id = getattr(user, "id", user)
    now = now or datetime.now(timezone.utc)
    return db.scalar(select(Entitlement.id).where(Entitlement.user_id == user_id, Entitlement.kind == "patron", _live(now)).limit(1)) is not None


def patron_ids(db: Session, user_ids, now: datetime | None = None) -> set:
    """Which of these readers are Patrons, in one statement (for badges on member and list rows)."""
    ids = list(user_ids)
    if not ids:
        return set()
    now = now or datetime.now(timezone.utc)
    return set(db.scalars(select(Entitlement.user_id).where(Entitlement.kind == "patron", Entitlement.user_id.in_(ids), _live(now))))


def club_plus(db: Session, club_id: int, now: datetime | None = None) -> bool:
    """True while the club has a live Club Plus subscription (grace included)."""
    now = now or datetime.now(timezone.utc)
    return db.scalar(select(Entitlement.id).where(Entitlement.kind == "club_plus", Entitlement.club_id == club_id, _live(now)).limit(1)) is not None


def club_plus_ids(db: Session, club_ids, now: datetime | None = None) -> set:
    ids = list(club_ids)
    if not ids:
        return set()
    now = now or datetime.now(timezone.utc)
    return set(db.scalars(select(Entitlement.club_id).where(Entitlement.kind == "club_plus", Entitlement.club_id.in_(ids), _live(now))))
