"""Welcome emails (T73 G4): at most three plain emails to a new reader, with a one-click opt-out.

Day 0, day 3 and day 10 after sign-up, one call to action each, no countdowns, no rewards. A run sends at most one email to an
account and at most MAX_PER_RUN in total. Accounts that switched `email_tips` off, accounts older than 30 days, and any email
that is more than LATE_DAYS overdue (a long pause in the schedule) are skipped without sending.

The wording below is the growth lead's edited copy, approved by Michael (.local-dev/growth/landing-review.md, "Welcome emails").

Mail goes through the existing Resend sender settings (`RESEND_API_KEY`, `PASSWORD_RESET_FROM`). Tests replace `send_email`.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import uuid
from email.utils import formataddr, parseaddr
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from database import settings
from models import User

STEP_DAYS = (0, 3, 10)
MAX_PER_RUN = 200
ACCOUNT_MAX_AGE_DAYS = 30
LATE_DAYS = 5
MAX_CONSECUTIVE_FAILURES = 3

# (subject, line, call-to-action label, path on the site). Approved copy; every path is /my-books.
COPY = (
    ("Your Bookvane shelf", "Thanks for joining. The quickest way to fill your shelf: open Bookvane on your phone, tap Scan books, "
     "and point the camera at the barcode on the back of each book. Have a Goodreads or StoryGraph export instead? You can upload "
     "that. Everything you add is private.", "Open My Books", "/my-books"),
    ("What are you reading right now?", "If you’re partway through a book, add it with the page you’re on. A note is optional, "
     "and only you can see it.", "Add a book", "/my-books"),
    ("A short list of books", "A list is a few books you want to remember or pass on. It stays private unless you choose to "
     "share it.", "Make a list", "/my-books"),
)
REPLY_LINE = "Reply if something isn’t working."      # day 0 only: replies reach the support inbox
SENDER_NAME = "Michael at Bookvane"
REPLY_TO = "support@bookvane.me"


class NotConfigured(Exception):
    pass


# --- unsubscribe token ---------------------------------------------------------------------------------------------

def _signature(user_id: uuid.UUID) -> str:
    key = settings.secret_key.encode("utf-8")
    return hmac.new(key, f"email-tips-unsubscribe:{user_id}".encode("utf-8"), hashlib.sha256).hexdigest()[:40]


def unsubscribe_token(user_id: uuid.UUID) -> str:
    return f"{user_id.hex}.{_signature(user_id)}"


def read_unsubscribe_token(token: str) -> uuid.UUID | None:
    """The account a valid token belongs to, else None. A token never expires: it can only switch tips off."""
    try:
        raw, signature = token.split(".", 1)
        user_id = uuid.UUID(hex=raw)
    except (ValueError, AttributeError):
        return None
    return user_id if hmac.compare_digest(signature, _signature(user_id)) else None


def unsubscribe_url(user_id: uuid.UUID) -> str:
    return f"{settings.public_api_base_url.rstrip('/')}/email/unsubscribe?t={unsubscribe_token(user_id)}"


# --- the message ---------------------------------------------------------------------------------------------------

def build_email(step: int, user_id: uuid.UUID) -> dict:
    """The Resend payload parts for welcome email `step` (1 to 3): subject, text, html and the unsubscribe headers."""
    subject, line, label, path = COPY[step - 1]
    if step == 1:
        line = f"{line} {REPLY_LINE}"
    link = f"{(settings.frontend_base_url or 'https://bookvane.me').rstrip('/')}{path}"
    opt_out = unsubscribe_url(user_id)
    plain = f"{line}\n\n{label}: {link}\n\nYou get these tips because you joined Bookvane. Stop them with one click: {opt_out}\n"
    page = (f"<p>{html.escape(line)}</p><p><a href=\"{html.escape(link, quote=True)}\">{html.escape(label)}</a></p>"
            f"<p style=\"color:#666;font-size:13px\">You get these tips because you joined Bookvane. "
            f"<a href=\"{html.escape(opt_out, quote=True)}\">Stop them with one click</a>.</p>")
    return {"subject": subject, "text": plain, "html": page,
            "headers": {"List-Unsubscribe": f"<{opt_out}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}}


def sender() -> str:
    """"Michael at Bookvane" on the address (and so the domain) of the existing password-reset sender."""
    return formataddr((SENDER_NAME, parseaddr(settings.password_reset_from or "")[1]))


def send_email(to: str, parts: dict) -> None:
    """One message through Resend, as the password-reset email is sent. Raises on failure."""
    if not all((settings.resend_api_key, settings.password_reset_from, settings.frontend_base_url)):
        raise NotConfigured("Email is not configured")
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": sender(), "reply_to": REPLY_TO, "to": [to], **parts},
        timeout=10,
    )
    response.raise_for_status()


# --- who is due -----------------------------------------------------------------------------------------------------

DUE_SQL = text("""
    SELECT id, email, welcome_step, created_at,
           created_at + make_interval(days => (ARRAY[0, 3, 10])[welcome_step + 1]) AS due_at
    FROM users
    WHERE email_tips AND welcome_step < 3
      AND created_at >= :oldest
      AND created_at + make_interval(days => (ARRAY[0, 3, 10])[welcome_step + 1]) <= :now
    ORDER BY created_at, id
    LIMIT :limit
""")


def due_accounts(db: Session, now: datetime, limit: int = MAX_PER_RUN):
    return db.execute(DUE_SQL, {"now": now, "oldest": now - timedelta(days=ACCOUNT_MAX_AGE_DAYS), "limit": limit}).all()


def send_due(db: Session, *, now: datetime | None = None, send=send_email, limit: int = MAX_PER_RUN) -> dict:
    """Send the next welcome email to each due account (one each, at most `limit`). Two statements however many are due, plus
    one mail call per account. A failed send leaves the account's step alone, so the next run tries again."""
    now = now or datetime.now(timezone.utc)
    limit = min(limit, MAX_PER_RUN)
    rows = due_accounts(db, now, limit)
    sent, late, failed, streak = [], [], 0, 0
    for row in rows:
        if now - row.due_at > timedelta(days=LATE_DAYS):
            late.append(row.id)                        # a long pause in the schedule: pass this email by rather than send it late
            continue
        try:
            send(row.email, build_email(row.welcome_step + 1, row.id))
            sent.append(row.id)
            streak = 0
        except Exception:  # noqa: BLE001 - one bad address or a mail outage must not stop the run's bookkeeping
            failed += 1
            streak += 1
            if streak >= MAX_CONSECUTIVE_FAILURES:
                break                                    # the sender is down: stop instead of hammering it
    for ids in (sent, late):
        if ids:
            db.execute(update(User).where(User.id.in_(ids)).values(welcome_step=User.welcome_step + 1))
    db.commit()
    return {"due": len(rows), "sent": len(sent), "skipped_late": len(late), "failed": failed,
            "capped": len(rows) >= limit}
