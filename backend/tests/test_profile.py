"""Profile v1: profile settings, yearly stats, reading lists and the public pages."""
import json
import uuid
from datetime import date

import pytest
from sqlalchemy import delete, select, text


@pytest.fixture()
def world(client, db_session, app_modules, seeded_books):
    from auth.dependencies import get_current_user
    models = app_modules["models"]
    main = app_modules["main"]
    created = []

    class World:
        pass

    w = World()
    w.models, w.db, w.books = models, db_session, list(seeded_books.values())

    def make_user(email=None, **fields):
        user = models.User(email=email or f"p-{uuid.uuid4().hex[:10]}@example.test", hashed_password="x", **fields)
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    def act_as(user):
        main.app.dependency_overrides[get_current_user] = lambda: user

    def anonymous():
        main.app.dependency_overrides.pop(get_current_user, None)

    w.make_user, w.act_as, w.anonymous, w.client = make_user, act_as, anonymous, client
    yield w
    anonymous()
    db_session.rollback()
    db_session.execute(delete(models.User).where(models.User.id.in_(created)))
    db_session.commit()


def detail(response):
    return response.json()["detail"]["code"]


# --- migration ---------------------------------------------------------------------------------------------------

def test_migration_adds_profile_columns_and_list_tables(db_session):
    columns = {row[0] for row in db_session.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"))}
    assert {"display_name", "bio", "handle", "profile_public", "profile_prompted_at"} <= columns
    tables = {row[0] for row in db_session.execute(text(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
    assert {"reading_lists", "reading_list_items"} <= tables


def test_migration_revision_follows_the_import_description():
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "a7d4e2b9c683_profile_v1.py"
    assert "down_revision = 'f6c3d9a25e71'" in path.read_text(encoding="utf-8")


# --- profile -----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name,local,expected", [
    ("Ada Lovelace", "x", "AL"), ("ada lovelace byron", "x", "AL"), ("Plato", "x", "P"),
    (None, "zed", "Z"), ("   ", "mary.s", "M"),
])
def test_initials_rules(world, name, local, expected):
    world.act_as(world.make_user(email=f"{local}.{uuid.uuid4().hex[:6]}@example.test", display_name=name))
    assert world.client.get("/me/profile").json()["initials"] == expected


def test_get_profile_shape_and_defaults(world):
    user = world.make_user()
    world.act_as(user)
    body = world.client.get("/me/profile").json()
    assert body == {"display_name": None, "bio": None, "initials": user.email[0].upper(), "handle": None,
                    "profile_public": False, "show_prompt": True, "reading_since": user.created_at.year}


def test_patch_trims_blanks_to_null_and_prompted_clears_the_prompt(world):
    world.act_as(world.make_user())
    r = world.client.patch("/me/profile", json={"display_name": "  Ada   Lovelace ", "bio": "   ", "prompted": True})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Ada Lovelace" and r.json()["bio"] is None and r.json()["show_prompt"] is False


@pytest.mark.parametrize("changes,status,code", [
    ({"display_name": "x" * 41}, 422, "display_name_invalid"), ({"bio": "x" * 161}, 422, "bio_invalid"),
    ({"handle": "ab"}, 422, "handle_invalid"), ({"handle": "x" * 31}, 422, "handle_invalid"),
    ({"handle": "has_underscore"}, 422, "handle_invalid"), ({"handle": "sp ace"}, 422, "handle_invalid"),
    ({"handle": "admin"}, 422, "handle_reserved"), ({"handle": "Privacy"}, 422, "handle_reserved"),
    ({"profile_public": True}, 422, "handle_required"),
])
def test_patch_validation(world, changes, status, code):
    world.act_as(world.make_user())
    r = world.client.patch("/me/profile", json=changes)
    assert r.status_code == status and detail(r) == code
    assert world.client.get("/me/profile").json()["profile_public"] is False  # a refused change saves nothing


def test_handles_are_lowercased_unique_changeable_and_the_old_link_stops_working(world):
    first, second = world.make_user(), world.make_user()
    world.act_as(first)
    assert world.client.patch("/me/profile", json={"handle": "Reader-One", "profile_public": True}).json()["handle"] == "reader-one"
    world.act_as(second)
    r = world.client.patch("/me/profile", json={"handle": "reader-one"})
    assert r.status_code == 409 and detail(r) == "handle_taken"
    world.anonymous()
    assert world.client.get("/u/reader-one").status_code == 200
    world.act_as(first)
    assert world.client.patch("/me/profile", json={"handle": "reader-two"}).json()["handle"] == "reader-two"
    world.anonymous()
    assert world.client.get("/u/reader-one").status_code == 404
    assert world.client.get("/u/reader-two").status_code == 200
    world.act_as(second)
    assert world.client.patch("/me/profile", json={"handle": "reader-one"}).status_code == 200  # freed


def test_a_handle_can_be_cleared_while_private(world):
    world.act_as(world.make_user())
    world.client.patch("/me/profile", json={"handle": "going-away"})
    assert world.client.patch("/me/profile", json={"handle": ""}).json()["handle"] is None


# --- stats -------------------------------------------------------------------------------------------------------

def finish(w, user, book, ended_on, total_pages=None, private_title=None, state="finished"):
    models = w.models
    entry = None
    if book is not None:
        entry = w.db.scalar(select(models.UserBook).where(models.UserBook.user_id == user.id, models.UserBook.book_id == book.id))
    if entry is None:
        entry = models.UserBook(user_id=user.id, book_id=book.id if book is not None else None,
                                private_title=private_title, is_owned=True)
        w.db.add(entry)
        w.db.flush()
    w.db.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state=state, ended_on=ended_on,
                                   started_on=None, total_pages=total_pages, creation_fingerprint=uuid.uuid4().hex))
    w.db.commit()
    return entry


def test_stats_count_rereads_private_entries_missing_pages_and_boundaries(world):
    user = world.make_user()
    a, b, c = world.books[:3]
    a.page_count, b.page_count, c.page_count = 100, None, 300
    world.db.commit()
    genre = world.models.Tag(name=f"Genre-{uuid.uuid4().hex[:5]}", type=world.models.TagType.genre)
    world.db.add(genre)
    world.db.flush()
    world.db.execute(world.models.book_tags.insert().values([{"book_id": a.id, "tag_id": genre.id}]))
    finish(world, user, a, date(2026, 1, 1))                       # first day of the year
    finish(world, user, a, date(2026, 3, 5))                       # reread counts again
    finish(world, user, b, date(2026, 3, 9))                       # no pages anywhere -> 0
    finish(world, user, c, date(2026, 12, 31), total_pages=250)    # attempt pages win over the book's
    finish(world, user, None, date(2026, 3, 20), private_title="Mine", total_pages=40)  # private: books and pages only
    finish(world, user, c, date(2025, 12, 31))                     # last year
    finish(world, user, c, date(2027, 1, 1))                       # next year
    finish(world, user, c, date(2026, 6, 1), state="dnf")          # not finished
    world.act_as(user)
    stats = world.client.get("/me/stats?year=2026").json()
    assert stats["books_finished"] == 5 and stats["pages_read"] == 100 + 100 + 0 + 250 + 40
    assert stats["by_month"] == [1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1] and stats["biggest_month"] == 3
    assert {"name": genre.name, "count": 2} in stats["top_genres"] and len(stats["top_genres"]) <= 3
    assert stats["year"] == 2026


def test_stats_for_an_empty_year_and_the_default_year(world):
    world.act_as(world.make_user())
    body = world.client.get("/me/stats?year=2020").json()
    assert body == {"year": 2020, "books_finished": 0, "pages_read": 0, "by_month": [0] * 12, "top_genres": [],
                    "biggest_month": None}
    assert world.client.get("/me/stats").json()["year"] == date.today().year
    assert world.client.get("/me/stats?year=abc").status_code == 422


def test_stats_only_count_the_signed_in_reader(world):
    mine, other = world.make_user(), world.make_user()
    finish(world, other, world.books[0], date(2026, 2, 2))
    world.act_as(mine)
    assert world.client.get("/me/stats?year=2026").json()["books_finished"] == 0


# --- lists -------------------------------------------------------------------------------------------------------

def test_list_crud_add_remove_order_and_cross_reader_404(world):
    owner, other = world.make_user(), world.make_user()
    world.act_as(owner)
    made = world.client.post("/me/lists", json={"name": " Winter  reads ", "description": "cosy"})
    assert made.status_code == 201 and made.json()["name"] == "Winter reads" and made.json()["is_public"] is False
    lid = made.json()["id"]
    ids = [book.id for book in world.books[:3]]
    for book_id in ids:
        assert world.client.post(f"/me/lists/{lid}/books", json={"book_id": book_id}).status_code == 204
    assert world.client.post(f"/me/lists/{lid}/books", json={"book_id": ids[0]}).status_code == 204  # no duplicate
    assert [b["id"] for b in world.client.get(f"/me/lists/{lid}").json()["books"]] == ids
    summary = world.client.get("/me/lists").json()[0]
    assert summary["book_count"] == 3 and len(summary["covers"]) <= 3
    assert "has_book" not in summary
    second = world.client.post("/me/lists", json={"name": "Empty"}).json()["id"]
    flags = {row["id"]: row["has_book"] for row in world.client.get(f"/me/lists?book_id={ids[0]}").json()}
    assert flags == {lid: True, second: False}
    assert world.client.delete(f"/me/lists/{second}").status_code == 204
    assert world.client.put(f"/me/lists/{lid}/order", json={"book_ids": ids[::-1]}).status_code == 204
    assert [b["id"] for b in world.client.get(f"/me/lists/{lid}").json()["books"]] == ids[::-1]
    for bad in (ids[:2], ids + [ids[0]], ids[:2] + [999999999]):
        r = world.client.put(f"/me/lists/{lid}/order", json={"book_ids": bad})
        assert r.status_code == 422 and detail(r) == "order_mismatch"
    assert world.client.post(f"/me/lists/{lid}/books", json={"book_id": 999999999}).status_code == 404
    assert world.client.delete(f"/me/lists/{lid}/books/{ids[0]}").status_code == 204
    assert world.client.patch(f"/me/lists/{lid}", json={"name": "Renamed", "is_public": True}).json()["is_public"] is True
    world.act_as(other)
    for call in (world.client.get(f"/me/lists/{lid}"), world.client.patch(f"/me/lists/{lid}", json={"name": "x"}),
                 world.client.delete(f"/me/lists/{lid}"), world.client.post(f"/me/lists/{lid}/books", json={"book_id": ids[0]}),
                 world.client.put(f"/me/lists/{lid}/order", json={"book_ids": []})):
        assert call.status_code == 404
    assert world.client.get("/me/lists").json() == []
    world.act_as(owner)
    assert world.client.delete(f"/me/lists/{lid}").status_code == 204
    assert world.client.get(f"/me/lists/{lid}").status_code == 404


def test_list_name_is_required_and_limits_are_enforced(world, monkeypatch):
    from services import profile
    world.act_as(world.make_user())
    assert world.client.post("/me/lists", json={"name": "  "}).status_code == 422
    assert world.client.post("/me/lists", json={"name": "x" * 81}).status_code == 422
    monkeypatch.setattr(profile, "MAX_LISTS", 2)
    monkeypatch.setattr(profile, "MAX_BOOKS_PER_LIST", 1)
    first = world.client.post("/me/lists", json={"name": "a"}).json()["id"]
    assert world.client.post("/me/lists", json={"name": "b"}).status_code == 201
    r = world.client.post("/me/lists", json={"name": "c"})
    assert r.status_code == 422 and detail(r) == "list_limit"
    world.client.post(f"/me/lists/{first}/books", json={"book_id": world.books[0].id})
    r = world.client.post(f"/me/lists/{first}/books", json={"book_id": world.books[1].id})
    assert r.status_code == 422 and detail(r) == "list_limit"


def test_the_owner_view_carries_shelf_status_and_finished_month_in_one_query(world, app_modules):
    from sqlalchemy import event
    user = world.make_user()
    a, b, c = world.books[:3]
    entry = finish(world, user, a, date(2026, 4, 2))
    finish(world, user, a, date(2026, 9, 30))  # the latest finish wins
    world.act_as(user)
    lid = world.client.post("/me/lists", json={"name": "L"}).json()["id"]
    for book in (a, b, c):
        world.client.post(f"/me/lists/{lid}/books", json={"book_id": book.id})
    world.db.expire_all()
    statements = []
    engine = world.db.get_bind()
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        books = world.client.get(f"/me/lists/{lid}").json()["books"]
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert [(x["status"], x["finished_month"]) for x in books] == [("owned", "2026-09"), (None, None), (None, None)]
    assert len([s for s in statements if "reading_list_items" in s and s.lstrip().upper().startswith("SELECT")]) == 1


# --- public pages ------------------------------------------------------------------------------------------------

SECRET_KEYS = {"email", "save_note", "note", "notes", "reaction", "reactions", "rating", "ratings", "status", "finished_month",
               "ended_on", "started_on", "finished_on", "hashed_password", "profile_prompted_at", "is_owned", "is_wanted",
               "private_title", "private_author", "private_description", "user_id", "id_user", "handle_hash"}


def all_keys(value):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from all_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from all_keys(inner)


def test_public_payloads_never_contain_private_data(world):
    user = world.make_user(email="very.secret.reader@example.test")
    world.act_as(user)
    world.client.patch("/me/profile", json={"display_name": "Ada Lovelace", "bio": "Hello", "handle": "ada-public", "profile_public": True})
    a, b = world.books[:2]
    entry = finish(world, user, a, date.today())
    entry.save_note = "SECRET-SAVE-NOTE"
    world.db.add(world.models.UserBook(user_id=user.id, book_id=None, private_title="SECRET-PRIVATE-ENTRY", is_wanted=True))
    attempt = world.db.scalar(select(world.models.ReadingAttempt).where(world.models.ReadingAttempt.user_book_id == entry.id))
    attempt.note, attempt.reaction = "SECRET-ATTEMPT-NOTE", "loved"
    world.db.commit()
    public_id = world.client.post("/me/lists", json={"name": "Public one", "is_public": True}).json()["id"]
    private_id = world.client.post("/me/lists", json={"name": "SECRET-PRIVATE-LIST"}).json()["id"]
    for lid in (public_id, private_id):
        for book in (a, b):
            world.client.post(f"/me/lists/{lid}/books", json={"book_id": book.id})
    world.anonymous()
    page = world.client.get("/u/ada-public")
    one = world.client.get(f"/u/ada-public/lists/{public_id}")
    assert page.status_code == one.status_code == 200
    blob = json.dumps([page.json(), one.json()])
    for needle in ("very.secret", "example.test", "SECRET-SAVE-NOTE", "SECRET-PRIVATE-ENTRY", "SECRET-ATTEMPT-NOTE",
                   "SECRET-PRIVATE-LIST", "loved", str(date.today())):
        assert needle not in blob
    assert not SECRET_KEYS & set(all_keys([page.json(), one.json()]))
    assert [item["name"] for item in page.json()["lists"]] == ["Public one"]
    assert [x["id"] for x in one.json()["books"]] == [a.id, b.id]
    assert page.json()["reading_since"] == user.created_at.year and page.json()["initials"] == "AL"
    assert set(page.json()) == {"display_name", "initials", "bio", "reading_since", "stats", "lists"}
    assert "Cache-Control" in page.headers and "public" in page.headers["Cache-Control"]
    assert world.client.get(f"/u/ada-public/lists/{private_id}").status_code == 404


def test_public_initials_never_come_from_the_email(world):
    user = world.make_user(email="qzmail@example.test")
    world.act_as(user)
    world.client.patch("/me/profile", json={"handle": "handle-letter", "profile_public": True})
    assert world.client.get("/me/profile").json()["initials"] == "Q"  # the owner's own view may use the email
    lid = world.client.post("/me/lists", json={"name": "L", "is_public": True}).json()["id"]
    world.anonymous()
    assert world.client.get("/u/handle-letter").json()["initials"] == "H"
    assert world.client.get(f"/u/handle-letter/lists/{lid}").json()["owner"]["initials"] == "H"
    cache = world.client.get("/u/handle-letter").headers["Cache-Control"]
    assert cache == "public, max-age=60"


@pytest.mark.parametrize("word", ["profile", "account", "register", "bookvane", "support", "my-books", "browse", "home"])
def test_more_reserved_usernames(world, word):
    world.act_as(world.make_user())
    r = world.client.patch("/me/profile", json={"handle": word})
    assert r.status_code == 422 and detail(r) == "handle_reserved"


def test_every_kind_of_missing_public_page_is_the_same_404(world):
    user = world.make_user()
    world.act_as(user)
    world.client.patch("/me/profile", json={"handle": "quiet-reader"})  # exists but private
    lid = world.client.post("/me/lists", json={"name": "Hidden"}).json()["id"]
    other = world.make_user()
    world.act_as(other)
    world.client.patch("/me/profile", json={"handle": "loud-reader", "profile_public": True})
    world.anonymous()
    responses = [world.client.get(path) for path in (
        "/u/quiet-reader", "/u/nobody-here", f"/u/quiet-reader/lists/{lid}", f"/u/loud-reader/lists/{lid}",
        "/u/loud-reader/lists/987654321", "/u/UPPER-nobody")]
    assert {r.status_code for r in responses} == {404}
    assert len({json.dumps(r.json()) for r in responses}) == 1
    assert detail(responses[0]) == "not_found"
    assert all("public" not in r.headers.get("Cache-Control", "") for r in responses)


def test_going_private_or_making_a_list_private_takes_effect_at_once(world):
    user = world.make_user()
    world.act_as(user)
    world.client.patch("/me/profile", json={"handle": "flip-flop", "profile_public": True})
    lid = world.client.post("/me/lists", json={"name": "L", "is_public": True}).json()["id"]
    world.anonymous()
    assert world.client.get("/u/flip-flop").status_code == 200
    assert world.client.get(f"/u/flip-flop/lists/{lid}").status_code == 200
    world.act_as(user)
    world.client.patch(f"/me/lists/{lid}", json={"is_public": False})
    world.anonymous()
    assert world.client.get(f"/u/flip-flop/lists/{lid}").status_code == 404
    assert world.client.get("/u/flip-flop").json()["lists"] == []
    world.act_as(user)
    world.client.patch("/me/profile", json={"profile_public": False})
    world.anonymous()
    assert world.client.get("/u/flip-flop").status_code == 404


def test_signed_out_readers_cannot_use_the_private_endpoints(world):
    world.anonymous()
    for method, path in (("get", "/me/profile"), ("patch", "/me/profile"), ("get", "/me/stats"), ("get", "/me/lists"),
                         ("post", "/me/lists"), ("get", "/me/lists/1")):
        assert getattr(world.client, method)(path).status_code == 401


def test_profile_is_an_allowed_signup_source(client, db_session, app_modules):
    models = app_modules["models"]
    email = f"src-{uuid.uuid4().hex[:6]}@example.com"
    from services import event_counts
    assert event_counts.clean_source("profile") == "profile"
    assert client.post("/auth/register?src=profile", json={"email": email, "password": "long enough password"}).status_code == 201
    row = db_session.scalar(select(models.EventCount).where(models.EventCount.name == "register_completed",
                                                            models.EventCount.src == "profile"))
    assert row is not None
    db_session.execute(delete(models.User).where(models.User.email == email))
    db_session.commit()
