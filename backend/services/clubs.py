"""Free book clubs (T78A): private, invite-only groups with spoiler-safe discussion.

- Nothing here is public. A club, its members, its posts and its books are visible to its members only (anyone else gets a 404).
- Free up to FREE_CAP members; a live Club Plus subscription (services.entitlements.club_plus) lifts the cap. If Plus lapses nobody
  is removed: new joins simply pause while the club is at or over the cap.
- Discussion is spoiler-safe: a post is anchored at the page or percent it is about (by default the poster's own progress) and a
  member who has not reached it sees only a locked stub ("Unlocks at p. 140"). Progress comes from the member's OWN readings of the
  book; nobody's progress is shown to others unless that member opted in.
- Reports: three different members hiding a post until a moderator (owner or admin) reviews it.
Statement counts do not grow with the number of members or posts: every list is one joined query plus at most one for badges
and one for the viewer's progress.
"""
from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, func, select, text, update
from sqlalchemy.dialects.postgresql import aggregate_order_by, insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import settings
from models import (Author, Book, Club, ClubBook, ClubCheckpoint, ClubInvite, ClubMember, ClubPost, ClubReport, ReadingAttempt, User, UserBook, book_authors)
from services import entitlements
from services.event_counts import record_event
from services.profile import initials

FREE_CAP = 25
MAX_OWNED = 10
MAX_BOOKS = 50
MAX_CHECKPOINTS = 20
HIDE_AFTER_REPORTS = 3
POST_PAGE = 30
INVITE_DAYS = 14
TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
MODS = ("owner", "admin")


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _count(db: Session, name: str) -> None:
    try:
        record_event(db, name)
    except SQLAlchemyError:
        db.rollback()


def _name(display_name: str | None) -> str:
    return display_name or "A member"


# --- membership -----------------------------------------------------------------------------------------------------------

def member_of(db: Session, club_id: int, user: User, *, lock: bool = False) -> ClubMember:
    """The reader's membership, or a 404 that does not reveal whether the club exists."""
    query = select(ClubMember).where(ClubMember.club_id == club_id, ClubMember.user_id == getattr(user, "id", user))
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, detail="Club not found")
    return row


def moderator(db: Session, club_id: int, user: User) -> ClubMember:
    row = member_of(db, club_id, user)
    if row.role not in MODS:
        raise fail(403, "moderators_only")
    return row


def _member_count(db: Session, club_id: int) -> int:
    return db.scalar(select(func.count()).select_from(ClubMember).where(ClubMember.club_id == club_id)) or 0


def _full(db: Session, club_id: int, count: int | None = None) -> bool:
    count = _member_count(db, club_id) if count is None else count
    return count >= FREE_CAP and not entitlements.club_plus(db, club_id)


# --- clubs ---------------------------------------------------------------------------------------------------------------

def create_club(db: Session, user: User, name: str, description: str | None, color: str | None) -> dict:
    owned = db.scalar(select(func.count()).select_from(Club).where(Club.owner_id == user.id)) or 0
    if owned >= MAX_OWNED:
        raise fail(409, "too_many_clubs")
    club = Club(name=name, description=description or None, owner_id=user.id, color=color)
    db.add(club)
    db.flush()
    db.add(ClubMember(club_id=club.id, user_id=user.id, role="owner"))
    db.commit()
    _count(db, "club_created")
    return {"id": club.id, "name": club.name, "description": club.description, "color": club.color, "role": "owner", "member_count": 1}


def my_clubs(db: Session, user: User) -> list[dict]:
    """The reader's clubs with member counts and the current book, in one statement."""
    members = (select(ClubMember.club_id, func.count().label("n")).group_by(ClubMember.club_id).subquery())
    current = (select(ClubBook.club_id, Book.title, Book.id.label("book_id")).join(Book, Book.id == ClubBook.book_id)
               .where(ClubBook.status == "current").subquery())
    rows = db.execute(select(Club.id, Club.name, Club.description, Club.color, ClubMember.role, members.c.n, current.c.title, current.c.book_id)
                      .join(ClubMember, and_(ClubMember.club_id == Club.id, ClubMember.user_id == user.id))
                      .join(members, members.c.club_id == Club.id).outerjoin(current, current.c.club_id == Club.id)
                      .order_by(Club.name, Club.id)).all()
    return [{"id": r.id, "name": r.name, "description": r.description, "color": r.color, "role": r.role, "member_count": r.n,
             "current_book": {"book_id": r.book_id, "title": r.title} if r.title else None} for r in rows]


def detail(db: Session, club_id: int, user: User) -> dict:
    me = member_of(db, club_id, user)
    club = db.get(Club, club_id)
    count = _member_count(db, club_id)
    plus = entitlements.club_plus(db, club_id)
    authors = (select(func.coalesce(func.array_agg(aggregate_order_by(Author.name, book_authors.c.author_id)), text("ARRAY[]::text[]")))
               .select_from(book_authors.join(Author)).where(book_authors.c.book_id == Book.id).correlate(Book).scalar_subquery())
    books = db.execute(select(ClubBook, Book.title, Book.cover_image_url, Book.page_count, authors).join(Book, Book.id == ClubBook.book_id)
                       .where(ClubBook.club_id == club_id).order_by(ClubBook.status != "current", ClubBook.starts_on.nulls_last(), ClubBook.id)).all()
    ids = [row[0].id for row in books]
    checkpoints: dict[int, list] = {}
    if ids:
        for cp in db.scalars(select(ClubCheckpoint).where(ClubCheckpoint.club_book_id.in_(ids)).order_by(ClubCheckpoint.due_on.nulls_last(), ClubCheckpoint.id)):
            checkpoints.setdefault(cp.club_book_id, []).append({"id": cp.id, "unit": cp.unit, "value": cp.value, "due_on": cp.due_on, "label": cp.label})
    return {"id": club.id, "name": club.name, "description": club.description, "color": club.color, "created_at": club.created_at,
            "me": {"role": me.role, "share_progress": me.share_progress},
            "member_count": count, "club_plus": plus, "cap": {"free_limit": FREE_CAP, "full": count >= FREE_CAP and not plus},
            "books": [{"id": cb.id, "book_id": cb.book_id, "title": title, "cover_image_url": cover, "page_count": pages, "status": cb.status,
                       "authors": list(names or []), "starts_on": cb.starts_on, "ends_on": cb.ends_on, "checkpoints": checkpoints.get(cb.id, [])}
                      for cb, title, cover, pages, names in books]}


def update_club(db: Session, club_id: int, user: User, changes: dict) -> dict:
    moderator(db, club_id, user)
    club = db.get(Club, club_id)
    for key in ("name", "description", "color"):
        if key in changes:
            setattr(club, key, changes[key] if key == "name" else (changes[key] or None))
    db.commit()
    return {"id": club.id, "name": club.name, "description": club.description, "color": club.color}


def delete_club(db: Session, club_id: int, user: User) -> None:
    me = member_of(db, club_id, user)
    if me.role != "owner":
        raise fail(403, "owner_only")
    if entitlements.club_plus(db, club_id):
        raise fail(409, "cancel_club_plus_first")
    try:
        db.delete(db.get(Club, club_id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(409, "club_has_billing_history") from None


# --- members -----------------------------------------------------------------------------------------------------------------

def _progress_rows(db: Session, user_ids: list, book_id: int | None) -> dict:
    """For members who opted in: their reading of the current club book (the live one first), in one statement."""
    if not user_ids or book_id is None:
        return {}
    rows = db.execute(select(UserBook.user_id, ReadingAttempt.state, ReadingAttempt.progress_unit, ReadingAttempt.progress_value)
                      .join(UserBook, UserBook.id == ReadingAttempt.user_book_id)
                      .where(UserBook.user_id.in_(user_ids), UserBook.book_id == book_id)
                      .order_by(UserBook.user_id, case((ReadingAttempt.state.in_(("reading", "paused")), 0), else_=1),
                                ReadingAttempt.updated_at.desc())).all()
    found: dict = {}
    for user_id, state, unit, value in rows:
        found.setdefault(user_id, {"state": state, "unit": unit, "value": value})
    return found


def members(db: Session, club_id: int, user: User) -> list[dict]:
    me = member_of(db, club_id, user)
    rows = db.execute(select(ClubMember, User.display_name).join(User, User.id == ClubMember.user_id)
                      .where(ClubMember.club_id == club_id).order_by(ClubMember.joined_at, ClubMember.user_id)).all()
    book_id = db.scalar(select(ClubBook.book_id).where(ClubBook.club_id == club_id, ClubBook.status == "current"))
    sharing = [m.user_id for m, _ in rows if m.share_progress or m.user_id == user.id]
    progress = _progress_rows(db, sharing, book_id)
    patrons = entitlements.patron_ids(db, [m.user_id for m, _ in rows])
    return [{"user_id": m.user_id, "name": _name(display_name), "initials": initials(display_name, "member"), "role": m.role,
             "joined_at": m.joined_at, "patron": m.user_id in patrons, "me": m.user_id == user.id,
             "shares_progress": m.share_progress,
             "progress": progress.get(m.user_id) if (m.share_progress or m.user_id == user.id) else None} for m, display_name in rows]


def set_my_sharing(db: Session, club_id: int, user: User, share: bool) -> dict:
    me = member_of(db, club_id, user, lock=True)
    me.share_progress = share
    db.commit()
    return {"share_progress": me.share_progress}


def change_role(db: Session, club_id: int, user: User, target_id, role: str) -> dict:
    me = member_of(db, club_id, user)
    if me.role != "owner":
        raise fail(403, "owner_only")
    target = member_of(db, club_id, target_id)
    if target.role == "owner":
        raise fail(409, "owner_role_fixed")
    target.role = role
    db.commit()
    return {"role": target.role}


def remove_member(db: Session, club_id: int, user: User, target_id) -> None:
    me = moderator(db, club_id, user)
    target = member_of(db, club_id, target_id)
    if target.user_id == user.id:
        raise fail(409, "use_leave")
    if target.role == "owner" or (target.role == "admin" and me.role != "owner"):
        raise fail(403, "not_allowed")
    db.delete(target)
    db.commit()


def leave(db: Session, club_id: int, user: User) -> None:
    me = member_of(db, club_id, user)
    if me.role == "owner":
        raise fail(409, "owner_cannot_leave")
    db.delete(me)
    db.commit()


# --- invites ---------------------------------------------------------------------------------------------------------------------

def _invite_state(invite: ClubInvite, now: datetime) -> str:
    if invite.revoked_at is not None:
        return "revoked"
    if invite.expires_at <= now:
        return "expired"
    if invite.max_uses is not None and invite.uses >= invite.max_uses:
        return "used_up"
    return "active"


def create_invite(db: Session, club_id: int, user: User, expires_in_days: int, max_uses: int | None) -> dict:
    moderator(db, club_id, user)
    token = secrets.token_urlsafe(32)
    invite = ClubInvite(token=token, club_id=club_id, created_by=user.id, expires_at=_now() + timedelta(days=expires_in_days), max_uses=max_uses)
    db.add(invite)
    db.commit()
    base = (settings.frontend_base_url or "https://bookvane.me").rstrip("/")
    return {"id": invite.id, "url": f"{base}/c/{token}?ref=club", "expires_at": invite.expires_at, "max_uses": invite.max_uses}


def list_invites(db: Session, club_id: int, user: User) -> list[dict]:
    moderator(db, club_id, user)
    now = _now()
    return [{"id": i.id, "created_at": i.created_at, "expires_at": i.expires_at, "max_uses": i.max_uses, "uses": i.uses, "state": _invite_state(i, now)}
            for i in db.scalars(select(ClubInvite).where(ClubInvite.club_id == club_id).order_by(ClubInvite.created_at.desc()).limit(50))]


def revoke_invite(db: Session, club_id: int, user: User, invite_id) -> None:
    moderator(db, club_id, user)
    invite = db.scalar(select(ClubInvite).where(ClubInvite.id == invite_id, ClubInvite.club_id == club_id))
    if invite is None:
        raise HTTPException(404, detail="Invite not found")
    invite.revoked_at = invite.revoked_at or _now()
    db.commit()


def _valid_invite(db: Session, token: str, *, lock: bool = False) -> ClubInvite:
    if not TOKEN.match(token or ""):
        raise HTTPException(404, detail="Not found")
    query = select(ClubInvite).where(ClubInvite.token == token)
    invite = db.scalar(query.with_for_update() if lock else query)
    if invite is None or _invite_state(invite, _now()) != "active":
        raise HTTPException(404, detail="Not found")
    return invite


def invite_preview(db: Session, token: str) -> dict:
    """What the invite page may show before joining: the club's name, description, colour, the owner's display name and the current
    book, never its members, emails or discussion."""
    invite = _valid_invite(db, token)
    club = db.get(Club, invite.club_id)
    count = _member_count(db, club.id)
    owner_name = db.scalar(select(User.display_name).where(User.id == club.owner_id))
    authors = (select(func.coalesce(func.array_agg(aggregate_order_by(Author.name, book_authors.c.author_id)), text("ARRAY[]::text[]")))
               .select_from(book_authors.join(Author)).where(book_authors.c.book_id == Book.id).correlate(Book).scalar_subquery())
    current = db.execute(select(Book.id, Book.title, Book.cover_image_url, authors).join(ClubBook, ClubBook.book_id == Book.id)
                         .where(ClubBook.club_id == club.id, ClubBook.status == "current").order_by(ClubBook.id).limit(1)).first()
    return {"name": club.name, "description": club.description, "color": club.color, "member_count": count, "full": _full(db, club.id, count),
            "owner_name": owner_name or "A reader",
            "current_book": {"book_id": current[0], "title": current[1], "cover_image_url": current[2], "authors": list(current[3] or [])} if current else None}


def join(db: Session, user: User, token: str) -> dict:
    invite = _valid_invite(db, token, lock=True)
    club = db.scalar(select(Club).where(Club.id == invite.club_id).with_for_update())     # one join at a time per club: the cap holds
    existing = db.get(ClubMember, (club.id, user.id))
    if existing is not None:
        db.rollback()
        return {"id": club.id, "name": club.name, "joined": False}
    if _full(db, club.id):
        db.rollback()
        raise fail(409, "club_full")
    db.add(ClubMember(club_id=club.id, user_id=user.id, role="member"))
    invite.uses += 1
    db.commit()
    _count(db, "club_joined")
    return {"id": club.id, "name": club.name, "joined": True}


# --- books and checkpoints ---------------------------------------------------------------------------------------------------------

def _club_book(db: Session, club_id: int, club_book_id: int) -> ClubBook:
    row = db.scalar(select(ClubBook).where(ClubBook.id == club_book_id, ClubBook.club_id == club_id).with_for_update())
    if row is None:
        raise HTTPException(404, detail="Club book not found")
    return row


def _make_current(db: Session, club_id: int, except_id: int | None) -> None:
    query = update(ClubBook).where(ClubBook.club_id == club_id, ClubBook.status == "current")
    if except_id is not None:
        query = query.where(ClubBook.id != except_id)
    db.execute(query.values(status="past"))


def add_book(db: Session, club_id: int, user: User, data: dict) -> dict:
    moderator(db, club_id, user)
    if db.get(Book, data["book_id"]) is None:
        raise HTTPException(404, detail="Book not found")
    if (db.scalar(select(func.count()).select_from(ClubBook).where(ClubBook.club_id == club_id)) or 0) >= MAX_BOOKS:
        raise fail(409, "too_many_books")
    if data["status"] == "current":
        _make_current(db, club_id, None)
        db.flush()
    row = ClubBook(club_id=club_id, book_id=data["book_id"], status=data["status"], starts_on=data.get("starts_on"), ends_on=data.get("ends_on"))
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(422, "invalid_dates") from None
    return {"id": row.id, "book_id": row.book_id, "status": row.status, "starts_on": row.starts_on, "ends_on": row.ends_on}


def update_book(db: Session, club_id: int, user: User, club_book_id: int, changes: dict) -> dict:
    moderator(db, club_id, user)
    row = _club_book(db, club_id, club_book_id)
    if changes.get("status") == "current":
        _make_current(db, club_id, row.id)
        db.flush()
    for key in ("status", "starts_on", "ends_on"):
        if key in changes:
            setattr(row, key, changes[key])
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(422, "invalid_dates") from None
    return {"id": row.id, "status": row.status, "starts_on": row.starts_on, "ends_on": row.ends_on}


def delete_book(db: Session, club_id: int, user: User, club_book_id: int) -> None:
    moderator(db, club_id, user)
    db.delete(_club_book(db, club_id, club_book_id))
    db.commit()


def add_checkpoint(db: Session, club_id: int, user: User, club_book_id: int, data: dict) -> dict:
    moderator(db, club_id, user)
    _club_book(db, club_id, club_book_id)
    if (db.scalar(select(func.count()).select_from(ClubCheckpoint).where(ClubCheckpoint.club_book_id == club_book_id)) or 0) >= MAX_CHECKPOINTS:
        raise fail(409, "too_many_checkpoints")
    row = ClubCheckpoint(club_book_id=club_book_id, **data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(422, "invalid_checkpoint") from None
    return {"id": row.id, "unit": row.unit, "value": row.value, "due_on": row.due_on, "label": row.label}


def delete_checkpoint(db: Session, club_id: int, user: User, club_book_id: int, checkpoint_id: int) -> None:
    moderator(db, club_id, user)
    _club_book(db, club_id, club_book_id)
    row = db.scalar(select(ClubCheckpoint).where(ClubCheckpoint.id == checkpoint_id, ClubCheckpoint.club_book_id == club_book_id))
    if row is None:
        raise HTTPException(404, detail="Checkpoint not found")
    db.delete(row)
    db.commit()


# --- spoiler-safe discussion ------------------------------------------------------------------------------------------------------------

def viewer_progress(db: Session, user_id, book_id: int) -> dict:
    """How far this reader is in the book, from their own readings: {finished, pages, percent} (None where unknown). One statement."""
    rows = db.execute(select(ReadingAttempt.state, ReadingAttempt.progress_unit, ReadingAttempt.progress_value,
                             func.coalesce(ReadingAttempt.total_pages, Book.page_count))
                      .join(UserBook, UserBook.id == ReadingAttempt.user_book_id).join(Book, Book.id == UserBook.book_id)
                      .where(UserBook.user_id == user_id, UserBook.book_id == book_id)).all()
    best = {"finished": False, "pages": None, "percent": None, "total": None}
    for state, unit, value, total in rows:
        if state == "finished":
            best["finished"] = True
        if unit is None or value is None:
            continue
        pages = value if unit == "pages" else (round(value * total / 100) if total else None)
        percent = value if unit == "percent" else (value * 100 / total if total else None)
        if pages is not None:
            best["pages"] = max(best["pages"] or 0, pages)
        if percent is not None:
            best["percent"] = max(best["percent"] or 0, percent)
        best["total"] = total or best["total"]
    return best


def reached(progress: dict, unit: str | None, value: int | None, page_count: int | None = None) -> bool:
    """Has the reader got to this anchor? No anchor (or the very start) is open to everyone; a finished reader sees everything."""
    if unit is None or not value:
        return True
    if progress["finished"]:
        return True
    if unit == "pages":
        have = progress["pages"]
        if have is None and progress["percent"] is not None and page_count:
            have = progress["percent"] * page_count / 100
        return have is not None and have >= value
    have = progress["percent"]
    if have is None and progress["pages"] is not None and page_count:
        have = progress["pages"] * 100 / page_count
    return have is not None and have >= value


def _post_view(post: ClubPost, name: str | None, user_id, patrons: set, count: int | None = None) -> dict:
    return {"id": post.id, "body": post.body, "author": {"name": _name(name), "initials": initials(name, "member"), "patron": post.user_id in patrons},
            "mine": post.user_id == user_id, "anchor": {"unit": post.anchor_unit, "value": post.anchor_value} if post.anchor_unit else None,
            "created_at": post.created_at, "edited_at": post.edited_at, **({"report_count": count, "hidden": post.hidden_at is not None} if count is not None else {})}


def list_posts(db: Session, club_id: int, user: User, club_book_id: int, before: int | None = None, limit: int = POST_PAGE) -> dict:
    me = member_of(db, club_id, user)
    cb = db.execute(select(ClubBook.book_id, Book.page_count).join(Book, Book.id == ClubBook.book_id)
                    .where(ClubBook.id == club_book_id, ClubBook.club_id == club_id)).first()
    if cb is None:
        raise HTTPException(404, detail="Club book not found")
    mod = me.role in MODS
    query = (select(ClubPost, User.display_name, func.count(ClubReport.post_id).label("reports"))
             .join(User, User.id == ClubPost.user_id).outerjoin(ClubReport, ClubReport.post_id == ClubPost.id)
             .where(ClubPost.club_book_id == club_book_id, ClubPost.deleted_at.is_(None)).group_by(ClubPost.id, User.display_name)
             .order_by(ClubPost.id.desc()).limit(limit + 1))
    if before is not None:
        query = query.where(ClubPost.id < before)
    rows = db.execute(query).all()
    page, more = rows[:limit], len(rows) > limit
    progress = viewer_progress(db, user.id, cb.book_id)
    patrons = entitlements.patron_ids(db, {post.user_id for post, _, _ in page})
    items = []
    for post, name, reports in page:
        mine = post.user_id == user.id
        if post.hidden_at is not None and not mod:
            items.append({"id": post.id, "hidden": True})
        elif not mine and not mod and not reached(progress, post.anchor_unit, post.anchor_value, cb.page_count):
            items.append({"id": post.id, "locked": True, "unlocks_at": {"unit": post.anchor_unit, "value": post.anchor_value}, "created_at": post.created_at,
                          "author": {"name": _name(name)}})
        else:
            items.append(_post_view(post, name, user.id, patrons, reports if mod else None))
    return {"items": items, "next_before": page[-1][0].id if more and page else None}


def create_post(db: Session, club_id: int, user: User, club_book_id: int, body: str, unit: str | None, value: int | None) -> dict:
    member_of(db, club_id, user)
    cb = db.execute(select(ClubBook.book_id, Book.page_count).join(Book, Book.id == ClubBook.book_id)
                    .where(ClubBook.id == club_book_id, ClubBook.club_id == club_id)).first()
    if cb is None:
        raise HTTPException(404, detail="Club book not found")
    progress = viewer_progress(db, user.id, cb.book_id)
    if unit is None:                       # no anchor given: the post is about where the poster is now
        if progress["percent"] is not None and not progress["finished"]:
            unit, value = ("pages", progress["pages"]) if progress["pages"] is not None else ("percent", int(progress["percent"]))
    elif not reached(progress, unit, value, cb.page_count):
        raise fail(422, "anchor_ahead_of_progress")      # a post cannot claim to be about pages its author has not reached
    post = ClubPost(club_book_id=club_book_id, user_id=user.id, body=body, anchor_unit=unit if value else None, anchor_value=value if value else None)
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_view(post, user.display_name, user.id, entitlements.patron_ids(db, [user.id]))


def _post(db: Session, club_id: int, post_id: int) -> ClubPost:
    post = db.scalar(select(ClubPost).join(ClubBook, ClubBook.id == ClubPost.club_book_id)
                     .where(ClubPost.id == post_id, ClubBook.club_id == club_id, ClubPost.deleted_at.is_(None)).with_for_update(of=ClubPost))
    if post is None:
        raise HTTPException(404, detail="Post not found")
    return post


def edit_post(db: Session, club_id: int, user: User, post_id: int, body: str) -> dict:
    member_of(db, club_id, user)
    post = _post(db, club_id, post_id)
    if post.user_id != user.id:
        raise fail(403, "not_allowed")
    post.body, post.edited_at = body, _now()
    db.commit()
    return {"id": post.id, "body": post.body, "edited_at": post.edited_at}


def _soft_delete(post: ClubPost) -> None:
    post.deleted_at, post.body, post.hidden_at = _now(), "", None


def delete_post(db: Session, club_id: int, user: User, post_id: int) -> None:
    me = member_of(db, club_id, user)
    post = _post(db, club_id, post_id)
    if post.user_id != user.id and me.role not in MODS:
        raise fail(403, "not_allowed")
    _soft_delete(post)
    db.commit()


def report_post(db: Session, club_id: int, user: User, post_id: int, reason: str | None) -> dict:
    member_of(db, club_id, user)
    post = _post(db, club_id, post_id)
    if post.user_id == user.id:
        raise fail(422, "cannot_report_own_post")
    db.execute(insert(ClubReport).values(post_id=post.id, reporter_id=user.id, reason=reason).on_conflict_do_nothing())
    count = db.scalar(select(func.count()).select_from(ClubReport).where(ClubReport.post_id == post.id)) or 0
    if count >= HIDE_AFTER_REPORTS and post.hidden_at is None:
        post.hidden_at = _now()
    db.commit()
    return {"reported": True}


def reports(db: Session, club_id: int, user: User) -> list[dict]:
    moderator(db, club_id, user)
    rows = db.execute(select(ClubPost, User.display_name, func.count(ClubReport.post_id), func.array_agg(ClubReport.reason).filter(ClubReport.reason.is_not(None)))
                      .join(ClubBook, ClubBook.id == ClubPost.club_book_id).join(User, User.id == ClubPost.user_id)
                      .join(ClubReport, ClubReport.post_id == ClubPost.id)
                      .where(ClubBook.club_id == club_id, ClubPost.deleted_at.is_(None)).group_by(ClubPost.id, User.display_name)
                      .order_by(ClubPost.hidden_at.is_(None), func.count(ClubReport.post_id).desc(), ClubPost.id).limit(100)).all()
    return [{"id": post.id, "body": post.body, "author": _name(name), "report_count": n, "reasons": (reasons or [])[:5], "hidden": post.hidden_at is not None,
             "created_at": post.created_at} for post, name, n, reasons in rows]


def review_post(db: Session, club_id: int, user: User, post_id: int, action: str) -> dict:
    moderator(db, club_id, user)
    post = _post(db, club_id, post_id)
    if action == "delete":
        _soft_delete(post)
    else:
        post.hidden_at = None
        db.execute(ClubReport.__table__.delete().where(ClubReport.post_id == post.id))      # a restored post starts clean
    db.commit()
    return {"action": action}
