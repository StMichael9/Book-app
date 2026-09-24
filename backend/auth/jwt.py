import jwt

from datetime import datetime, timedelta, timezone

from database import settings


SECRET_KEY = settings.secret_key
ALGORITHM = "HS256"


def create_access_token(payload: dict) -> str:
    ACCESS_TOKEN_EXPIRE_MINUTES = 15

    expires = (
        datetime.now(timezone.utc)
        + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    payload = payload.copy()
    payload["exp"] = expires

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )
