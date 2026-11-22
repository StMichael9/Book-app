"""T77A: Stripe billing foundation. Mocked Stripe calls and webhook payloads signed exactly as Stripe signs them (verified by the SDK)."""
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete, event, select, text

WEBHOOK_SECRET = "whsec_test_fixture_secret"
PRICES = {"STRIPE_PRICE_PATRON_MONTH": "price_pm", "STRIPE_PRICE_PATRON_YEAR": "price_py",
          "STRIPE_PRICE_CLUBPLUS_MONTH": "price_cm", "STRIPE_PRICE_CLUBPLUS_YEAR": "price_cy"}
AMOUNTS = {"price_pm": ("month", 500), "price_py": ("year", 5000), "price_cm": ("month", 1000), "price_cy": ("year", 10000)}
NOW = datetime.now(timezone.utc)


class FakeStripe:
    """Stands in for the Stripe API; the signature check still uses the real SDK."""

    def __init__(self):
        self.calls, self.subscriptions, self.fail_retrieve = [], {}, False

    def create_customer(self, *, email, user_id):
        self.calls.append(("customer", email, user_id))
        return f"cus_{user_id[:8]}"

    def create_checkout_session(self, **kwargs):
        self.calls.append(("checkout", kwargs))
        return "https://checkout.stripe.test/session"

    def create_portal_session(self, *, customer, return_url):
        self.calls.append(("portal", customer, return_url))
        return "https://billing.stripe.test/portal"

    def retrieve_subscription(self, subscription_id):
        if self.fail_retrieve:
            raise RuntimeError("stripe is down")
        return self.subscriptions[subscription_id]

    def construct_event(self, payload, signature):
        from services.billing import StripeGateway
        return StripeGateway().construct_event(payload, signature)


@pytest.fixture()
def billing(client, db_session, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    from services import billing as service, event_counts
    models, settings = app_modules["models"], app_modules["database"].settings
    limiter.reset()
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("sk_test_fixture"))
    monkeypatch.setattr(settings, "stripe_webhook_secret", SecretStr(WEBHOOK_SECRET))
    monkeypatch.setattr(settings, "frontend_base_url", "https://bookvane.me")
    for env, price in PRICES.items():
        monkeypatch.setattr(settings, env.lower(), price)
    fake = FakeStripe()
    monkeypatch.setattr(service, "gateway", fake)
    for table in ("entitlements", "billing_events", "billing_customers", "event_counts"):
        db_session.execute(text(f"DELETE FROM {table}"))
    db_session.commit()
    event_counts.window.reset()

    class B:
        pass

    b = B()
    b.client, b.db, b.models, b.settings, b.fake, b.service = client, db_session, models, settings, fake, service
    b.users = []

    def user(prefix="pay"):
        item = models.User(email=f"{prefix}-{uuid.uuid4().hex[:8]}@billing-fixture.org", hashed_password="x")
        db_session.add(item)
        db_session.commit()
        b.users.append(item.id)
        return item

    def sign_in(item):
        app_modules["main"].app.dependency_overrides[get_current_user] = lambda: item

    b.user, b.sign_in = user, sign_in
    if db_session.scalar(text("SELECT to_regclass('clubs')")) is not None:        # clubs exist: the club ids these tests use must be real
        holder = user("clubholder")
        for club_id in (1, 2, 7):
            db_session.execute(text("INSERT INTO clubs (id, name, owner_id) VALUES (:i, 'Billing fixture', :u)"), {"i": club_id, "u": holder.id})
        db_session.commit()
    yield b
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()
    db_session.rollback()
    for table in ("entitlements", "billing_events", "billing_customers", "event_counts"):
        db_session.execute(text(f"DELETE FROM {table}"))
    if db_session.scalar(text("SELECT to_regclass('clubs')")) is not None:
        db_session.execute(text("DELETE FROM clubs WHERE id IN (1, 2, 7) AND name = 'Billing fixture'"))
    db_session.execute(delete(models.User).where(models.User.id.in_(b.users)))
    db_session.commit()


def signed(payload: dict, *, secret=WEBHOOK_SECRET, when=None):
    body = json.dumps(payload, separators=(",", ":")).encode()
    stamp = int(when or time.time())
    mac = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"Stripe-Signature": f"t={stamp},v1={mac}", "Content-Type": "application/json"}


def subscription(sub_id, user, *, product="patron", price="price_pm", status="active", club_id=None, cancel=False, period_end=None, customer=None):
    interval, amount = AMOUNTS[price]
    meta = {"user_id": str(user.id), "product": product, **({"club_id": str(club_id)} if club_id else {})}
    return {"id": sub_id, "object": "subscription", "customer": customer or f"cus_{str(user.id)[:8]}", "status": status, "metadata": meta,
            "cancel_at_period_end": cancel, "current_period_end": int((period_end or NOW + timedelta(days=30)).timestamp()),
            "items": {"data": [{"price": {"id": price, "unit_amount": amount, "currency": "usd", "recurring": {"interval": interval}}}]}}


_counter = [0]


def stripe_event(kind, obj, *, created=None, event_id=None):
    _counter[0] += 1
    return {"id": event_id or f"evt_{uuid.uuid4().hex[:12]}", "object": "event", "type": kind, "created": int(created or time.time()) + _counter[0],
            "data": {"object": obj}}


def send(b, payload, **kwargs):
    body, headers = signed(payload, **kwargs)
    return b.client.post("/billing/webhook", content=body, headers=headers)


def entitlement_of(b, sub_id):
    b.db.expire_all()
    return b.db.execute(select(b.models.Entitlement).where(b.models.Entitlement.stripe_subscription_id == sub_id)).scalar_one_or_none()


def counted(b):
    b.db.expire_all()
    return {name: int(n) for name, n in b.db.execute(text("SELECT name, sum(count) FROM event_counts GROUP BY name"))}


def is_patron(b, user):
    from services import entitlements
    b.db.expire_all()
    return entitlements.is_patron(b.db, user)


# --- settings ----------------------------------------------------------------------------------------------------------------

def test_a_live_stripe_key_is_refused_unless_live_mode_is_switched_on(app_modules):
    from database import Settings
    base = dict(DATABASE_URL="postgresql://u:p@localhost/x", SECRET_KEY="x" * 40, IS_DEV=True, _env_file=None)
    assert Settings(STRIPE_SECRET_KEY="sk_test_abc", **base).stripe_secret_key.get_secret_value() == "sk_test_abc"
    assert Settings(STRIPE_SECRET_KEY="rk_test_abc", **base)
    for live in ("sk_live_abc", "rk_live_abc", "whatever"):
        with pytest.raises(ValidationError):
            Settings(STRIPE_SECRET_KEY=live, **base)
    assert Settings(STRIPE_SECRET_KEY="sk_live_abc", STRIPE_ALLOW_LIVE="true", **base)
    assert Settings(**base).stripe_secret_key is None                                           # unset: billing is simply off
    assert "sk_test_abc" not in repr(Settings(STRIPE_SECRET_KEY="sk_test_abc", **base))        # a SecretStr, never printed


# --- checkout and portal -----------------------------------------------------------------------------------------------------

def test_billing_is_off_when_stripe_is_not_configured(billing):
    billing.settings.stripe_secret_key = None
    billing.sign_in(billing.user())
    assert billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "month"}).status_code == 503
    assert billing.client.get("/me/billing").json() == {"enabled": False, "patron": False, "entitlements": []}
    assert billing.client.post("/billing/webhook", content=b"{}").status_code == 503


def test_patron_checkout_uses_the_right_price_creates_one_customer_and_counts_it(billing):
    person = billing.user()
    billing.sign_in(person)
    first = billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "year"})
    assert first.status_code == 200 and first.json() == {"url": "https://checkout.stripe.test/session"}
    billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "month"})
    sessions = [call[1] for call in billing.fake.calls if call[0] == "checkout"]
    assert sessions[0]["line_items"] == [{"price": "price_py", "quantity": 1}] and sessions[1]["line_items"][0]["price"] == "price_pm"
    assert sessions[0]["metadata"] == {"user_id": str(person.id), "product": "patron"} and sessions[0]["subscription_data"]["metadata"] == sessions[0]["metadata"]
    assert sessions[0]["client_reference_id"] == str(person.id) and sessions[0]["success_url"].startswith("https://bookvane.me/")
    assert len([call for call in billing.fake.calls if call[0] == "customer"]) == 1                 # the customer is created once and reused
    assert counted(billing)["checkout_started"] == 2


def test_checkout_refuses_bad_requests_and_an_existing_patron(billing):
    person = billing.user()
    billing.sign_in(person)
    for bad in ({"product": "gold", "interval": "month"}, {"product": "patron", "interval": "week"}, {"product": "patron", "interval": "month", "extra": 1},
                {"product": "patron", "interval": "month", "club_id": 3}, {"product": "club_plus", "interval": "month"}):
        assert billing.client.post("/me/billing/checkout", json=bad).status_code == 422, bad
    billing.settings.stripe_price_patron_month = None
    assert billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "month"}).status_code == 503
    billing.settings.stripe_price_patron_month = "price_pm"
    billing.db.add(billing.models.Entitlement(user_id=person.id, kind="patron", stripe_subscription_id="sub_have", status="active"))
    billing.db.commit()
    again = billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "month"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_subscribed"


def test_club_plus_can_only_be_bought_by_the_clubs_owner_and_once(billing, monkeypatch):
    owner, other = billing.user("owner"), billing.user("other")
    monkeypatch.setattr(billing.service, "_owns_club", lambda db, user_id, club_id: club_id == 7 and user_id == owner.id)
    billing.sign_in(other)
    assert billing.client.post("/me/billing/checkout", json={"product": "club_plus", "interval": "month", "club_id": 7}).status_code == 404
    billing.sign_in(owner)
    assert billing.client.post("/me/billing/checkout", json={"product": "club_plus", "interval": "month", "club_id": 8}).status_code == 404
    ok = billing.client.post("/me/billing/checkout", json={"product": "club_plus", "interval": "year", "club_id": 7})
    assert ok.status_code == 200
    session = [call[1] for call in billing.fake.calls if call[0] == "checkout"][-1]
    assert session["line_items"][0]["price"] == "price_cy" and session["metadata"] == {"user_id": str(owner.id), "product": "club_plus", "club_id": "7"}
    billing.db.add(billing.models.Entitlement(user_id=owner.id, kind="club_plus", club_id=7, stripe_subscription_id="sub_plus", status="active"))
    billing.db.commit()
    assert billing.client.post("/me/billing/checkout", json={"product": "club_plus", "interval": "month", "club_id": 7}).status_code == 409


def test_without_a_clubs_table_nobody_owns_a_club(billing):
    if billing.db.scalar(text("SELECT to_regclass('clubs')")) is not None:
        pytest.skip("the clubs table exists: ownership is checked against it")
    assert billing.service._owns_club(billing.db, uuid.uuid4(), 1) is False


def test_the_portal_needs_a_customer_and_returns_the_stripe_address(billing):
    person = billing.user()
    billing.sign_in(person)
    assert billing.client.post("/me/billing/portal").status_code == 409
    billing.client.post("/me/billing/checkout", json={"product": "patron", "interval": "month"})
    portal = billing.client.post("/me/billing/portal")
    assert portal.status_code == 200 and portal.json() == {"url": "https://billing.stripe.test/portal"}
    assert [call for call in billing.fake.calls if call[0] == "portal"][0][2] == "https://bookvane.me/settings/billing"


def test_the_billing_summary_shows_status_without_any_stripe_ids(billing):
    person = billing.user()
    billing.sign_in(person)
    billing.db.add(billing.models.Entitlement(user_id=person.id, kind="patron", stripe_subscription_id="sub_secret_id", status="active",
                                              interval="month", current_period_end=NOW + timedelta(days=9), cancel_at_period_end=True))
    billing.db.add(billing.models.BillingCustomer(user_id=person.id, stripe_customer_id="cus_secret_id"))
    billing.db.commit()
    response = billing.client.get("/me/billing")
    body = response.json()
    assert body["enabled"] is True and body["patron"] is True and len(body["entitlements"]) == 1
    row = body["entitlements"][0]
    assert (row["kind"], row["status"], row["active"], row["in_grace"], row["cancel_at_period_end"], row["interval"]) == ("patron", "active", True, False, True, "month")
    assert "sub_secret_id" not in response.text and "cus_secret_id" not in response.text
    assert {c.name for c in billing.models.BillingCustomer.__table__.columns} == {"user_id", "stripe_customer_id", "created_at"}   # no card data


# --- the webhook: signature, idempotency, lifecycle ----------------------------------------------------------------------------

def test_a_bad_signature_is_refused_and_nothing_is_recorded(billing):
    person = billing.user()
    payload = stripe_event("customer.subscription.created", subscription("sub_x", person))
    body, headers = signed(payload)
    assert billing.client.post("/billing/webhook", content=body, headers={"Content-Type": "application/json"}).status_code == 400          # no header
    assert billing.client.post("/billing/webhook", content=body, headers={**headers, "Stripe-Signature": "t=1,v1=bad"}).status_code == 400
    assert billing.client.post("/billing/webhook", content=body + b" ", headers=headers).status_code == 400                                  # tampered body
    wrong = signed(payload, secret="whsec_other")
    assert billing.client.post("/billing/webhook", content=wrong[0], headers=wrong[1]).status_code == 400
    stale = signed(payload, when=time.time() - 3600)
    assert billing.client.post("/billing/webhook", content=stale[0], headers=stale[1]).status_code == 400                                    # replayed an hour late
    assert billing.db.scalar(text("SELECT count(*) FROM billing_events")) == 0 and entitlement_of(billing, "sub_x") is None
    assert send(billing, payload).status_code == 200


def test_a_replayed_event_changes_nothing_and_counts_once(billing):
    person = billing.user()
    payload = stripe_event("customer.subscription.created", subscription("sub_once", person), event_id="evt_same")
    assert send(billing, payload).json() == {"status": "ok"}
    assert send(billing, payload).json() == {"status": "duplicate"}
    assert send(billing, payload).json() == {"status": "duplicate"}
    assert billing.db.scalar(text("SELECT count(*) FROM entitlements")) == 1 and billing.db.scalar(text("SELECT count(*) FROM billing_events")) == 1
    assert counted(billing) == {"patron_started": 1}


def test_the_whole_patron_lifecycle(billing):
    person = billing.user()
    sub_id = "sub_life"
    assert not is_patron(billing, person)
    # 1. checkout completes: the subscription is fetched from Stripe, whatever order the events arrive in
    billing.fake.subscriptions[sub_id] = subscription(sub_id, person)
    done = stripe_event("checkout.session.completed", {"mode": "subscription", "customer": f"cus_{str(person.id)[:8]}", "subscription": sub_id,
                                                       "client_reference_id": str(person.id), "metadata": {"user_id": str(person.id), "product": "patron"}})
    assert send(billing, done).status_code == 200
    row = entitlement_of(billing, sub_id)
    assert (row.kind, row.status, row.club_id, row.interval, row.unit_amount, row.currency) == ("patron", "active", None, "month", 500, "usd")
    assert billing.db.get(billing.models.BillingCustomer, person.id).stripe_customer_id.startswith("cus_") and is_patron(billing, person)
    assert counted(billing) == {"patron_started": 1}
    # the subscription's own "created" event (arriving after) changes nothing and does not count again
    assert send(billing, stripe_event("customer.subscription.created", subscription(sub_id, person))).status_code == 200
    assert counted(billing) == {"patron_started": 1}
    # 2. renewal moves the period end
    later = NOW + timedelta(days=60)
    send(billing, stripe_event("customer.subscription.updated", subscription(sub_id, person, period_end=later)))
    assert abs((entitlement_of(billing, sub_id).current_period_end - later).total_seconds()) < 2
    # 3. a failed payment starts the 7-day grace: still a Patron
    send(billing, stripe_event("invoice.payment_failed", {"subscription": sub_id}))
    row = entitlement_of(billing, sub_id)
    assert row.status == "past_due" and row.payment_failed_at is not None and is_patron(billing, person)
    # the grace runs out after 7 days
    billing.db.execute(text("UPDATE entitlements SET payment_failed_at = now() - interval '8 days' WHERE stripe_subscription_id = :s"), {"s": sub_id})
    billing.db.commit()
    assert not is_patron(billing, person)
    billing.db.execute(text("UPDATE entitlements SET payment_failed_at = now() - interval '6 days' WHERE stripe_subscription_id = :s"), {"s": sub_id})
    billing.db.commit()
    assert is_patron(billing, person)                                                           # day 6: still inside the grace
    # 4. the card is fixed: Stripe says active again and the grace marker clears
    send(billing, stripe_event("customer.subscription.updated", subscription(sub_id, person, status="active")))
    row = entitlement_of(billing, sub_id)
    assert row.status == "active" and row.payment_failed_at is None
    # 5. cancel at period end: still a Patron until Stripe deletes it
    send(billing, stripe_event("customer.subscription.updated", subscription(sub_id, person, cancel=True)))
    assert entitlement_of(billing, sub_id).cancel_at_period_end is True and is_patron(billing, person)
    assert "subscription_canceled" not in counted(billing)
    # 6. the subscription ends
    send(billing, stripe_event("customer.subscription.deleted", subscription(sub_id, person, status="canceled")))
    assert entitlement_of(billing, sub_id).status == "canceled" and not is_patron(billing, person)
    assert counted(billing)["subscription_canceled"] == 1
    # 7. resubscribing is a new subscription and a new start
    send(billing, stripe_event("customer.subscription.created", subscription("sub_again", person, price="price_py")))
    assert is_patron(billing, person) and counted(billing)["patron_started"] == 2 and entitlement_of(billing, "sub_again").interval == "year"


def test_a_failed_payment_before_any_subscription_event_is_harmless_and_a_late_old_event_is_ignored(billing):
    person = billing.user()
    assert send(billing, stripe_event("invoice.payment_failed", {"subscription": "sub_nope"})).status_code == 200
    newer = stripe_event("customer.subscription.updated", subscription("sub_ord", person, status="active"), created=time.time() + 100)
    older = stripe_event("customer.subscription.updated", subscription("sub_ord", person, status="past_due"), created=time.time() - 100)
    send(billing, newer)
    send(billing, older)
    assert entitlement_of(billing, "sub_ord").status == "active"                                 # the stale event did not override the newer state
    gone = stripe_event("customer.subscription.deleted", subscription("sub_ord", person), created=time.time() + 200)
    send(billing, gone)
    late_active = stripe_event("customer.subscription.updated", subscription("sub_ord", person, status="active"), created=time.time() + 150)
    send(billing, late_active)
    assert entitlement_of(billing, "sub_ord").status == "canceled"                                # a delete is not undone by an older update


def test_club_plus_belongs_to_the_club_not_the_payer_and_patron_is_separate(billing):
    from services import entitlements
    owner = billing.user("owner")
    send(billing, stripe_event("customer.subscription.created", subscription("sub_club", owner, product="club_plus", price="price_cm", club_id=7)))
    row = entitlement_of(billing, "sub_club")
    assert (row.kind, row.club_id) == ("club_plus", 7) and counted(billing) == {"club_plus_started": 1}
    billing.db.expire_all()
    assert entitlements.club_plus(billing.db, 7) and not entitlements.club_plus(billing.db, 8) and not entitlements.is_patron(billing.db, owner)
    assert entitlements.club_plus_ids(billing.db, [7, 8, 9]) == {7}
    billing.db.execute(text("UPDATE entitlements SET status = 'past_due', payment_failed_at = now() - interval '9 days'"))
    billing.db.commit()
    billing.db.expire_all()
    assert not entitlements.club_plus(billing.db, 7)                                             # lapsed: only the extras stop, nothing is deleted
    assert billing.db.scalar(text("SELECT count(*) FROM entitlements WHERE club_id = 7")) == 1


def test_a_club_plus_subscription_for_a_club_that_does_not_exist_is_ignored_not_retried_forever(billing):
    owner = billing.user("owner")
    assert send(billing, stripe_event("customer.subscription.created", subscription("sub_ghostclub", owner, product="club_plus", price="price_cm", club_id=424242))).status_code == 200
    assert billing.db.scalar(text("SELECT count(*) FROM entitlements")) == (0 if billing.db.scalar(text("SELECT to_regclass('clubs')")) is not None else 1)


def test_unknown_readers_products_and_events_are_acknowledged_and_ignored(billing):
    ghost = billing.models.User(id=uuid.uuid4(), email="ghost@billing-fixture.org", hashed_password="x")
    assert send(billing, stripe_event("customer.subscription.created", subscription("sub_ghost", ghost))).status_code == 200
    assert send(billing, stripe_event("charge.refunded", {"id": "ch_1"})).status_code == 200
    person = billing.user()
    odd = subscription("sub_odd", person, product="gold")
    assert send(billing, stripe_event("customer.subscription.created", odd)).status_code == 200
    incomplete = subscription("sub_inc", person, status="incomplete")
    assert send(billing, stripe_event("customer.subscription.created", incomplete)).status_code == 200
    assert billing.db.scalar(text("SELECT count(*) FROM entitlements")) == 0


def test_a_failure_while_handling_gives_stripe_a_retry_and_forgets_the_event_id(billing):
    person = billing.user()
    sub_id = "sub_retry"
    billing.fake.subscriptions[sub_id] = subscription(sub_id, person)
    billing.fake.fail_retrieve = True
    done = stripe_event("checkout.session.completed", {"mode": "subscription", "customer": "cus_x", "subscription": sub_id,
                                                       "metadata": {"user_id": str(person.id), "product": "patron"}}, event_id="evt_retry")
    assert send(billing, done).status_code == 500                                                # a 500 makes Stripe retry
    billing.db.rollback()
    assert billing.db.scalar(text("SELECT count(*) FROM billing_events WHERE id = 'evt_retry'")) == 0
    billing.fake.fail_retrieve = False
    assert send(billing, done).json() == {"status": "ok"} and is_patron(billing, person)


def test_a_database_error_is_a_500_and_leaves_no_event_id(billing, monkeypatch):
    person = billing.user()
    payload = stripe_event("customer.subscription.created", subscription("sub_dberr", person), event_id="evt_dberr")
    original = billing.service.handle_event

    def broken(db, event, counts):
        db.execute(text("INSERT INTO entitlements (user_id, kind, stripe_subscription_id, status) VALUES (:u, 'nope', 'x', 'active')"), {"u": person.id})

    monkeypatch.setattr(billing.service, "handle_event", broken)
    assert send(billing, payload).status_code == 500
    monkeypatch.setattr(billing.service, "handle_event", original)
    assert billing.db.scalar(text("SELECT count(*) FROM billing_events WHERE id = 'evt_dberr'")) == 0
    assert send(billing, payload).json() == {"status": "ok"}


# --- entitlements and metrics -----------------------------------------------------------------------------------------------------

def test_patron_ids_answers_for_many_readers_in_one_statement(billing, app_modules):
    from services import entitlements
    engine = app_modules["database"].engine
    people = [billing.user() for _ in range(6)]
    ids = [person.id for person in people]
    for person in people[:3]:
        billing.db.add(billing.models.Entitlement(user_id=person.id, kind="patron", stripe_subscription_id=f"sub_{person.id.hex}", status="active"))
    billing.db.commit()
    seen = []
    listener = lambda conn, cursor, statement, *a: seen.append(statement)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        found = entitlements.patron_ids(billing.db, ids)
        found_more = entitlements.patron_ids(billing.db, ids * 3)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert found == set(ids[:3]) == found_more and len(seen) == 2
    assert entitlements.patron_ids(billing.db, []) == set()


def test_admin_metrics_report_active_subscriptions_and_mrr(billing, monkeypatch):
    boss = billing.user("boss")
    monkeypatch.setattr(billing.settings, "admin_emails", boss.email)
    billing.sign_in(boss)
    people = [billing.user() for _ in range(5)]
    rows = [("patron", None, "active", "month", 500, False), ("patron", None, "trialing", "year", 5000, True), ("club_plus", 1, "active", "month", 1000, False),
            ("club_plus", 2, "active", "year", 10000, False), ("patron", None, "past_due", "month", 500, False)]
    for index, (person, (kind, club, status, interval, amount, cancel)) in enumerate(zip(people, rows)):
        billing.db.add(billing.models.Entitlement(user_id=person.id, kind=kind, club_id=club, stripe_subscription_id=f"sub_m{index}", status=status,
                                                  interval=interval, unit_amount=amount, currency="usd", cancel_at_period_end=cancel))
    billing.db.add(billing.models.Entitlement(user_id=people[0].id, kind="patron", stripe_subscription_id="sub_gone", status="canceled", interval="month", unit_amount=500, currency="usd"))
    billing.db.commit()
    report = billing.client.get("/admin/metrics").json()["billing"]
    assert report["active_subscriptions"] == {"patron": 2, "club_plus": 2} and report["past_due"] == 1 and report["cancelling"] == 1
    assert report["mrr_minor_units"] == {"usd": 500 + round(5000 / 12) + 1000 + round(10000 / 12)}


def test_the_billing_events_are_not_accepted_from_the_browser(billing):
    for name in ("checkout_started", "patron_started", "club_plus_started", "subscription_canceled"):
        assert billing.client.post("/events", json={"name": name}).status_code == 204
    assert counted(billing) == {}
