"""Error monitoring is off unless SENTRY_DSN is set, and what it sends never carries cookies, credentials or bodies."""
from __future__ import annotations

import json

import pytest
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

import observability

DSN = "https://publickey@o0.ingest.example.invalid/1"


@pytest.fixture(autouse=True)
def sentry_off_afterwards():
    yield
    sentry_sdk.get_global_scope().set_client(None)


class Recorder(Transport):
    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        self.events.extend(item.payload.json for item in envelope.items if item.type == "event")


def test_nothing_starts_without_a_dsn(app_modules):
    assert app_modules["database"].settings.sentry_dsn is None
    assert observability.init_sentry(None, "production") is False
    assert observability.init_sentry("", "production") is False
    assert not sentry_sdk.is_initialized()


def test_with_a_dsn_it_starts_with_privacy_preserving_options():
    assert observability.init_sentry(DSN, "staging", transport=Recorder()) is True
    options = sentry_sdk.get_client().options
    assert options["send_default_pii"] is False
    assert options["traces_sample_rate"] == 0.1
    assert options["environment"] == "staging"
    assert options["max_request_body_size"] == "never"
    assert options["include_local_variables"] is False
    assert options["before_send"] is observability.scrub_event
    assert options["before_send_transaction"] is observability.scrub_event


def test_the_environment_defaults_follow_the_deployment(app_modules):
    settings = app_modules["database"].settings
    assert observability.environment_name(settings) == "development"  # tests run with IS_DEV=true


def test_scrubbing_removes_cookies_credentials_bodies_and_query_text():
    event = {
        "request": {
            "url": "https://api.example.com/me/library?q=secret+title#token=abc",
            "query_string": "q=secret+title", "cookies": {"access_token": "jwt-value"}, "data": {"password": "hunter2"},
            "headers": {"Authorization": "Bearer jwt-value", "Cookie": "access_token=jwt-value", "Referer": "https://x/?q=secret",
                        "X-Anything": "private", "User-Agent": "Test/1.0", "Content-Type": "application/json"},
            "env": {"REMOTE_ADDR": "203.0.113.9"},
        },
        "user": {"id": "u1", "email": "reader@example.com", "ip_address": "203.0.113.9"},
        "breadcrumbs": {"values": [{"message": "GET /me/library?q=secret"}]},
        "exception": {"values": [{"type": "ValueError", "value": "boom"}]},
    }
    cleaned = observability.scrub_event(event, {})
    text = json.dumps(cleaned)
    for secret in ("jwt-value", "hunter2", "secret", "abc", "reader@example.com", "203.0.113.9", "private"):
        assert secret not in text
    assert cleaned["request"]["url"] == "https://api.example.com/me/library"
    assert cleaned["request"]["headers"] == {"User-Agent": "Test/1.0", "Content-Type": "application/json"}
    assert cleaned["exception"]["values"][0]["value"] == "boom"  # the error itself is what we need to see


def test_scrubbing_tolerates_events_without_a_request():
    assert observability.scrub_event({"message": "plain"}, {}) == {"message": "plain"}


def test_a_failing_request_is_reported_without_its_cookies_headers_body_or_query():
    # Built from pieces so the secrets never appear as literals in the source lines a stack trace quotes.
    password, note, bearer, cookie, search = ("hunt" + "er2", "my private " + "reading note", "tok" + "en-value", "jwt" + "-value", "secret" + "-title")
    recorder = Recorder()
    assert observability.init_sentry(DSN, "test", transport=recorder) is True
    app = FastAPI()

    @app.post("/boom")
    async def boom(request: Request):
        await request.body()
        raise RuntimeError("something broke")

    client = TestClient(app, raise_server_exceptions=False)
    response = client.post(f"/boom?q={search}", json={"password": password, "note": note},
                           headers={"Authorization": f"Bearer {bearer}"}, cookies={"access_token": cookie})
    assert response.status_code == 500
    sentry_sdk.flush()
    assert recorder.events, "the error should have been reported"
    text = json.dumps(recorder.events)
    assert "something broke" in text
    for secret in (password, note, bearer, cookie, search):
        assert secret not in text
