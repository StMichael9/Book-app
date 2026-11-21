from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from database import get_db
from loan_schemas import LoanCreate, LoanPatch, LoanView, PublicLoan, ShareLink
from models import User
from rate_limit import limiter
from routes.library import reading_user, writing_user
from services import loans

router = APIRouter(prefix="/me", tags=["loans"])
public = APIRouter(tags=["loans"])


@router.post("/loans", response_model=LoanView, status_code=201)
@limiter.limit("60/minute")
def create_loan(request: Request, data: LoanCreate, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return loans.create(db, current_user, data)


@router.get("/loans")
@limiter.limit("60/minute")
def list_loans(request: Request, state: Literal["open", "closed"] | None = None, direction: Literal["lent", "borrowed"] | None = None,
               current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return {"items": loans.listing(db, current_user, state=state, direction=direction)}


@router.patch("/loans/{loan_id}", response_model=LoanView)
@limiter.limit("60/minute")
def patch_loan(request: Request, loan_id: UUID, data: LoanPatch, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return loans.update(db, current_user, loan_id, data)


@router.delete("/loans/{loan_id}", status_code=204)
@limiter.limit("60/minute")
def delete_loan(request: Request, loan_id: UUID, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    loans.delete(db, current_user, loan_id)
    return Response(status_code=204)


@router.post("/loans/{loan_id}/share", response_model=ShareLink)
@limiter.limit("30/minute")
def share_loan(request: Request, loan_id: UUID, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return loans.share(db, current_user, loan_id)


@router.delete("/loans/{loan_id}/share", status_code=204)
@limiter.limit("30/minute")
def revoke_share(request: Request, loan_id: UUID, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    loans.revoke(db, current_user, loan_id)
    return Response(status_code=204)


def _private(response: Response) -> None:
    # Nothing here is for a cache or a search engine: one private link, one book.
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


@public.get("/loans/{token}", response_model=PublicLoan)
@limiter.limit("30/minute")
def public_loan(request: Request, response: Response, token: str, db: Session = Depends(get_db)):
    """The borrower's page: the book, the lender's first name and the dates. No sign-in, no borrower name, nothing else."""
    _private(response)
    return loans.public_view(db, token)


@public.post("/loans/{token}/back", response_model=PublicLoan)
@limiter.limit("10/minute")
def loan_back(request: Request, response: Response, token: str, db: Session = Depends(get_db)):
    """"I've given it back": marks the loan for the lender to confirm. Idempotent."""
    _private(response)
    return loans.said_back(db, token)
