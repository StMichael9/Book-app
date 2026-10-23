from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from data import backfill_from_editions

ENGLISH = ["/languages/eng"]


@pytest.fixture
def catalogue(db_session, app_modules):
    models = app_modules["models"]
    author = models.Author(name="Backfill Author")
    db_session.add(author)

    def book(title, editions=(), preferred=None, **fields):
        item = models.Book(title=title, **fields)
        item.authors.append(author)
        db_session.add(item)
        db_session.flush()
        made = []
        for spec in editions:
            edition = models.Edition(book_id=item.id, source_id=f"/books/OL{uuid.uuid4().hex[:12]}M", languages=spec.get("languages", []),
                                     publication_date=spec.get("date"), page_count=spec.get("pages"), cover_image_url=spec.get("cover"))
            db_session.add(edition)
            made.append(edition)
        db_session.flush()
        if preferred is not None:
            item.preferred_edition_id = made[preferred].id
        db_session.commit()
        return item

    return book


def reload(db_session, models, book):
    db_session.expire_all()
    return db_session.get(models.Book, book.id)


def run(url, **kwargs):
    return backfill_from_editions.backfill(url, **{"apply": True, **kwargs})


def test_year_is_the_earliest_valid_year_across_editions(catalogue, test_database_url, db_session, app_modules):
    this_year = date.today().year
    item = catalogue("Years", [
        {"date": "1999-01-02"}, {"date": "June 3, 1847"}, {"date": "c1850"}, {"date": "0000"}, {"date": "99"},
        {"date": "1234"}, {"date": str(this_year + 1)}, {"date": "n.d."}, {"date": None}, {"date": "12345678"},
    ])
    run(test_database_url)
    assert reload(db_session, app_modules["models"], item).published_year == 1847


def test_no_valid_year_leaves_it_null(catalogue, test_database_url, db_session, app_modules):
    item = catalogue("Junk", [{"date": "0000"}, {"date": "99"}, {"date": "n.d."}])
    run(test_database_url)
    assert reload(db_session, app_modules["models"], item).published_year is None


def test_page_count_is_the_median_of_positive_counts_preferring_english(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    english = catalogue("English", [{"pages": 150, "languages": ENGLISH}, {"pages": 170, "languages": ENGLISH},
                                    {"pages": 160, "languages": ENGLISH}, {"pages": 900, "languages": ["/languages/fre"]},
                                    {"pages": 0, "languages": ENGLISH}, {"pages": None, "languages": ENGLISH}])
    other = catalogue("No English", [{"pages": 100, "languages": ["/languages/fre"]}, {"pages": 300, "languages": ["/languages/ger"]},
                                     {"pages": 200}])
    even = catalogue("Even", [{"pages": 100, "languages": ENGLISH}, {"pages": 200, "languages": ENGLISH}])
    none = catalogue("None", [{"pages": 0}, {"pages": None}])
    run(test_database_url)
    assert [reload(db_session, models, item).page_count for item in (english, other, even, none)] == [160, 200, 150, None]


def test_cover_prefers_the_preferred_edition_then_the_first_with_a_cover(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    preferred = catalogue("Preferred", [{"cover": "https://c/first.jpg"}, {"cover": "https://c/preferred.jpg"}], preferred=1)
    first = catalogue("First", [{"cover": None}, {"cover": "  "}, {"cover": "https://c/second.jpg"}, {"cover": "https://c/third.jpg"}])
    blank_preferred = catalogue("Blank preferred", [{"cover": "https://c/only.jpg"}, {"cover": ""}], preferred=1)
    none = catalogue("No cover", [{"cover": None}])
    run(test_database_url)
    assert [reload(db_session, models, item).cover_image_url for item in (preferred, first, blank_preferred, none)] == [
        "https://c/preferred.jpg", "https://c/second.jpg", "https://c/only.jpg", None]


def test_only_null_fields_are_filled_and_nothing_is_overwritten(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    item = catalogue("Has some", [{"date": "1800", "pages": 500, "cover": "https://c/new.jpg", "languages": ENGLISH}],
                     published_year=1900, page_count=250, description="Keep me.")
    report = run(test_database_url)
    loaded = reload(db_session, models, item)
    assert (loaded.published_year, loaded.page_count, loaded.description) == (1900, 250, "Keep me.")
    assert loaded.cover_image_url == "https://c/new.jpg"
    assert report["filled"] == {"published_year": 0, "page_count": 0, "cover_image_url": 1}


@pytest.mark.parametrize("blank", ["", "   ", " \t\r\n"])
def test_a_blank_cover_counts_as_missing_and_the_book_becomes_complete(catalogue, test_database_url, db_session, app_modules, blank):
    models = app_modules["models"]
    item = catalogue("Blank cover", [{"cover": "https://c/new.jpg"}], cover_image_url=blank, description="D", page_count=10, published_year=2000)
    assert reload(db_session, models, item).is_complete is False
    report = run(test_database_url)
    loaded = reload(db_session, models, item)
    assert loaded.cover_image_url == "https://c/new.jpg" and loaded.is_complete is True
    assert report["filled"]["cover_image_url"] == 1 and report["complete_after"] == report["complete_before"] + 1
    again = run(test_database_url)
    assert again["filled"] == {"published_year": 0, "page_count": 0, "cover_image_url": 0}
    assert reload(db_session, models, item).cover_image_url == "https://c/new.jpg"


def test_a_blank_cover_with_no_usable_edition_cover_is_left_alone_and_rerun_is_a_no_op(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    item = catalogue("Still blank", [{"cover": "  "}, {"cover": None}], cover_image_url="  ")
    first = run(test_database_url)
    second = run(test_database_url)
    assert first["filled"]["cover_image_url"] == 0 and second["filled"] == first["filled"]
    assert reload(db_session, models, item).cover_image_url == "  "


def test_report_counts_and_completeness_before_and_after(catalogue, test_database_url, db_session, app_modules):
    catalogue("Already complete", [], cover_image_url="https://c/a.jpg", description="D", page_count=10, published_year=2000)
    catalogue("Becomes complete", [{"date": "1901", "pages": 120, "cover": "https://c/b.jpg", "languages": ENGLISH}], description="D")
    catalogue("Stays incomplete", [{"date": "1902"}], description="D")
    report = run(test_database_url)
    assert report["filled"] == {"published_year": 2, "page_count": 1, "cover_image_url": 1}
    assert report["complete_after"] == report["complete_before"] + 1
    assert report["books_without_authors"] == 0
    assert report["applied"] is True


def test_books_without_authors_are_reported(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    db_session.add(models.Book(title="Authorless", description="D", page_count=1, published_year=2000, cover_image_url="https://c/x.jpg"))
    db_session.commit()
    assert run(test_database_url, apply=False)["books_without_authors"] == 1


def test_dry_run_writes_nothing_but_predicts_the_apply(catalogue, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    item = catalogue("Dry", [{"date": "1901", "pages": 120, "cover": "https://c/b.jpg", "languages": ENGLISH}], description="D")
    dry = backfill_from_editions.backfill(test_database_url)
    loaded = reload(db_session, models, item)
    assert (loaded.published_year, loaded.page_count, loaded.cover_image_url) == (None, None, None)
    assert dry["applied"] is False and dry["complete_after"] == dry["complete_before"] + 1
    applied = run(test_database_url)
    assert applied["filled"] == dry["filled"] and applied["complete_after"] == dry["complete_after"]


def test_rerunning_changes_nothing(catalogue, test_database_url, db_session, app_modules):
    catalogue("Again", [{"date": "1901", "pages": 120, "cover": "https://c/b.jpg", "languages": ENGLISH}], description="D")
    first = run(test_database_url, batch_size=1)
    assert sum(first["filled"].values()) == 3
    second = run(test_database_url, batch_size=1)
    assert second["filled"] == {"published_year": 0, "page_count": 0, "cover_image_url": 0}
    assert second["complete_before"] == second["complete_after"]


def test_cli_needs_an_explicit_url_and_is_a_dry_run_by_default(catalogue, test_database_url, db_session, app_modules, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    with pytest.raises(SystemExit):
        backfill_from_editions.main([])
    item = catalogue("Cli", [{"date": "1901"}], description="D")
    assert backfill_from_editions.main(["--database-url", test_database_url]) == 0
    assert "dry run" in capsys.readouterr().out.lower()
    assert reload(db_session, app_modules["models"], item).published_year is None
    assert backfill_from_editions.main(["--database-url", test_database_url, "--apply"]) == 0
    assert reload(db_session, app_modules["models"], item).published_year == 1901
