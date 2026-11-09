"""T49: nightly top-up, weekly health check, admin-only enqueue, metrics block, server-side search counts."""
import csv
import uuid
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import delete, func, select

from test_combined_search import FakeOL, doc  # noqa: F401  (a fake Open Library and a search-result builder)

ROOT = Path(__file__).resolve().parents[2]


def test_the_benchmark_list_is_about_five_hundred_distinct_titles():
    rows = list(csv.DictReader(open(ROOT / "backend" / "data" / "benchmark_titles.csv", encoding="utf-8", newline="")))
    assert 450 <= len(rows) <= 650 and set(rows[0]) == {"title", "author", "group"}
    assert len({(r["title"], r["author"]) for r in rows}) == len(rows) and all(r["title"] and r["author"] for r in rows)
    assert {"classics", "fantasy", "science fiction", "thriller", "mystery"} <= {r["group"] for r in rows}


# --- the checker (pure) ----------------------------------------------------------------------------------------------------

def test_the_checker_matches_by_title_and_author_surname():
    from data import catalogue_health as h
    item = {"title": "The Hobbit", "author": "J. R. R. Tolkien"}
    assert h.found_in(item, [{"title": "Hobbit", "authors": [{"name": "J.R.R. Tolkien"}]}])
    assert not h.found_in(item, [{"title": "The Hobbit", "authors": [{"name": "Charles Dixon"}]}])
    orwell = [{"title": "Nineteen Eighty-Four", "authors": [{"name": "George Orwell"}]}]
    assert h.found_in({"title": "Nineteen Eighty Four", "author": "George Orwell"}, orwell)


def test_the_summary_is_counts_only_and_alerts_on_each_crossed_limit():
    from data import catalogue_health as h
    result = {"checked": 100, "found": 80, "missing": [{"title": "Secret Reader Title", "author": "Someone"}]}
    block = {"searches": {"runs": 200, "empty": 50, "empty_percent": 25.0}, "imports": {"rows": 10, "matched": 5, "match_percent": 50.0},
             "books": {"total": 5, "more_than_3_authors": 0, "no_genre": 1, "no_cover": 0, "low_score": 0, "unscored": 0},
             "lookups": {"queued": 2}, "gate_rejections": {"no_pages": 3}, "database_mb": 750.0,
             "alerts": ["Empty searches are 25.0% (limit 15.0%)."]}
    text, alerts = h.summary(result, {"queued": 20}, block)
    assert "Secret Reader Title" not in text and "80 of 100" in text and "Sent to the lookup queue: 20" in text
    assert any("coverage" in a.lower() for a in alerts) and any("Empty searches" in a for a in alerts)
    quiet, none = h.summary({"checked": 100, "found": 95, "missing": []}, None, None)
    assert none == [] and "Alerts: none" in quiet


# --- the server ------------------------------------------------------------------------------------------------------------

@pytest.fixture()
def admin(app_modules, db_session, client, monkeypatch):
    from auth.dependencies import get_current_user, get_current_user_optional
    models = app_modules["models"]
    settings = app_modules["database"].settings
    user = models.User(email=f"admin-{uuid.uuid4().hex[:6]}@example.test", hashed_password="x")
    other = models.User(email=f"plain-{uuid.uuid4().hex[:6]}@example.test", hashed_password="x")
    db_session.add_all([user, other])
    db_session.commit()
    monkeypatch.setattr(settings, "admin_emails", user.email)
    monkeypatch.setattr(settings, "admin_api_key", SecretStr("weekly-job-key"))
    app = app_modules["main"].app

    class A:
        pass

    a = A()
    a.user, a.other, a.client, a.models, a.db = user, other, client, models, db_session
    def sign_in(who):
        app.dependency_overrides[get_current_user] = lambda: who
        app.dependency_overrides[get_current_user_optional] = lambda: who

    def sign_out():
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides[get_current_user_optional] = lambda: None

    a.as_admin, a.as_other, a.signed_out = (lambda: sign_in(user)), (lambda: sign_in(other)), sign_out
    yield a
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)
    db_session.rollback()
    db_session.execute(delete(models.CatalogueLookup))
    db_session.execute(delete(models.EventCount).where(models.EventCount.name.in_(["search_run", "search_empty"])))
    db_session.execute(delete(models.User).where(models.User.id.in_([user.id, other.id])))
    db_session.commit()


ITEMS = {"items": [{"title": "Fourth Wing", "author": "Rebecca Yarros"}, {"title": "Iron Flame", "author": "Rebecca Yarros"}]}


def test_enqueue_is_admin_only_by_account_or_service_key(admin):
    admin.signed_out()
    assert admin.client.post("/admin/catalogue/enqueue", json=ITEMS).status_code in (401, 403)
    admin.as_other()
    assert admin.client.post("/admin/catalogue/enqueue", json=ITEMS).status_code == 403
    assert admin.client.post("/admin/catalogue/enqueue", json=ITEMS, headers={"X-Admin-Key": "wrong"}).status_code == 403
    admin.as_admin()
    r = admin.client.post("/admin/catalogue/enqueue", json=ITEMS)
    assert r.status_code == 200 and r.json()["queued"] == 2
    admin.signed_out()
    r = admin.client.post("/admin/catalogue/enqueue", json=ITEMS, headers={"X-Admin-Key": "weekly-job-key"})
    assert r.status_code == 200
    assert admin.db.scalar(select(func.count()).select_from(admin.models.CatalogueLookup)) == 2        # queued once per book


def test_enqueue_validates_its_body(admin):
    admin.as_admin()
    assert admin.client.post("/admin/catalogue/enqueue", json={"items": [{"title": "x", "author": "y", "extra": 1}]}).status_code == 422
    assert admin.client.post("/admin/catalogue/enqueue", json={"items": [{"title": "x", "author": "y"}] * 501}).status_code == 422
    assert admin.client.post("/admin/catalogue/enqueue", json={"items": [{"title": "", "author": "y"}]}).json() == {"queued": 0, "skipped": 1, "ignored": 0}


def test_the_alert_route_is_admin_only_and_sends_nothing_without_a_mailer(admin, monkeypatch):
    import httpx
    from database import settings as real
    from services import catalogue_health
    admin.signed_out()
    assert admin.client.post("/admin/catalogue/alert", json={"lines": ["x"]}).status_code in (401, 403)
    admin.as_admin()
    monkeypatch.setattr(real, "resend_api_key", None)
    assert admin.client.post("/admin/catalogue/alert", json={"lines": ["Coverage is 80%."]}).json() == {"sent": False}
    sent = {}

    class Response:
        def raise_for_status(self):
            pass

    monkeypatch.setattr(httpx, "post", lambda url, **kw: sent.update(url=url, **kw) or Response())
    monkeypatch.setattr(real, "resend_api_key", "key")
    monkeypatch.setattr(real, "password_reset_from", "Bookvane <noreply@bookvane.me>")
    assert catalogue_health.send_alert(["Coverage is 80%."]) is True
    assert sent["json"]["to"] == ["support@bookvane.me"] and "Coverage is 80%." in sent["json"]["html"]


def test_metrics_carry_a_catalogue_block_with_coverage_searches_and_size(admin):
    admin.as_admin()
    models, db = admin.models, admin.db
    book = models.Book(title="Fourth Wing", source_id="/works/OL9T49W", cover_image_url="x", page_count=500, published_year=2023,
                       description="d", quality_score=95)
    book.authors = [models.Author(name="Rebecca Yarros", source_id="/authors/OL9T49A")]
    db.add(book)
    db.commit()
    try:
        assert admin.client.get("/books", params={"book": "fourth wing"}).status_code == 200            # a search that finds
        admin.client.get("/books", params={"book": "zzzz nothing matches this"})                           # one that does not
        r = admin.client.get("/admin/metrics", params={"days": 7})
        block = r.json()["catalogue"]
        assert block["searches"]["runs"] >= 2 and block["searches"]["empty"] >= 1
        assert block["coverage"]["benchmark"] > 450 and block["coverage"]["found"] >= 1
        assert block["books"]["total"] >= 1 and block["database_mb"] > 0 and "coverage_min" in block["limits"]
        assert any("coverage" in a.lower() for a in block["alerts"])                                     # one book of 500 titles
        admin.signed_out()
        assert admin.client.get("/admin/catalogue/metrics", headers={"X-Admin-Key": "weekly-job-key"}).json()["coverage"]["benchmark"] > 450
        assert admin.client.get("/admin/catalogue/metrics").status_code in (401, 403)
        assert admin.client.get("/admin/metrics").status_code == 401
    finally:
        db.rollback()
        db.execute(delete(models.Book).where(models.Book.source_id == "/works/OL9T49W"))
        db.execute(delete(models.Author).where(models.Author.source_id == "/authors/OL9T49A"))
        db.commit()


def test_search_counts_hold_no_search_text(admin):
    admin.client.get("/books", params={"book": "a private looking phrase"})
    names = set(admin.db.scalars(select(admin.models.EventCount.name)))
    assert {"search_run", "search_empty"} <= names
    rows = admin.db.execute(select(admin.models.EventCount.src, admin.models.EventCount.placement)
                            .where(admin.models.EventCount.name.in_(["search_run", "search_empty"]))).all()
    assert all(src == "" and placement == "" for src, placement in rows)


# --- the nightly top-up --------------------------------------------------------------------------------------------------------

@pytest.fixture()
def topup(app_modules, db_session, monkeypatch):
    from services import catalogue_resolver
    fake = FakeOL()
    monkeypatch.setattr(catalogue_resolver, "ol_get", fake)
    yield fake
    db_session.rollback()
    models = app_modules["models"]
    db_session.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "gate_reject"))
    db_session.execute(delete(models.Book).where(models.Book.source_id.like("/works/OL7%W")))
    db_session.execute(delete(models.Author).where(models.Author.source_id.like("/authors/OL7%A")))
    db_session.commit()


def test_top_up_adds_only_new_gate_passing_books_and_stops_at_the_limit(topup, db_session, app_modules):
    from data import top_up
    models = app_modules["models"]
    db_session.add(models.Book(title="Held", source_id="/works/OL700002W", cover_image_url="x", page_count=1, published_year=2000))
    db_session.commit()
    docs = [doc(1, title="Alpha One"), doc(2, title="Held"), doc(3, title="Gamma Three", pages=None), doc(4, title="Box Set Omnibus"),
            doc(5, title="Epsilon Five"), doc(6, title="Zeta Six"), doc(7, title="Eta Seven")]
    topup.docs = docs
    report = top_up.top_up(db_session, limit=2, batches=[docs])
    assert report["added"] == 2 and report["already_held"] == 1 and report["not_listable"] == 2
    held = set(db_session.scalars(select(models.Book.source_id).where(models.Book.source_id.like("/works/OL7%W"))))
    assert held == {"/works/OL700002W", "/works/OL700001W", "/works/OL700005W"}                      # 1 and 5; 2 was held; stopped at 2 added


def test_a_dry_run_reports_without_writing(topup, db_session, app_modules):
    from data import top_up
    models = app_modules["models"]
    topup.docs = [doc(1, title="Alpha One"), doc(2, title="Beta Two")]
    before = db_session.scalar(select(func.count()).select_from(models.Book))
    report = top_up.top_up(db_session, limit=10, dry_run=True, batches=[topup.docs])
    assert report["added"] == 2 and db_session.scalar(select(func.count()).select_from(models.Book)) == before


def test_the_daily_cap_stops_the_run_instead_of_pushing_past_it(topup, db_session, monkeypatch, app_modules):
    from data import top_up
    monkeypatch.setattr(app_modules["database"].settings, "catalogue_promote_daily_cap", 0)
    topup.docs = [doc(1), doc(2)]
    report = top_up.top_up(db_session, limit=10, batches=[[doc(1), doc(2)]])
    assert report.get("stopped_daily_cap") == 1 and "added" not in report


def test_a_rejected_book_is_counted_by_reason_and_logged_without_its_title(topup, db_session, app_modules):
    from data import top_up
    models = app_modules["models"]
    bad = doc(1, authors=("Ink Publishing Press",))
    topup.docs = [bad]
    report = top_up.top_up(db_session, limit=5, batches=[[bad]])
    assert report.get("rejected_no_author") == 1
    issue = db_session.scalar(select(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "gate_reject"))
    assert issue.detail == "no_author" and "Fourth" not in issue.detail


def test_popularity_refresh_fills_missing_scores(topup, db_session, app_modules):
    from data import top_up
    models = app_modules["models"]
    db_session.add(models.Book(title="Fourth Wing", source_id="/works/OL700001W", cover_image_url="x", page_count=1, published_year=2000))
    db_session.commit()
    topup.docs = [doc(1, readers=5000, ratings=900)]
    assert top_up.refresh_popularity(db_session)["changed"] >= 1
    db_session.expire_all()
    assert db_session.scalar(select(models.Book.popularity).where(models.Book.source_id == "/works/OL700001W")) > 8


def test_failed_lookups_are_requeued(db_session, app_modules):
    from data import top_up
    models = app_modules["models"]
    db_session.add(models.CatalogueLookup(key="t49-failed", title="X", author="Y", status="failed", attempts=5))
    db_session.commit()
    try:
        assert top_up.retry_failed(db_session)["requeued"] >= 1
        db_session.expire_all()
        row = db_session.scalar(select(models.CatalogueLookup).where(models.CatalogueLookup.key == "t49-failed"))
        assert (row.status, row.attempts) == ("queued", 0)
    finally:
        db_session.execute(delete(models.CatalogueLookup).where(models.CatalogueLookup.key == "t49-failed"))
        db_session.commit()


def test_the_workflows_are_scheduled_and_only_run_when_switched_on():
    health = (ROOT / ".github" / "workflows" / "catalogue-health.yml").read_text(encoding="utf-8")
    topup = (ROOT / ".github" / "workflows" / "catalogue-topup.yml").read_text(encoding="utf-8")
    assert "cron:" in health and "ADMIN_API_KEY" in health and "data.catalogue_health" in health and "persist-credentials: false" in health
    assert "cron:" in topup and "vars.CATALOGUE_TOPUP == 'on'" in topup and "--refresh-popularity --retry-failed" in topup
