"""GET /books?sort=popular: popularity first, then id; books without a score last; sort is part of the cache key."""
import pytest
from sqlalchemy import select


@pytest.fixture()
def scored(client, db_session, app_modules, seeded_books):
    models = app_modules["models"]
    books = sorted((b for b in seeded_books.values() if b.is_listed), key=lambda b: b.id)  # unlisted books never show
    assert len(books) >= 4
    a, b, c, d = books[:4]
    for book, value in ((a, 5.0), (b, None), (c, 9.0), (d, 5.0)):
        book.popularity = value
    for extra in books[4:]:
        extra.popularity = None
    db_session.commit()
    return books, (a, b, c, d)


def ids(client, query=""):
    response = client.get(f"/books?size=50{query}")
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def test_popular_orders_by_score_then_id_with_nulls_last(client, scored):
    books, (a, b, c, d) = scored
    got = ids(client, "&sort=popular")
    assert got[:3] == [c.id, a.id, d.id]  # 9.0, then the 5.0 tie by id
    assert got[3:] == sorted(book.id for book in books if book.popularity is None)  # NULLs last, by id
    assert ids(client) == sorted(book.id for book in books)  # the default order is unchanged


def test_popular_keeps_the_text_match_first_and_works_with_filters(client, scored):
    books, (a, b, c, d) = scored
    title = c.title.split()[0]
    got = ids(client, f"&sort=popular&book={title}")
    assert got and got[0] in {book.id for book in books if book.title.lower().startswith(title.lower())}
    assert ids(client, f"&sort=popular&tag={c.tags[0].name}")[0] == max((book for book in books if c.tags[0] in book.tags),
                                                                          key=lambda x: (x.popularity or -1, -x.id)).id


def test_unknown_sort_is_rejected(client, scored):
    assert client.get("/books?sort=newest").status_code == 422


def test_sort_is_part_of_the_anonymous_cache_key(client, scored):
    from services import catalogue_cache
    books, (a, b, c, d) = scored
    plain = ids(client)
    popular = ids(client, "&sort=popular")
    assert plain != popular and ids(client) == plain and ids(client, "&sort=popular") == popular  # no cross-talk
    keys = [key for key in catalogue_cache._entries if isinstance(key, tuple) and key[0] == "list"]
    assert any(("sort", "popular") in key[1] for key in keys) and any(("sort", "popular") not in key[1] for key in keys)


def test_migration_follows_catalogue_on_demand():
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c9f2a6d83e15_book_popularity.py"
    assert "down_revision = 'b8e5f1c7d204'" in path.read_text(encoding="utf-8")
