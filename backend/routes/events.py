import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user, get_current_user_optional
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


def _admin_emails() -> set[str]:
    return {item.strip().casefold() for item in settings.admin_emails.split(",") if item.strip()}


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.email.casefold() not in _admin_emails():
        raise HTTPException(status_code=403, detail="Not allowed")
    return current_user


def admin_or_service_key(request: Request, user: User | None = Depends(get_current_user_optional)) -> User | None:
    """An admin reader (by email), or the weekly job's service key in the X-Admin-Key header; nobody else."""
    key = settings.admin_api_key.get_secret_value() if settings.admin_api_key else ""
    supplied = request.headers.get("x-admin-key", "")
    if key and supplied and hmac.compare_digest(supplied.encode(), key.encode()):
        return None
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.email.casefold() not in _admin_emails():
        raise HTTPException(status_code=403, detail="Not allowed")
    return user


@router.get("/admin/metrics")
def admin_metrics(days: int = Query(30, ge=1, le=366), _admin: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    return {**event_counts.metrics(db, days), "catalogue": catalogue_health.catalogue_block(db, days)}


@router.get("/admin/catalogue/metrics")
def admin_catalogue_metrics(days: int = Query(7, ge=1, le=366), _admin: User | None = Depends(admin_or_service_key),
                            db: Session = Depends(get_db)):
    """The catalogue block alone (counts and percentages), for the weekly health job."""
    return catalogue_health.catalogue_block(db, days)


class MissingTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    author: str


class EnqueueMissing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[MissingTitle] = Field(max_length=catalogue_health.ENQUEUE_MAX)


@router.post("/admin/catalogue/enqueue")
def admin_enqueue(data: EnqueueMissing, _admin: User | None = Depends(admin_or_service_key), db: Session = Depends(get_db)):
    """Queue titles the weekly benchmark could not find for the existing lookup worker."""
    return catalogue_health.enqueue_missing(db, [item.model_dump() for item in data.items])


class Alert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[str] = Field(max_length=10)


@router.post("/admin/catalogue/alert", status_code=202)
def admin_alert(data: Alert, _admin: User | None = Depends(admin_or_service_key)):
    """Email the support inbox when a catalogue limit is crossed. Counts and percentages only; sent through the existing mailer."""
    return {"sent": catalogue_health.send_alert(data.lines)}
