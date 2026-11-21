from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from models import User
from rate_limit import limiter
from services import billing

router = APIRouter(tags=["billing"])
MAX_WEBHOOK_BYTES = 1_000_000


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: Literal["patron", "club_plus"]
    interval: Literal["month", "year"]
    club_id: int | None = Field(default=None, ge=1)


@router.post("/me/billing/checkout")
@limiter.limit("10/minute")
def start_checkout(request: Request, data: CheckoutRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The Stripe Checkout address for this product. Only a club's owner can buy Club Plus for it."""
    return billing.checkout(db, current_user, data.product, data.interval, data.club_id)


@router.post("/me/billing/portal")
@limiter.limit("10/minute")
def open_portal(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The Stripe billing portal (manage, cancel, update the card). Needs a Stripe customer, i.e. a first checkout."""
    return billing.portal(db, current_user)


@router.get("/me/billing")
@limiter.limit("60/minute")
def my_billing(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return billing.summary(db, current_user)


@router.post("/billing/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Stripe's event feed. The Stripe-Signature header is verified; each event id is handled once."""
    from fastapi import HTTPException
    payload = await request.body()
    if len(payload) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large"})
    return billing.process_webhook(db, payload, request.headers.get("stripe-signature", ""))
