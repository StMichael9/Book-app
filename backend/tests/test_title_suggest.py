"""T61: GET /autocomplete/books, the title type-ahead for the header search."""
import time
import uuid

import pytest
from sqlalchemy import delete, event


@pytest.fixture()
def shelf(db_session, app_modules):
    models = app_modules["models"]
    made = {"books": [], "authors": []}

    class S:
        pass

    s = S()
    s.models, s.db = models, db_session

    def book(title, author="Zed Writer", popularity=None, listed=True, year=1999, aliases=()):
        item = models.Book(title=title, description="d", page_count=200, published_year=year, popularity=popularity,
                           cover_image_url=f"https://covers.example/{uuid.uuid4().hex[:6]}.jpg",
                           quality_score=None if listed else 10, source_id=f"/works/OL7{uuid.uuid4().int % 10**6:06d}W")
        db_session.add(item)
        db_session.flush()
        if author:
            row = models.Author(name=author, source_id=f"/authors/OL7{uuid.uuid4().int % 10**6:06d}A")
            db_session.add(row)
            db_session.flush()
            item.authors.append(row)
            made["authors"].append(row.id)
        for alias in aliases:
            db_session.add(models.BookTitleAlias(book_id=item.id, title=alias, language="en", source="openlibrary_edition"))
        db_session.commit()
        made["books"].append(item.id)
        return item

    s.book = book
    yield s
    db_session.rollback()
    db_session.execute(delete(models.Book).where(models.Book.id.in_(made["books"])))
    db_session.execute(delete(models.Author).where(models.Author.id.in_(made["authors"])))
    db_session.commit()


def suggest(client, q, **params):
    r = client.get("/autocomplete/books", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return r.json()


def titles(client, q, **params):
    return [item["title"] for item in suggest(client, q, **params)]


def test_the_response_has_just_what_a_dropdown_row_needs(client, shelf):
    book = shelf.book("Quixalon Harbor", author="Ada Quixalon", year=2001)
    [row] = suggest(client, "quixalon")
    assert row == {"id": book.id, "title": "Quixalon Harbor", "authors": ["Ada Quixalon"], "cover_url": book.cover_image_url, "year": 2001}


def test_a_prefix_match_ranks_above_a_fuzzy_one_and_popularity_orders_prefixes(client, shelf):
    shelf.book("The Great Quixalon", popularity=900)          # the key folds "the": "great quixalon", found only as a word, not a prefix
    shelf.book("Quixalon Rising", popularity=5)
    shelf.book("Quixalon Falling", popularity=50)
    assert titles(client, "quixalon") == ["Quixalon Falling", "Quixalon Rising", "The Great Quixalon"]


def test_a_shorter_title_wins_a_tie_on_popularity(client, shelf):
    shelf.book("Quixalon Chronicles of the Far North")
    shelf.book("Quixalon")
    assert titles(client, "quixalon")[0] == "Quixalon"


def test_a_leading_article_and_punctuation_are_folded_like_the_title_key(client, shelf):
    shelf.book("The Quixalon Affair!")
    assert titles(client, "quixalon aff") == ["The Quixalon Affair!"]
    assert titles(client, "  QUIXALON,  affair ") == ["The Quixalon Affair!"]


def test_an_alias_title_is_found_and_the_book_shown_once(client, shelf):
    book = shelf.book("Ordinary Name Here", aliases=["Vrenzalo Alias Title", "Vrenzalo Other Alias"])
    rows = suggest(client, "vrenzalo")
    assert [r["id"] for r in rows] == [book.id] and rows[0]["title"] == "Ordinary Name Here"


def test_unlisted_books_are_never_suggested(client, shelf):
    shelf.book("Quixalon Hidden", listed=False, aliases=["Quixalon Hidden Alias"])
    shelf.book("Quixalon Visible")
    assert titles(client, "quixalon") == ["Quixalon Visible"]
    assert "Quixalon Hidden" not in titles(client, "quixalon hidden") and "Quixalon Hidden" not in titles(client, "quixalon hidden alias")


def test_a_typo_still_finds_the_book_by_trigram_similarity(client, shelf):
    shelf.book("Harry Potterzzy and the Philosophers Quixalon")
    shelf.book("Unrelated Zorbonic Tales")
    assert "Harry Potterzzy and the Philosophers Quixalon" in titles(client, "hary potterzy")
    assert titles(client, "zorbonc tales") == ["Unrelated Zorbonic Tales"]


def test_fuzzy_matches_only_fill_what_prefixes_leave(client, shelf):
    for n in range(3):
        shelf.book(f"Quixalon Prefix {n}")
    shelf.book("Zebra Quixalonn Tale")                          # a near miss that would match fuzzily
    rows = titles(client, "quixalon pre", limit=3)
    assert len(rows) == 3 and all(t.startswith("Quixalon Prefix") for t in rows)


def test_fewer_than_two_characters_gives_nothing(client, shelf):
    shelf.book("Q Is For Quixalon")
    for q in ("", " ", "q", " q ", "%", "_"):
        assert suggest(client, q) == [], q
    assert suggest(client, "q ") == []


def test_the_limit_defaults_to_six_and_is_capped_at_eight(client, shelf):
    for n in range(12):
        shelf.book(f"Quixalon Volume {n:02d}")
    assert len(suggest(client, "quixalon")) == 6
    assert len(suggest(client, "quixalon", limit=3)) == 3
    assert len(suggest(client, "quixalon", limit=50)) == 8
    assert len(suggest(client, "quixalon", limit=0)) == 1


def test_like_characters_in_the_query_are_not_wildcards(client, shelf):
    shelf.book("Quixalon 100 Percent")
    assert titles(client, "quixalon 100%") == ["Quixalon 100 Percent"]      # folded like the title key: punctuation is dropped
    assert titles(client, "q_x") == []                                       # "_" is dropped, not a one-letter wildcard


def test_it_is_one_statement_and_fast_on_a_small_catalogue(client, shelf, app_modules):
    shelf.book("Quixalon Speed")
    engine = app_modules["database"].engine
    seen = []
    watch = lambda conn, cursor, statement, *a: seen.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", watch)
    try:
        start = time.perf_counter()
        suggest(client, "quixalon")
        elapsed = time.perf_counter() - start
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert sum(1 for s in seen if "bookvane_search_key" in s) == 1
    assert elapsed < 1.5
