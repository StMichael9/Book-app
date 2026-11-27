"""Club meetings, RSVPs, book suggestions and votes. Part of the free clubs (services.clubs); same rules: members only (anyone else gets a 404).

- One upcoming meeting per club. "Upcoming" is `starts_at >= now - 3h`, so a meeting stays on the page through its evening. It is worked out
  when a page is read: no job, no email, no polling. The create runs under a lock on the club row so two organisers cannot both add one.
- The .ics file is a one-off download behind the member's session, never a subscription feed.
- Suggestions and votes: closing a vote moves the top suggestion onto the club's shelf and clears every vote; the other suggestions stay.
- Every read is a fixed number of statements, however many clubs, members or suggestions there are.
"""
from __future__ import annotations

from datetime import timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, delete, exists, func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (Author, Book, Club, ClubBook, ClubMeeting, ClubMeetingRsvp, ClubSuggestion, ClubVote, User, book_authors)
from services import clubs
from services.clubs import MAX_BOOKS, MODS, fail, member_of, moderator

GRACE = timedelta(hours=3)
LENGTH = timedelta(hours=2)
MAX_AHEAD = timedelta(days=365)
MAX_OPEN_SUGGESTIONS = 20
STATUSES = ("going", "maybe", "no")


def _cutoff():
    return clubs._now() - GRACE


# --- meetings ----------------------------------------------------------------------------------------------------------------

def _query(user_id):
    """A meeting with its RSVP counts and the viewer's own answer: one statement."""
    counts = [func.count(ClubMeetingRsvp.user_id).filter(ClubMeetingRsvp.status == s).label(s) for s in STATUSES]
    mine = func.max(case((ClubMeetingRsvp.user_id == user_id, ClubMeetingRsvp.status))).label("mine")
    return (select(ClubMeeting, *counts, mine).outerjoin(ClubMeetingRsvp, ClubMeetingRsvp.meeting_id == ClubMeeting.id).group_by(ClubMeeting.id))


def _view(row) -> dict:
    meeting = row[0]
    return {"id": meeting.id, "starts_at": meeting.starts_at, "place": meeting.place, "link": meeting.link, "questions": list(meeting.questions or []),
            "counts": {"going": row.going, "maybe": row.maybe, "no": row.no}, "my_rsvp": row.mine}


def next_meeting(db: Session, club_id: int, user_id) -> dict | None:
    row = db.execute(_query(user_id).where(ClubMeeting.club_id == club_id, ClubMeeting.starts_at >= _cutoff())
                     .order_by(ClubMeeting.starts_at, ClubMeeting.id).limit(1)).first()
    return _view(row) if row else None


def next_meeting_at(db: Session, club_ids: list) -> dict:
    """The start of each club's next meeting, in one statement however many clubs."""
    if not club_ids:
        return {}
    return dict(db.execute(select(ClubMeeting.club_id, func.min(ClubMeeting.starts_at))
                           .where(ClubMeeting.club_id.in_(club_ids), ClubMeeting.starts_at >= _cutoff()).group_by(ClubMeeting.club_id)).all())


def member_rsvps(db: Session, club_id: int) -> dict:
    """Each member's answer for the club's next meeting, in one statement."""
    nxt = (select(ClubMeeting.id).where(ClubMeeting.club_id == club_id, ClubMeeting.starts_at >= _cutoff())
           .order_by(ClubMeeting.starts_at, ClubMeeting.id).limit(1).scalar_subquery())
    return dict(db.execute(select(ClubMeetingRsvp.user_id, ClubMeetingRsvp.status).where(ClubMeetingRsvp.meeting_id == nxt)).all())


def drop_member_activity(db: Session, club_id: int, user_id) -> None:
    """A member who leaves or is removed loses their RSVPs and votes in this club (the caller commits, in the same transaction)."""
    db.execute(delete(ClubVote).where(ClubVote.user_id == user_id, ClubVote.suggestion_id.in_(select(ClubSuggestion.id).where(ClubSuggestion.club_id == club_id))))
    db.execute(delete(ClubMeetingRsvp).where(ClubMeetingRsvp.user_id == user_id,
                                             ClubMeetingRsvp.meeting_id.in_(select(ClubMeeting.id).where(ClubMeeting.club_id == club_id))))


def _check_start(starts_at) -> None:
    now = clubs._now()
    if starts_at < now:
        raise fail(422, "starts_in_past")
    if starts_at > now + MAX_AHEAD:
        raise fail(422, "starts_too_far_ahead")


def _meeting(db: Session, club_id: int, meeting_id: int, *, lock: bool = False) -> ClubMeeting:
    query = select(ClubMeeting).where(ClubMeeting.id == meeting_id, ClubMeeting.club_id == club_id)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, detail="Meeting not found")
    return row


def create_meeting(db: Session, club_id: int, user: User, data: dict) -> dict:
    moderator(db, club_id, user)
    _check_start(data["starts_at"])
    db.scalar(select(Club.id).where(Club.id == club_id).with_for_update())                # one create at a time per club
    if db.scalar(select(ClubMeeting.id).where(ClubMeeting.club_id == club_id, ClubMeeting.starts_at >= _cutoff()).limit(1)) is not None:
        db.rollback()
        raise fail(409, "meeting_exists")
    row = ClubMeeting(club_id=club_id, starts_at=data["starts_at"], place=data.get("place") or None, link=data.get("link") or None,
                      questions=data.get("questions") or [], created_by=user.id)
    db.add(row)
    db.commit()
    return _view(db.execute(_query(user.id).where(ClubMeeting.id == row.id)).first())


def update_meeting(db: Session, club_id: int, user: User, meeting_id: int, changes: dict) -> dict:
    moderator(db, club_id, user)
    row = _meeting(db, club_id, meeting_id, lock=True)
    if "starts_at" in changes:
        _check_start(changes["starts_at"])
    if "starts_at" in changes:
        row.starts_at = changes["starts_at"]
    for key in ("place", "link"):
        if key in changes:
            setattr(row, key, changes[key] or None)
    if "questions" in changes:
        row.questions = changes["questions"] or []
    db.commit()
    return _view(db.execute(_query(user.id).where(ClubMeeting.id == meeting_id)).first())


def delete_meeting(db: Session, club_id: int, user: User, meeting_id: int) -> None:
    moderator(db, club_id, user)
    db.delete(_meeting(db, club_id, meeting_id))
    db.commit()


def set_rsvp(db: Session, club_id: int, user: User, meeting_id: int, status: str) -> dict:
    member_of(db, club_id, user)
    _meeting(db, club_id, meeting_id)
    db.execute(insert(ClubMeetingRsvp).values(meeting_id=meeting_id, user_id=user.id, status=status)
               .on_conflict_do_update(index_elements=["meeting_id", "user_id"], set_={"status": status, "updated_at": func.now()}))
    db.commit()
    counts = dict(db.execute(select(ClubMeetingRsvp.status, func.count()).where(ClubMeetingRsvp.meeting_id == meeting_id).group_by(ClubMeetingRsvp.status)).all())
    return {"counts": {s: counts.get(s, 0) for s in STATUSES}, "my_rsvp": status}


# --- the calendar file ---------------------------------------------------------------------------------------------------------

def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")


def _fold(line: str) -> str:
    """Lines of at most 75 octets, continued with a leading space (RFC 5545)."""
    chunks, current, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        if size + n > 75:
            chunks.append(current)
            current, size = " ", 1
        current, size = current + ch, size + n
    chunks.append(current)
    return "\r\n".join(chunks)


def ics(db: Session, club_id: int, user: User, meeting_id: int) -> str:
    member_of(db, club_id, user)
    meeting = _meeting(db, club_id, meeting_id)
    name = db.scalar(select(Club.name).where(Club.id == club_id))
    title = db.scalar(select(Book.title).join(ClubBook, ClubBook.book_id == Book.id).where(ClubBook.club_id == club_id, ClubBook.status == "current").limit(1))
    stamp = lambda moment: moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    description = [f"Reading: {title}"] if title else []
    if meeting.questions:
        description += ["Questions:"] + [f"{n}. {q}" for n, q in enumerate(meeting.questions, 1)]
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bookvane//Clubs//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
             f"UID:club-meeting-{meeting.id}@bookvane.me", f"DTSTAMP:{stamp(meeting.created_at)}", f"DTSTART:{stamp(meeting.starts_at)}",
             f"DTEND:{stamp(meeting.starts_at + LENGTH)}", f"SUMMARY:{_escape(name)}"]
    if meeting.place or meeting.link:
        lines.append(f"LOCATION:{_escape(meeting.place or meeting.link)}")
    if description:
        lines.append(f"DESCRIPTION:{_escape(chr(10).join(description))}")
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


# --- suggestions and votes -----------------------------------------------------------------------------------------------------

def _rows(db: Session, club_id: int, user_id, only_id: int | None = None) -> list[dict]:
    authors = (select(func.coalesce(func.array_agg(aggregate_order_by(Author.name, book_authors.c.author_id)), text("ARRAY[]::text[]")))
               .select_from(book_authors.join(Author)).where(book_authors.c.book_id == Book.id).correlate(Book).scalar_subquery())
    votes = select(func.count()).where(ClubVote.suggestion_id == ClubSuggestion.id).correlate(ClubSuggestion).scalar_subquery().label("votes")
    mine = exists().where(ClubVote.suggestion_id == ClubSuggestion.id, ClubVote.user_id == user_id).correlate(ClubSuggestion).label("my_vote")
    query = (select(ClubSuggestion, Book.title, Book.cover_image_url, Book.page_count, authors, User.display_name, votes, mine)
             .join(Book, Book.id == ClubSuggestion.book_id).join(User, User.id == ClubSuggestion.suggested_by).where(ClubSuggestion.club_id == club_id)
             .order_by(votes.desc(), ClubSuggestion.created_at, ClubSuggestion.id))
    if only_id is not None:
        query = query.where(ClubSuggestion.id == only_id)
    return [{"id": s.id, "book": {"id": s.book_id, "title": title, "authors": list(names or []), "cover_image_url": cover, "page_count": pages},
             "suggested_by": {"name": clubs._name(display)}, "note": s.note, "votes": n, "my_vote": bool(voted), "mine": s.suggested_by == user_id}
            for s, title, cover, pages, names, display, n, voted in db.execute(query).all()]


def list_suggestions(db: Session, club_id: int, user: User) -> list[dict]:
    member_of(db, club_id, user)
    return _rows(db, club_id, user.id)


def _lock_club(db: Session, club_id: int) -> None:
    db.scalar(select(Club.id).where(Club.id == club_id).with_for_update())


def create_suggestion(db: Session, club_id: int, user: User, book_id: int, note: str | None) -> dict:
    member_of(db, club_id, user)
    if db.get(Book, book_id) is None:
        raise HTTPException(404, detail="Book not found")
    _lock_club(db, club_id)
    if db.scalar(select(ClubSuggestion.id).where(ClubSuggestion.club_id == club_id, ClubSuggestion.book_id == book_id)) is not None:
        db.rollback()
        raise fail(409, "already_suggested")
    if db.scalar(select(ClubBook.id).where(ClubBook.club_id == club_id, ClubBook.book_id == book_id, ClubBook.status.in_(("current", "upcoming"))).limit(1)) is not None:
        db.rollback()
        raise fail(409, "on_club_shelf")
    if (db.scalar(select(func.count()).select_from(ClubSuggestion).where(ClubSuggestion.club_id == club_id)) or 0) >= MAX_OPEN_SUGGESTIONS:
        db.rollback()
        raise fail(409, "too_many_suggestions")
    row = ClubSuggestion(club_id=club_id, book_id=book_id, suggested_by=user.id, note=(note or "").strip() or None)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(409, "already_suggested") from None
    return _rows(db, club_id, user.id, row.id)[0]


def _suggestion(db: Session, club_id: int, suggestion_id: int) -> ClubSuggestion:
    row = db.scalar(select(ClubSuggestion).where(ClubSuggestion.id == suggestion_id, ClubSuggestion.club_id == club_id))
    if row is None:
        raise HTTPException(404, detail="Suggestion not found")
    return row


def delete_suggestion(db: Session, club_id: int, user: User, suggestion_id: int) -> None:
    me = member_of(db, club_id, user)
    row = _suggestion(db, club_id, suggestion_id)
    if row.suggested_by != user.id and me.role not in MODS:
        raise fail(403, "not_allowed")
    db.delete(row)
    db.commit()


def set_vote(db: Session, club_id: int, user: User, suggestion_id: int, on: bool) -> dict:
    """Idempotent: voting twice or removing a vote that is not there changes nothing and returns the current state."""
    member_of(db, club_id, user)
    _suggestion(db, club_id, suggestion_id)
    if on:
        db.execute(insert(ClubVote).values(suggestion_id=suggestion_id, user_id=user.id).on_conflict_do_nothing())
    else:
        db.execute(delete(ClubVote).where(ClubVote.suggestion_id == suggestion_id, ClubVote.user_id == user.id))
    db.commit()
    return {"votes": db.scalar(select(func.count()).select_from(ClubVote).where(ClubVote.suggestion_id == suggestion_id)) or 0, "my_vote": on}


def close_vote(db: Session, club_id: int, user: User) -> dict:
    """The top suggestion (a tie goes to the oldest) joins the shelf as the upcoming book, or as the current one if there is none; every vote is
    cleared and the other suggestions stay for the next round. One transaction under a lock on the club."""
    moderator(db, club_id, user)
    _lock_club(db, club_id)
    votes = select(func.count()).where(ClubVote.suggestion_id == ClubSuggestion.id).correlate(ClubSuggestion).scalar_subquery().label("votes")
    top = db.execute(select(ClubSuggestion, Book.title, votes).join(Book, Book.id == ClubSuggestion.book_id).where(ClubSuggestion.club_id == club_id)
                     .order_by(votes.desc(), ClubSuggestion.created_at, ClubSuggestion.id).limit(1)).first()
    if top is None:
        db.rollback()
        raise fail(409, "no_suggestions")
    if (db.scalar(select(func.count()).select_from(ClubBook).where(ClubBook.club_id == club_id)) or 0) >= MAX_BOOKS:
        db.rollback()
        raise fail(409, "club_shelf_full")
    suggestion, title, count = top
    has_current = db.scalar(select(ClubBook.id).where(ClubBook.club_id == club_id, ClubBook.status == "current").limit(1)) is not None
    shelf = ClubBook(club_id=club_id, book_id=suggestion.book_id, status="upcoming" if has_current else "current")
    db.add(shelf)
    db.execute(delete(ClubVote).where(ClubVote.suggestion_id.in_(select(ClubSuggestion.id).where(ClubSuggestion.club_id == club_id))))
    db.execute(delete(ClubSuggestion).where(ClubSuggestion.id == suggestion.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(409, "club_shelf_full") from None
    return {"club_book": {"id": shelf.id, "book_id": shelf.book_id, "status": shelf.status, "starts_on": shelf.starts_on, "ends_on": shelf.ends_on},
            "title": title, "votes": count}
