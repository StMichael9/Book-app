"""T72: merge an old keyless author into its Open Library twin. Links move or are removed, the keyless author goes, an undo log is
written, unsafe pairs are skipped and reported, and a dry run writes nothing."""
import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def world(db_session, app_modules):
    from data import author_merge
    models = app_modules["models"]
    made = {"books": [], "authors": [], "tags": []}

    class W:
        pass

    w = W()
    w.db, w.models, w.module, w.made = db_session, models, author_merge, made
    w.factory = sessionmaker(bind=app_modules["database"].engine)
    token = uuid.uuid4().hex[:8]

    def author(name, key=None):
        item = models.Author(name=name, source_id=key)
        db_session.add(item)
        db_session.commit()
        made["authors"].append(item.id)
        return SimpleNamespace(id=item.id, name=name)

    def book(title, authors, tags=()):
        item = models.Book(title=f"{title} {token}", description="d", source_id=f"/works/OLM{uuid.uuid4().hex[:6]}W")
        item.authors = [db_session.get(models.Author, a.id) for a in authors]
        for name in tags:
            tag = db_session.scalar(select(models.Tag).where(models.Tag.name == name, models.Tag.type == models.TagType.genre))
            if tag is None:
                tag = models.Tag(name=name, type=models.TagType.genre)
                db_session.add(tag)
                db_session.flush()
                made["tags"].append(tag.id)
            item.tags.append(tag)
        db_session.add(item)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def only_mine(report_fn):
        """Limit a run to the authors this test made (the rest of the shared test database is not touched)."""
        ids = set(made["authors"])
        original = w.module.find_pairs
        w.module.find_pairs = lambda db: [p for p in original(db) if {
            (p.get("keyless") or p["first"])[0], (p.get("keyed") or p["second"])[0]} <= ids]
        try:
            return report_fn()
        finally:
            w.module.find_pairs = original

    w.author, w.book, w.only_mine = author, book, only_mine
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
    for tag_id in made["tags"]:
        obj = db_session.get(models.Tag, tag_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()


def exists(world, author):
    world.db.rollback()
    return world.db.scalar(text("SELECT count(*) FROM authors WHERE id = :i"), {"i": author.id}) == 1


def scene(world):
    """An old 'Charles Dickens' on two books; the keyed twin on one of them and on a third. A third author sits between them."""
    old = world.author("Charles Dickens")
    middle = world.author("Someone Between")
    keyed = world.author("Charles Dickens", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    both = world.book("Oliver", [old, middle, keyed], tags=["Classic"])
    only_old = world.book("Bleak", [old], tags=["Classic"])
    only_keyed = world.book("Hard Times", [keyed], tags=["Classic"])
    return old, middle, keyed, both, only_old, only_keyed


def test_dry_run_reports_and_writes_nothing(world):
    old, middle, keyed, both, only_old, _ = scene(world)
    report = world.only_mine(lambda: world.module.run(world.factory, apply=False))
    c = report["counts"]
    assert (c["pairs"], c["links_moved"], c["links_removed"], c["authors_deleted"], c["books"]) == (1, 1, 1, 1, 2)
    assert c["order_may_change"] == 0                                  # Bleak's link moves past nobody; Oliver's link is removed
    assert report["merged"] == 0 and report["applied"] is False and report["tag"] is None
    assert exists(world, old) and world.links(both.id) == sorted([old.id, middle.id, keyed.id]) and world.links(only_old.id) == [old.id]
    assert world.db.scalar(text("SELECT count(*) FROM catalogue_import_issues WHERE code = 'author_merge'")) == 0
    assert "Pairs to merge: 1" in world.module.markdown(report)


def test_apply_moves_removes_deletes_and_logs(world):
    old, middle, keyed, both, only_old, only_keyed = scene(world)
    report = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t72"))
    assert report["merged"] == 1 and report["tag"] == "t72"
    world.db.rollback()
    assert not exists(world, old) and exists(world, keyed)
    assert world.links(both.id) == sorted([middle.id, keyed.id])      # duplicate link removed, the keyed one stays in place
    assert world.links(only_old.id) == [keyed.id] and world.links(only_keyed.id) == [keyed.id]
    logs = [json.loads(d) for d in world.db.scalars(text("SELECT detail FROM catalogue_import_issues WHERE code = 'author_merge'"))]
    assert len(logs) == 1 and logs[0]["tag"] == "t72" and logs[0]["keyed_id"] == keyed.id and logs[0]["keyless"]["id"] == old.id
    assert [b for b, _ in logs[0]["moved"]] == [only_old.id] and [b for b, _ in logs[0]["removed"]] == [both.id]
    again = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t72b"))
    assert again["counts"]["pairs"] == 0                                # nothing left to merge


def test_a_moved_link_that_passes_a_third_author_is_counted_as_an_order_change(world):
    old = world.author("Order Person")
    middle = world.author("Middle Person")
    keyed = world.author("Order Person", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    world.book("Shared", [old, keyed], tags=["Classic"])
    world.book("Passes", [old, middle], tags=["Classic"])
    report = world.only_mine(lambda: world.module.run(world.factory, apply=False))
    assert report["counts"]["links_moved"] == 1 and report["counts"]["order_may_change"] == 1


def test_undo_restores_the_author_and_every_link(world):
    old, middle, keyed, both, only_old, _ = scene(world)
    before = {both.id: world.links(both.id), only_old.id: world.links(only_old.id)}
    world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t72u"))
    result = world.module.undo(world.factory, "t72u")
    assert result["authors_restored"] == 1
    world.db.rollback()
    assert exists(world, old) and {both.id: world.links(both.id), only_old.id: world.links(only_old.id)} == before
    assert world.db.scalar(text("SELECT source_id FROM authors WHERE id = :i"), {"i": old.id}) is None
    assert world.module.undo(world.factory, "t72u")["authors_restored"] == 0      # a second undo changes nothing


def test_unsafe_pairs_are_skipped_and_reported(world):
    # both authors keyed
    a1 = world.author("Both Keyed", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    a2 = world.author("Both Keyed", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    world.book("Keyed Pair", [a1, a2], tags=["Classic"])
    # a keyless author whose other books share no subject with the keyed twin's books
    stranger = world.author("John Smith")
    twin = world.author("John Smith", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    world.book("Shared Smith", [stranger, twin], tags=["Zebra Subject"])
    world.book("Other Smith", [stranger], tags=["Cooking Subject"])
    # a keyless author with two keyed twins on different books
    ambiguous = world.author("Twice Twinned")
    t1 = world.author("Twice Twinned", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    t2 = world.author("Twice Twinned", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    world.book("Twin One", [ambiguous, t1], tags=["Classic"])
    world.book("Twin Two", [ambiguous, t2], tags=["Classic"])
    report = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t72s"))
    assert report["merged"] == 0 and report["counts"]["pairs"] == 0
    reasons = sorted(item["reason"] for item in report["skipped"])
    assert reasons == ["ambiguous_twin", "ambiguous_twin", "both_keyed", "different_subjects"]
    for author in (a1, a2, stranger, twin, ambiguous, t1, t2):
        assert exists(world, author)
    text_report = world.module.markdown(report)
    assert "both_keyed" in text_report and "different_subjects" in text_report and "ambiguous_twin" in text_report


def test_a_keyless_author_with_a_matching_subject_on_other_books_is_merged(world):
    old = world.author("Same Subject")
    keyed = world.author("Same Subject", key=f"/authors/OLM{uuid.uuid4().int % 10 ** 7}A")
    world.book("Shared Subject", [old, keyed], tags=["Classic"])
    world.book("Other Subject", [old], tags=["Classic"])
    world.book("Keyed Subject", [keyed], tags=["Classic"])
    report = world.only_mine(lambda: world.module.run(world.factory, apply=True, tag="t72m"))
    assert report["merged"] == 1 and not exists(world, old)


def test_a_bad_tag_is_refused(world):
    with pytest.raises(ValueError):
        world.module.run(world.factory, tag="no spaces")
    with pytest.raises(ValueError):
        world.module.undo(world.factory, "../x")
