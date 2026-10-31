from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db, settings
from models import User
from services import event_counts

router = APIRouter(tags=["events"])


@router.post("/events", status_code=204)
async def count_event(request: Request, db: Session = Depends(get_db)) -> Response:
    """Count one anonymous event. Never errors to the client: anything invalid, over the cap or failing is a quiet 204.

    No cookie, header or address is read, and the body is never logged. text/plain is accepted for sendBeacon.
    """
    event = event_counts.parse_event(await request.body())
    if event and event_counts.window.allow():
        try:
            event_counts.record_event(db, *event)
        except SQLAlchemyError:
            db.rollback()
    return Response(status_code=204)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    admins = {item.strip().casefold() for item in settings.admin_emails.split(",") if item.strip()}
    if current_user.email.casefold() not in admins:
        raise HTTPException(status_code=403, detail="Not allowed")
    return current_user


@router.get("/admin/metrics")
def admin_metrics(days: int = Query(30, ge=1, le=366), _admin: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    return event_counts.metrics(db, days)
