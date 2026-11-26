"""Self-serve account deletion (`DELETE /me`). One request, one transaction: nothing is half-deleted.

- Paid subscriptions are cancelled with the provider first (no charge, no refund); with billing unconfigured they are only marked
  cancelled here. Then everything the reader owns goes, most of it through the users foreign keys (ON DELETE CASCADE).
- Clubs the reader owns pass to the longest-serving admin, else the longest-serving member; a club with no one else is deleted with its
  books, checkpoints, posts and invites. The reader's own posts and the reports they filed are deleted, not anonymised.
- Import history is removed before the entries so the import-removal triggers have nothing left to mark.
"""
from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from library_import_models import ImportedLibraryRecord, ImportedReadLink, LibraryImportRun
from models import Club, ClubMember, EmailSignup, Entitlement, ReadingList, User, UserBook
from services import billing


def _cancel_subscriptions(db: Session, user_id) -> None:
    rows = db.scalars(select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.status != "canceled")).all()
    for row in rows:
        if billing.configured():
            billing.gateway.cancel_subscription(row.stripe_subscription_id)
        row.status = "canceled"
    db.flush()


def _hand_over_clubs(db: Session, user_id) -> None:
    owned = db.scalars(select(Club).where(Club.owner_id == user_id).order_by(Club.id).with_for_update()).all()
    for club in owned:
        successor = db.scalar(
            select(ClubMember).where(ClubMember.club_id == club.id, ClubMember.user_id != user_id)
            .order_by((ClubMember.role != "admin"), ClubMember.joined_at, ClubMember.user_id).limit(1).with_for_update())
        if successor is None:
            db.execute(delete(Entitlement).where(Entitlement.club_id == club.id, Entitlement.user_id == user_id))
            db.delete(club)
            continue
        db.execute(delete(ClubMember).where(ClubMember.club_id == club.id, ClubMember.user_id == user_id))
        db.flush()
        successor.role = "owner"
        club.owner_id = successor.user_id
    db.flush()


def delete_account(db: Session, user: User) -> None:
    user_id, email = user.id, user.email
    try:
        db.execute(select(User.id).where(User.id == user_id).with_for_update())
        _cancel_subscriptions(db, user_id)
        _hand_over_clubs(db, user_id)
        db.execute(delete(Entitlement).where(Entitlement.user_id == user_id))
        db.execute(delete(ImportedReadLink).where(ImportedReadLink.user_id == user_id))
        db.execute(delete(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user_id))
        db.execute(delete(LibraryImportRun).where(LibraryImportRun.user_id == user_id))
        db.execute(delete(UserBook).where(UserBook.user_id == user_id))
        db.execute(delete(ReadingList).where(ReadingList.user_id == user_id))
        db.execute(delete(EmailSignup).where(func.lower(EmailSignup.email) == email.lower()))
        db.expunge(user)
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
