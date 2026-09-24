import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

AUTH_PATH = "/auth"
PROTECTED_PATH = "/__test__/protected"
TEST_LIMITER = None


def _reset_limiter() -> None:
    """Clear SlowAPI's in-memory state between tests.

    SlowAPI keeps limiter state on the global limiter, so requests from one
    TestClient can affect another test. The storage API differs by version.
    """
    reset = getattr(TEST_LIMITER, "reset", None)
    if callable(reset):
        reset()
        return

    storage = getattr(TEST_LIMITER, "_storage", None)
    reset_storage = getattr(storage, "reset", None)
    if callable(reset_storage):
        reset_storage()
        return

    clear_storage = getattr(storage, "clear", None)
    if callable(clear_storage):
        clear_storage()
        return

    pytest.fail("Installed SlowAPI version exposes no limiter reset API")


@pytest.fixture(autouse=True)
def auth_test_environment(app_modules, db_session: Session):
    """Isolate auth rows, install the protected test route, and reset limits."""
    models = app_modules["models"]
    app = app_modules["main"].app
    from auth.dependencies import get_current_user
    from rate_limit import limiter

    global TEST_LIMITER
    TEST_LIMITER = limiter

    _reset_limiter()
    db_session.execute(delete(models.RefreshToken))
    db_session.execute(delete(models.User))
    db_session.commit()

    router = APIRouter()

    @router.get(PROTECTED_PATH)
    def protected_route(current_user=Depends(get_current_user)):
        return {"email": current_user.email}

    app.include_router(router)
    added_routes = [route for route in app.routes if route.path == PROTECTED_PATH]

    try:
        yield
    finally:
        _reset_limiter()
        db_session.execute(delete(models.RefreshToken))
        db_session.execute(delete(models.User))
        db_session.commit()
        app.router.routes[:] = [
            route for route in app.router.routes if route not in added_routes
        ]


def _new_email() -> str:
    return f"auth-{uuid.uuid4().hex}@example.com"


def _credentials(email: str | None = None) -> dict[str, str]:
    return {
        "email": email or _new_email(),
        "password": "correct horse battery staple",
    }


def _register(client: TestClient, credentials: dict[str, str]):
    return client.post(f"{AUTH_PATH}/register", json=credentials)


def _register_and_login(client: TestClient) -> tuple[dict[str, str], object]:
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    response = client.post(f"{AUTH_PATH}/login", json=credentials)
    assert response.status_code == 200
    return credentials, response


def _refresh_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _set_cookie_headers(response) -> list[str]:
    return response.headers.get_list("set-cookie")


def test_register_new_email_succeeds(client: TestClient):
    response = _register(client, _credentials())

    assert response.status_code == 201
    assert response.json() == {"message": "User created successfully"}


def test_register_duplicate_email_fails_with_conflict(client: TestClient):
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201

    response = _register(client, credentials)

    assert response.status_code == 409
    assert response.json()["detail"] == "User already exists"


def test_login_with_correct_credentials_sets_both_http_only_cookies(
    client: TestClient,
):
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201

    response = client.post(f"{AUTH_PATH}/login", json=credentials)

    assert response.status_code == 200
    assert response.json() == {"message": "Login successful"}
    assert response.cookies.get("access_token")
    assert response.cookies.get("refresh_token")
    cookie_headers = _set_cookie_headers(response)
    assert any("access_token=" in value and "HttpOnly" in value for value in cookie_headers)
    assert any("refresh_token=" in value and "HttpOnly" in value for value in cookie_headers)
    assert all("SameSite=lax" in value for value in cookie_headers)


def test_login_with_wrong_password_fails_with_unauthorized(client: TestClient):
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201

    response = client.post(
        f"{AUTH_PATH}/login",
        json={**credentials, "password": "wrong password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_login_with_nonexistent_email_fails_with_unauthorized(client: TestClient):
    response = client.post(f"{AUTH_PATH}/login", json=_credentials())

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_protected_route_with_valid_access_token_succeeds(client: TestClient):
    credentials, _ = _register_and_login(client)

    response = client.get(PROTECTED_PATH)

    assert response.status_code == 200
    assert response.json() == {"email": credentials["email"]}


def test_protected_route_with_expired_access_token_fails(
    client: TestClient,
    db_session: Session,
    app_modules,
):
    credentials, _ = _register_and_login(client)
    models = app_modules["models"]
    user = db_session.execute(
        select(models.User).where(models.User.email == credentials["email"])
    ).scalars().one()
    expired_token = jwt.encode(
        {
            "sub": str(user.id),
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        app_modules["database"].settings.secret_key,
        algorithm="HS256",
    )

    response = client.get(
        PROTECTED_PATH,
        cookies={"access_token": expired_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Access token expired"


def test_protected_route_with_invalid_signature_fails(
    client: TestClient,
    db_session: Session,
    app_modules,
):
    credentials, _ = _register_and_login(client)
    models = app_modules["models"]
    user = db_session.execute(
        select(models.User).where(models.User.email == credentials["email"])
    ).scalars().one()
    invalid_token = jwt.encode(
        {
            "sub": str(user.id),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        "wrong-secret",
        algorithm="HS256",
    )

    response = client.get(
        PROTECTED_PATH,
        cookies={"access_token": invalid_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid access token"


def test_protected_route_without_access_cookie_fails(client: TestClient):
    response = client.get(PROTECTED_PATH)

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_refresh_rotates_valid_unrevoked_token(client: TestClient, db_session: Session, app_modules):
    _, login_response = _register_and_login(client)
    old_refresh_token = login_response.cookies.get("refresh_token")
    models = app_modules["models"]

    old_row = db_session.execute(
        select(models.RefreshToken).where(
            models.RefreshToken.token_hash == _refresh_hash(old_refresh_token)
        )
    ).scalars().one()
    old_id = old_row.id

    response = client.post(
        f"{AUTH_PATH}/refresh",
        cookies={"refresh_token": old_refresh_token},
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Access token refreshed"}
    assert response.cookies.get("access_token")
    new_refresh_token = response.cookies.get("refresh_token")
    assert new_refresh_token and new_refresh_token != old_refresh_token
    db_session.expire_all()
    refreshed_old_row = db_session.get(models.RefreshToken, old_id)
    new_row = db_session.execute(
        select(models.RefreshToken).where(
            models.RefreshToken.token_hash == _refresh_hash(new_refresh_token)
        )
    ).scalars().one()
    assert refreshed_old_row.revoked is True
    assert new_row.revoked is False


def test_refresh_with_revoked_token_fails(client: TestClient):
    _, login_response = _register_and_login(client)
    old_refresh_token = login_response.cookies.get("refresh_token")
    assert client.post(
        f"{AUTH_PATH}/refresh",
        cookies={"refresh_token": old_refresh_token},
    ).status_code == 200

    response = client.post(
        f"{AUTH_PATH}/refresh",
        cookies={"refresh_token": old_refresh_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Refresh token has been revoked"


def test_refresh_with_expired_token_fails(client: TestClient, db_session: Session, app_modules):
    _, login_response = _register_and_login(client)
    refresh_token = login_response.cookies.get("refresh_token")
    models = app_modules["models"]
    stored_token = db_session.execute(
        select(models.RefreshToken).where(
            models.RefreshToken.token_hash == _refresh_hash(refresh_token)
        )
    ).scalars().one()
    stored_token.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    response = client.post(
        f"{AUTH_PATH}/refresh",
        cookies={"refresh_token": refresh_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Refresh token has expired"


def test_logout_revokes_refresh_token_and_clears_both_cookies(
    client: TestClient,
    db_session: Session,
    app_modules,
):
    _, login_response = _register_and_login(client)
    refresh_token = login_response.cookies.get("refresh_token")
    models = app_modules["models"]

    response = client.post(f"{AUTH_PATH}/logout")

    assert response.status_code == 200
    assert response.json() == {"message": "Logout successful"}
    db_session.expire_all()
    stored_token = db_session.execute(
        select(models.RefreshToken).where(
            models.RefreshToken.token_hash == _refresh_hash(refresh_token)
        )
    ).scalars().one()
    assert stored_token.revoked is True
    cookie_headers = _set_cookie_headers(response)
    assert any("access_token=" in value and "Max-Age=0" in value for value in cookie_headers)
    assert any("refresh_token=" in value and "Max-Age=0" in value for value in cookie_headers)

    refresh_response = client.post(
        f"{AUTH_PATH}/refresh",
        cookies={"refresh_token": refresh_token},
    )
    assert refresh_response.status_code == 401


def test_sixth_login_request_within_a_minute_is_rate_limited(client: TestClient):
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201

    responses = [
        client.post(
            f"{AUTH_PATH}/login",
            json={**credentials, "password": "wrong password"},
        )
        for _ in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [401] * 5
    assert responses[5].status_code == 429


# The global SlowAPI limiter is reset by auth_test_environment before and after
# each test. If a different SlowAPI version is installed, update _reset_limiter
# to call that version's documented storage reset method rather than disabling
# the limiter, especially for the sixth-login assertion above.
