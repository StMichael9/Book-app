"""Stripe Checkout, the billing portal and the webhook (T77A). Test mode until Michael switches it (see `Settings`).

Bookvane never sees card data: Checkout and the portal are Stripe's pages. All Stripe calls go through `gateway`, so tests replace it;
the webhook signature is verified by the Stripe SDK itself (`construct_event`). Counters are daily totals only.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import settings
from models import BillingCustomer, BillingEvent, Entitlement, User
from services import entitlements
from services.event_counts import record_event

log = logging.getLogger("bookvane.billing")

PRODUCTS = ("patron", "club_plus")
INTERVALS = ("month", "year")
STATUS = {"active": "active", "trialing": "trialing", "past_due": "past_due", "unpaid": "past_due",
          "canceled": "canceled", "incomplete_expired": "canceled", "paused": "canceled"}       # 'incomplete' is not entitled yet


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})


class StripeGateway:
    """The only code that talks to Stripe. Imported lazily so the app starts without the SDK being used."""

    def _key(self) -> str:
        return settings.stripe_secret_key.get_secret_value()

    def create_customer(self, *, email: str, user_id: str) -> str:
        import stripe
        return stripe.Customer.create(email=email, metadata={"user_id": user_id}, api_key=self._key())["id"]

    def create_checkout_session(self, **kwargs) -> str:
        import stripe
        return stripe.checkout.Session.create(mode="subscription", api_key=self._key(), **kwargs)["url"]

    def create_portal_session(self, *, customer: str, return_url: str) -> str:
        import stripe
        return stripe.billing_portal.Session.create(customer=customer, return_url=return_url, api_key=self._key())["url"]

    def retrieve_subscription(self, subscription_id: str) -> dict:
        import stripe
        return json.loads(str(stripe.Subscription.retrieve(subscription_id, api_key=self._key())))

    def construct_event(self, payload: bytes, signature: str) -> dict:
        """Verify the Stripe-Signature header (HMAC and a 5-minute tolerance) and return the event as a plain dict."""
        import stripe
        stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret.get_secret_value())
        return json.loads(payload)


gateway = StripeGateway()


def configured() -> bool:
    return bool(settings.stripe_secret_key and settings.stripe_webhook_secret)


def price_for(product: str, interval: str) -> str | None:
    return {("patron", "month"): settings.stripe_price_patron_month, ("patron", "year"): settings.stripe_price_patron_year,
            ("club_plus", "month"): settings.stripe_price_clubplus_month, ("club_plus", "year"): settings.stripe_price_clubplus_year}[(product, interval)]


def _product_by_price(price_id: str | None) -> str | None:
    for product in PRODUCTS:
        for interval in INTERVALS:
            if price_id and price_for(product, interval) == price_id:
                return product
    return None


def _count(db: Session, name: str) -> None:
    try:
        record_event(db, name)
    except SQLAlchemyError:
        db.rollback()


def _site() -> str:
    return (settings.frontend_base_url or "https://bookvane.me").rstrip("/")


def _owns_club(db: Session, user_id, club_id: int) -> bool:
    """Only a club's owner may buy Club Plus for it. Answers False until the clubs table exists."""
    if db.scalar(text("SELECT to_regclass('clubs')")) is None:
        return False
    return db.scalar(text("SELECT 1 FROM clubs WHERE id = :c AND owner_id = :u"), {"c": club_id, "u": user_id}) is not None


# --- reader endpoints -------------------------------------------------------------------------------------------------

def _customer(db: Session, user: User) -> str:
    row = db.get(BillingCustomer, user.id)
    if row is not None:
        return row.stripe_customer_id
    created = gateway.create_customer(email=user.email, user_id=str(user.id))
    db.execute(insert(BillingCustomer).values(user_id=user.id, stripe_customer_id=created).on_conflict_do_nothing(index_elements=["user_id"]))
    db.commit()
    return db.get(BillingCustomer, user.id).stripe_customer_id


def checkout(db: Session, user: User, product: str, interval: str, club_id: int | None) -> dict:
    if not configured():
        raise fail(503, "billing_not_configured")
    price = price_for(product, interval)
    if not price:
        raise fail(503, "price_not_configured")
    if product == "patron":
        if club_id is not None:
            raise fail(422, "club_id_not_allowed")
        if entitlements.is_patron(db, user):
            raise fail(409, "already_subscribed")
    else:
        if club_id is None:
            raise fail(422, "club_id_required")
        if not _owns_club(db, user.id, club_id):
            raise HTTPException(404, detail="Club not found")
        if entitlements.club_plus(db, club_id):
            raise fail(409, "already_subscribed")
    customer = _customer(db, user)
    meta = {"user_id": str(user.id), "product": product, **({"club_id": str(club_id)} if club_id is not None else {})}
    url = gateway.create_checkout_session(customer=customer, line_items=[{"price": price, "quantity": 1}], client_reference_id=str(user.id),
                                          metadata=meta, subscription_data={"metadata": meta}, allow_promotion_codes=True,
                                          success_url=f"{_site()}/settings/billing?checkout=success", cancel_url=f"{_site()}/settings/billing?checkout=cancelled")
    _count(db, "checkout_started")
    return {"url": url}


def portal(db: Session, user: User) -> dict:
    if not configured():
        raise fail(503, "billing_not_configured")
    row = db.get(BillingCustomer, user.id)
    if row is None:
        raise fail(409, "no_customer")
    return {"url": gateway.create_portal_session(customer=row.stripe_customer_id, return_url=f"{_site()}/settings/billing")}


def summary(db: Session, user: User) -> dict:
    now = datetime.now(timezone.utc)
    rows = db.scalars(select(Entitlement).where(Entitlement.user_id == user.id).order_by(Entitlement.id)).all()
    items = [{"kind": row.kind, "club_id": row.club_id, "status": row.status, "active": entitlements.is_live(row, now),
              "in_grace": entitlements.in_grace(row, now), "current_period_end": row.current_period_end.isoformat() if row.current_period_end else None,
              "cancel_at_period_end": row.cancel_at_period_end, "interval": row.interval} for row in rows]
    return {"enabled": configured(), "patron": any(item["kind"] == "patron" and item["active"] for item in items), "entitlements": items}


# --- the webhook -------------------------------------------------------------------------------------------------------

def _seconds(value) -> datetime | None:
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def apply_subscription(db: Session, sub: dict, created: int, counts: list[str], *, session_meta: dict | None = None) -> None:
    """Create or update the entitlement for a Stripe subscription object. Older events than the last applied one are ignored."""
    status = STATUS.get(sub.get("status"))
    if status is None:
        return
    meta = {**(session_meta or {}), **(sub.get("metadata") or {})}
    items = (sub.get("items") or {}).get("data") or [{}]
    item = items[0]
    price = item.get("price") or {}
    product = meta.get("product") or _product_by_price(price.get("id"))
    user_id = meta.get("user_id")
    if user_id is None and sub.get("customer"):
        user_id = db.scalar(select(BillingCustomer.user_id).where(BillingCustomer.stripe_customer_id == sub["customer"]))
    if product not in PRODUCTS or not user_id or db.get(User, user_id) is None:
        log.warning("Subscription %s has no known reader or product; ignored", sub.get("id"))
        return
    club_id = int(meta["club_id"]) if product == "club_plus" and str(meta.get("club_id", "")).isdigit() else None
    if product == "club_plus" and club_id is None:
        return
    recurring = price.get("recurring") or {}
    existing = db.scalar(select(Entitlement).where(Entitlement.stripe_subscription_id == sub["id"]).with_for_update())
    if existing is not None and existing.stripe_event_created > created:
        return
    period_end = _seconds(sub.get("current_period_end") or item.get("current_period_end"))
    values = dict(status=status, current_period_end=period_end, cancel_at_period_end=bool(sub.get("cancel_at_period_end")),
                  interval=recurring.get("interval") if recurring.get("interval") in INTERVALS else None, unit_amount=price.get("unit_amount"),
                  currency=(price.get("currency") or "")[:3] or None, stripe_event_created=created)
    now = datetime.now(timezone.utc)
    if existing is None:
        db.add(Entitlement(user_id=user_id, kind=product, club_id=club_id, stripe_subscription_id=sub["id"],
                           payment_failed_at=now if status == "past_due" else None, **values))
        if status in ("active", "trialing"):
            counts.append("patron_started" if product == "patron" else "club_plus_started")
    else:
        previous = existing.status
        for key, value in values.items():
            setattr(existing, key, value)
        if status == "past_due":
            existing.payment_failed_at = existing.payment_failed_at or now
        else:
            existing.payment_failed_at = None
        if status == "canceled" and previous != "canceled":
            counts.append("subscription_canceled")
        if status in ("active", "trialing") and previous == "canceled":
            counts.append("patron_started" if product == "patron" else "club_plus_started")      # the same subscription came back


def _invoice_subscription(invoice: dict) -> str | None:
    found = invoice.get("subscription") or ((invoice.get("parent") or {}).get("subscription_details") or {}).get("subscription")
    return found if isinstance(found, str) else (found or {}).get("id")


def handle_event(db: Session, event: dict, counts: list[str]) -> None:
    kind, obj, created = event.get("type"), (event.get("data") or {}).get("object") or {}, int(event.get("created") or 0)
    if kind == "checkout.session.completed":
        if obj.get("mode") != "subscription" or not obj.get("subscription"):
            return
        meta = obj.get("metadata") or {}
        user_id = meta.get("user_id") or obj.get("client_reference_id")
        if user_id and obj.get("customer") and db.get(User, user_id) is not None:
            db.execute(insert(BillingCustomer).values(user_id=user_id, stripe_customer_id=obj["customer"]).on_conflict_do_nothing(index_elements=["user_id"]))
        # The subscription's own events may arrive before or after this one; asking Stripe for it makes the order not matter.
        apply_subscription(db, gateway.retrieve_subscription(obj["subscription"]), created, counts, session_meta=meta)
    elif kind in ("customer.subscription.created", "customer.subscription.updated"):
        apply_subscription(db, obj, created, counts)
    elif kind == "customer.subscription.deleted":
        apply_subscription(db, {**obj, "status": "canceled"}, created, counts)
    elif kind == "invoice.payment_failed":
        subscription_id = _invoice_subscription(obj)
        row = db.scalar(select(Entitlement).where(Entitlement.stripe_subscription_id == subscription_id).with_for_update()) if subscription_id else None
        if row is not None and row.stripe_event_created <= created and row.status != "canceled":
            row.status, row.stripe_event_created = "past_due", created
            row.payment_failed_at = row.payment_failed_at or datetime.now(timezone.utc)


def process_webhook(db: Session, payload: bytes, signature: str) -> dict:
    """Verify, record the event id once, apply it, count it. A replay is acknowledged and changes nothing; a failure rolls the
    event id back out so Stripe's retry is handled afresh."""
    if not configured():
        raise fail(503, "billing_not_configured")
    try:
        event = gateway.construct_event(payload, signature or "")
    except Exception:  # noqa: BLE001 - a bad signature, a bad body or a stale timestamp are all the same refusal
        raise fail(400, "invalid_signature") from None
    event_id, kind = event.get("id"), event.get("type")
    if not isinstance(event_id, str) or not isinstance(kind, str):
        raise fail(400, "invalid_event")
    counts: list[str] = []
    try:
        first = db.execute(insert(BillingEvent).values(id=event_id, type=kind).on_conflict_do_nothing(index_elements=["id"]).returning(BillingEvent.id)).scalar()
        if first is None:
            db.rollback()
            return {"status": "duplicate"}
        handle_event(db, event, counts)
        db.commit()
    except Exception:  # noqa: BLE001 - whatever went wrong, the event id is rolled back out and Stripe retries
        db.rollback()
        log.exception("Stripe event %s (%s) could not be handled", event_id, kind)
        raise fail(500, "webhook_failed") from None
    for name in counts:
        _count(db, name)
    return {"status": "ok"}


# --- metrics -------------------------------------------------------------------------------------------------------------

def billing_block(db: Session) -> dict:
    """Active subscriptions and MRR for /admin/metrics, from the entitlements table in one statement."""
    monthly = case((Entitlement.interval == "month", Entitlement.unit_amount), (Entitlement.interval == "year", Entitlement.unit_amount / 12.0), else_=0)
    rows = db.execute(select(Entitlement.kind, Entitlement.status, Entitlement.cancel_at_period_end, func.coalesce(Entitlement.currency, "usd"),
                             func.count(), func.coalesce(func.sum(monthly), 0))
                      .where(Entitlement.status.in_(("active", "trialing", "past_due")))
                      .group_by(Entitlement.kind, Entitlement.status, Entitlement.cancel_at_period_end, func.coalesce(Entitlement.currency, "usd"))).all()
    active = {"patron": 0, "club_plus": 0}
    mrr: dict[str, int] = {}
    past_due = cancelling = 0
    for kind, status, cancel, currency, count, amount in rows:
        if status == "past_due":
            past_due += count
            continue
        active[kind] += count
        cancelling += count if cancel else 0
        mrr[currency] = mrr.get(currency, 0) + int(round(float(amount)))
    return {"active_subscriptions": active, "past_due": past_due, "cancelling": cancelling, "mrr_minor_units": mrr}
