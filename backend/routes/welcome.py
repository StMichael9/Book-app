import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import update
from sqlalchemy.orm import Session

from database import get_db, settings
from models import User
from rate_limit import limiter
from services import welcome

router = APIRouter(tags=["email"])

PAGE = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Bookvane</title></head><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem\">"
        "<h1>{heading}</h1><p>{body}</p></body></html>")


def service_key_only(request: Request) -> None:
    """The daily job's service key in the X-Admin-Key header; nobody else (not even a signed-in admin)."""
    key = settings.admin_api_key.get_secret_value() if settings.admin_api_key else ""
    supplied = request.headers.get("x-admin-key", "")
    if not (key and supplied and hmac.compare_digest(supplied.encode(), key.encode())):
        raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/admin/send-welcome")
def send_welcome(limit: int = Query(welcome.MAX_PER_RUN, ge=1, le=welcome.MAX_PER_RUN), _key: None = Depends(service_key_only),
                 db: Session = Depends(get_db)):
    """Send the due welcome emails: one per account, at most 200 a run. Counts only in the answer."""
    if not all((settings.resend_api_key, settings.password_reset_from, settings.frontend_base_url)):
        raise HTTPException(status_code=503, detail="Email is not configured")
    return welcome.send_due(db, limit=limit)


def _unsubscribe(token: str, db: Session) -> Response:
    user_id = welcome.read_unsubscribe_token(token)
    if user_id is None:
        return Response(PAGE.format(heading="This link is not valid", body="It may have been copied incompletely."),
                        status_code=400, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})
    db.execute(update(User).where(User.id == user_id).values(email_tips=False))
    db.commit()
    return Response(PAGE.format(heading="You are unsubscribed", body="You will not get more tips from Bookvane by email."),
                    media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})


@router.get("/email/unsubscribe")
@limiter.limit("30/minute")
def unsubscribe_link(request: Request, t: str = Query("", max_length=200), db: Session = Depends(get_db)):
    return _unsubscribe(t, db)


@router.post("/email/unsubscribe")
@limiter.limit("30/minute")
def unsubscribe_one_click(request: Request, t: str = Query("", max_length=200), db: Session = Depends(get_db)):
    """The List-Unsubscribe-Post one-click form that mail clients send."""
    return _unsubscribe(t, db)
