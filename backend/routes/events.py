import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db, settings
from models import User
from services import catalogue_health, event_counts

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


def require_admin(request: Request, db: Session = Depends(get_db)) -> User | None:
    """An admin reader (by email) or the weekly job's service key in the X-Admin-Key header; nobody else."""
    key = settings.admin_api_key.get_secret_value() if settings.admin_api_key else ""
    supplied = request.headers.get("x-admin-key", "")
    if key and supplied and hmac.compare_digest(supplied.encode(), key.encode()):
        return None
    user = get_current_user(request, db)
    admins = {item.strip().casefold() for item in settings.admin_emails.split(",") if item.strip()}
    if user.email.casefold() not in admins:
        raise HTTPException(status_code=403, detail="Not allowed")
    return user


@router.get("/admin/metrics")
def admin_metrics(days: int = Query(30, ge=1, le=366), _admin: User | None = Depends(require_admin),
                  db: Session = Depends(get_db)):
    return {**event_counts.metrics(db, days), "catalogue": catalogue_health.catalogue_block(db, days)}


class MissingTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    author: str


class EnqueueMissing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[MissingTitle] = Field(max_length=catalogue_health.ENQUEUE_MAX)


@router.post("/admin/catalogue/enqueue")
def admin_enqueue(data: EnqueueMissing, _admin: User | None = Depends(require_admin), db: Session = Depends(get_db)):
    """Queue titles the weekly benchmark could not find for the existing lookup worker."""
    return catalogue_health.enqueue_missing(db, [item.model_dump() for item in data.items])


class Alert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[str] = Field(max_length=10)


@router.post("/admin/catalogue/alert", status_code=202)
def admin_alert(data: Alert, _admin: User | None = Depends(require_admin)):
    """Email the support inbox when a catalogue limit is crossed. Counts and percentages only; sent through the existing mailer."""
    return {"sent": catalogue_health.send_alert(data.lines)}
