"""T60: average days to finish and pages per reading day, in the reader's private reading-life figures."""
import importlib
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from test_profile import world  # noqa: F401
from test_reading_life import life  # noqa: F401  (a signed-in reader with a known library)

A, B = "attempt-a", "attempt-b"


@pytest.fixture()
def rl(app_modules):
    """The service module, imported once the test database settings are in place."""
    return importlib.import_module("services.reading_life")


def row(attempt, day, unit, first, last, total=None):
    return (attempt, day, unit, first, last, total)


def d(n):
    return date(2026, 3, n)


# --- average days to finish (no database) -----------------------------------------------------------------------------------

def test_the_mean_needs_three_books_and_same_day_finishes_count_as_zero(rl):
    done = [SimpleNamespace(started=d(1), ended=d(1)), SimpleNamespace(started=d(1), ended=d(4)),
            SimpleNamespace(started=d(1), ended=d(8)), SimpleNamespace(started=None, ended=d(9)),
            SimpleNamespace(started=d(9), ended=d(8))]               # no start date, and an end before the start: left out
    days = rl.days_to_finish(done)
    assert days == [0, 3, 7]
    assert rl.average_days(days) == 3 and rl.average_days(days[:2]) is None and rl.average_days([]) is None
    assert rl.average_days([1, 2]) is None and rl.average_days([1, 2, 4]) == 2        # 7/3 = 2.33
    assert rl.average_days([2, 2, 3, 3]) == 3                                            # 2.5 rounds half up


# --- pages gained per day (no database) -------------------------------------------------------------------------------------

def test_a_first_row_gains_last_minus_first_and_later_rows_gain_from_the_previous_last_value(rl):
    gains = rl.page_gains([row(A, d(1), "pages", 0, 30), row(A, d(2), "pages", 30, 50), row(A, d(4), "pages", 55, 90)])
    assert dict(gains) == {d(1): 30, d(2): 20, d(4): 40}      # day 4: 90 - 50, not 90 - 55


def test_a_percent_row_uses_the_attempts_total_pages_and_is_skipped_without_them(rl):
    assert dict(rl.page_gains([row(A, d(1), "percent", 0, 10, 300), row(A, d(2), "percent", 10, 25, 300)])) == {d(1): 30, d(2): 45}
    assert dict(rl.page_gains([row(A, d(1), "percent", 0, 10, None), row(A, d(2), "pages", 5, 20)])) == {d(2): 15}
    assert dict(rl.page_gains([row(A, d(1), "percent", 0, 33, 100)])) == {d(1): 33}
    assert dict(rl.page_gains([row(A, d(1), "percent", 0, 1, 250)])) == {d(1): 3}      # 2.5 pages rounds half up


def test_a_change_of_unit_skips_that_days_gain_and_the_next_day_starts_from_the_new_unit(rl):
    gains = rl.page_gains([row(A, d(1), "pages", 0, 40), row(A, d(2), "percent", 20, 50, 200), row(A, d(3), "percent", 50, 60, 200)])
    assert dict(gains) == {d(1): 40, d(3): 20}          # day 2 changed unit: no gain recorded


def test_a_correction_downwards_counts_as_zero_and_the_next_gain_is_from_the_corrected_value(rl):
    gains = rl.page_gains([row(A, d(1), "pages", 0, 80), row(A, d(2), "pages", 60, 60), row(A, d(3), "pages", 60, 75)])
    assert dict(gains) == {d(1): 80, d(2): 0, d(3): 15}


def test_two_books_on_the_same_day_make_one_reading_day(rl):
    gains = rl.page_gains([row(A, d(1), "pages", 0, 30), row(B, d(1), "pages", 0, 20), row(A, d(2), "pages", 30, 30)])
    assert dict(gains) == {d(1): 50, d(2): 0}
    assert rl.reading_days(gains) == {"reading_days": 1, "pages_per_day": None}     # a day with no gain is not a reading day


def test_fewer_than_five_reading_days_gives_no_pages_per_day(rl):
    four = {d(n): 20 for n in range(1, 5)}
    five = {d(n): 20 for n in range(1, 6)} | {d(6): 0}
    assert rl.reading_days(four) == {"reading_days": 4, "pages_per_day": None}
    assert rl.reading_days(five) == {"reading_days": 5, "pages_per_day": 20}
    assert rl.reading_days({d(n): n for n in range(1, 7)}) == {"reading_days": 6, "pages_per_day": 4}    # 21/6 = 3.5 -> 4


def test_years_are_bucketed_by_the_day_of_the_row(rl):
    gains = {date(2025, 12, 31): 10, date(2026, 1, 1): 30, date(2026, 1, 2): 50, date(2026, 6, 1): 20, date(2026, 6, 2): 20,
             date(2026, 6, 3): 20, date(2027, 1, 1): 5}
    assert rl.reading_days(gains, 2026) == {"reading_days": 5, "pages_per_day": 28}     # 140/5
    assert rl.reading_days(gains, 2025) == {"reading_days": 1, "pages_per_day": None}
    assert rl.reading_days(gains) == {"reading_days": 7, "pages_per_day": 22}           # 155/7 = 22.1


# --- through GET /me/stats (database) ---------------------------------------------------------------------------------------

def add_days(life, entry, days, unit="pages", total=None):
    """Progress rows for the first attempt of `entry`: days is [(day, first, last)]."""
    models, db = life.models, life.db
    attempt = db.scalars(select(models.ReadingAttempt).where(models.ReadingAttempt.user_book_id == entry.id, models.ReadingAttempt.started_on.is_not(None))
                         .order_by(models.ReadingAttempt.started_on)).first()
    if total is not None:
        attempt.total_pages = total
    for day, first, last in days:
        db.add(models.ReadingProgressDay(attempt_id=attempt.id, day=day, unit=unit, first_value=first, last_value=last))
    db.commit()
    return attempt


def test_the_mean_is_in_the_year_the_previous_year_and_all_time_with_the_median_unchanged(life):
    s = life.stats(2026)
    assert s["median_days"] == 8 and s["avg_days"] == 13        # 7, 9, 28, 7 -> 12.75
    assert s["previous"]["avg_days"] is None and s["previous"]["median_days"] == 12   # one book in 2025
    assert s["all_time"]["avg_days"] == 13                     # adds the 2025 book: 63 / 5 = 12.6
    assert life.stats(2025)["avg_days"] is None


def test_pages_per_day_through_the_endpoint_across_years(life):
    start = date(2026, 3, 1)
    add_days(life, life.e["b2"], [(start + timedelta(days=n), 20 * n, 20 * (n + 1)) for n in range(3)])     # 20 pages a day, 3 days
    add_days(life, life.e["priv"], [(start + timedelta(days=n), 10 * n, 10 * (n + 1)) for n in range(5)])   # 10 pages a day, 5 days
    add_days(life, life.e["b5"], [(date(2025, 5, 21), 0, 40), (date(2025, 5, 22), 40, 70)])                  # 2025: two days
    s = life.stats(2026)
    assert (s["reading_days"], s["pages_per_day"]) == (5, 22)          # 30, 30, 30, 10, 10 over two books: 110 / 5
    assert (s["previous"]["reading_days"], s["previous"]["pages_per_day"]) == (2, None)
    assert (s["all_time"]["reading_days"], s["all_time"]["pages_per_day"]) == (7, 26)    # 180 / 7 = 25.7


def test_a_reader_with_no_progress_rows_gets_zero_days_and_no_figure(life):
    s = life.stats(2026)
    assert (s["reading_days"], s["pages_per_day"]) == (0, None) and (s["all_time"]["reading_days"], s["all_time"]["pages_per_day"]) == (0, None)


def test_another_readers_progress_days_never_count(life):
    other = life.world.make_user()
    entry = life.models.UserBook(user_id=other.id, private_title="Theirs", is_wanted=True)
    life.db.add(entry)
    life.db.flush()
    attempt = life.models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state="reading", total_pages=300,
                                         creation_fingerprint=uuid.uuid4().hex)
    life.db.add(attempt)
    life.db.flush()
    for n in range(8):
        life.db.add(life.models.ReadingProgressDay(attempt_id=attempt.id, day=date(2026, 4, 1 + n), unit="pages",
                                                   first_value=n * 10, last_value=n * 10 + 10))
    life.db.commit()
    s = life.stats(2026)
    assert s["reading_days"] == 0 and s["pages_per_day"] is None and s["all_time"]["reading_days"] == 0


def test_neither_figure_appears_on_the_public_profile(life):
    world = life.world
    start = date(2026, 4, 1)
    add_days(life, life.e["b2"], [(start + timedelta(days=n), 10 * n, 10 * (n + 1)) for n in range(6)])
    world.client.patch("/me/profile", json={"handle": "facts-reader", "profile_public": True})
    world.anonymous()
    page = world.client.get("/u/facts-reader").json()
    blob = str(page)
    for private in ("avg_days", "pages_per_day", "reading_days", "median_days"):
        assert private not in blob
