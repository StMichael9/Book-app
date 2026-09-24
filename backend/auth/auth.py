import secrets
import hashlib
import logging
from urllib.parse import quote

import httpx

from datetime import datetime, timedelta, timezone

from pwdlib import PasswordHash

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)

from pydantic import BaseModel, EmailStr

from sqlalchemy import select, update, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db, settings
from models import User, RefreshToken, PasswordResetToken
from auth.jwt import create_access_token

from rate_limit import limiter


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)

password_hash = PasswordHash.recommended()
logger = logging.getLogger(__name__)
GENERIC_RESET_MESSAGE = {"message": "If that account exists, a reset link will be sent."}


# -------------------------
# COOKIE SETTINGS
# -------------------------

COOKIE_DOMAIN = settings.cookie_domain
COOKIE_SECURE = not settings.is_dev
COOKIE_SAMESITE = settings.cookie_samesite or ("lax" if settings.is_dev else "none")
if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
    raise RuntimeError("SameSite=None cookies require IS_DEV=false and HTTPS")


# -------------------------
# REGISTER
# -------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


def validate_password(password: str) -> None:
    if not 8 <= len(password) <= 128:
        raise HTTPException(status_code=422, detail="Password must be 8 to 128 characters")


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED
)
@limiter.limit("5/minute")
def register(
    request: Request,
    data: RegisterRequest,
    db: Session = Depends(get_db),
):
    validate_password(data.password)
    email = data.email.lower()
    statement = select(User).where(func.lower(User.email) == email)

    user = db.execute(statement).scalars().first()

    if user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already exists",
        )

    hashed_password = password_hash.hash(data.password)

    new_user = User(
        email=email,
        hashed_password=hashed_password,
    )

    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User already exists") from None

    return {
        "message": "User created successfully"
    }


# -------------------------
# LOGIN
# -------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    statement = select(User).where(func.lower(User.email) == data.email.lower())

    user = db.execute(statement).scalars().first()

    if not user or not password_hash.verify(
        data.password,
        user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    payload = {
        "sub": str(user.id),
        "ver": user.token_version,
    }

    access_token = create_access_token(payload)

    # Generate refresh token
    refresh_token = secrets.token_urlsafe(32)

    refresh_token_hash = hashlib.sha256(
        refresh_token.encode()
    ).hexdigest()

    new_refresh_token = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        expires_at=(
            datetime.now(timezone.utc)
            + timedelta(days=7)
        ),
    )

    user.last_login_at = datetime.now(timezone.utc)

    db.add(new_refresh_token)
    db.commit()

    # Access token cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=15 * 60,
    )

    # Refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=7 * 24 * 60 * 60,
    )

    return {
        "message": "Login successful"
    }


# -------------------------
# REFRESH
# -------------------------

@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    refresh_token = request.cookies.get("refresh_token")

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
        )

    refresh_token_hash = hashlib.sha256(
        refresh_token.encode()
    ).hexdigest()

    statement = select(RefreshToken).where(
        RefreshToken.token_hash == refresh_token_hash
    )

    stored_token = (
        db.execute(statement)
        .scalars()
        .first()
    )

    if not stored_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    if stored_token.revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked",
        )

    if stored_token.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired",
        )

    user = stored_token.user

    # Consume the presented token atomically: simultaneous refreshes must not
    # both mint a valid replacement.
    claimed = db.execute(
        update(RefreshToken)
        .where(RefreshToken.id == stored_token.id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
        .returning(RefreshToken.id)
    ).scalar_one_or_none()
    if claimed is None:
        db.rollback()
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    # Create new access token
    payload = {
        "sub": str(user.id),
        "ver": user.token_version,
    }

    access_token = create_access_token(payload)

    # Create new refresh token
    new_refresh_token = secrets.token_urlsafe(32)

    new_refresh_token_hash = hashlib.sha256(
        new_refresh_token.encode()
    ).hexdigest()

    new_stored_refresh_token = RefreshToken(
        user_id=user.id,
        token_hash=new_refresh_token_hash,
        expires_at=(
            datetime.now(timezone.utc)
            + timedelta(days=7)
        ),
    )

    db.add(new_stored_refresh_token)
    db.commit()

    # Replace access token cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=15 * 60,
    )

    # Replace refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=7 * 24 * 60 * 60,
    )

    return {
        "message": "Access token refreshed"
    }


# -------------------------
# LOGOUT
# -------------------------

@router.post("/logout")
@limiter.limit("30/minute")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    refresh_token = request.cookies.get("refresh_token")

    if refresh_token:
        refresh_token_hash = hashlib.sha256(
            refresh_token.encode()
        ).hexdigest()

        statement = select(RefreshToken).where(
            RefreshToken.token_hash == refresh_token_hash
        )

        stored_token = (
            db.execute(statement)
            .scalars()
            .first()
        )

        if stored_token:
            stored_token.revoked = True
            db.commit()

    response.delete_cookie(
        key="access_token",
        domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )

    response.delete_cookie(
        key="refresh_token",
        domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )

    return {
        "message": "Logout successful"
    }


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


def send_password_reset_email(email: str, reset_url: str) -> None:
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.password_reset_from,
            "to": [email],
            "subject": "Reset your Bookvane password",
            "html": (
                "<p>Use this link to reset your Bookvane password. "
                "It expires in 30 minutes.</p>"
                f'<p><a href="{reset_url}">Reset password</a></p>'
                "<p>If you did not request this, you can ignore this email.</p>"
            ),
        },
        timeout=10,
    )
    response.raise_for_status()


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
def forgot_password(
    request: Request,
    data: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    if not all((settings.resend_api_key, settings.password_reset_from, settings.frontend_base_url)):
        raise HTTPException(status_code=503, detail="Password recovery is not configured")

    user = db.execute(
        select(User).where(func.lower(User.email) == data.email.lower())
    ).scalars().first()
    if not user:
        return GENERIC_RESET_MESSAGE

    now = datetime.now(timezone.utc)
    recent = db.execute(
        select(PasswordResetToken.id).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at >= now - timedelta(minutes=10),
        ).limit(1)
    ).first()
    if recent:
        return GENERIC_RESET_MESSAGE

    token = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=now + timedelta(minutes=30),
    ))
    db.commit()

    reset_url = f"{settings.frontend_base_url.rstrip('/')}/reset-password#token={quote(token)}"
    try:
        send_password_reset_email(user.email, reset_url)
    except (httpx.HTTPError, ValueError):
        logger.exception("Password reset email delivery failed")
    return GENERIC_RESET_MESSAGE


@router.post("/reset-password")
@limiter.limit("10/hour")
def reset_password(
    request: Request,
    data: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    validate_password(data.password)
    if not 32 <= len(data.token) <= 256:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    now = datetime.now(timezone.utc)
    token_hash = hashlib.sha256(data.token.encode()).hexdigest()
    consumed = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(PasswordResetToken.user_id)
    ).scalar_one_or_none()
    if consumed is None:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user = db.execute(select(User).where(User.id == consumed).with_for_update()).scalar_one()
    user.hashed_password = password_hash.hash(data.password)
    user.token_version += 1
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked=True))
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    db.commit()
    return {"message": "Password updated. Please sign in again."}
