"""Library CSV export follows reading access, independent of the import flag (synthetic)."""
import csv
import io
import uuid

import pytest


@pytest.fixture
def exporter(client, db_session, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    user = models.User(email=f"export-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    other = models.User(email=f"export-other-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    db_session.add_all([user, other])
    db_session.flush()
    db_session.add_all([
        models.UserBook(user_id=user.id, private_title="=Private Unicode 夜", private_author="É Author", is_owned=True),
        models.UserBook(user_id=other.id, private_title="OTHER READER SECRET", is_wanted=True),
    ])
    db_session.commit()
    settings = app_modules["database"].settings
    monkeypatch.setattr(settings, "reading_v3_enabled", True)
    monkeypatch.setattr(settings, "reading_v3_user_ids", "")
    monkeypatch.setattr(settings, "library_import_enabled", False)
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: user
    limiter.reset()
    yield user, settings
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    db_session.rollback()
    limiter.reset()


def test_library_csv_downloads_with_import_disabled_and_is_owner_scoped(client, exporter):
    response = client.get("/me/library/export.csv")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="bookvane-library-v1.csv"'
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert [row["title"] for row in rows] == ["'=Private Unicode 夜"]  # formula-escaped, as the existing exporter does
    assert "OTHER READER SECRET" not in response.text


def test_capability_advertises_export_separately_from_import(client, exporter):
    features = client.get("/me/reading-capabilities").json()["features"]
    assert features["library_export"] is True
    assert features["library_import"] is False
    # The import-scoped route keeps its existing gate.
    assert client.get("/me/library-imports/export.csv").status_code == 403


def test_library_csv_follows_reading_read_access(client, exporter, monkeypatch, app_modules):
    user, settings = exporter
    monkeypatch.setattr(settings, "reading_v3_enabled", False)
    # A reader who already has V3-only data keeps owner-only read access, like /me/reading-export.
    assert client.get("/me/library/export.csv").status_code == 200
    from auth.dependencies import get_current_user
    models = app_modules["models"]
    fresh = models.User(email=f"export-fresh-{uuid.uuid4().hex}@example.com", hashed_password="isolated-fixture")
    from database import SessionLocal
    with SessionLocal() as session:
        session.add(fresh)
        session.commit()
        session.refresh(fresh)
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: fresh
    assert client.get("/me/library/export.csv").status_code == 403
    assert client.get("/me/reading-capabilities").json()["features"]["library_export"] is False


def test_library_csv_requires_authentication(client, exporter, app_modules):
    from auth.dependencies import get_current_user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/me/library/export.csv").status_code == 401
