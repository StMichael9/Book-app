"""T46: one genre system. The taxonomy itself needs no database; the migration, endpoint and personal genres do."""
import importlib.util
import pathlib
import uuid

import pytest
from sqlalchemy import select, text

from data import clean, taxonomy


# --- the list and the mapping (no database) -------------------------------------------------------------------------------

def test_there_are_28_genres_in_two_groups_with_the_planned_names():
    groups = {}
    for key, label, group in taxonomy.GENRES:
        groups.setdefault(group, []).append(label)
    assert len(taxonomy.GENRES) == 28 and len(groups["fiction"]) == 15 and len(groups["nonfiction"]) == 13
    assert groups["fiction"][:3] == ["Fantasy", "Science fiction", "Mystery & crime"] and "Children's" in groups["fiction"]
    assert groups["nonfiction"][0] == "Graphic novels & comics" and groups["nonfiction"][-1] == "Art & music"
    assert set(taxonomy.SUBJECT_ALIASES) == set(taxonomy.GENRE_KEYS) == set(taxonomy.PARTIAL_KEYWORDS)
    assert set(taxonomy.CATEGORY_TYPES.values()) == {"genre"}


def test_one_exact_alias_is_enough():
    assert taxonomy.genres_for_subjects(["Fantasy fiction"]) == ["fantasy"]
    assert taxonomy.genres_for_subjects(["Detective and mystery stories"]) == ["mystery_crime"]
    assert taxonomy.genres_for_subjects(["Science-fiction"]) == ["science_fiction"]
    assert taxonomy.genres_for_subjects(["Self-help"]) == ["self_help"]
    assert taxonomy.genres_for_subjects(["Comic books, strips, etc."]) == ["graphic_novels"]


def test_one_partial_hit_is_not_enough_but_two_are():
    assert taxonomy.genres_for_subjects(["Wizard schools in Scotland"]) == []
    assert taxonomy.genres_for_subjects(["Wizard schools in Scotland", "Dragon riders"]) == ["fantasy"]
    assert taxonomy.genres_for_subjects(["Wizard schools in Scotland", "Wizard schools in Scotland"]) == []      # the same subject twice


def test_nothing_to_go_on_gives_no_genre_and_moods_and_themes_are_never_genres():
    assert taxonomy.genres_for_subjects(["Zebra", "Window"]) == [] and taxonomy.genres_for_subjects(None) == []
    assert all(name not in taxonomy.GENRE_KEYS for name, _ in taxonomy.MOOD_THEME_MAP.values())
    assert taxonomy.genres_for_subjects(["Friendship -- Fiction"]) == []


def test_a_book_gets_the_best_supported_genres_and_at_most_three():
    found = taxonomy.genres_for_subjects(["Fantasy", "Magic", "Dragons", "Fairy tales", "Wizards", "Romance", "Mystery", "Horror"])
    assert found[0] == "fantasy" and len(found) == 3


def test_a_reviewed_custom_mapping_is_exact_only():
    assert taxonomy.genres_for_subjects(["Lighthouses", "Wizards"], {"lighthouses": "travel"}) == ["travel"]


def test_the_importer_assigns_only_genre_tags_from_the_new_list():
    work = {"key": "/works/OL1W", "title": "A Book", "authors": [{"author": {"key": "/authors/OL1A"}}],
            "subjects": ["Fantasy fiction", "Humorous stories", "Friendship -- Fiction"]}
    tags = clean.normalize_work(work)["tags"]
    assert {"name": "fantasy", "type": "genre"} in tags and {"name": "Humorous", "type": "mood"} in tags
    assert all(t["name"] in taxonomy.GENRE_KEYS for t in tags if t["type"] == "genre")
    assert clean.normalize_work({**work, "subjects": ["Zebra"]}) is None


def test_a_readers_shelf_name_counts_as_a_genre_for_that_reader():
    assert taxonomy.genre_for_label("sci-fi") == "science_fiction" and taxonomy.genre_for_label("Fantasy") == "fantasy"
    assert taxonomy.genre_for_label("to-read") is None and taxonomy.genre_for_label("favorites") is None and taxonomy.genre_for_label("") is None


# --- the database --------------------------------------------------------------------------------------------------------

@pytest.fixture()
def genre_tags(db_session):
    """The migration creates the 28 genre tags; other test files wipe the tags table, so make sure they are there."""
    db_session.execute(text("DELETE FROM tags WHERE lower(name) = ANY(:keys) AND type::text <> 'genre'"), {"keys": list(taxonomy.GENRE_KEYS)})
    for key in taxonomy.GENRE_KEYS:
        db_session.execute(text("INSERT INTO tags (name, type, visible_in_v2) VALUES (:n, 'genre', true) "
                                "ON CONFLICT (name, type) DO UPDATE SET visible_in_v2 = true"), {"n": key})
    db_session.commit()


def test_the_endpoint_serves_the_same_list_with_each_genres_tag_id(client, db_session, app_modules, genre_tags):
    models = app_modules["models"]
    r = client.get("/genres")
    assert r.status_code == 200 and "max-age" in r.headers["cache-control"]
    items = r.json()
    assert [(i["key"], i["label"], i["group"]) for i in items] == [(k, label, g) for k, label, g in taxonomy.GENRES]
    rows = dict(db_session.execute(select(models.Tag.id, models.Tag.name).where(models.Tag.type == models.TagType.genre)).all())
    assert all(rows[i["id"]] == i["key"] for i in items) and len({i["id"] for i in items}) == 28      # ids are the tags rows


def test_all_28_genre_tags_exist_and_are_shown(db_session, app_modules, genre_tags):
    models = app_modules["models"]
    rows = db_session.execute(select(models.Tag.name, models.Tag.visible_in_v2).where(models.Tag.type == models.TagType.genre)).all()
    shown = {name for name, visible in rows if visible}
    assert set(taxonomy.GENRE_KEYS) <= shown


def _migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c3e6a0b42d79_genre_taxonomy.py"
    spec = importlib.util.spec_from_file_location("genre_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def rollback_connection(app_modules):
    """A connection whose changes are always rolled back, so a migration can be rehearsed on the disposable database."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    engine = app_modules["database"].engine
    with engine.connect() as conn:
        trans = conn.begin()
        context = Operations.context(MigrationContext.configure(conn))
        yield conn, context
        trans.rollback()


def _tag(conn, name, kind="topic"):
    return conn.execute(text("INSERT INTO tags (name, type, visible_in_v2) VALUES (:n, CAST(:t AS tagtype), true) "
                             "ON CONFLICT (name, type) DO UPDATE SET visible_in_v2 = true RETURNING id"), {"n": name, "t": kind}).scalar()


def test_the_migration_merges_old_tags_and_keeps_books_and_readers_picks(rollback_connection, genre_tags):
    conn, context = rollback_connection
    book = conn.execute(text("SELECT id FROM books ORDER BY id LIMIT 1")).scalar()
    art, music = _tag(conn, "art"), _tag(conn, "music")
    new = conn.execute(text("SELECT id FROM tags WHERE name = 'art_music' AND type = 'genre'")).scalar()
    user = conn.execute(text("INSERT INTO users (id, email, hashed_password) VALUES (:i, :e, 'x') RETURNING id"),
                        {"i": uuid.uuid4(), "e": f"mig-{uuid.uuid4().hex[:8]}@example.test"}).scalar()
    for tag_id in (art, music):
        conn.execute(text("INSERT INTO book_tags (book_id, tag_id, source_managed) VALUES (:b, :t, true)"), {"b": book, "t": tag_id})
        conn.execute(text("INSERT INTO user_preferences (user_id, tag_id) VALUES (:u, :t)"), {"u": user, "t": tag_id})
    with context:
        _migration().upgrade()
    assert conn.execute(text("SELECT count(*) FROM tags WHERE name IN ('art', 'music') AND type = 'topic'")).scalar() == 0
    assert conn.execute(text("SELECT count(*) FROM book_tags WHERE book_id = :b AND tag_id = :t"), {"b": book, "t": new}).scalar() == 1
    assert conn.execute(text("SELECT count(*) FROM user_preferences WHERE user_id = :u AND tag_id = :t"), {"u": user, "t": new}).scalar() == 1
    assert conn.execute(text("SELECT visible_in_v2 FROM tags WHERE id = :t"), {"t": new}).scalar() is True


def test_the_migration_renames_in_place_when_the_new_genre_does_not_exist_yet(rollback_connection, genre_tags):
    conn, context = rollback_connection
    conn.execute(text("DELETE FROM tags WHERE name = 'biography_memoir' AND type = 'genre'"))
    old = _tag(conn, "biography", "genre")
    with context:
        _migration().upgrade()
    row = conn.execute(text("SELECT name, type::text, visible_in_v2 FROM tags WHERE id = :i"), {"i": old}).first()
    assert tuple(row) == ("biography_memoir", "genre", True)                      # same id, so every link and pick survives


def test_tags_with_no_genre_stay_as_plain_topics_outside_the_picker(rollback_connection):
    conn, context = rollback_connection
    sports = _tag(conn, "sports")
    with context:
        _migration().upgrade()
    assert tuple(conn.execute(text("SELECT name, type::text, visible_in_v2 FROM tags WHERE id = :i"), {"i": sports}).first()) == ("sports", "topic", False)


def test_the_migration_downgrades_renames_and_follows_the_current_head():
    source = (pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c3e6a0b42d79_genre_taxonomy.py").read_text(encoding="utf-8")
    assert "down_revision = 'a1c4e8b27d56'" in source


def test_a_downgrade_restores_the_old_names(rollback_connection):
    conn, context = rollback_connection
    conn.execute(text("DELETE FROM tags WHERE name IN ('mystery', 'mystery_crime') AND type = 'genre'"))
    renamed = _tag(conn, "mystery_crime", "genre")
    with context:
        _migration().downgrade()
    assert tuple(conn.execute(text("SELECT name, type::text FROM tags WHERE id = :i"), {"i": renamed}).first()) == ("mystery", "genre")


# --- personal genres from imported shelves ---------------------------------------------------------------------------------

def test_an_imported_shelf_named_like_a_genre_filters_for_that_reader_only(db_session, app_modules, client, monkeypatch, genre_tags):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_enabled", True)
    monkeypatch.setattr(app_modules["database"].settings, "reading_v3_user_ids", "")
    mine, other = (models.User(email=f"g-{uuid.uuid4().hex[:8]}@example.test", hashed_password="x") for _ in range(2))
    db_session.add_all([mine, other])
    db_session.commit()
    entry = models.UserBook(user_id=mine.id, private_title="My sci-fi book", is_wanted=True)
    plain = models.UserBook(user_id=mine.id, private_title="Unshelved", is_wanted=True)
    theirs = models.UserBook(user_id=other.id, private_title="Theirs", is_wanted=True)
    db_session.add_all([entry, plain, theirs])
    db_session.flush()
    db_session.add(models.ImportedLibraryRecord(user_id=mine.id, user_book_id=entry.id, source="goodreads", scope="s",
                                                record_key=uuid.uuid4().hex[:16], accepted_hash="h", context={"labels": ["sci-fi", "owned"]}))
    db_session.commit()
    genre_id = db_session.scalar(select(models.Tag.id).where(models.Tag.name == "science_fiction", models.Tag.type == models.TagType.genre))
    app_modules["main"].app.dependency_overrides[get_current_user] = lambda: mine
    limiter.reset()
    try:
        ids = [i["id"] for i in client.get("/me/library", params={"subject": genre_id}).json()["items"]]
        assert ids == [entry.id]
        assert db_session.scalar(select(models.book_tags.c.book_id).where(models.book_tags.c.tag_id == genre_id,
                                                                         models.book_tags.c.book_id == entry.book_id)) is None
        app_modules["main"].app.dependency_overrides[get_current_user] = lambda: other
        assert client.get("/me/library", params={"subject": genre_id}).json()["items"] == []
    finally:
        app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
        db_session.rollback()
        for item in (mine, other):
            db_session.delete(item)
        db_session.commit()
        limiter.reset()
