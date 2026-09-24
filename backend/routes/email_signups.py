from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from database import get_db
from models import EmailSignup
from rate_limit import limiter

router = APIRouter(tags=["email signups"])


class EmailSignupRequest(BaseModel):
    email: EmailStr
    consent: bool


@router.post("/email-signups", status_code=202)
@limiter.limit("5/minute")
def create_email_signup(
    request: Request,
    data: EmailSignupRequest,
    db: Session = Depends(get_db),
):
    if not data.consent:
        raise HTTPException(status_code=422, detail="Consent is required")
    email = data.email.lower()
    statement = insert(EmailSignup).values(email=email, source="landing")
    db.execute(statement.on_conflict_do_nothing(index_elements=["email"]))
    db.commit()
    return {"message": "Thanks for signing up for Bookvane updates."}
