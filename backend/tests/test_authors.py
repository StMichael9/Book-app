"""T71 Part A: author bio and photo cleaning, the author endpoints, the author SEO page and sitemap chunk, the backfill tool and
the duplicate-author report."""
import json
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, event, select, text
from sqlalchemy.orm import sessionmaker

from data import clean

INDEX = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")


# --- cleaning (no database) --------------------------------------------------------------------------------------------

def test_bio_is_plain_text_without_markdown_links_or_credits():
    raw = "**Jane** Doe is a [writer](http://example.org/x) of _books_.\r\n\r\n----------\r\nSource: Wikipedia"
    assert clean.author_bio(raw) == "Jane Doe is a writer of books."
    assert clean.author_bio({"type": "/type/text", "value": "A [ref][1] and https://x.org gone.\n\n[1]: http://y.org"}) == "A ref and gone."
    assert clean.author_bio("He wrote 5_000 words and _lots_ of **books**.") == "He wrote 5_000 words and lots of books."


def test_bio_is_cut_at_a_sentence_end_within_600_characters():
    long = "One sentence here. " * 60
    cut = clean.author_bio(long)
    assert len(cut) <= 600 and cut.endswith("here.") and cut == ("One sentence here. " * 40).strip()[:len(cut)]
    assert clean.author_bio("x" * 700) is None                    # no sentence end to cut at: not cut mid-sentence
    assert len(clean.author_bio("Short and complete.")) == 19


def test_bio_with_an_email_address_or_nothing_usable_is_dropped():
    assert clean.author_bio("Write to jane@example.com for talks.") is None
    for value in (None, 7, "", "   ", {"value": None}, ["a"], "----------\nSource: x"):
        assert clean.author_bio(value) is None


def test_photo_id_is_the_first_positive_integer():
    assert clean.author_photo([-1, 0, 5, 7]) == 5
    assert clean.author_photo([-1]) is None and clean.author_photo(None) is None and clean.author_photo(["5"]) is None
    assert clean.author_photo([True, 9]) == 9 and clean.author_photo([2 ** 40, 3]) == 3


def test_normalize_author_carries_bio_and_photo():
    record = {"key": "/authors/OL8A", "name": "Jane Doe", "bio": {"value": "A writer."}, "photos": [-1, 44]}
    assert clean.normalize_author(record) == {"source_id": "/authors/OL8A", "name": "Jane Doe", "bio": "A writer.", "photo_id": 44}
    assert clean.normalize_author({"key": "/authors/OL8A", "name": "Jane Doe"})["bio"] is None


# --- the database ------------------------------------------------------------------------------------------------------

@pytest.fixture()
def world(client, db_session, app_modules, monkeypatch):
    from services import seo as seo_module
    models = app_modules["models"]
    monkeypatch.setattr(app_modules["database"].settings, "frontend_base_url", "https://bookvane.me")

    class Site:
        def __call__(self, url, timeout=None, headers=None, **kwargs):
            class Response:
                status_code, text = 200, INDEX
            return Response()

    monkeypatch.setattr(seo_module.requests, "get", Site())
    seo_module.clear_caches()
    made = {"books": [], "authors": [], "users": []}

    class W:
        pass

    w = W()
    w.client, w.db, w.models, w.seo, w.made = client, db_session, models, seo_module, made

    def author(name="Ann Author", bio=None, photo=None, key=None):
        item = models.Author(name=name, bio=bio, photo_id=photo, source_id=key or f"/authors/OL{uuid.uuid4().int % 10 ** 8}A",
                             bio_source="open_library" if bio else None)
        db_session.add(item)
        db_session.commit()
        made["authors"].append(item.id)
        return item

    def book(title, authors, listed=True, popularity=None):
        item = models.Book(title=title, description="A stored description.", published_year=1999 if listed else None,
                           page_count=300 if listed else None, isbn13=None, cover_image_url="https://covers.openlibrary.org/b/id/1-L.jpg",
                           popularity=popularity, source_id=f"/works/OLT{uuid.uuid4().hex[:6]}W")
        item.authors = list(authors)
        db_session.add(item)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def user():
        item = models.User(email=f"au-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
        db_session.add(item)
        db_session.commit()
        made["users"].append(item.id)
        return item

    w.author, w.book, w.user = author, book, user
    yield w
    seo_module.clear_caches()
    db_session.rollback()
    for model, ids in ((models.UserBook, None), ):
        pass
    db_session.execute(delete(models.UserBook).where(models.UserBook.user_id.in_(made["users"])))
    for book_id in made["books"]:
        obj = db_session.get(models.Book, book_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()
    for author_id in made["authors"]:
        obj = db_session.get(models.Author, author_id)
        if obj is not None:
            db_session.delete(obj)
    for user_id in made["users"]:
        obj = db_session.get(models.User, user_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()


def test_author_page_shape_404_and_book_count(world):
    ann = world.author("Ann Author", bio="A short bio.", photo=77)
    world.book("One", [ann])
    world.book("Two", [ann])
    world.book("Unlisted", [ann], listed=False)
    body = world.client.get(f"/authors/{ann.id}").json()
    assert body == {"id": ann.id, "name": "Ann Author", "bio": "A short bio.", "photo_url": "https://covers.openlibrary.org/a/id/77-M.jpg",
                    "book_count": 2}
    bare = world.author("No Bio")
    assert world.client.get(f"/authors/{bare.id}").json() == {"id": bare.id, "name": "No Bio", "bio": None, "photo_url": None, "book_count": 0}
    assert world.client.get("/authors/99999999").status_code == 404
    assert world.client.get("/authors/99999999/books").status_code == 404


def test_author_books_are_popular_first_listed_only_and_paged_24(world):
    ann = world.author("Pager Person")
    books = [world.book(f"Book {n:02d}", [ann], popularity=float(n)) for n in range(30)]
    world.book("Hidden", [ann], listed=False, popularity=999.0)
    first = world.client.get(f"/authors/{ann.id}/books").json()
    assert (first["total"], first["page"], first["size"], first["pages"]) == (30, 1, 24, 2)
    assert [item["id"] for item in first["items"]] == [b.id for b in reversed(books)][:24]
    second = world.client.get(f"/authors/{ann.id}/books?page=2").json()
    assert [item["id"] for item in second["items"]] == [b.id for b in reversed(books)][24:]
    card = first["items"][0]
    assert {"id", "title", "authors", "tags", "cover_image_url"} <= set(card) and card["authors"] == [{"id": ann.id, "name": "Pager Person"}]
    assert card["shelf"] is None
    assert world.client.get(f"/authors/{ann.id}/books?page=3").json()["items"] == []
    assert world.client.get(f"/authors/{ann.id}/books?page=0").status_code == 422


def test_shelf_flags_for_a_signed_in_reader_in_a_constant_number_of_statements(world, app_modules):
    from auth.dependencies import get_current_user_optional
    ann = world.author("Shelf Author")
    books = [world.book(f"Shelf {n}", [ann], popularity=float(n)) for n in range(12)]
    reader = world.user()
    models = world.models
    entries = {}
    for index, book in enumerate(books[:6]):
        entry = models.UserBook(user_id=reader.id, book_id=book.id, status=models.UserBookStatus.owned if index == 0 else None,
                                is_owned=index % 2 == 0, is_wanted=index % 2 == 1)
        world.db.add(entry)
        entries[book.id] = entry
    world.db.commit()
    app_modules["main"].app.dependency_overrides[get_current_user_optional] = lambda: reader
    engine = app_modules["database"].engine

    def count(path):
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        event.listen(engine, "before_cursor_execute", listener)
        try:
            response = world.client.get(path)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        assert response.status_code == 200, response.text
        return response.json(), len(seen)

    try:
        body, signed_in = count(f"/authors/{ann.id}/books")
        flags = {item["id"]: item["shelf"] for item in body["items"]}
        for book in books[:6]:
            assert flags[book.id]["entry_id"] == entries[book.id].id
        assert flags[books[0].id]["status"] == "owned" and flags[books[0].id]["is_owned"] is True
        assert flags[books[1].id]["is_wanted"] is True
        assert all(flags[book.id] is None for book in books[6:])
        for extra in range(6, 12):
            world.db.add(models.UserBook(user_id=reader.id, book_id=books[extra].id, is_owned=True))
        world.db.commit()
        _, again = count(f"/authors/{ann.id}/books")
        assert again == signed_in                                        # shelf flags cost one batched query however many shelved
    finally:
        app_modules["main"].app.dependency_overrides.pop(get_current_user_optional, None)
    world.seo.clear_caches()
    _, anonymous = count(f"/authors/{ann.id}/books")
    assert anonymous < signed_in <= anonymous + 2        # the shelf query (and the reader row refresh the test itself causes)


def test_book_cards_and_up_next_carry_author_ids(world):
    ann, bob = world.author("Ann Ids"), world.author("Bob Ids")
    book = world.book("With Ids", [ann, bob])
    detail = world.client.get(f"/books/{book.id}").json()
    assert sorted(a["id"] for a in detail["authors"]) == sorted([ann.id, bob.id])
    found = world.client.get("/books", params={"book": "With Ids"}).json()["items"]
    assert any(item["id"] == book.id and all("id" in a for a in item["authors"]) for item in found)


# --- SEO ---------------------------------------------------------------------------------------------------------------

def test_author_seo_page_has_head_tags_person_json_ld_and_a_book_list(world):
    ann = world.author("Ann <Writer>", bio="Ann writes <b>things</b> & more.", photo=5, key="/authors/OL123A")
    world.book("First Book", [ann], popularity=2.0)
    world.book("Second & Book", [ann], popularity=1.0)
    response = world.client.get(f"/seo/author/{ann.id}")
    assert response.status_code == 200 and response.headers["cache-control"] == "public, max-age=300"
    page = response.text
    assert "<title>Ann &lt;Writer&gt; · Books and bio · Bookvane</title>" in page
    assert f'<link rel="canonical" href="https://bookvane.me/author/{ann.id}" />' in page
    ld = re.search(r'<script type="application/ld[+]json" id="bv-author-ld">(.*?)</script>', page, re.S).group(1)
    assert "<" not in ld and ">" not in ld and "&" not in ld
    data = json.loads(ld)
    assert data["@type"] == "Person" and data["name"] == "Ann <Writer>" and data["sameAs"] == ["https://openlibrary.org/authors/OL123A"]
    assert data["image"] == "https://covers.openlibrary.org/a/id/5-M.jpg"
    assert f'<li><a href="/book/' in page and "First Book" in page and "Second &amp; Book" in page
    assert page.index("First Book") < page.index("Second &amp; Book")
    assert "<h1>Ann &lt;Writer&gt;</h1>" in page and "<b>things</b>" not in page


def test_author_without_bio_or_listed_books(world):
    plain = world.author("Plain Person")
    world.book("Plain Book", [plain])
    page = world.client.get(f"/seo/author/{plain.id}").text
    assert "Plain Person: 1 book on Bookvane" in page and '"sameAs"' in page            # source key still gives the profile link
    empty = world.author("Empty Person")
    gone = world.client.get(f"/seo/author/{empty.id}")
    assert gone.status_code == 404 and 'id="root"' in gone.text
    assert world.client.get("/seo/author/99999999").status_code == 404


def test_author_sitemap_chunk_lists_only_authors_with_a_listed_book_and_the_index_links_it(world, monkeypatch):
    with_book, hidden_only, nothing = world.author("Has Book"), world.author("Hidden Only"), world.author("Nothing")
    world.book("Visible", [with_book])
    world.book("Not listed", [hidden_only], listed=False)
    world.seo.clear_caches()
    chunk = world.client.get("/sitemaps/authors-1.xml")
    assert chunk.status_code == 200 and chunk.headers["content-type"].startswith("application/xml")
    urls = re.findall(r"/author/(\d+)</loc>", chunk.text)
    assert str(with_book.id) in urls and str(hidden_only.id) not in urls and str(nothing.id) not in urls
    index = world.client.get("/sitemaps/index.xml").text
    assert "https://api.bookvane.me/sitemaps/authors-1.xml" in index
    assert world.client.get("/sitemaps/authors-0.xml").status_code == 404
    assert world.client.get("/sitemaps/authors-9999.xml").status_code == 404
    monkeypatch.setattr(world.seo, "SITEMAP_CHUNK", 1)
    world.seo.clear_caches()
    chunks = world.seo.author_sitemap_count(world.db)
    seen = []
    for n in range(1, chunks + 1):
        seen += re.findall(r"/author/(\d+)</loc>", world.client.get(f"/sitemaps/authors-{n}.xml").text)
    assert len(seen) == len(set(seen)) and str(with_book.id) in seen


# --- backfill tool -----------------------------------------------------------------------------------------------------

def dump(*records):
    return [(clean.author_key(r["key"]), clean.author_bio(r.get("bio")), clean.author_photo(r.get("photos"))) for r in records]


@pytest.fixture()
def backfill(world, app_modules):
    from data import author_bios
    world.module, world.factory = author_bios, sessionmaker(bind=app_modules["database"].engine)
    yield world
    world.db.rollback()
    world.db.execute(delete(world.models.CatalogueImportIssue).where(world.models.CatalogueImportIssue.code == "author_bio"))
    world.db.commit()


def only_mine(backfill, rows):
    """Limit the run to the authors this test made (the rest of the shared test database is not touched)."""
    ids = set(backfill.made["authors"])
    original = backfill.module.known_authors
    backfill.module.known_authors = lambda db: {k: v for k, v in original(db).items() if v.id in ids}
    return original


def state(backfill, author):
    backfill.db.rollback()
    return backfill.db.execute(text("SELECT bio, photo_id, bio_source FROM authors WHERE id = :i"), {"i": author.id}).one()


def test_backfill_dry_run_reports_rows_and_bytes_and_writes_nothing(backfill):
    one = backfill.author("Dry One", key="/authors/OL1001A")
    two = backfill.author("Dry Two", key="/authors/OL1002A")
    three = backfill.author("Dry Three", key="/authors/OL1003A")
    rows = dump({"key": "/authors/OL1001A", "bio": "A bio of ten.", "photos": [-1, 5]},
                {"key": "/authors/OL1002A", "photos": [9]},
                {"key": "/authors/OL1003A", "bio": ""}, {"key": "/authors/OL9999A", "bio": "Not ours."})
    original = only_mine(backfill, rows)
    try:
        report = backfill.module.run(backfill.factory, rows, apply=False)
    finally:
        backfill.module.known_authors = original
    assert report["applied"] is False and report["rows"] == 2 and report["written"] == 0
    assert report["bytes_added"] == len("A bio of ten.") + 4 + 4
    assert report["counts"]["with_bio"] == 1 and report["counts"]["with_photo"] == 2 and report["counts"]["nothing_to_add"] == 1
    for author in (one, two, three):
        assert tuple(state(backfill, author)) == (None, None, None)
    assert "Rows to change: 2" in backfill.module.markdown(report)


def test_backfill_apply_fills_only_what_is_missing_logs_and_undoes(backfill):
    fresh = backfill.author("Fresh", key="/authors/OL2001A")
    has_bio = backfill.author("Has Bio", bio="Mine already.", key="/authors/OL2002A")
    has_photo = backfill.author("Has Photo", photo=3, key="/authors/OL2003A")
    hand = backfill.author("Hand Written", key="/authors/OL2004A")
    backfill.db.execute(text("UPDATE authors SET bio = 'Edited by us.', bio_source = 'manual' WHERE id = :i"), {"i": hand.id})
    backfill.db.commit()
    rows = dump({"key": "/authors/OL2001A", "bio": "Fresh bio.", "photos": [11]},
                {"key": "/authors/OL2002A", "bio": "Replacement.", "photos": [12]},
                {"key": "/authors/OL2003A", "bio": "Photo author bio.", "photos": [13]},
                {"key": "/authors/OL2004A", "bio": "Would overwrite.", "photos": [14]})
    original = only_mine(backfill, rows)
    try:
        report = backfill.module.run(backfill.factory, rows, apply=True, tag="t71")
    finally:
        backfill.module.known_authors = original
    assert report["applied"] is True and report["written"] == 4
    assert tuple(state(backfill, fresh)) == ("Fresh bio.", 11, "open_library")
    assert tuple(state(backfill, has_bio)) == ("Mine already.", 12, "open_library")           # bio kept, missing photo filled
    assert tuple(state(backfill, has_photo)) == ("Photo author bio.", 3, "open_library")      # photo kept, missing bio filled
    assert tuple(state(backfill, hand)) == ("Edited by us.", 14, "manual")                     # a hand-set bio is never replaced
    assert backfill.db.scalar(text("SELECT count(*) FROM catalogue_import_issues WHERE code = 'author_bio'")) == 4
    again = backfill.module.run(backfill.factory, rows, apply=True, tag="t71b")                # nothing left to fill for these
    mine = [a for a in again["samples"] if a["key"].startswith("/authors/OL200")]
    assert mine == []
    undone = backfill.module.undo(backfill.factory, "t71")
    assert undone["bios_cleared"] == 2
    assert tuple(state(backfill, fresh)) == (None, None, None)
    assert state(backfill, hand).bio == "Edited by us."


def test_backfill_rejects_a_bad_tag(backfill):
    with pytest.raises(ValueError):
        backfill.module.run(backfill.factory, [], tag="no spaces allowed")


# --- duplicate report --------------------------------------------------------------------------------------------------

def test_duplicate_report_finds_same_name_pairs_on_one_book_and_merges_nothing(world):
    from data import duplicate_authors
    first, second = world.author("Charles Dickens"), world.author("charles  dickens.")
    other = world.author("Someone Else")
    world.book("Oliver Twist", [first, second])
    world.book("Bleak House", [first, second, other])
    world.book("Solo Dickens", [first])
    separate = world.author("Charles Dickens")        # same name, but never on the same book as another Dickens
    world.book("Elsewhere", [separate])
    before = world.db.scalar(text("SELECT count(*) FROM authors"))
    result = duplicate_authors.report(world.db)
    mine = [item for item in result["samples"] if {item["first"][0], item["second"][0]} == {first.id, second.id}]
    assert len(mine) == 1 and mine[0]["books"] == 2
    assert not [item for item in result["samples"] if separate.id in (item["first"][0], item["second"][0])]
    assert not [item for item in result["samples"] if other.id in (item["first"][0], item["second"][0])]
    assert world.db.scalar(text("SELECT count(*) FROM authors")) == before
    assert "Report only" in duplicate_authors.markdown(result)
