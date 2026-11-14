"""T57: re-tag genres with the corrected rules: replace mode, cap of three, kept non-subject links, dry run, log and undo."""
import json

import pytest
from sqlalchemy import delete, insert, select, text
from sqlalchemy.orm import sessionmaker

from test_clean_catalogue import ENGLISH, shelf  # noqa: F401

MYSTERY = ["Detective and mystery stories", "Fiction", "Private investigators", "Investigation", "Murder", "Travel"]


@pytest.fixture()
def tool(shelf, app_modules):  # noqa: F811
    from data import retag_genres
    models = app_modules["models"]
    db = shelf.db
    from data import taxonomy
    db.execute(text("DELETE FROM tags WHERE lower(name) = ANY(:keys) AND type::text <> 'genre'"), {"keys": list(taxonomy.GENRE_KEYS)})
    for name in taxonomy.GENRE_KEYS:
        db.execute(text("INSERT INTO tags (name, type, visible_in_v2) VALUES (:n, 'genre', true) "
                        "ON CONFLICT (name, type) DO UPDATE SET visible_in_v2 = true"), {"n": name})
    db.commit()
    tag_ids = dict(db.execute(text("SELECT name, id FROM tags WHERE type = 'genre'")).all())

    def link(book, genre, managed=True):
        db.execute(insert(models.book_tags).values(book_id=book.id, tag_id=tag_ids[genre], source_managed=managed))
        db.commit()

    def genres_of(book):
        db.rollback()
        return {row[0]: row[1] for row in db.execute(text(
            "SELECT t.name, bt.source_managed FROM book_tags bt JOIN tags t ON t.id = bt.tag_id "
            "WHERE bt.book_id = :b AND t.type = 'genre'"), {"b": book.id})}

    shelf.link, shelf.genres_of, shelf.module = link, genres_of, retag_genres
    shelf.factory = sessionmaker(bind=app_modules["database"].engine)
    yield shelf
    db.rollback()
    db.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "retag_genre"))
    db.commit()


def run(tool, rows, **kwargs):
    kwargs.setdefault("benchmark_titles", ())
    return tool.module.retag(tool.factory, rows, **kwargs)


def logs(tool):
    tool.db.rollback()
    return [json.loads(d) for d in tool.db.scalars(text("SELECT detail FROM catalogue_import_issues WHERE code = 'retag_genre' ORDER BY id"))]


def wrong_book(tool):
    book = tool.book("Orient Test", ["A. Christie"])
    for genre in ("mystery_crime", "business_money", "childrens", "humor", "travel"):
        tool.link(book, genre)
    return book


def test_replace_swaps_wrong_links_for_the_new_result_capped_at_three(tool):
    book = wrong_book(tool)
    report = run(tool, [(book.source_id, MYSTERY)], apply=True)
    assert tool.genres_of(book) == {"mystery_crime": True}
    assert report["counts"]["books_changed"] == 1
    assert report["links_removed"] == {"business_money": 1, "childrens": 1, "humor": 1, "travel": 1}
    assert report["counts"]["books_over_three_after"] <= report["counts"]["books_over_three_before"]


def test_a_book_never_ends_with_more_than_three(tool):
    book = tool.book("Many Genres", ["B. Author"])
    for genre in ("fantasy", "horror", "thriller", "humor"):
        tool.link(book, genre)
    run(tool, [(book.source_id, ["Fantasy fiction", "Mystery fiction", "Horror fiction", "Thriller", "Humorous fiction"])], apply=True)
    assert len(tool.genres_of(book)) == 3


def test_links_that_are_not_subject_derived_are_kept_and_count_towards_the_cap(tool):
    book = tool.book("Hand Tagged", ["C. Author"])
    tool.link(book, "travel", managed=False)
    tool.link(book, "humor", managed=True)
    report = run(tool, [(book.source_id, ["Fantasy fiction", "Mystery fiction", "Horror fiction", "Thriller"])], apply=True)
    now = tool.genres_of(book)
    assert now["travel"] is False and len(now) == 3 and "humor" not in now
    assert report["counts"]["non_subject_links_kept"] >= 1


def test_the_dry_run_writes_nothing(tool):
    book = wrong_book(tool)
    before = tool.genres_of(book)
    report = run(tool, [(book.source_id, MYSTERY)])
    assert tool.genres_of(book) == before and logs(tool) == []
    assert report["applied"] is False and report["counts"]["books_changed"] == 1
    assert report["db"]["links_removed"] == 0 and report["db"]["links_added"] == 0
    assert any(v["book_id"] == book.id for v in report["samples"])


def test_a_book_whose_work_is_not_in_the_dump_is_left_alone_and_counted(tool):
    book = wrong_book(tool)
    report = run(tool, [], apply=True)
    assert len(tool.genres_of(book)) == 5
    assert report["counts"]["books_not_in_dump_with_genres"] >= 1


def test_books_that_would_lose_every_genre_are_reported_and_can_be_skipped(tool):
    book = tool.book("Loses All", ["D. Author"])
    tool.link(book, "travel")
    rows = [(book.source_id, ["Travel"])]
    dry = run(tool, rows)
    assert dry["counts"]["would_lose_all"] == 1 and dry["would_lose_by_genre"] == {"travel": 1}
    assert dry["lose_all_samples"][0]["book_id"] == book.id
    kept = run(tool, rows, apply=True, skip_empty=True)
    assert tool.genres_of(book) == {"travel": True} and kept["counts"]["skipped_lose_all"] == 1
    run(tool, rows, apply=True)
    assert tool.genres_of(book) == {}


def test_log_and_undo_round_trip(tool):
    book = wrong_book(tool)
    before = tool.genres_of(book)
    run(tool, [(book.source_id, MYSTERY)], apply=True, tag="t57-test")
    entry = logs(tool)[0]
    assert entry["tag"] == "t57-test" and entry["book_id"] == book.id
    assert sorted(entry["removed"]) == ["business_money", "childrens", "humor", "travel"] and entry["added"] == []
    result = tool.module.undo(tool.factory, "t57-test")
    assert result["links_restored"] == 4 and tool.genres_of(book) == before
    assert tool.module.undo(tool.factory, "t57-test")["links_restored"] == 0      # a second undo changes nothing


def test_undo_takes_back_added_links_and_matches_the_exact_tag(tool):
    book = tool.book("Gets Added", ["E. Author"])
    run(tool, [(book.source_id, ["Fantasy fiction"])], apply=True, tag="a_b")
    assert tool.genres_of(book) == {"fantasy": True}
    assert tool.module.undo(tool.factory, "aXb")["books"] == 0                      # underscore is not a wildcard
    assert tool.module.undo(tool.factory, "a_b")["links_taken_back"] == 1 and tool.genres_of(book) == {}


def test_bad_tags_are_refused(tool):
    book = tool.book("Bad Tag", ["F. Author"])
    with pytest.raises(ValueError):
        run(tool, [(book.source_id, ["Fantasy fiction"])], apply=True, tag="no spaces; drop")
    with pytest.raises(ValueError):
        tool.module.undo(tool.factory, "x y")


def test_a_chunk_is_three_write_statements_not_one_per_book(tool, app_modules):
    from sqlalchemy import event
    books = [tool.book(f"Chunk {n}", ["G. Author"]) for n in range(5)]
    for book in books:
        tool.link(book, "travel")
    seen = []
    engine = app_modules["database"].engine
    watch = lambda conn, cursor, statement, *a: seen.append(statement.split()[0].upper())  # noqa: E731
    event.listen(engine, "before_cursor_execute", watch)
    try:
        run(tool, [(b.source_id, ["Fantasy fiction"]) for b in books], apply=True)
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert seen.count("DELETE") == 1 and seen.count("INSERT") <= 3
