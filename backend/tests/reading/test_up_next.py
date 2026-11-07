"""T41: the reader's "Up next" pins, and the oldest-first sort for My Books."""
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event, select

from test_library import reader  # noqa: F401


@pytest.fixture()
def pins(client, reader, seeded_books, db_session, app_modules):
    models = app_modules["models"]
    books = sorted(seeded_books.values(), key=lambda b: b.id)[:4]

    class P:
        pass

    p = P()
    p.client, p.db, p.models, p.reader, p.books = client, db_session, models, reader, books
    p.entries = []
    for book in books:
        item = models.UserBook(user_id=reader.id, book_id=book.id, is_wanted=True)
        db_session.add(item)
        db_session.flush()
        p.entries.append(item)
    db_session.commit()
    p.put = lambda ids: client.put("/me/up-next", json={"entry_ids": ids})

    def attempt(entry, state):
        db_session.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state=state,
                                             started_on=date(2026, 1, 1), ended_on=date(2026, 2, 1) if state == "finished" else None,
                                             creation_fingerprint=uuid.uuid4().hex))
        db_session.commit()

    p.attempt = attempt
    return p


def ids(response):
    return [item["entry_id"] for item in response.json()]


def codes(response):
    return response.json()["detail"]["code"]


def test_pins_come_back_in_the_order_they_were_put_with_the_documented_shape(pins):
    a, b, c, _ = pins.entries
    r = pins.put([c.id, a.id, b.id])
    assert r.status_code == 200 and ids(r) == [c.id, a.id, b.id]
    assert ids(pins.client.get("/me/up-next")) == [c.id, a.id, b.id]
    item = pins.client.get("/me/up-next").json()[1]
    book = pins.books[0]
    assert set(item) == {"entry_id", "book_id", "title", "authors", "cover_url", "owned", "want", "page_count"}
    assert (item["entry_id"], item["book_id"], item["title"]) == (a.id, book.id, book.title)
    assert item["authors"] == [author.name for author in book.authors] and item["authors"]
    assert item["cover_url"] == book.cover_image_url and item["page_count"] == book.page_count
    assert (item["owned"], item["want"]) == (False, True)


def test_an_empty_list_of_pins_before_any_are_set(pins):
    r = pins.client.get("/me/up-next")
    assert r.status_code == 200 and r.json() == []


def test_put_replaces_the_whole_list(pins):
    a, b, c, d = pins.entries
    pins.put([a.id, b.id, c.id])
    assert ids(pins.put([d.id, a.id])) == [d.id, a.id]
    pins.db.expire_all()
    positions = {e.id: e.up_next_position for e in pins.entries}
    assert positions == {d.id: 1, a.id: 2, b.id: None, c.id: None}       # the old positions were cleared first
    assert ids(pins.put([])) == [] and pins.client.get("/me/up-next").json() == []
    pins.db.expire_all()
    assert all(e.up_next_position is None for e in pins.entries)


def test_pinning_does_not_edit_the_entry(pins):
    a = pins.entries[0]
    before = (a.version, a.updated_at)
    pins.put([a.id])
    pins.db.expire_all()
    a = pins.db.get(pins.models.UserBook, a.id)
    assert (a.version, a.updated_at) == before and a.up_next_position == 1


def test_bad_replacements_are_refused_with_a_code_and_change_nothing(pins):
    a, b, c, d = pins.entries
    pins.put([a.id, b.id])
    extra = []
    for n in range(3):
        item = pins.models.UserBook(user_id=pins.reader.id, private_title=f"Extra {n}", is_wanted=True)
        pins.db.add(item)
        extra.append(item)
    pins.db.commit()
    six = [e.id for e in [a, b, c, d, *extra[:2]]]
    r = pins.put(six)
    assert r.status_code == 422 and codes(r) == "too_many_pins"
    r = pins.put([a.id, a.id])
    assert r.status_code == 422 and codes(r) == "duplicate_pins"
    r = pins.put([a.id, 999999999])
    assert r.status_code == 422 and codes(r) == "unknown_entry"
    other = pins.models.User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="x")
    pins.db.add(other)
    pins.db.flush()
    theirs = pins.models.UserBook(user_id=other.id, private_title="Not yours", is_wanted=True)
    pins.db.add(theirs)
    pins.db.commit()
    r = pins.put([a.id, theirs.id])
    assert r.status_code == 422 and codes(r) == "unknown_entry"          # another reader's entry is simply not found
    pins.attempt(c, "finished")
    r = pins.put([c.id])
    assert r.status_code == 422 and codes(r) == "entry_unavailable"
    pins.attempt(d, "reading")
    r = pins.put([d.id])
    assert r.status_code == 422 and codes(r) == "entry_unavailable"
    assert pins.client.put("/me/up-next", json={"entry_ids": "x"}).status_code == 422
    assert pins.client.put("/me/up-next", json={"entry_ids": [a.id], "extra": 1}).status_code == 422
    assert ids(pins.client.get("/me/up-next")) == [a.id, b.id]            # every refusal left the pins as they were


def test_five_pins_are_allowed(pins):
    items = []
    for n in range(5):
        item = pins.models.UserBook(user_id=pins.reader.id, private_title=f"Five {n}", is_wanted=True)
        pins.db.add(item)
        items.append(item)
    pins.db.commit()
    assert len(pins.put([e.id for e in items]).json()) == 5


def test_a_pin_drops_out_once_the_book_is_finished_or_started_and_never_errors(pins):
    a, b, c, _ = pins.entries
    pins.put([a.id, b.id, c.id])
    pins.attempt(b, "finished")
    r = pins.client.get("/me/up-next")
    assert r.status_code == 200 and ids(r) == [a.id, c.id]
    pins.attempt(a, "reading")
    assert ids(pins.client.get("/me/up-next")) == [c.id]
    assert ids(pins.put([c.id])) == [c.id]                                  # the next replace clears the stale ones
    pins.db.expire_all()
    assert pins.db.get(pins.models.UserBook, a.id).up_next_position is None
    assert pins.db.get(pins.models.UserBook, b.id).up_next_position is None


def test_a_private_entry_pins_with_no_book_id_and_the_readers_own_text_wins(pins):
    private = pins.models.UserBook(user_id=pins.reader.id, private_title="My own book", private_author="Me Myself", is_owned=True,
                                   private_catalogue={"cover_image_url": "https://covers.example/mine.jpg"})
    pins.db.add(private)
    linked = pins.entries[0]
    linked.private_title, linked.private_author = "Reader's title", "Reader's author"
    pins.db.commit()
    items = pins.put([private.id, linked.id]).json()
    assert items[0] == {"entry_id": private.id, "book_id": None, "title": "My own book", "authors": ["Me Myself"],
                        "cover_url": "https://covers.example/mine.jpg", "owned": True, "want": False, "page_count": None}
    assert items[1]["book_id"] == pins.books[0].id and items[1]["title"] == "Reader's title" and items[1]["authors"] == ["Reader's author"]


def test_a_get_is_one_statement(pins, app_modules):
    pins.put([e.id for e in pins.entries[:3]])
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert pins.client.get("/me/up-next").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len([s for s in statements if "up_next_position" in s]) == 1 and len(statements) <= 2


def test_pins_are_private_to_their_reader(pins, client, app_modules):
    from auth.dependencies import get_current_user
    pins.put([pins.entries[0].id])
    other = pins.models.User(email=f"other-{uuid.uuid4().hex}@example.com", hashed_password="x")
    pins.db.add(other)
    pins.db.commit()
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
    assert client.get("/me/up-next").json() == []


def test_the_up_next_migration_follows_the_current_head():
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[2] / "alembic" / "versions" / "e4a9c6d1b835_up_next_pins.py"
    assert "down_revision = 'd2b7c4e9f1a3'" in path.read_text(encoding="utf-8")


# --- sort=added_oldest ------------------------------------------------------------------------------------------

def test_added_oldest_lists_the_longest_saved_first_across_a_page_boundary(client, reader, db_session, app_modules):
    models = app_modules["models"]
    when = {"first": datetime(2026, 3, 1, tzinfo=timezone.utc), "second": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "third": datetime(2026, 1, 1, tzinfo=timezone.utc), "fourth": datetime(2026, 2, 1, tzinfo=timezone.utc)}
    made = {}
    for name, created in when.items():     # ids ascend first..fourth; the dates do not
        item = models.UserBook(user_id=reader.id, private_title=f"{name} book", is_wanted=True, created_at=created)
        db_session.add(item)
        db_session.flush()
        made[name] = item
    db_session.commit()
    names = {item.id: name for name, item in made.items()}
    expected = ["second", "third", "fourth", "first"]                  # date ascending, then id ascending
    full = client.get("/me/library", params={"sort": "added_oldest", "limit": 100}).json()
    assert [names[i["id"]] for i in full["items"]] == expected and full["index"] is None and full["next_cursor"] is None
    page_one = client.get("/me/library", params={"sort": "added_oldest", "limit": 2}).json()
    assert [names[i["id"]] for i in page_one["items"]] == expected[:2] and page_one["next_cursor"]
    page_two = client.get("/me/library", params={"sort": "added_oldest", "limit": 2, "cursor": page_one["next_cursor"]}).json()
    assert [names[i["id"]] for i in page_two["items"]] == expected[2:] and page_two["next_cursor"] is None
    # existing sorts are untouched, and a cursor does not cross from one sort to the other
    assert [names[i["id"]] for i in client.get("/me/library", params={"limit": 100}).json()["items"]] == ["fourth", "third", "second", "first"]
    r = client.get("/me/library", params={"sort": "added", "limit": 2, "cursor": page_one["next_cursor"]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_cursor"
