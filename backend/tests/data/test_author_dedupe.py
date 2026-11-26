"""T19: merge the duplicate authors T72 leaves behind. Same-name copies and variants that share a book with the full name merge into one;
two Open Library keys are skipped and reported; different people are not folded; a dry run writes nothing; the T72 undo restores."""
import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def world(db_session, app_modules):
    from data import author_dedupe, author_merge
    models = app_modules["models"]
    made = {"books": [], "authors": []}

    class W:
        pass

    w = W()
    w.db, w.models, w.module, w.merge_module = db_session, models, author_dedupe, author_merge
    w.factory = sessionmaker(bind=app_modules["database"].engine)
    token = uuid.uuid4().hex[:8]

    def author(name, key=None):
        item = models.Author(name=name, source_id=key)
        db_session.add(item)
        db_session.commit()
        made["authors"].append(item.id)
        return SimpleNamespace(id=item.id, name=name)

    def key():
        return f"/authors/OLD{uuid.uuid4().int % 10 ** 7}A"

    def book(title, authors):
        item = models.Book(title=f"{title} {token}", description="d", source_id=f"/works/OLD{uuid.uuid4().hex[:6]}W")
        item.authors = [db_session.get(models.Author, a.id) for a in authors]
        db_session.add(item)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def only_mine(fn):
        """Limit a run to the authors this test made (the rest of the shared test database is not touched)."""
        ids = set(made["authors"])
        original = w.module.find_groups
        w.module.find_groups = lambda db: [g for g in original(db) if {m[0] for m in g["members"]} <= ids]
        try:
            return fn()
        finally:
            w.module.find_groups = original

    def alive(a):
        db_session.rollback()
        return db_session.scalar(text("SELECT count(*) FROM authors WHERE id = :i"), {"i": a.id}) == 1

    w.author, w.key, w.book, w.only_mine, w.alive = author, key, book, only_mine, alive
    w.links = lambda book_id: [r[0] for r in db_session.execute(text("SELECT author_id FROM book_authors WHERE book_id = :b ORDER BY author_id"), {"b": book_id})]
    yield w
    db_session.rollback()
    db_session.execute(text("DELETE FROM catalogue_import_issues WHERE code = 'author_merge'"))
    for book_id in made["books"]:
        obj = db_session.get(models.Book, book_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()
    for author_id in made["authors"]:
        obj = db_session.get(models.Author, author_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()


def joyce(world):
    """James Joyce four times: two old copies, an initial form and the keyed one, chained through shared books."""
    old1, old2, initial = world.author("James Joyce"), world.author("james joyce."), world.author("J Joyce")
    keyed = world.author("James Joyce", key=world.key())
    a = world.book("Ulysses", [old1, old2])
    b = world.book("Dubliners", [old2, keyed])
    c = world.book("Portrait", [initial, keyed])
    d = world.book("Only Old", [old1])
    return old1, old2, initial, keyed, (a, b, c, d)


def test_four_copies_of_one_name_merge_into_the_keyed_one(world):
    old1, old2, initial, keyed, (a, b, c, d) = joyce(world)
    report = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19"))
    assert report["counts"]["authors_merged"] == 3 and report["merged"] == 3
    assert [world.alive(x) for x in (old1, old2, initial, keyed)] == [False, False, False, True]
    assert world.links(a.id) == [keyed.id] and world.links(b.id) == [keyed.id] and world.links(c.id) == [keyed.id] and world.links(d.id) == [keyed.id]
    logs = [json.loads(x) for x in world.db.scalars(text("SELECT detail FROM catalogue_import_issues WHERE code = 'author_merge'"))]
    assert len(logs) == 3 and {log["tag"] for log in logs} == {"t19"} and {log["keyed_id"] for log in logs} == {keyed.id}


def test_a_dry_run_reports_and_writes_nothing_and_the_run_is_idempotent(world):
    old1, old2, initial, keyed, (a, b, c, d) = joyce(world)
    report = world.only_mine(lambda: world.module.run(world.factory, apply=False))
    assert report["counts"]["authors_merged"] == 3 and report["merged"] == 0 and report["applied"] is False and report["tag"] is None
    assert all(world.alive(x) for x in (old1, old2, initial, keyed)) and world.links(d.id) == [old1.id]
    assert world.db.scalar(text("SELECT count(*) FROM catalogue_import_issues WHERE code = 'author_merge'")) == 0
    assert "Authors to merge: 3" in world.module.markdown(report)
    world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19a"))
    again = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19b"))
    assert again["counts"]["authors_merged"] == 0 and again["merged"] == 0


def test_with_no_keyed_author_the_one_with_most_books_wins(world):
    small, big = world.author("Anne Rice"), world.author("ANNE RICE")
    world.book("One", [small, big])
    world.book("Two", [big])
    world.book("Three", [big])
    world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19c"))
    assert world.alive(big) and not world.alive(small)


def test_two_keyed_authors_are_skipped_and_reported_never_merged(world):
    first, second = world.author("Stephen King", key=world.key()), world.author("Stephen King", key=world.key())
    keyless = world.author("Stephen King")
    world.book("It", [first, second])
    world.book("Carrie", [keyless, first])
    report = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19d"))
    assert report["counts"]["authors_merged"] == 0 and report["counts"]["skipped"] == 1 and report["skipped"][0]["reason"] == "multiple_keys"
    assert all(world.alive(x) for x in (first, second, keyless))
    assert "multiple_keys" in world.module.markdown(report)


def test_initials_merge_only_beside_the_full_name_and_different_people_are_not_folded(world):
    full, initial, alone = world.author("Robert Louis Stevenson"), world.author("R L Stevenson"), world.author("R L Stevenson")
    world.book("Treasure Island", [full, initial])
    only = world.book("Kidnapped", [alone])                  # no full name on this book: nothing ties it to the full name, so it stays
    lee, leo = world.author("Ann Lee"), world.author("Ann Leo")
    world.book("Two Anns", [lee, leo])
    world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19e"))
    assert world.alive(full) and not world.alive(initial) and world.alive(alone) and world.links(only.id) == [alone.id]
    assert world.alive(lee) and world.alive(leo)


def test_no_reader_data_is_touched_and_the_t72_undo_restores_everything(world):
    old1, old2, initial, keyed, (a, b, c, d) = joyce(world)
    before = {x.id: world.links(x.id) for x in (a, b, c, d)}
    entries = world.db.scalar(text("SELECT count(*) FROM user_books"))
    world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t19u"))
    assert world.db.scalar(text("SELECT count(*) FROM user_books")) == entries
    assert world.merge_module.undo(world.factory, "t19u")["authors_restored"] == 3
    world.db.rollback()
    assert all(world.alive(x) for x in (old1, old2, initial, keyed))
    assert {x.id: world.links(x.id) for x in (a, b, c, d)} == before


def test_a_bad_tag_is_refused(world):
    with pytest.raises(ValueError):
        world.module.run(world.factory, apply=False, tag="bad tag!")
