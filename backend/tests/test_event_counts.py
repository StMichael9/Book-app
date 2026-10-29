from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, func, select


@pytest.fixture()
def counters(client, db_session, app_modules):
    models = app_modules["models"]
    from services import event_counts
    db_session.execute(delete(models.EventCount))
    db_session.commit()
    event_counts.window.reset()
    yield models, event_counts
    event_counts.window.reset()
    db_session.execute(delete(models.EventCount))
    db_session.commit()


def rows(db_session, models):
    db_session.expire_all()
    return db_session.execute(select(models.EventCount.name, models.EventCount.src, models.EventCount.placement,
                                     models.EventCount.count)).all()


def test_only_allowlisted_events_are_counted_and_everything_else_is_a_quiet_204(client, db_session, counters):
    models, _ = counters
    ok = [{"name": "register_started", "src": "landing"}, {"name": "get_copy_click", "placement": "book_page"},
          {"name": "share_visit", "src": "share"}, {"name": "guest_search_empty", "src": "noresults"},
          {"name": "save_prompt_shown", "src": "saveprompt"}, {"name": "share_click"}]
    for body in ok:
        assert client.post("/events", json=body).status_code == 204
    assert len(rows(db_session, models)) == len(ok)
    bad = [{"name": "register_completed"}, {"name": "nope"}, {"name": "share_click", "src": "elsewhere"},
           {"name": "share_click", "placement": "footer"}, {"name": 5}, [], "text", {"src": "landing"}]
    for body in bad:
        assert client.post("/events", json=body).status_code == 204
    assert client.post("/events", content=b"not json").status_code == 204
    assert client.post("/events", content=b"").status_code == 204
    assert client.post("/events", content=b'{"name":"share_click","pad":"' + b"x" * 2000 + b'"}').status_code == 204
    assert len(rows(db_session, models)) == len(ok)  # none of the invalid ones wrote anything


def test_repeated_events_upsert_a_single_row_per_day_name_source_and_placement(client, db_session, counters):
    models, _ = counters
    for _ in range(3):
        client.post("/events", json={"name": "get_copy_click", "placement": "book_page"})
    client.post("/events", json={"name": "get_copy_click", "placement": "want_card"})
    client.post("/events", json={"name": "get_copy_click", "placement": None, "src": None})
    assert sorted(rows(db_session, models)) == [("get_copy_click", "", "", 1), ("get_copy_click", "", "book_page", 3),
                                                ("get_copy_click", "", "want_card", 1)]


def test_the_table_holds_no_personal_columns(db_session, counters):
    models, _ = counters
    assert {column.name for column in models.EventCount.__table__.columns} == {"day", "name", "src", "placement", "count"}


def test_a_text_plain_beacon_is_accepted_and_no_cookie_is_read(client, db_session, counters):
    models, _ = counters
    response = client.post("/events", content='{"name":"share_click","src":"share"}',
                           headers={"Content-Type": "text/plain;charset=UTF-8", "Cookie": "access_token=garbage"})
    assert response.status_code == 204 and response.content == b""
    assert rows(db_session, models) == [("share_click", "share", "", 1)]


def test_events_beyond_the_per_minute_cap_are_dropped_without_an_error(client, db_session, counters, monkeypatch):
    models, event_counts = counters
    monkeypatch.setattr(event_counts.window, "limit", 2)
    for _ in range(5):
        assert client.post("/events", json={"name": "share_click"}).status_code == 204
    assert rows(db_session, models) == [("share_click", "", "", 2)]


def test_register_completed_is_counted_server_side_by_a_validated_src(client, db_session, counters):
    models, _ = counters
    for n, query in enumerate(["?src=import", "?src=import", "?src=bogus", "", "?src=landing"]):
        response = client.post(f"/auth/register{query}", json={"email": f"counter{n}@example.com",
                                                                 "password": "long enough password"})
        assert response.status_code == 201
    assert sorted(rows(db_session, models)) == [("register_completed", "", "", 2), ("register_completed", "import", "", 2),
                                                ("register_completed", "landing", "", 1)]
    db_session.execute(delete(models.User).where(models.User.email.like("counter%@example.com")))
    db_session.commit()


@pytest.fixture()
def signed_in(client, db_session, app_modules, counters):
    from auth.dependencies import get_current_user
    models, _ = counters
    main = app_modules["main"]
    db_session.execute(delete(models.UserBook))
    db_session.execute(delete(models.User))
    db_session.commit()
    admin = models.User(email="boss@example.com", hashed_password="x")
    db_session.add(admin)
    db_session.commit()
    main.app.dependency_overrides[get_current_user] = lambda: admin
    yield admin
    main.app.dependency_overrides.pop(get_current_user, None)
    db_session.execute(delete(models.UserBook))
    db_session.execute(delete(models.User))
    db_session.commit()


def test_metrics_are_admin_only(client, signed_in, app_modules, monkeypatch):
    settings = app_modules["database"].settings
    monkeypatch.setattr(settings, "admin_emails", "")
    assert client.get("/admin/metrics").status_code == 403
    monkeypatch.setattr(settings, "admin_emails", "someone@else.com")
    assert client.get("/admin/metrics").status_code == 403
    monkeypatch.setattr(settings, "admin_emails", "Other@example.com, BOSS@example.com")
    assert client.get("/admin/metrics").status_code == 200
    assert client.get("/admin/metrics?days=0").status_code == 422


def test_metrics_report_counts_and_the_three_saves_in_a_week_cohort(client, db_session, signed_in, app_modules,
                                                                    counters, monkeypatch):
    models, _ = counters
    monkeypatch.setattr(app_modules["database"].settings, "admin_emails", "boss@example.com")
    now = datetime.now(timezone.utc)
    books = [models.Book(title=f"Cohort {n}", authors=[models.Author(name=f"Cohort Author {n}")]) for n in range(3)]
    db_session.add_all(books)
    db_session.commit()

    def reader(email, signed_up_days_ago, save_after_days, saves=3):
        user = models.User(email=email, hashed_password="x", created_at=now - timedelta(days=signed_up_days_ago))
        db_session.add(user)
        db_session.commit()
        for book in books[:saves]:
            db_session.add(models.UserBook(user_id=user.id, book_id=book.id, is_wanted=True,
                                           created_at=user.created_at + timedelta(days=save_after_days)))
        db_session.commit()

    reader("fast@example.com", 2, 1)        # counts: three saves inside the first week
    reader("fast-old@example.com", 20, 6)   # counts: still inside the window of 30 days
    reader("few@example.com", 2, 1, saves=2)  # two saves are not enough
    reader("slow@example.com", 20, 9)       # saves came after the first week
    reader("ancient@example.com", 90, 1)    # signed up before the 30 day window
    client.post("/events", json={"name": "share_click"})
    client.post("/events", json={"name": "share_click"})
    client.post("/events", json={"name": "register_started", "src": "landing"})

    report = client.get("/admin/metrics?days=30").json()
    assert report["totals"] == {"register_started": 1, "share_click": 2}
    assert {(c["name"], c["src"], c["count"]) for c in report["counts"]} == {("share_click", "", 2),
                                                                           ("register_started", "landing", 1)}
    assert report["new_accounts"] == 5  # the admin and four readers; "ancient" is outside the window
    assert report["new_accounts_with_3_saves_in_7_days"] == 2
    assert client.get("/admin/metrics?days=3").json()["new_accounts_with_3_saves_in_7_days"] == 1
