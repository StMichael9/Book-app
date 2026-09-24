import secrets
import hashlib

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

from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db, settings
from models import User, RefreshToken
from auth.jwt import create_access_token

from rate_limit import limiter


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)

password_hash = PasswordHash.recommended()


# -------------------------
# COOKIE SETTINGS
# -------------------------

COOKIE_DOMAIN = settings.cookie_domain
COOKIE_SECURE = not settings.is_dev


# -------------------------
# REGISTER
# -------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


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
    statement = select(User).where(User.email == data.email)

    user = db.execute(statement).scalars().first()

    if user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already exists",
        )

    hashed_password = password_hash.hash(data.password)

    new_user = User(
        email=data.email,
        hashed_password=hashed_password,
    )

    db.add(new_user)
    db.commit()

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
    statement = select(User).where(User.email == data.email)

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
        "sub": str(user.id)
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
        samesite="lax",
        domain=COOKIE_DOMAIN,
        max_age=15 * 60,
    )

    # Refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
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

    # Revoke old refresh token
    stored_token.revoked = True

    # Create new access token
    payload = {
        "sub": str(user.id)
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
        samesite="lax",
        domain=COOKIE_DOMAIN,
        max_age=15 * 60,
    )

    # Replace refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
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
    )

    response.delete_cookie(
        key="refresh_token",
        domain=COOKIE_DOMAIN,
    )

    return {
        "message": "Logout successful"
    }