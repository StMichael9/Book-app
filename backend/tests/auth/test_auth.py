import hashlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import APIRouter, Depends, Request
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text, event
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

    previous_routes = list(app.router.routes)
    app.include_router(router)

    try:
        yield
    finally:
        _reset_limiter()
        db_session.execute(delete(models.RefreshToken))
        db_session.execute(delete(models.User))
        db_session.commit()
        app.router.routes[:] = previous_routes


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


def test_registration_email_exceeding_schema_limit_returns_422(client):
    # Valid email syntax, but too long for the existing users.email VARCHAR(100).
    response = _register(client, _credentials(f"{'a' * 50}@{'b' * 50}.com"))
    assert response.status_code == 422


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
    assert any("access_token=" in value and "Max-Age=900" in value for value in cookie_headers)
    assert any("refresh_token=" in value and "Max-Age=604800" in value for value in cookie_headers)


def test_production_cookie_flags_and_write_origin(client: TestClient, monkeypatch):
    from database import settings
    from auth import auth as auth_routes

    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    monkeypatch.setattr(settings, "is_dev", False)
    monkeypatch.setenv("CORS_ORIGINS", "https://bookvane.example")
    monkeypatch.setattr(auth_routes, "COOKIE_SECURE", True)
    monkeypatch.setattr(auth_routes, "COOKIE_SAMESITE", "none")

    blocked = client.post(f"{AUTH_PATH}/login", json=credentials)
    assert blocked.status_code == 403
    allowed = client.post(
        f"{AUTH_PATH}/login", json=credentials,
        headers={"Origin": "https://bookvane.example"},
    )
    assert allowed.status_code == 200
    cookie_headers = _set_cookie_headers(allowed)
    assert all("Secure" in value and "SameSite=none" in value for value in cookie_headers)


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


def test_malformed_signed_subject_returns_401(client: TestClient, app_modules):
    from database import settings

    token = jwt.encode({"sub": "not-a-uuid", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, settings.secret_key, algorithm="HS256")
    response = client.get(PROTECTED_PATH, cookies={"access_token": token})
    assert response.status_code == 401


def test_password_reset_is_single_use_and_invalidates_sessions(
    client: TestClient, db_session: Session, app_modules, monkeypatch
):
    from database import settings
    from auth import auth as auth_routes

    credentials, login_response = _register_and_login(client)
    access_token = login_response.cookies.get("access_token")
    refresh_token = login_response.cookies.get("refresh_token")
    sent = []
    monkeypatch.setattr(settings, "resend_api_key", "test-key")
    monkeypatch.setattr(settings, "password_reset_from", "Bookvane <reset@shelfbound.dev>")
    monkeypatch.setattr(settings, "frontend_base_url", "https://shelfbound.dev")
    monkeypatch.setattr(auth_routes, "send_password_reset_email", lambda email, url: sent.append((email, url)))

    unknown = client.post(f"{AUTH_PATH}/forgot-password", json={"email": "missing@example.com"})
    known = client.post(f"{AUTH_PATH}/forgot-password", json={"email": credentials["email"]})
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert len(sent) == 1
    token = parse_qs(urlparse(sent[0][1]).fragment)["token"][0]

    reset = client.post(f"{AUTH_PATH}/reset-password", json={"token": token, "password": "new safe password"})
    assert reset.status_code == 200
    assert all("Max-Age=0" in value and "HttpOnly" in value for value in _set_cookie_headers(reset))
    assert "access_token" not in client.cookies
    assert "refresh_token" not in client.cookies
    assert client.post(f"{AUTH_PATH}/reset-password", json={"token": token, "password": "another password"}).status_code == 400
    assert client.get(PROTECTED_PATH, cookies={"access_token": access_token}).status_code == 401
    assert client.post(f"{AUTH_PATH}/refresh", cookies={"refresh_token": refresh_token}).status_code == 401
    assert client.post(f"{AUTH_PATH}/login", json=credentials).status_code == 401
    assert client.post(f"{AUTH_PATH}/login", json={**credentials, "password": "new safe password"}).status_code == 200


def test_expired_password_reset_token_is_rejected(client: TestClient, db_session: Session, app_modules):
    models = app_modules["models"]
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    user = db_session.execute(select(models.User).where(models.User.email == credentials["email"])).scalar_one()
    token = "expired-" + uuid.uuid4().hex
    db_session.add(models.PasswordResetToken(
        user_id=user.id,
        token_hash=_refresh_hash(token),
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    ))
    db_session.commit()

    response = client.post(f"{AUTH_PATH}/reset-password", json={"token": token, "password": "replacement password"})
    assert response.status_code == 400
    assert client.post(f"{AUTH_PATH}/login", json=credentials).status_code == 200


def test_simultaneous_password_reset_consumes_token_once(client: TestClient, db_session: Session, app_modules):
    models = app_modules["models"]
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    user = db_session.execute(select(models.User).where(models.User.email == credentials["email"])).scalar_one()
    token = "simultaneous-" + uuid.uuid4().hex
    db_session.add(models.PasswordResetToken(
        user_id=user.id,
        token_hash=_refresh_hash(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    ))
    db_session.commit()

    app = app_modules["main"].app
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()

    def submit():
        with TestClient(app) as other_client:
            return other_client.post(f"{AUTH_PATH}/reset-password", json={"token": token, "password": "replacement password"}).status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: submit(), range(2)))
    finally:
        app.dependency_overrides.update(overrides)
    assert sorted(statuses) == [200, 400]
    db_session.expire_all()
    assert client.post(f"{AUTH_PATH}/login", json={**credentials, "password": "replacement password"}).status_code == 200


def test_user_books_and_preferences_stay_with_the_owner(client: TestClient, seeded_books, db_session: Session):
    from models import Tag

    book_id = seeded_books["Dracula"].id
    tag_id = db_session.execute(select(Tag.id)).scalars().first()
    first = _credentials()
    second = _credentials()
    assert _register(client, first).status_code == 201
    assert _register(client, second).status_code == 201

    assert client.post(f"{AUTH_PATH}/login", json=first).status_code == 200
    assert client.post(f"/books/{book_id}/status", json={"status": "want"}).status_code == 200
    assert client.post("/me/preferences", json={"tag_ids": [tag_id]}).status_code == 200
    assert len(client.get("/me/books").json()) == 1

    assert client.post(f"{AUTH_PATH}/login", json=second).status_code == 200
    assert client.get("/me/books").json() == []
    assert client.get("/me/preferences").json() == []
    assert client.delete(f"/books/{book_id}/status").status_code == 404
    assert client.post(f"/books/{book_id}/status", json={"status": "owned"}).status_code == 200

    assert client.post(f"{AUTH_PATH}/login", json=first).status_code == 200
    assert client.get("/me/books").json()[0]["status"] == "want"
    assert len(client.get("/me/preferences").json()) == 1


def test_concurrent_status_creation_does_not_duplicate_or_error(
    client: TestClient, seeded_books, db_session: Session, app_modules
):
    models = app_modules["models"]
    book_id = seeded_books["Dracula"].id
    _, login_response = _register_and_login(client)
    access_token = login_response.cookies.get("access_token")
    app = app_modules["main"].app
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()

    def submit():
        with TestClient(app) as other_client:
            other_client.cookies.set("access_token", access_token)
            return other_client.post(f"/books/{book_id}/status", json={"status": "want"}).status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: submit(), range(2)))
    finally:
        app.dependency_overrides.update(overrides)
    assert statuses == [200, 200]
    db_session.expire_all()
    assert len(client.get("/me/books").json()) == 1
    user_book_rows = db_session.execute(
        select(models.UserBook).where(models.UserBook.book_id == book_id)
    ).scalars().all()
    assert len(user_book_rows) == 1


@pytest.fixture
def independent_auth_request(client, app_modules):
    """Real HTTP requests with separate, bounded PostgreSQL transactions."""
    database = app_modules["database"]
    app = app_modules["main"].app
    previous = dict(app.dependency_overrides)

    def get_test_db(request: Request):
        with database.SessionLocal() as session:
            session.connection().info["auth_test_action"] = request.url.path
            session.execute(text("SET LOCAL lock_timeout = '5s'"))
            session.execute(text("SET LOCAL statement_timeout = '10s'"))
            yield session

    app.dependency_overrides[database.get_db] = get_test_db

    def submit(path, *, payload=None, cookies=None):
        with TestClient(app) as other:
            if cookies:
                other.cookies.update(cookies)
            return other.post(path if path.startswith("/") else f"{AUTH_PATH}/{path}", json=payload)

    try:
        yield submit
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def _seed_reset_tokens(db_session, models, email, count=1):
    user = db_session.execute(select(models.User).where(models.User.email == email)).scalar_one()
    tokens = ["race-reset-" + uuid.uuid4().hex for _ in range(count)]
    for token in tokens:
        db_session.add(models.PasswordResetToken(
            user_id=user.id, token_hash=_refresh_hash(token),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        ))
    db_session.commit()
    return tokens


def test_concurrent_preference_replacements_do_not_merge_two_submissions(
    client, db_session, app_modules, independent_auth_request,
):
    """Two initial saves must leave one complete submission, not their union."""
    credentials, login_response = _register_and_login(client)
    models = app_modules["models"]
    tag_ids = list(db_session.execute(select(models.Tag.id).limit(2)).scalars())
    user = db_session.execute(select(models.User).where(models.User.email == credentials["email"])).scalar_one()
    assert not db_session.execute(select(models.UserPreference).where(models.UserPreference.user_id == user.id)).first()
    db_session.commit()
    first_deleted, second_started, release = Event(), Event(), Event()

    def pause_first_delete(connection, _cursor, statement, _parameters, _context, _executemany):
        if (connection.info.get("auth_test_action") == "/me/preferences"
                and statement.lstrip().startswith("DELETE FROM user_preferences")):
            if not first_deleted.is_set():
                first_deleted.set()
                assert release.wait(10), "Timed out releasing first preference save"

    engine = app_modules["database"].engine
    event.listen(engine, "after_cursor_execute", pause_first_delete)
    cookies = {"access_token": login_response.cookies.get("access_token")}

    def second_save():
        second_started.set()
        return independent_auth_request("/me/preferences", payload={"tag_ids": [tag_ids[1]], "source_text": "second"}, cookies=cookies)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(independent_auth_request, "/me/preferences", payload={"tag_ids": [tag_ids[0]], "source_text": "first"}, cookies=cookies)
            try:
                assert first_deleted.wait(10)
                second = executor.submit(second_save)
                assert second_started.wait(10)
                # Old code completes the second delete/insert while the first
                # is paused. Fixed code blocks on the owning User row.
                try:
                    second.result(timeout=0.3)
                except TimeoutError:
                    pass
            finally:
                release.set()
            assert first.result(timeout=10).status_code == 200
            assert second.result(timeout=10).status_code == 200
    finally:
        event.remove(engine, "after_cursor_execute", pause_first_delete)
        release.set()
    rows = db_session.execute(select(models.UserPreference).where(models.UserPreference.user_id == user.id)).scalars().all()
    assert [(row.tag_id, row.source_text) for row in rows] == [(tag_ids[1], "second")]


def test_reset_during_password_verification_rejects_stale_login(
    client, db_session, app_modules, independent_auth_request, monkeypatch
):
    from auth import auth as routes

    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    token = _seed_reset_tokens(db_session, app_modules["models"], credentials["email"])[0]
    verified, release = Event(), Event()
    original_verify = routes.password_hash.verify

    def delayed_verify(password, hashed):
        result = original_verify(password, hashed)
        if password == credentials["password"] and result:
            verified.set()
            assert release.wait(10), "Reset did not finish while login was paused"
        return result

    monkeypatch.setattr(routes.password_hash, "verify", delayed_verify)
    with ThreadPoolExecutor(max_workers=1) as executor:
        login_future = executor.submit(independent_auth_request, "login", payload=credentials)
        try:
            assert verified.wait(10)
            reset = independent_auth_request("reset-password", payload={
                "token": token, "password": "replacement password",
            })
            assert reset.status_code == 200
        finally:
            release.set()
        stale = login_future.result(timeout=10)
    assert stale.status_code == 401
    assert not stale.headers.get_list("set-cookie")
    assert independent_auth_request("login", payload={
        **credentials, "password": "replacement password",
    }).status_code == 200


def test_refresh_overlapping_reset_has_no_deadlock_and_replacement_is_revoked(
    client, db_session, app_modules, independent_auth_request
):
    credentials, login_response = _register_and_login(client)
    old_access = login_response.cookies.get("access_token")
    old_refresh = login_response.cookies.get("refresh_token")
    token = _seed_reset_tokens(db_session, app_modules["models"], credentials["email"])[0]
    engine = app_modules["database"].engine
    claimed, reset_waiting, release = Event(), Event(), Event()

    def after_query(connection, cursor, statement, parameters, context, executemany):
        if (connection.info.get("auth_test_action") == "/auth/refresh"
                and statement.lstrip().startswith("UPDATE refresh_tokens")):
            claimed.set()
            assert release.wait(10), "Reset did not reach its user lock"

    def before_query(connection, cursor, statement, parameters, context, executemany):
        if (connection.info.get("auth_test_action") == "/auth/reset-password"
                and "FROM users" in statement and "FOR UPDATE" in statement):
            reset_waiting.set()

    event.listen(engine, "after_cursor_execute", after_query)
    event.listen(engine, "before_cursor_execute", before_query)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            refresh_future = executor.submit(independent_auth_request, "refresh", cookies={
                "refresh_token": old_refresh,
            })
            try:
                assert claimed.wait(10)
                reset_future = executor.submit(independent_auth_request, "reset-password", payload={
                    "token": token, "password": "replacement password",
                })
                assert reset_waiting.wait(10)
            finally:
                release.set()
            refreshed = refresh_future.result(timeout=10)
            reset = reset_future.result(timeout=10)
        assert refreshed.status_code == reset.status_code == 200
    finally:
        release.set()
        event.remove(engine, "after_cursor_execute", after_query)
        event.remove(engine, "before_cursor_execute", before_query)

    for access in (old_access, refreshed.cookies.get("access_token")):
        assert client.get(PROTECTED_PATH, cookies={"access_token": access}).status_code == 401
    assert independent_auth_request("refresh", cookies={
        "refresh_token": refreshed.cookies.get("refresh_token"),
    }).status_code == 401


def test_reset_before_waiting_refresh_rechecks_revocation(
    client, db_session, app_modules, independent_auth_request
):
    credentials, login_response = _register_and_login(client)
    token = _seed_reset_tokens(db_session, app_modules["models"], credentials["email"])[0]
    engine = app_modules["database"].engine
    locked, refresh_waiting, release = Event(), Event(), Event()

    def after_query(connection, cursor, statement, parameters, context, executemany):
        if (connection.info.get("auth_test_action") == "/auth/reset-password"
                and "FROM users" in statement and "FOR UPDATE" in statement):
            locked.set()
            assert release.wait(10), "Refresh did not reach its user lock"

    def before_query(connection, cursor, statement, parameters, context, executemany):
        if (connection.info.get("auth_test_action") == "/auth/refresh"
                and "FROM users" in statement and "FOR UPDATE" in statement):
            refresh_waiting.set()

    event.listen(engine, "after_cursor_execute", after_query)
    event.listen(engine, "before_cursor_execute", before_query)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            reset_future = executor.submit(independent_auth_request, "reset-password", payload={
                "token": token, "password": "replacement password",
            })
            try:
                assert locked.wait(10)
                refresh_future = executor.submit(independent_auth_request, "refresh", cookies={
                    "refresh_token": login_response.cookies.get("refresh_token"),
                })
                assert refresh_waiting.wait(10)
            finally:
                release.set()
            assert reset_future.result(timeout=10).status_code == 200
            assert refresh_future.result(timeout=10).status_code == 401
    finally:
        release.set()
        event.remove(engine, "after_cursor_execute", after_query)
        event.remove(engine, "before_cursor_execute", before_query)


def test_simultaneous_different_reset_links_do_not_deadlock(
    client, db_session, app_modules, independent_auth_request
):
    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    tokens = _seed_reset_tokens(db_session, app_modules["models"], credentials["email"], count=2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda token: independent_auth_request(
            "reset-password", payload={"token": token, "password": "replacement password"},
        ), tokens))
    assert sorted(response.status_code for response in responses) == [200, 400]
    db_session.expire_all()
    user = db_session.execute(select(app_modules["models"].User).where(
        app_modules["models"].User.email == credentials["email"],
    )).scalar_one()
    assert user.token_version == 1


def test_concurrent_refresh_only_issues_one_replacement(
    client, db_session, app_modules, independent_auth_request
):
    _, login_response = _register_and_login(client)
    token = login_response.cookies.get("refresh_token")
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: independent_auth_request(
            "refresh", cookies={"refresh_token": token},
        ), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 401]
    db_session.expire_all()
    active = db_session.execute(select(app_modules["models"].RefreshToken).where(
        app_modules["models"].RefreshToken.revoked.is_(False),
    )).scalars().all()
    assert len(active) == 1


def test_concurrent_forgot_password_sends_one_link_per_cooldown(
    client, db_session, app_modules, independent_auth_request, monkeypatch
):
    from auth import auth as routes
    from database import settings

    credentials = _credentials()
    assert _register(client, credentials).status_code == 201
    sent = []
    monkeypatch.setattr(settings, "resend_api_key", "test-key")
    monkeypatch.setattr(settings, "password_reset_from", "Bookvane <reset@shelfbound.dev>")
    monkeypatch.setattr(settings, "frontend_base_url", "https://shelfbound.dev")
    monkeypatch.setattr(routes, "send_password_reset_email", lambda email, url: sent.append(url))
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: independent_auth_request(
            "forgot-password", payload={"email": credentials["email"]},
        ), range(2)))
    assert [response.status_code for response in responses] == [202, 202]
    assert responses[0].json() == responses[1].json() == routes.GENERIC_RESET_MESSAGE
    assert len(sent) == 1
    tokens = db_session.execute(select(app_modules["models"].PasswordResetToken)).scalars().all()
    assert len(tokens) == 1
