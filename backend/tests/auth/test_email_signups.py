from sqlalchemy import select, delete


def test_product_updates_require_explicit_consent(client, db_session, app_modules):
    signup = app_modules["models"].EmailSignup
    email = "updates-test@example.com"
    db_session.execute(delete(signup).where(signup.email == email))
    db_session.commit()

    refused = client.post("/email-signups", json={"email": email, "consent": False})
    assert refused.status_code == 422
    assert db_session.execute(select(signup).where(signup.email == email)).scalar_one_or_none() is None

    first = client.post("/email-signups", json={"email": "UPDATES-TEST@example.com", "consent": True})
    second = client.post("/email-signups", json={"email": email, "consent": True})
    assert first.status_code == second.status_code == 202
    rows = db_session.execute(select(signup).where(signup.email == email)).scalars().all()
    assert len(rows) == 1
    assert rows[0].source == "landing"
    db_session.execute(delete(signup).where(signup.email == email))
    db_session.commit()
