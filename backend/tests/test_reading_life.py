"""T37: the "reading life" figures added to GET /me/stats, checked against a small library with known answers."""
import os
import time
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event, insert, select

from test_profile import world  # noqa: F401  (users, a signed-in client, cleanup)

OLD_KEYS = {"year", "books_finished", "pages_read", "by_month", "top_genres", "biggest_month"}


@pytest.fixture()
def life(world):
    models, db = world.models, world.db
    user = world.make_user()
    world.act_as(user)
    tags = {t.name: t for t in db.scalars(select(models.Tag)).all()}
    authors = {name: models.Author(name=name) for name in ("Ann Author", "Bo Writer", "Cy New")}
    db.add_all(authors.values())

    def book(title, author, pages, tag_names=()):
        item = models.Book(title=title, description="d", page_count=pages, published_year=2000,
                           cover_image_url=f"https://covers.example/{title}.jpg", source_id=f"/works/OLR{uuid.uuid4().hex[:6]}W")
        item.authors = [authors[author]]
        item.tags = [tags[name] for name in tag_names]
        db.add(item)
        return item

    b1, b2 = book("Aa", "Ann Author", 100, ["fantasy"]), book("Bb", "Ann Author", 300, ["fantasy", "horror"])
    b3, b4 = book("Cc", "Bo Writer", 500, ["horror"]), book("Dd", "Cy New", None)
    b5, b6, b7, b8 = (book("Ee", "Ann Author", 250, ["fantasy"]), book("Ff", "Bo Writer", 200),
                      book("Gg", "Cy New", 200), book("Hh", "Bo Writer", 200))
    db.flush()

    def entry(created=None, **fields):
        item = models.UserBook(user_id=user.id, **fields)
        if created:
            item.created_at = created
        db.add(item)
        db.flush()
        return item

    e = dict(
        b1=entry(book_id=b1.id, is_owned=True), b2=entry(book_id=b2.id, is_wanted=True), b3=entry(book_id=b3.id, is_owned=True),
        b4=entry(book_id=b4.id, is_owned=True), b5=entry(book_id=b5.id, is_owned=True),
        priv=entry(private_title="Pp", private_author="Di Priv", is_wanted=True),
        b6=entry(book_id=b6.id, is_owned=True, created=datetime(2025, 1, 1, tzinfo=timezone.utc)),
        b7=entry(book_id=b7.id, is_wanted=True, created=datetime(2025, 2, 1, tzinfo=timezone.utc)),
        b8=entry(book_id=b8.id, is_owned=True))

    def attempt(item, state, started, ended, pages=None, origin="native"):
        db.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=item.id, state=state, started_on=started, ended_on=ended,
                                     total_pages=pages, origin=origin, creation_fingerprint=uuid.uuid4().hex))

    attempt(e["b5"], "finished", date(2025, 5, 20), date(2025, 6, 1))
    attempt(e["b3"], "dnf", None, date(2025, 9, 9))
    attempt(e["b1"], "finished", date(2025, 12, 25), date(2026, 1, 1))            # first day of the year
    attempt(e["b2"], "finished", date(2026, 3, 1), date(2026, 3, 10))
    attempt(e["b3"], "finished", date(2026, 2, 20), date(2026, 3, 20), origin="import")   # imported history counts
    attempt(e["b4"], "finished", None, date(2026, 7, 4))                            # no pages anywhere
    attempt(e["priv"], "finished", date(2026, 8, 1), date(2026, 8, 8), pages=200)   # a private entry's own pages
    attempt(e["b2"], "finished", None, date(2026, 12, 31))                          # a reread counts again; last day of the year
    attempt(e["b1"], "dnf", None, date(2026, 5, 5))
    attempt(e["b3"], "finished", None, date(2027, 1, 1))                            # next year
    attempt(e["b8"], "reading", date(2026, 11, 1), None)
    db.commit()

    class Life:
        pass

    L = Life()
    L.world, L.e, L.books, L.user, L.db, L.models = world, e, dict(b6=b6, b7=b7), user, db, models

    def stats(year=2026):
        r = world.client.get(f"/me/stats?year={year}")
        assert r.status_code == 200, r.text
        return r.json()

    L.stats = stats
    return L


ZERO_MONTH = {"books": 0, "pages": 0}


def test_every_year_figure_on_a_known_library(life):
    s = life.stats(2026)
    assert (s["books"], s["pages"], s["pages_unknown"], s["avg_length"], s["median_days"], s["stopped"]) == (6, 1400, 1, 280, 8, 1)
    months = [dict(m) for m in s["months"]]
    expected = [dict(ZERO_MONTH) for _ in range(12)]
    expected[0], expected[2], expected[6], expected[7], expected[11] = (
        {"books": 1, "pages": 100}, {"books": 2, "pages": 800}, {"books": 1, "pages": 0}, {"books": 1, "pages": 200},
        {"books": 1, "pages": 300})
    assert months == expected
    assert s["top_subjects"] == [{"name": "fantasy", "count": 3}, {"name": "horror", "count": 3}]
    assert s["length_mix"] == {"short": 2, "medium": 2, "long": 1, "unknown": 1}
    assert (s["authors_new"], s["authors_returning"]) == (3, 1)  # Ann Author finished in 2025 too; Bo, Cy, Di are new
    assert s["all_time"] == {"books": 8, "pages": 2150}


def test_the_previous_year_has_the_same_figures(life):
    p = life.stats(2026)["previous"]
    assert (p["books"], p["pages"], p["pages_unknown"], p["avg_length"], p["median_days"], p["stopped"]) == (1, 250, 0, 250, 12, 1)
    assert p["months"][5] == {"books": 1, "pages": 250} and sum(m["books"] for m in p["months"]) == 1
    assert p["top_subjects"] == [{"name": "fantasy", "count": 1}]
    assert p["length_mix"] == {"short": 0, "medium": 1, "long": 0, "unknown": 0}
    assert (p["authors_new"], p["authors_returning"]) == (1, 0)
    assert set(p) == set(life.stats(2026)) - {"previous", "all_time", "shelf", "year", "books_finished", "pages_read", "by_month",
                                               "top_genres", "biggest_month"}


def test_year_boundaries(life):
    assert life.stats(2025)["books"] == 1                      # 1 Jan 2026 is not in 2025
    assert life.stats(2026)["months"][0]["books"] == 1 and life.stats(2026)["months"][11]["books"] == 1   # 1 Jan and 31 Dec
    s = life.stats(2027)
    assert s["books"] == 1 and s["months"][0]["books"] == 1    # 31 Dec 2026 is not in 2027
    assert s["previous"]["books"] == 6
    assert (s["authors_new"], s["authors_returning"]) == (0, 1)


def test_imported_attempts_count_in_the_year_and_all_time(life):
    imported = life.db.scalar(select(life.models.ReadingAttempt).where(life.models.ReadingAttempt.origin == "import"))
    assert imported.state == "finished" and imported.ended_on == date(2026, 3, 20)
    assert life.stats(2026)["months"][2]["books"] == 2         # includes the imported finish
    assert life.stats(2026)["all_time"]["books"] == 8


def test_unknown_pages_are_left_out_and_counted(life):
    s = life.stats(2026)
    assert s["pages_unknown"] == 1 and s["pages"] == 1400 and s["length_mix"]["unknown"] == 1
    assert s["avg_length"] == round(1400 / 5)                 # five books with known pages


def test_the_shelf_figures_and_the_oldest_waiting_book(life):
    shelf = life.stats()["shelf"]
    assert shelf["owned_unfinished"] == 2     # Ff (never opened) and Hh (reading); the other owned books were finished
    assert shelf["want"] == 3                 # Bb, Pp, Gg


def test_oldest_waiting_is_the_earliest_saved_unread_owned_or_wanted_entry(life):
    waiting = life.stats()["shelf"]["oldest_waiting"]
    assert waiting["entry_id"] == life.e["b6"].id and waiting["title"] == "Ff"
    assert waiting["book_id"] == life.books["b6"].id and waiting["cover_url"] == "https://covers.example/Ff.jpg"
    assert waiting["saved_at"].startswith("2025-01-01T00:00:00")
    # an older private entry wins, and has no book id or cover
    life.db.add(life.models.UserBook(user_id=life.user.id, private_title="Older private", is_wanted=True,
                                     created_at=datetime(2024, 6, 1, tzinfo=timezone.utc)))
    life.db.commit()
    waiting = life.stats()["shelf"]["oldest_waiting"]
    assert waiting["title"] == "Older private" and waiting["book_id"] is None and waiting["cover_url"] is None
    assert set(waiting) == {"entry_id", "book_id", "title", "cover_url", "saved_at"}


def test_an_empty_library_is_zeros_and_nulls_without_errors(world):
    world.act_as(world.make_user())
    s = world.client.get("/me/stats?year=2026").json()
    for figures in (s, s["previous"]):
        assert (figures["books"], figures["pages"], figures["pages_unknown"], figures["stopped"]) == (0, 0, 0, 0)
        assert figures["avg_length"] is None and figures["median_days"] is None and figures["top_subjects"] == []
        assert figures["months"] == [{"books": 0, "pages": 0}] * 12
        assert figures["length_mix"] == {"short": 0, "medium": 0, "long": 0, "unknown": 0}
        assert (figures["authors_new"], figures["authors_returning"]) == (0, 0)
    assert s["all_time"] == {"books": 0, "pages": 0}
    assert s["shelf"] == {"owned_unfinished": 0, "want": 0, "oldest_waiting": None}


def test_the_existing_keys_are_unchanged(life):
    from services import profile
    s = life.stats(2026)
    assert {key: s[key] for key in OLD_KEYS} == profile.year_stats(life.db, life.user.id, 2026)
    assert s["by_month"] == [1, 0, 2, 0, 0, 0, 1, 1, 0, 0, 0, 1] and s["biggest_month"] == 3


def test_the_public_profile_payload_is_unchanged_and_shows_none_of_it(life):
    world = life.world
    world.client.patch("/me/profile", json={"handle": "life-reader", "profile_public": True})
    world.anonymous()
    page = world.client.get("/u/life-reader").json()
    assert set(page["stats"]) == OLD_KEYS
    blob = str(page)
    for private in ("shelf", "oldest_waiting", "pages_unknown", "median_days", "authors_new", "all_time", "length_mix", "Older"):
        assert private not in blob


def test_a_2000_entry_library_is_fast_with_a_fixed_number_of_statements(world, app_modules):
    models = world.models
    user = world.make_user()
    world.act_as(user)
    tag_ids = [t.id for t in world.db.scalars(select(models.Tag)).all()][:3]
    authors = [models.Author(name=f"Life Author {n}") for n in range(150)]
    world.db.add_all(authors)
    world.db.flush()
    book_ids = world.db.scalars(insert(models.Book).returning(models.Book.id), [
        {"title": f"Life book {n:04d}", "description": "d", "page_count": 80 + n % 700, "published_year": 2000,
         "cover_image_url": "https://covers.example/x.jpg"} for n in range(2000)]).all()
    world.db.execute(insert(models.book_authors), [{"book_id": b, "author_id": authors[n % 150].id} for n, b in enumerate(book_ids)])
    world.db.execute(insert(models.book_tags), [{"book_id": b, "tag_id": tag_ids[n % len(tag_ids)]} for n, b in enumerate(book_ids)])
    entry_ids = world.db.scalars(insert(models.UserBook).returning(models.UserBook.id), [
        {"user_id": user.id, "book_id": b, "is_owned": n % 2 == 0, "is_wanted": n % 3 == 0} for n, b in enumerate(book_ids)]).all()
    world.db.execute(insert(models.ReadingAttempt), [
        {"id": uuid.uuid4(), "user_book_id": e, "state": "finished" if n % 4 else "dnf", "started_on": date(2025, 1, 1 + n % 28),
         "ended_on": date(2025 + n % 2, 1 + n % 12, 1 + n % 28), "creation_fingerprint": uuid.uuid4().hex}
        for n, e in enumerate(entry_ids) if n % 5 != 0])
    world.db.commit()
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    timings = []
    try:
        for _ in range(12):
            statements.clear()
            start = time.perf_counter()
            r = world.client.get("/me/stats?year=2026")
            timings.append(time.perf_counter() - start)
            assert r.status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    body = r.json()
    assert body["books"] > 100 and body["previous"]["books"] > 100 and body["all_time"]["books"] > 1000
    selects = [s for s in statements if s.lstrip().upper().startswith(("SELECT", "WITH"))]
    assert len(selects) <= 9, len(selects)
    timings.sort()
    p95 = timings[int(len(timings) * 0.95) - 1]
    print(f"T37 2,000 entries: p95 {p95:.3f}s, {len(selects)} SELECTs")
    # 300 ms is for an idle machine (BOOKVANE_STRICT_TIMING=yes); by default the cap is loose so a busy machine cannot fail it.
    assert p95 < (0.3 if os.getenv("BOOKVANE_STRICT_TIMING") == "yes" else 1.5), f"p95 {p95:.3f}s"
