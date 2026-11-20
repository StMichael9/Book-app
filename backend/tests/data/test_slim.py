"""T66: the slim task removes only source aliases nothing reads, and a finished import leaves none behind."""
from __future__ import annotations

from sqlalchemy import select, text

from test_load import import_env  # noqa: F401
from test_import_resume import scenario
from test_popular_growth import fake_stream, popular


def test_orphan_aliases_are_counted_then_removed_and_the_rest_is_kept(import_env):
    models, factory, importer, config = import_env
    from data import slim
    with factory.begin() as session:
        book = models.Book(title="Held", source_id="/works/OL1W")
        session.add(book)
        session.flush()
        session.add_all([
            models.CatalogueSourceAlias(old_source_id="/works/OL10W", canonical_source_id="/works/OL1W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL11W", canonical_source_id="/works/OL99W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL12W", canonical_source_id="/works/OL98W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL13W", canonical_source_id="/works/OL97W", source_type="deleted"),
        ])
    with factory.begin() as session:
        data = slim.report(session.connection())
        assert data["orphan_aliases"] == 2 and data["aliases_total"] == 4           # the deleted-type row is not an orphan
        assert slim.delete_orphan_aliases(session.connection()) == 2
    with factory() as session:
        left = set(session.scalars(select(models.CatalogueSourceAlias.old_source_id)))
    assert left == {"/works/OL10W", "/works/OL13W"}                                  # the held book's alias and the deleted marker


def test_a_finished_import_leaves_no_alias_without_a_book(import_env, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch, scenario())
    assert importer.run_import(popular(config)) == "complete"
    with factory() as session:
        orphans = session.execute(text("""SELECT count(*) FROM catalogue_source_aliases a WHERE a.source_type <> 'deleted'
            AND NOT EXISTS (SELECT 1 FROM books b WHERE b.source_id = a.canonical_source_id)""")).scalar_one()
    assert orphans == 0


# --- T66: undo-log trim and the three-edition cap --------------------------------------------------------------------------

def _edition(key, *, quality=115, isbns=(), cover=None, pages=None, languages=("/languages/eng",), fmt=None):
    return {"edition_key": key, "quality": quality, "isbns": [{"isbn13": isbn} for isbn in isbns], "cover_image_url": cover,
            "page_count": pages, "languages": list(languages), "physical_format": fmt, "publishers": [], "publication_date": None}


def test_three_editions_are_kept_cover_first_then_isbns_then_the_most_complete():
    mod = importlib_staging()
    editions = [_edition("E1", isbns=["9780000000001"], pages=300),                       # best quality, no cover
                _edition("E2", quality=100, cover="http://c/2.jpg"),                      # the only cover
                _edition("E3", isbns=["9780000000002"]), _edition("E4", isbns=["9780000000003"], pages=200, fmt="Hardcover"),
                _edition("E5", quality=100, pages=100)]
    kept = [item["edition_key"] for item in mod.select_useful_editions(editions)]
    assert len(kept) == 3 and kept[0] == "E1" and kept[1] == "E2"                         # preferred, then the cover edition
    assert kept[2] == "E4"                                                                # then the new ISBN that is the most complete


def test_editions_that_something_points_at_are_never_dropped():
    mod = importlib_staging()
    editions = [_edition(f"E{n}", isbns=[f"978000000000{n}"], pages=100 + n) for n in range(1, 7)]
    kept = {item["edition_key"] for item in mod.select_useful_editions(editions, keep=("E5", "E6"))}
    assert {"E5", "E6"} <= kept and len(kept) == 3
    kept = {item["edition_key"] for item in mod.select_useful_editions(editions, keep=("E1", "E2", "E3", "E4"))}
    assert kept == {"E1", "E2", "E3", "E4"}                                               # more kept than the limit: all stay


def importlib_staging():
    import importlib
    return importlib.import_module("data.staging")


def test_slim_trims_editions_and_undo_logs_but_protects_referenced_editions(import_env):
    models, factory, importer, config = import_env
    from data import slim
    with factory.begin() as session:
        book = models.Book(title="Many", source_id="/works/OL5W")
        session.add(book)
        session.flush()
        editions = []
        for n in range(1, 6):
            edition = models.Edition(book_id=book.id, source_id=f"/books/OL{n}M", page_count=100 + n, languages=["/languages/eng"],
                                     publishers=[])
            session.add(edition)
            session.flush()
            session.add(models.EditionISBN(edition_id=edition.id, isbn13=f"97800000000{n:02d}"))
            editions.append(edition)
        protected_last = editions[4]
        user = models.User(email="slim@example.com", hashed_password="x")
        session.add(user)
        session.flush()
        entry = models.UserBook(user_id=user.id, book_id=book.id)
        session.add(entry)
        session.flush()
        from uuid import uuid4
        session.add(models.ReadingAttempt(id=uuid4(), user_book_id=entry.id, state="finished", edition_id=protected_last.id, creation_fingerprint=uuid4().hex))
        for code in ("clean_book", "reclean_description", "retag_genre"):
            session.add(models.CatalogueImportIssue(code=code, detail="x"))
        book_id, protected_id = book.id, protected_last.id
    with factory.begin() as session:
        connection = session.connection()
        data = slim.report(connection)
        assert data["editions"]["editions_dropped"] == 2 and {r["code"] for r in data["undo_logs"]} == {"clean_book", "reclean_description"}
        assert slim.trim_editions(connection, apply=True)["editions_dropped"] == 2
        assert slim.delete_undo_logs(connection) == 2
    with factory() as session:
        kept = set(session.scalars(select(models.Edition.id).where(models.Edition.book_id == book_id)))
        assert len(kept) == 3 and protected_id in kept
        assert session.scalar(select(models.EditionISBN.isbn13).where(models.EditionISBN.edition_id.notin_(kept))) is None
        assert list(session.scalars(select(models.CatalogueImportIssue.code))) == ["retag_genre"]           # nothing else touched
