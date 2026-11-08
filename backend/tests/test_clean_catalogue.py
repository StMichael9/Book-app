"""T47: the re-clean of existing books, and the cleaner inside the gate. Synthetic books on the disposable test database only."""
import uuid

import pytest
from sqlalchemy import delete, select

from test_cleaner import DRACULA_AUTHORS, SPANISH

ENGLISH = ("A young solicitor travels to Transylvania to help a nobleman buy a house in London. He soon learns that the count "
           "is not what he seems, and that the people of the village fear what lives in the castle.")


@pytest.fixture()
def shelf(db_session, app_modules):
    models = app_modules["models"]
    made = {"books": [], "authors": [], "users": []}

    class S:
        pass

    s = S()
    s.models, s.db, s.made = models, db_session, made

    def book(title, authors, description=ENGLISH, popularity=None, pages=300, year=1897, cover="https://covers.example/c.jpg"):
        item = models.Book(title=title, description=description, popularity=popularity, page_count=pages, published_year=year,
                           cover_image_url=cover, source_id=f"/works/OL8{uuid.uuid4().int % 10**6:06d}W")
        db_session.add(item)
        db_session.flush()
        for name in authors:
            author = models.Author(name=name, source_id=f"/authors/OL8{uuid.uuid4().int % 10**6:06d}A")
            db_session.add(author)
            db_session.flush()
            item.authors.append(author)
            made["authors"].append(author.id)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def user():
        item = models.User(email=f"cl-{uuid.uuid4().hex[:8]}@example.test", hashed_password="x")
        db_session.add(item)
        db_session.commit()
        made["users"].append(item.id)
        return item

    s.book, s.user = book, user
    yield s
    db_session.rollback()
    db_session.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "clean_book"))
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id.like("/works/OL8%W")))
    db_session.execute(delete(models.User).where(models.User.id.in_(made["users"])))
    db_session.execute(delete(models.Book).where(models.Book.id.in_(made["books"])))
    db_session.execute(delete(models.Author).where(models.Author.id.in_(made["authors"])))
    db_session.commit()


def run(shelf, **kwargs):
    from data import clean_catalogue
    return clean_catalogue.scan(shelf.db, only=shelf.made["books"], **kwargs)


def authors_of(shelf, book):
    shelf.db.expire_all()
    return sorted(a.name for a in shelf.db.get(shelf.models.Book, book.id).authors)


def test_dracula_dry_run_changes_nothing_and_reports_the_fix(shelf):
    dracula = shelf.book("Bram Stoker's Dracula omnibus", DRACULA_AUTHORS, description=SPANISH, popularity=9.0)
    report = run(shelf, apply=False, samples=5)
    assert report["counts"]["changed"] == 1 and report["counts"]["many_authors"] == 1 and report["counts"]["bad_description"] == 1
    sample = report["samples"][0]
    assert sample["after"]["title"] == "Dracula" and sample["after"]["authors"] == ["Bram Stoker"] and sample["after"]["description"] is None
    shelf.db.expire_all()
    book = shelf.db.get(shelf.models.Book, dracula.id)
    assert book.title == "Bram Stoker's Dracula omnibus" and book.description == SPANISH and len(book.authors) == len(DRACULA_AUTHORS)
    assert book.quality_score is None
    assert shelf.db.scalar(select(shelf.models.CatalogueImportIssue.id).where(shelf.models.CatalogueImportIssue.code == "clean_book")) is None
    from data import clean_catalogue
    assert "Dracula" in clean_catalogue.markdown(report)


def test_apply_cleans_the_book_logs_every_change_and_undo_puts_it_back(shelf):
    dracula = shelf.book("Bram Stoker's Dracula omnibus", DRACULA_AUTHORS, description=SPANISH, popularity=9.0)
    report = run(shelf, apply=True, tag="t47-test")
    shelf.db.expire_all()
    book = shelf.db.get(shelf.models.Book, dracula.id)
    assert book.title == "Dracula" and book.description is None and authors_of(shelf, dracula) == ["Bram Stoker"]
    assert book.quality_score >= 60 and book.is_listed is True
    issue = shelf.db.scalar(select(shelf.models.CatalogueImportIssue).where(shelf.models.CatalogueImportIssue.code == "clean_book"))
    assert "Bram Stoker's Dracula omnibus" in issue.detail and "t47-test" in issue.detail
    assert run(shelf, apply=True, tag="t47-again")["counts"].get("changed", 0) == 0          # idempotent
    from data import clean_catalogue
    assert clean_catalogue.undo(shelf.db, "t47-test") == 1
    shelf.db.expire_all()
    book = shelf.db.get(shelf.models.Book, dracula.id)
    assert book.title == "Bram Stoker's Dracula omnibus" and book.description == SPANISH and len(book.authors) == len(DRACULA_AUTHORS)


def test_a_derivative_is_unlisted_not_deleted_and_a_clean_book_is_left_alone(shelf):
    omnibus = shelf.book("Sherlock Holmes Omnibus", ["Arthur Conan Doyle"])
    plain = shelf.book("Dracula", ["Bram Stoker"], popularity=5.0)
    plain.quality_score = 100
    shelf.db.commit()
    report = run(shelf, apply=True)
    shelf.db.expire_all()
    hidden = shelf.db.get(shelf.models.Book, omnibus.id)
    assert hidden is not None and hidden.is_listed is False and hidden.quality_score <= 40
    assert report["counts"]["derivative"] == 1 and report["counts"]["unlisted_after"] == 1
    kept = shelf.db.get(shelf.models.Book, plain.id)
    assert kept.is_listed is True and kept.title == "Dracula"


def test_duplicate_works_fold_into_the_most_popular_and_readers_links_move(shelf):
    keep = shelf.book("Dune", ["Frank Herbert"], popularity=9.0)
    dup = shelf.book("Dune", ["Frank Herbert"], popularity=2.0)
    solo, both = shelf.user(), shelf.user()
    models = shelf.models
    mine = models.UserBook(user_id=solo.id, book_id=dup.id, is_owned=True, save_note="my note")
    shelf.db.add(mine)
    private = models.UserBook(user_id=solo.id, private_title="Dune", private_author="Frank Herbert", is_wanted=True)
    shelf.db.add(private)
    shelf.db.commit()
    report = run(shelf, apply=True)
    shelf.db.expire_all()
    assert report["folded"]["folded"] == 1 and report["counts"]["duplicate_groups"] == 1
    entry = shelf.db.get(models.UserBook, mine.id)
    assert entry.book_id == keep.id and entry.save_note == "my note" and entry.is_owned is True
    assert shelf.db.get(models.UserBook, private.id).book_id is None                       # a private copy is never touched
    assert shelf.db.get(models.Book, dup.id).is_listed is False and shelf.db.get(models.Book, keep.id).is_listed is True
    alias = shelf.db.scalar(select(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == dup.source_id))
    assert alias.canonical_source_id == keep.source_id


def test_a_reader_who_holds_both_duplicates_keeps_both_and_nothing_is_folded(shelf):
    keep = shelf.book("Emma", ["Jane Austen"], popularity=9.0)
    dup = shelf.book("Emma", ["Jane Austen"], popularity=1.0)
    reader = shelf.user()
    models = shelf.models
    shelf.db.add_all([models.UserBook(user_id=reader.id, book_id=keep.id, is_owned=True),
                      models.UserBook(user_id=reader.id, book_id=dup.id, is_wanted=True)])
    shelf.db.commit()
    report = run(shelf, apply=True)
    shelf.db.expire_all()
    assert report["folded"].get("skipped_reader_holds_both") == 1 and not report["folded"].get("folded")
    assert shelf.db.get(models.Book, dup.id).is_listed is True
    assert shelf.db.scalar(select(models.CatalogueSourceAlias.old_source_id).where(
        models.CatalogueSourceAlias.old_source_id == dup.source_id)) is None


def test_the_gate_runs_the_cleaner_for_every_new_book(shelf):
    from services import catalogue_gate
    work = {"source_id": "/works/OL8999999W", "title": "Bram Stoker's Dracula omnibus", "authors": DRACULA_AUTHORS,
            "author_keys": [], "description": ENGLISH + " This edition includes an introduction by a scholar.",
            "cover_image_url": "https://covers.example/c.jpg", "published_year": 1897, "page_count": 418, "isbns": [], "subjects": []}
    verdict = catalogue_gate.vet(shelf.db, work)
    assert isinstance(verdict, catalogue_gate.Accepted)
    assert verdict.work["title"] == "Dracula" and verdict.work["authors"] == ["Bram Stoker"] and verdict.work["description"] == ENGLISH
    for over, reason in ((dict(title="Sherlock Holmes Omnibus", authors=["Arthur Conan Doyle"]), "derivative"),
                         (dict(authors=["Destinyalready Creative Writing Ink", "ClassyBookRead"]), "no_author")):
        rejected = catalogue_gate.vet(shelf.db, {**work, **over})
        assert isinstance(rejected, catalogue_gate.Rejected) and rejected.reason == reason
    book_id = catalogue_gate.promote(shelf.db, verdict.work)
    shelf.db.commit()
    shelf.made["books"].append(book_id)
    book = shelf.db.get(shelf.models.Book, book_id)
    assert book.quality_score >= 60 and book.is_listed is True
    shelf.made["authors"].extend(a.id for a in book.authors)
