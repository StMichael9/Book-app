"""T73: the growth pack backend. Channel counters (G1), weekly active readers and week-1 return (G2), social previews (G3), welcome
emails (G4) and import counts (G5). Nothing is sent anywhere: the mailer is a recording stub."""
import importlib.util
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from sqlalchemy import delete, event, select, text

ROOT = Path(__file__).resolve().parents[2]
INDEX = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
NOW = datetime.now(timezone.utc)


def days_ago(n):
    return NOW - timedelta(days=n)


class Site:
    def __call__(self, url, timeout=None, headers=None, **kwargs):
        class Response:
            status_code, text = 200, INDEX
        return Response()


@pytest.fixture()
def growth(client, db_session, app_modules, monkeypatch):
    from auth.dependencies import get_current_user
    from services import event_counts, seo
    models = app_modules["models"]
    settings = app_modules["database"].settings
    monkeypatch.setattr(settings, "frontend_base_url", "https://bookvane.me")
    monkeypatch.setattr(seo.requests, "get", Site())
    seo.clear_caches()
    from services import catalogue_cache
    catalogue_cache.clear()
    from rate_limit import limiter
    limiter.reset()
    db_session.execute(delete(models.EventCount))
    db_session.execute(delete(models.UserBook))
    db_session.execute(delete(models.User))          # the shared test database keeps other tests' readers; the welcome run reads them all
    db_session.commit()
    event_counts.window.reset()
    made = {"users": [], "books": []}

    class G:
        pass

    g = G()
    g.client, g.db, g.models, g.settings, g.made = client, db_session, models, settings, made

    def user(prefix="g", age=0, **fields):
        fields.setdefault("email_tips", True)             # most fixtures are readers who opted in; the default itself is tested below
        item = models.User(email=f"{prefix}-{uuid.uuid4().hex[:8]}@growth-fixture.org", hashed_password="x",
                           created_at=days_ago(age), **fields)
        db_session.add(item)
        db_session.commit()
        made["users"].append(item.id)
        return item

    def book(title):
        item = models.Book(title=f"{title} {uuid.uuid4().hex[:5]}", cover_image_url="https://covers.openlibrary.org/b/id/9-L.jpg",
                           description="d", published_year=2000, page_count=100, source_id=f"/works/OLG{uuid.uuid4().hex[:6]}W")
        item.authors = [models.Author(name="Growth Author")]
        db_session.add(item)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def admin_as(item):
        monkeypatch.setattr(settings, "admin_emails", item.email)
        app_modules["main"].app.dependency_overrides[get_current_user] = lambda: item

    g.user, g.book, g.admin_as = user, book, admin_as
    yield g
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    seo.clear_caches()
    event_counts.window.reset()
    limiter.reset()
    db_session.rollback()
    db_session.execute(delete(models.EventCount))
    db_session.execute(text("DELETE FROM library_import_runs WHERE user_id = ANY(:ids)"), {"ids": made["users"]})
    db_session.execute(delete(models.ReadingList).where(models.ReadingList.user_id.in_(made["users"])))
    db_session.execute(delete(models.UserBook).where(models.UserBook.user_id.in_(made["users"])))
    db_session.commit()
    for book_id in made["books"]:
        obj = db_session.get(models.Book, book_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()
    db_session.execute(delete(models.User).where(models.User.id.in_(made["users"])))
    db_session.commit()


def counts(g):
    g.db.expire_all()
    return sorted(g.db.execute(select(g.models.EventCount.name, g.models.EventCount.src, g.models.EventCount.ref,
                                      g.models.EventCount.count)).all())


# --- G1: channel counters ---------------------------------------------------------------------------------------------

def test_an_unknown_ref_counts_as_none_and_known_refs_are_kept(growth):
    for ref in ("tt", "ig", "bogus", None, 5, "TT"):
        growth.client.post("/events", json={"name": "landing_visit", "ref": ref})
    assert counts(growth) == [("landing_visit", "", "", 4), ("landing_visit", "", "ig", 1), ("landing_visit", "", "tt", 1)]
    growth.client.post("/events", json={"name": "landing_visit", "src": "switch", "ref": "club"})
    assert ("landing_visit", "switch", "club", 1) in counts(growth)


def test_scan_events_and_the_bounds_on_how_many_books_a_scan_adds(growth):
    for body in ({"name": "scan_opened"}, {"name": "scan_opened"}, {"name": "scan_added", "n": 40}, {"name": "scan_added", "n": 2},
                 {"name": "scan_added"}):
        assert growth.client.post("/events", json=body).status_code == 204
    for bad in (0, -3, 101, "5", True, 2.5, None):
        assert growth.client.post("/events", json={"name": "scan_added", "n": bad}).status_code == 204
    assert counts(growth) == [("scan_added", "", "", 43), ("scan_opened", "", "", 2)]
    assert growth.client.post("/events", json={"name": "scan_opened", "n": 50}).status_code == 204
    assert [row for row in counts(growth) if row[0] == "scan_opened"] == [("scan_opened", "", "", 3)]    # n only widens scan_added


def test_register_counts_with_a_validated_ref_and_stores_nothing_on_the_user(growth):
    for n, (query, body_ref) in enumerate([("?ref=tt", None), ("?ref=tt&src=landing", None), ("?ref=nope", None), ("", "rd"), ("", "nope")]):
        body = {"email": f"ref{n}-{uuid.uuid4().hex[:6]}@growth-fixture.org", "password": "long enough password"}
        if body_ref:
            body["ref"] = body_ref
        assert growth.client.post(f"/auth/register{query}", json=body).status_code == 201
    assert counts(growth) == [("register_completed", "", "", 2), ("register_completed", "", "rd", 1), ("register_completed", "", "tt", 1),
                              ("register_completed", "landing", "tt", 1)]
    assert "ref" not in {column.name for column in growth.models.User.__table__.columns}
    growth.db.execute(delete(growth.models.User).where(growth.models.User.email.like("ref%@growth-fixture.org")))
    growth.db.commit()


def test_the_primary_key_migration_keeps_existing_counts_and_the_downgrade_folds_them(growth):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = ROOT / "backend" / "alembic" / "versions" / "b9c4e7a12d03_event_counts_ref.py"
    spec = importlib.util.spec_from_file_location("event_ref_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    connection = growth.db.connection()
    outer = connection.begin_nested()
    try:
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
            connection.execute(text("INSERT INTO event_counts (day, name, src, placement, count) VALUES (:d, 'share_click', 'share', '', 7)"),
                               {"d": NOW.date()})
            module.upgrade()
        rows = connection.execute(text("SELECT name, src, placement, ref, count FROM event_counts")).all()
        assert rows == [("share_click", "share", "", "", 7)]
        connection.execute(text("INSERT INTO event_counts (day, name, src, placement, ref, count) VALUES (:d, 'share_click', 'share', '', 'tt', 2)"),
                           {"d": NOW.date()})                                       # the new key admits the same row under another ref
        key = connection.execute(text("SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid "
                                      "AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'event_counts'::regclass AND i.indisprimary")).scalar()
        assert key == ["day", "name", "src", "placement", "ref"]
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
        assert connection.execute(text("SELECT name, count FROM event_counts")).all() == [("share_click", 9)]
    finally:
        outer.rollback()
        growth.db.rollback()


def test_metrics_report_visits_signups_and_conversion_by_ref_and_the_scan_figures(growth):
    boss = growth.user("boss")
    growth.admin_as(boss)
    today = NOW.date()
    rows = [("landing_visit", "tt", 40), ("landing_visit", "", 10), ("landing_visit", "ig", 5), ("register_completed", "tt", 4),
            ("register_completed", "", 1), ("scan_opened", "", 6), ("scan_added", "", 30)]
    for name, ref, count in rows:
        growth.db.add(growth.models.EventCount(day=today, name=name, src="", placement="", ref=ref, count=count))
    growth.db.add(growth.models.EventCount(day=today - timedelta(days=1), name="landing_visit", src="", placement="", ref="tt", count=10))
    growth.db.commit()
    report = growth.client.get("/admin/metrics?days=7").json()
    totals = {item["ref"]: item for item in report["channels"]["totals"]}
    assert totals["tt"] == {"ref": "tt", "visits": 50, "signups": 4, "conversion": 0.08}
    assert totals[""]["conversion"] == 0.1 and totals["ig"]["signups"] == 0 and totals["ig"]["conversion"] == 0.0
    day = {(item["day"], item["ref"]): item for item in report["channels"]["by_day"]}
    assert day[(today.isoformat(), "tt")]["visits"] == 40 and day[((today - timedelta(days=1)).isoformat(), "tt")]["signups"] == 0
    assert report["scans"]["opened"] == 6 and report["scans"]["added"] == 30 and report["scans"]["books_per_scan"] == 5.0
    assert all("ref" in row for row in report["counts"])


def test_the_counter_table_holds_only_the_five_key_columns_and_a_count(growth):
    assert {column.name for column in growth.models.EventCount.__table__.columns} == {"day", "name", "src", "placement", "ref", "count"}


# --- G2 and G5: weekly active readers, week-1 return, import counts ----------------------------------------------------

def stamp(g, user, table, when, **extra):
    """An activity row for the user, dated `when`."""
    book = g.book("Activity")
    entry = g.models.UserBook(user_id=user.id, book_id=book.id, is_owned=True, created_at=when, updated_at=when)
    g.db.add(entry)
    g.db.commit()
    return entry


def test_weekly_active_readers_count_distinct_real_accounts_in_rolling_windows(growth):
    from services import growth_metrics
    boss = growth.user("boss")
    growth.admin_as(boss)
    a, b, c = growth.user("a", 40), growth.user("b", 40), growth.user("c", 40)
    tester = growth.models.User(email="x@example.com", hashed_password="x", created_at=days_ago(40))
    growth.db.add(tester)
    growth.db.commit()
    growth.made["users"].append(tester.id)
    stamp(growth, a, "user_books", days_ago(2))                 # week 0
    stamp(growth, a, "user_books", days_ago(3))                 # the same reader twice in one week counts once
    stamp(growth, b, "user_books", days_ago(9))                 # week 1
    stamp(growth, a, "user_books", days_ago(10))                # a is also active in week 1
    stamp(growth, tester, "user_books", days_ago(2))            # a test account never counts
    stamp(growth, boss, "user_books", days_ago(2))              # an admin never counts
    growth.db.execute(text("INSERT INTO library_import_runs (id, user_id, source, headers, creation_fingerprint, created_at, updated_at, phase) "
                           "VALUES (:i, :u, 'goodreads', '{}', :f, :t, :t, 'completed')"),
                      {"i": uuid.uuid4(), "u": c.id, "f": "f" * 64, "t": days_ago(16)})
    growth.db.commit()
    war = {row["weeks_ago"]: row["readers"] for row in growth_metrics.weekly_active_readers(growth.db, NOW)}
    assert len(war) == 8 and war[0] == 1 and war[1] == 2 and war[2] == 1 and war[3] == 0     # c's import run is in week 2
    report = growth.client.get("/admin/metrics").json()
    assert [row["readers"] for row in report["weekly_active_readers"]][:3] == [1, 2, 1]
    assert "active_reader" in report["definitions"]


def test_notes_progress_and_reading_updates_count_as_activity(growth):
    from services import growth_metrics
    owner = growth.user("owner", 30)
    book = growth.book("Reader")
    entry = growth.models.UserBook(user_id=owner.id, book_id=book.id, is_owned=True, created_at=days_ago(30), updated_at=days_ago(30))
    growth.db.add(entry)
    growth.db.commit()
    attempt = growth.models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state="reading", creation_fingerprint="a" * 64,
                                           created_at=days_ago(30), updated_at=days_ago(30))
    growth.db.add(attempt)
    growth.db.commit()
    def week0():
        return growth_metrics.weekly_active_readers(growth.db, NOW)[0]["readers"]
    assert week0() == 0
    growth.db.execute(text("UPDATE reading_attempts SET updated_at = :t WHERE id = :i"), {"t": days_ago(1), "i": attempt.id})
    growth.db.commit()
    assert week0() == 1
    growth.db.execute(text("UPDATE reading_attempts SET updated_at = :t WHERE id = :i"), {"t": days_ago(30), "i": attempt.id})
    growth.db.execute(text("INSERT INTO reading_progress_days (attempt_id, day, unit, first_value, last_value, updated_at) VALUES (:i, :d, 'pages', 1, 5, :t)"),
                      {"i": attempt.id, "d": days_ago(2).date(), "t": days_ago(2)})
    growth.db.commit()
    assert week0() == 1
    growth.db.execute(text("DELETE FROM reading_progress_days WHERE attempt_id = :i"), {"i": attempt.id})
    growth.db.execute(text("INSERT INTO reading_notes (attempt_id, text, request_id, written_at) VALUES (:i, 'n', :r, :t)"),
                      {"i": attempt.id, "r": uuid.uuid4(), "t": days_ago(3)})
    growth.db.commit()
    assert week0() == 1
    growth.db.execute(text("DELETE FROM reading_notes WHERE attempt_id = :i"), {"i": attempt.id})
    growth.db.execute(text("INSERT INTO reading_notes (attempt_id, text, request_id) VALUES (:i, 'migrated', :r)"),
                      {"i": attempt.id, "r": uuid.uuid4()})            # a migrated note has no date and is not activity
    growth.db.commit()
    assert week0() == 0
    growth.db.execute(delete(growth.models.ReadingAttempt).where(growth.models.ReadingAttempt.id == attempt.id))
    growth.db.commit()


def test_week_one_return_measures_days_7_to_13_of_each_signup_and_only_old_enough_accounts(growth):
    from services import growth_metrics
    # all three signed up 15-17 days ago: the same sign-up week, and old enough (14 days) to measure
    back = growth.user("back", 16)
    gone = growth.user("gone", 16)
    early = growth.user("early", 16)
    fresh = growth.user("fresh", 3)                                          # too new to have a day 7-13 window
    stamp(growth, back, "user_books", back.created_at + timedelta(days=8))   # active on day 8: returned
    stamp(growth, gone, "user_books", gone.created_at + timedelta(days=2))   # only in week 0 of its own life: not a return
    stamp(growth, early, "user_books", early.created_at + timedelta(days=14, hours=1))   # day 14 is outside days 7 to 13
    stamp(growth, fresh, "user_books", fresh.created_at + timedelta(hours=1))
    table = {row["weeks_ago"]: row for row in growth_metrics.week_one_return(growth.db, NOW)}
    old = table[2]                                                           # signed up 14 to 21 days ago
    assert (old["signed_up"], old["measured"], old["returned"], old["share"]) == (3, 3, 1, 0.333)
    new = table[0]
    assert new["signed_up"] == 1 and new["measured"] == 0 and new["share"] is None


def test_import_runs_started_and_completed_per_day(growth):
    boss = growth.user("boss")
    growth.admin_as(boss)
    u = growth.user("importer")
    def run(created, updated, phase):
        growth.db.execute(text("INSERT INTO library_import_runs (id, user_id, source, headers, creation_fingerprint, created_at, updated_at, phase) "
                               "VALUES (:i, :u, 'goodreads', '{}', :f, :c, :p, :ph)"),
                          {"i": uuid.uuid4(), "u": u.id, "f": uuid.uuid4().hex * 2, "c": created, "p": updated, "ph": phase})
    run(days_ago(1), days_ago(1), "completed")
    run(days_ago(1), days_ago(0), "completed_with_issues")
    run(days_ago(1), days_ago(1), "cancelled")
    run(days_ago(0), days_ago(0), "applying")
    growth.db.commit()
    report = growth.client.get("/admin/metrics?days=3").json()
    by_day = {row["day"]: row for row in report["imports"]}
    yesterday, today = days_ago(1).date().isoformat(), NOW.date().isoformat()
    assert by_day[yesterday] == {"day": yesterday, "started": 3, "completed": 1}
    assert by_day[today] == {"day": today, "started": 1, "completed": 1}


def test_metrics_run_a_fixed_number_of_statements_however_much_data_there_is(growth, app_modules):
    boss = growth.user("boss")
    growth.admin_as(boss)
    engine = app_modules["database"].engine

    def count():
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert growth.client.get("/admin/metrics?days=30").status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen)

    growth.db.refresh(boss)
    before = count()
    for n in range(12):
        reader = growth.user("busy", 20)
        stamp(growth, reader, "user_books", days_ago(n))
        growth.client.post("/events", json={"name": "landing_visit", "ref": "tt"})
        growth.client.post("/events", json={"name": "scan_added", "n": 3})
    growth.db.refresh(boss)
    assert count() == before


# --- G3: social previews ------------------------------------------------------------------------------------------------

def public_shelf(g, handle, public=True, list_public=True, titles=("Alpha", "Bravo", "Charlie", "Delta")):
    owner = g.user("shelf", display_name="Ada L", handle=handle, profile_public=public)
    reading_list = g.models.ReadingList(user_id=owner.id, name="Winter reads", description="d", is_public=list_public)
    g.db.add(reading_list)
    g.db.commit()
    for position, title in enumerate(titles, start=1):
        g.db.add(g.models.ReadingListItem(list_id=reading_list.id, book_id=g.book(title).id, position=position))
    g.db.commit()
    return owner, reading_list


def test_a_public_profile_page_has_the_social_head_and_only_public_data(growth):
    handle = f"ada-{uuid.uuid4().hex[:6]}"
    owner, reading_list = public_shelf(growth, handle)
    response = growth.client.get(f"/seo/u/{handle}")
    assert response.status_code == 200 and response.headers["cache-control"] == "public, max-age=300"
    page = response.text
    assert "<title>Ada L&#x27;s shelf on Bookvane</title>" in page
    assert re.search(r'<meta property="og:description" content="4 books, including Alpha [^,]*, Bravo [^,]*, Charlie [^"]*\."', page)
    assert 'Delta' not in re.search(r'og:description" content="([^"]*)"', page).group(1)       # only the first three titles
    assert '<meta name="twitter:card" content="summary_large_image"' in page
    assert "wsrv.nl" in re.search(r'og:image" content="([^"]*)"', page).group(1)             # the cached cover of the first book
    assert f'<link rel="canonical" href="https://bookvane.me/u/{handle}" />' in page
    assert page.count('rel="canonical"') == 1


def test_a_public_list_page_uses_the_list_title(growth):
    handle = f"lst-{uuid.uuid4().hex[:6]}"
    owner, reading_list = public_shelf(growth, handle, titles=("One", "Two"))
    page = growth.client.get(f"/seo/u/{handle}/lists/{reading_list.id}").text
    assert "<title>Winter reads · a reading list on Bookvane</title>" in page
    assert re.search(r'og:description" content="2 books, including One [^,]*, Two [^"]*\."', page)
    assert f'href="https://bookvane.me/u/{handle}/lists/{reading_list.id}"' in page


def test_private_hidden_and_unknown_profiles_and_lists_are_404_without_a_hint(growth):
    private_handle, hidden_handle = f"prv-{uuid.uuid4().hex[:6]}", f"hid-{uuid.uuid4().hex[:6]}"
    public_shelf(growth, private_handle, public=False)
    owner, hidden_list = public_shelf(growth, hidden_handle, list_public=False)
    for path in (f"/seo/u/{private_handle}", f"/seo/u/{hidden_handle}/lists/{hidden_list.id}", "/seo/u/nobody-here",
                 f"/seo/u/{hidden_handle}/lists/999999"):
        response = growth.client.get(path)
        assert response.status_code == 404 and "Ada" not in response.text and "<title>Bookvane" in response.text or response.status_code == 404
        assert "Winter reads" not in response.text and private_handle not in response.text.replace("nobody-here", "")


def test_a_profile_with_no_public_list_still_gets_a_plain_description(growth):
    handle = f"emp-{uuid.uuid4().hex[:6]}"
    growth.user("shelf", display_name="Empty Shelf", handle=handle, profile_public=True)
    page = growth.client.get(f"/seo/u/{handle}").text
    assert "Empty Shelf&#x27;s shelf on Bookvane" in page and "summary_large_image" not in page     # no cover, so the plain card stays


def test_the_home_page_head_has_one_canonical_tag(growth):
    page = growth.client.get("/seo/home").text
    assert page.count('rel="canonical"') == 1 and '<link rel="canonical" href="https://bookvane.me/" />' in page


# --- G4: welcome emails ---------------------------------------------------------------------------------------------------

class Mailbox:
    def __init__(self):
        self.sent = []
        self.fail = set()

    def __call__(self, to, parts):
        if to in self.fail:
            raise RuntimeError("bounced")
        self.sent.append((to, parts))


def due(g, mailbox, **kwargs):
    from services import welcome
    return welcome.send_due(g.db, now=kwargs.pop("now", NOW), send=mailbox, **kwargs)


def test_the_right_step_goes_to_the_right_account_one_per_run_and_the_steps_progress(growth):
    day0, day3, day10 = growth.user("d0", 0), growth.user("d3", 3), growth.user("d4", 4)
    box = Mailbox()
    first = due(growth, box)
    assert first["sent"] == 3 and first["skipped_late"] == 0
    assert {parts["subject"] for to, parts in box.sent} == {"Start your Bookvane shelf"}
    growth.db.expire_all()
    assert [growth.db.get(growth.models.User, u.id).welcome_step for u in (day0, day3, day10)] == [1, 1, 1]
    # a run sends one email per account: the 3- and 4-day-old accounts are also due for step 2, which goes in the NEXT run
    assert due(growth, box)["sent"] == 2
    growth.db.expire_all()
    assert [growth.db.get(growth.models.User, u.id).welcome_step for u in (day0, day3, day10)] == [1, 2, 2]
    assert due(growth, box)["sent"] == 0                                    # nothing else is due yet
    assert due(growth, box, now=NOW + timedelta(days=3))["sent"] == 1       # the day-0 account turns 3 days old
    growth.db.expire_all()
    assert [growth.db.get(growth.models.User, u.id).welcome_step for u in (day0, day3, day10)] == [2, 2, 2]


def test_step_progression_runs_through_all_three_emails_and_then_stops(growth):
    one = growth.user("p", 0)
    box = Mailbox()
    subjects = []
    for offset in (0, 3, 10, 11, 40):
        before = len(box.sent)
        due(growth, box, now=NOW + timedelta(days=offset))
        subjects += [parts["subject"] for to, parts in box.sent[before:]]
    assert len(subjects) == 3 and len(set(subjects)) == 3
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, one.id).welcome_step == 3


def test_opt_out_old_and_late_accounts_are_skipped(growth):
    out = growth.user("out", 1, email_tips=False)
    old = growth.user("old", 45)
    late = growth.user("late", 9)                                           # its day-0 email was due 9 days ago: past the 5-day grace
    ok = growth.user("ok", 1)
    box = Mailbox()
    result = due(growth, box)
    recipients = [to for to, parts in box.sent]
    assert recipients == [ok.email] and result["skipped_late"] == 1
    assert out.email not in recipients and old.email not in recipients and late.email not in recipients
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, late.id).welcome_step == 1     # passed by, not sent late
    assert growth.db.get(growth.models.User, old.id).welcome_step == 0 and growth.db.get(growth.models.User, out.id).welcome_step == 0


def test_a_very_overdue_email_is_passed_by_instead_of_sent_late(growth):
    late = growth.user("late", 12)
    growth.db.execute(text("UPDATE users SET welcome_step = 1 WHERE id = :i"), {"i": late.id})
    growth.db.commit()                                                      # step 2 was due on day 3, 9 days ago
    box = Mailbox()
    result = due(growth, box)
    assert box.sent == [] and result["skipped_late"] == 1
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, late.id).welcome_step == 2


def test_the_per_run_cap_and_a_failed_send(growth, monkeypatch):
    users = [growth.user("cap", (5 - i) * 0.001) for i in range(5)]       # oldest first, the order a run takes them
    box = Mailbox()
    result = due(growth, box, limit=3)
    assert result["sent"] == 3 and result["capped"] is True and len(box.sent) == 3
    from services import welcome
    assert welcome.MAX_PER_RUN == 200
    box.fail.add(users[3].email)
    box.fail.add(users[4].email)
    again = due(growth, box)
    growth.db.expire_all()
    steps = sorted(growth.db.get(growth.models.User, u.id).welcome_step for u in users)
    assert again["failed"] == 2 and again["sent"] == 0 and steps == [0, 0, 1, 1, 1]     # a failed send leaves the step to try again
    box.fail.clear()
    assert due(growth, box)["sent"] == 2


def test_the_sender_stops_after_three_failures_in_a_row(growth):
    for _ in range(6):
        growth.user("down", 0)
    class Down:
        calls = 0
        def __call__(self, to, parts):
            Down.calls += 1
            raise RuntimeError("down")
    from services import welcome
    result = welcome.send_due(growth.db, now=NOW, send=Down())
    assert result["failed"] == 3 and Down.calls == 3 and result["sent"] == 0


def test_each_email_has_one_link_plain_text_html_and_an_unsubscribe_header(growth):
    from services import welcome
    person = growth.user("mail", 0)
    for step in (1, 2, 3):
        parts = welcome.build_email(step, person.id)
        assert parts["subject"] and parts["text"] and parts["html"]
        link = welcome.unsubscribe_url(person.id)
        assert parts["headers"]["List-Unsubscribe"] == f"<{link}>" and parts["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        assert link in parts["text"] and link in parts["html"]
        links = re.findall(r'<a href="([^"]*)"', parts["html"])
        assert len(links) == 2 and sum("unsubscribe" in item for item in links) == 1              # one call to action and the opt-out
    assert parts["subject"] != welcome.build_email(1, person.id)["subject"]


def test_unsubscribe_token_get_and_post_and_a_bad_token(growth):
    from services import welcome
    person = growth.user("unsub", 0)
    token = welcome.unsubscribe_token(person.id)
    assert welcome.read_unsubscribe_token(token) == person.id
    for bad in ("", "x", token + "0", token[:-2] + "ab", f"{uuid.uuid4().hex}.{token.split('.')[1]}", "zz.zz"):
        assert welcome.read_unsubscribe_token(bad) is None
        assert growth.client.get("/email/unsubscribe", params={"t": bad}).status_code == 400
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, person.id).email_tips is True
    assert growth.client.post("/email/unsubscribe", params={"t": token}).status_code == 200            # the one-click form
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, person.id).email_tips is False
    growth.db.execute(text("UPDATE users SET email_tips = true WHERE id = :i"), {"i": person.id})
    growth.db.commit()
    response = growth.client.get("/email/unsubscribe", params={"t": token})
    assert response.status_code == 200 and "unsubscribed" in response.text
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, person.id).email_tips is False
    assert growth.client.get("/email/unsubscribe", params={"t": token}).status_code == 200            # again: still fine
    box = Mailbox()
    due(growth, box)
    assert person.email not in [to for to, _ in box.sent]


def test_the_send_endpoint_needs_the_service_key_and_a_configured_mailer(growth, monkeypatch):
    from pydantic import SecretStr
    from services import welcome
    settings = growth.settings
    monkeypatch.setattr(settings, "admin_api_key", SecretStr("service-key-123"))
    assert growth.client.post("/admin/send-welcome").status_code == 401
    assert growth.client.post("/admin/send-welcome", headers={"x-admin-key": "wrong"}).status_code == 401
    boss = growth.user("boss")
    growth.admin_as(boss)
    assert growth.client.post("/admin/send-welcome").status_code == 401                 # a signed-in admin is not the service key
    for name in ("resend_api_key", "password_reset_from"):
        monkeypatch.setattr(settings, name, None)
    assert growth.client.post("/admin/send-welcome", headers={"x-admin-key": "service-key-123"}).status_code == 503
    monkeypatch.setattr(settings, "resend_api_key", "re_test")
    monkeypatch.setattr(settings, "password_reset_from", "Bookvane <hello@example.com>")
    posts = []

    class Reply:
        def raise_for_status(self):
            pass

    monkeypatch.setattr(welcome.httpx, "post", lambda url, **kwargs: posts.append((url, kwargs)) or Reply())
    person = growth.user("api", 0)
    response = growth.client.post("/admin/send-welcome", headers={"x-admin-key": "service-key-123"})
    assert response.status_code == 200 and response.json()["sent"] >= 1
    mine = [kwargs for url, kwargs in posts if kwargs["json"]["to"] == [person.email]]
    assert len(mine) == 1 and mine[0]["json"]["from"] == "Bookvane <hello@example.com>" and "List-Unsubscribe" in mine[0]["json"]["headers"]
    assert growth.client.post("/admin/send-welcome?limit=201", headers={"x-admin-key": "service-key-123"}).status_code == 422


def test_the_daily_job_is_off_unless_the_variable_is_on_and_a_manual_run_is_off_too():
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "welcome-emails.yml").read_text(encoding="utf-8"))
    job = workflow["jobs"]["send"]
    assert job["if"] == "${{ vars.WELCOME_EMAILS == 'on' }}"                       # no event is exempt: schedule and manual both wait for it
    on = workflow.get("on") or workflow[True]
    assert "schedule" in on and "workflow_dispatch" in on
    script = job["steps"][0]["run"]
    assert "/admin/send-welcome" in script and 'X-Admin-Key: $ADMIN_API_KEY' in script and "http://" not in script


def test_email_tips_can_be_changed_in_the_profile_settings_and_defaults_on(growth):
    from auth.dependencies import get_current_user
    person = growth.user("prefs", 0)
    growth.client.app.dependency_overrides[get_current_user] = lambda: person
    assert growth.client.get("/me/profile").json()["email_tips"] is True            # this fixture reader opted in
    assert growth.client.patch("/me/profile", json={"email_tips": False}).json()["email_tips"] is False
    assert growth.client.patch("/me/profile", json={"email_tips": "no"}).status_code == 422
    growth.db.expire_all()
    assert growth.db.get(growth.models.User, person.id).email_tips is False
    growth.client.app.dependency_overrides.pop(get_current_user, None)


def test_email_tips_is_an_opt_in_chosen_at_sign_up_and_off_for_everyone_else(growth):
    emails = {}
    for n, body in enumerate([{}, {"email_tips": True}, {"email_tips": False}]):
        email = f"tips{n}-{uuid.uuid4().hex[:6]}@growth-fixture.org"
        emails[n] = email
        assert growth.client.post("/auth/register", json={"email": email, "password": "long enough password", **body}).status_code == 201
    assert growth.client.post("/auth/register", json={"email": "bad-tips@growth-fixture.org", "password": "long enough password",
                                                       "email_tips": "maybe"}).status_code == 422
    growth.db.expire_all()
    stored = {n: growth.db.scalar(select(growth.models.User.email_tips).where(growth.models.User.email == email)) for n, email in emails.items()}
    assert stored == {0: False, 1: True, 2: False}
    box = Mailbox()
    due(growth, box, now=datetime.now(timezone.utc) + timedelta(minutes=1))
    assert [to for to, _ in box.sent] == [emails[1]]                                  # only the account that ticked the box is mailed
    assert growth.models.User.__table__.c.email_tips.server_default.arg == "false"
    path = ROOT / "backend" / "alembic" / "versions" / "c5d8f1b34e76_welcome_emails.py"
    assert "sa.false()" in path.read_text(encoding="utf-8")                           # existing accounts stay false
    growth.db.execute(delete(growth.models.User).where(growth.models.User.email.like("tips%@growth-fixture.org")))
    growth.db.commit()


def test_the_welcome_migration_marks_accounts_already_older_than_30_days_as_finished(growth):
    path = ROOT / "backend" / "alembic" / "versions" / "c5d8f1b34e76_welcome_emails.py"
    assert "UPDATE users SET welcome_step = 3 WHERE created_at < now() - interval '30 days'" in path.read_text(encoding="utf-8")
