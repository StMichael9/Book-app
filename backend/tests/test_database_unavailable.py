from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError


@pytest.fixture
def broken_database(app_modules):
    main = app_modules["main"]

    def unreachable():
        raise OperationalError("SELECT 1", {}, Exception("exceeded the compute time quota"))
        yield  # pragma: no cover

    main.app.dependency_overrides[main.get_db] = unreachable
    yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.pop(main.get_db, None)


def test_database_outage_returns_plain_503(broken_database):
    response = broken_database.get("/health", headers={"Origin": "https://bookvane.me"})
    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "service_unavailable", "message": "Bookvane is temporarily unavailable."}}
    assert response.headers["retry-after"] == "30"
    assert "quota" not in response.text
