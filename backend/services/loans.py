"""Lending (T75): a private log of books lent and borrowed, plus an optional private link for the borrower.

Owner-scoped throughout (a loan of someone else's entry is a 404). Nothing is ever sent to anyone: the lender sends the link
themselves. The borrower's name is visible only to the lender; the public link shows one book and the lender's first name.
Aggregate counters only for events (no loan, person or book is recorded in them).
"""
from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by, insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import settings
from loan_schemas import LoanBrief, LoanCreate, LoanPatch, LoanView, PublicLoan
from models import Author, Book, Loan, User, UserBook, book_authors
from services.event_counts import record_event

TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
CLOSED_VISIBLE_DAYS = 30
LIST_LIMIT = 200


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})


def today() -> date:
    return datetime.now(timezone.utc).date()


def _count(db: Session, name: str) -> None:
    """One aggregate count; never allowed to fail the request."""
    try:
        record_event(db, name)
    except SQLAlchemyError:
        db.rollback()


def brief(loan: Loan, on: date | None = None) -> LoanBrief:
    on = on or today()
    return LoanBrief(id=loan.id, direction=loan.direction, person_name=loan.person_name, started_on=loan.started_on,
                     due_on=loan.due_on, overdue=bool(loan.ended_on is None and loan.due_on is not None and loan.due_on < on),
                     said_back=loan.borrower_said_back_at is not None and loan.ended_on is None,
                     has_link=loan.share_token is not None and loan.share_revoked_at is None and loan.ended_on is None)


def view(loan: Loan, on: date | None = None) -> LoanView:
    return LoanView(**brief(loan, on).model_dump(), entry_id=loan.user_book_id, ended_on=loan.ended_on)


def briefs_for(entry: UserBook) -> list[LoanBrief]:
    """The entry's open loans from the relationship loaded with the entry (no statement of its own)."""
    on = today()
    return [brief(loan, on) for loan in entry.open_loans]


# --- the reader's own loans ----------------------------------------------------------------------------------------------

def _entry(db: Session, user: User, entry_id: int) -> UserBook:
    entry = db.scalar(select(UserBook).where(UserBook.id == entry_id, UserBook.user_id == user.id).with_for_update())
    if entry is None:
        raise HTTPException(404, detail="Library entry not found")
    return entry


def _entry_for_book(db: Session, user: User, book_id: int) -> UserBook:
    """The reader's entry for a catalogue book, created (not owned, not wanted) when they have none yet."""
    if db.get(Book, book_id) is None:
        raise HTTPException(404, detail="Book not found")
    db.execute(insert(UserBook).values(user_id=user.id, book_id=book_id, is_owned=False, is_wanted=False, status=None, version=1)
               .on_conflict_do_nothing(constraint="uq_user_book"))
    return db.scalar(select(UserBook).where(UserBook.user_id == user.id, UserBook.book_id == book_id).with_for_update())


def _loan(db: Session, user: User, loan_id) -> Loan:
    loan = db.scalar(select(Loan).join(UserBook, UserBook.id == Loan.user_book_id)
                     .where(Loan.id == loan_id, UserBook.user_id == user.id).with_for_update(of=Loan))
    if loan is None:
        raise HTTPException(404, detail="Loan not found")
    return loan


def create(db: Session, user: User, data: LoanCreate) -> LoanView:
    entry = _entry(db, user, data.entry_id) if data.entry_id is not None else _entry_for_book(db, user, data.book_id)
    started = data.started_on or today()
    if started > today():
        raise fail(422, "start_in_future")
    if data.due_on is not None and data.due_on < started:
        raise fail(422, "due_before_start")
    if data.direction == "lent" and not entry.is_owned:
        raise fail(422, "lend_requires_owned")
    existing = db.scalar(select(Loan).where(Loan.user_book_id == entry.id, Loan.request_id == data.request_id))
    if existing is not None:           # a retry of the same request: the same loan, or a conflict when the details differ
        same = (existing.direction, existing.person_name, existing.due_on) == (data.direction, data.person_name, data.due_on)
        if not same:
            raise fail(409, "request_id_conflict")
        db.commit()
        return view(existing)
    if db.scalar(select(Loan.id).where(Loan.user_book_id == entry.id, Loan.direction == data.direction, Loan.ended_on.is_(None))):
        raise fail(409, "loan_already_open")
    loan = Loan(user_book_id=entry.id, direction=data.direction, person_name=data.person_name, started_on=started,
                due_on=data.due_on, request_id=data.request_id)
    db.add(loan)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(409, "loan_already_open") from None
    _count(db, "loan_created")
    db.refresh(loan)
    return view(loan)


def update(db: Session, user: User, loan_id, data: LoanPatch) -> LoanView:
    loan = _loan(db, user, loan_id)
    fields = data.model_fields_set
    if loan.ended_on is not None and (fields - {"ended"} or data.ended):
        raise fail(409, "loan_closed")
    if "person_name" in fields:
        loan.person_name = data.person_name
    if "due_on" in fields:
        if data.due_on is not None and data.due_on < loan.started_on:
            raise fail(422, "due_before_start")
        loan.due_on = data.due_on
    if data.ended:
        loan.ended_on = max(today(), loan.started_on)
    db.commit()
    db.refresh(loan)
    return view(loan)


def delete(db: Session, user: User, loan_id) -> None:
    loan = _loan(db, user, loan_id)
    db.delete(loan)
    db.commit()


def listing(db: Session, user: User, *, state: str | None = None, direction: str | None = None, entry_id: int | None = None,
            limit: int = LIST_LIMIT) -> list[dict]:
    """The reader's loans with the book's title, id, cover and authors (a private entry: no id or cover, its own author), open ones first
    (overdue, then by due date). One statement however many loans."""
    on = today()
    authors = (select(func.array_agg(aggregate_order_by(Author.name, book_authors.c.author_id)).filter(Author.name.is_not(None)))
               .select_from(book_authors.join(Author, Author.id == book_authors.c.author_id))
               .where(book_authors.c.book_id == UserBook.book_id).correlate(UserBook).scalar_subquery())
    query = (select(Loan, func.coalesce(Book.title, UserBook.private_title).label("title"), Book.id, Book.cover_image_url,
                    authors.label("authors"), UserBook.private_author)
             .join(UserBook, UserBook.id == Loan.user_book_id).outerjoin(Book, Book.id == UserBook.book_id)
             .where(UserBook.user_id == user.id))
    if state == "open":
        query = query.where(Loan.ended_on.is_(None))
    elif state == "closed":
        query = query.where(Loan.ended_on.is_not(None))
    if direction:
        query = query.where(Loan.direction == direction)
    if entry_id is not None:
        query = query.where(Loan.user_book_id == entry_id)
    overdue_first = case((Loan.ended_on.is_(None) & (Loan.due_on < on), 0), else_=1)
    if state == "closed":       # past loans: the most recently returned first
        query = query.order_by(Loan.ended_on.desc(), Loan.created_at.desc(), Loan.id)
    else:
        query = query.order_by(Loan.ended_on.is_not(None), overdue_first, Loan.due_on.asc().nulls_last(), Loan.started_on.desc(), Loan.id)
    query = query.limit(min(limit, LIST_LIMIT))
    return [{**view(loan, on).model_dump(mode="json"), "title": title, "book_id": book_id, "cover_image_url": cover,
             "authors": list(names or []) if book_id is not None else ([private_author] if private_author else [])}
            for loan, title, book_id, cover, names, private_author in db.execute(query).all()]


def share(db: Session, user: User, loan_id) -> dict:
    """The loan's link, created on first use and reused after; a revoked link is replaced by a new one."""
    loan = _loan(db, user, loan_id)
    if loan.direction != "lent":
        raise fail(422, "share_requires_lent")
    if loan.ended_on is not None:
        raise fail(409, "loan_closed")
    created = False
    if loan.share_token is None or loan.share_revoked_at is not None:
        loan.share_token, loan.share_revoked_at, loan.borrower_said_back_at = secrets.token_urlsafe(32), None, None
        created = True
    db.commit()
    if created:
        _count(db, "loan_link_created")
    return {"url": f"{(settings.frontend_base_url or 'https://bookvane.me').rstrip('/')}/l/{loan.share_token}"}


def revoke(db: Session, user: User, loan_id) -> None:
    loan = _loan(db, user, loan_id)
    if loan.share_token is not None and loan.share_revoked_at is None:
        loan.share_revoked_at = datetime.now(timezone.utc)
        db.commit()
    else:
        db.rollback()


# --- the borrower's link (public) ------------------------------------------------------------------------------------------

def _by_token(db: Session, token: str):
    """(loan, entry, book title, authors, cover, lender display name) for a link, or 404. One statement."""
    if not TOKEN.match(token or ""):
        raise HTTPException(404, detail="Not found")
    authors = (select(func.array_agg(Author.name).filter(Author.name.is_not(None)))
               .select_from(book_authors.join(Author, Author.id == book_authors.c.author_id))
               .where(book_authors.c.book_id == UserBook.book_id).correlate(UserBook).scalar_subquery())
    row = db.execute(select(Loan, UserBook.private_title, UserBook.private_author, UserBook.private_catalogue, Book.title, Book.cover_image_url,
                            authors.label("authors"), User.display_name)
                     .join(UserBook, UserBook.id == Loan.user_book_id).join(User, User.id == UserBook.user_id)
                     .outerjoin(Book, Book.id == UserBook.book_id)
                     .where(Loan.share_token == token, Loan.direction == "lent")).first()
    if row is None:
        raise HTTPException(404, detail="Not found")
    loan = row[0]
    now = datetime.now(timezone.utc)
    if loan.ended_on is not None and (today() - loan.ended_on) > timedelta(days=CLOSED_VISIBLE_DAYS):
        raise HTTPException(404, detail="Not found")
    if loan.share_revoked_at is not None and (now - loan.share_revoked_at) > timedelta(days=CLOSED_VISIBLE_DAYS):
        raise HTTPException(404, detail="Not found")
    return row


def _public(row) -> PublicLoan:
    loan, private_title, private_author, private_catalogue, title, cover, authors, display_name = row
    closed = loan.ended_on is not None or loan.share_revoked_at is not None
    if title is None:
        catalogue = private_catalogue if isinstance(private_catalogue, dict) else {}
        title, cover = private_title, catalogue.get("cover_image_url")
        authors = [private_author] if private_author else []
    first = (display_name or "").split()
    return PublicLoan(state="closed" if closed else "open", title=title, authors=list(authors or []), cover_url=cover,
                      lender_first_name=first[0] if first else None, started_on=loan.started_on, due_on=loan.due_on,
                      said_back=loan.borrower_said_back_at is not None)


def public_view(db: Session, token: str) -> PublicLoan:
    result = _public(_by_token(db, token))
    _count(db, "loan_link_opened")
    return result


def said_back(db: Session, token: str) -> PublicLoan:
    """The borrower says it is back. Idempotent; a closed or revoked link changes nothing."""
    row = _by_token(db, token)
    loan = row[0]
    if loan.ended_on is None and loan.share_revoked_at is None and loan.borrower_said_back_at is None:
        loan.borrower_said_back_at = datetime.now(timezone.utc)
        db.commit()
        _count(db, "loan_back")
        return _public(_by_token(db, token))
    db.rollback()
    return _public(row)
