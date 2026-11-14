"""T59: re-clean stored descriptions with no source swap: unmanaged markup, emails, reviews, contents; dry run, log, undo."""
import json

import pytest
from sqlalchemy import delete, event, text
from sqlalchemy.orm import sessionmaker

from test_clean_catalogue import ENGLISH, shelf  # noqa: F401

ORIENT = ("***While en route to Istanbul, Hercule Poirot is asked to solve a murder on a snowbound train.*** It is one of the "
          "best known detective stories of its age.")
ORIENT_CLEAN = ("While en route to Istanbul, Hercule Poirot is asked to solve a murder on a snowbound train. It is one of the "
                "best known detective stories of its age.")
REVIEW = ("Written By Bernie Weisz Historian e mail: Bernwei1@aol.com Title of Review: The Choirboys is a story of Los Angeles "
          "police officers and I give this book four stars out of five.")
CONTENTS = ("Fiction. My kinsman, Major Molineux / Nathaniel Hawthorne Purloined Letter / Edgar Allan Poe The Fall of the House "
            "of Usher / Edgar Allan Poe Young Goodman Brown / Nathaniel Hawthorne The Open Boat / Stephen Crane")


@pytest.fixture()
def tool(shelf, app_modules):  # noqa: F811
    from data import reclean_descriptions, reclean_stored
    models = app_modules["models"]
    shelf.module, shelf.factory = reclean_stored, sessionmaker(bind=app_modules["database"].engine)
    shelf.undo = reclean_descriptions.undo

    def make(title, description, managed=False):
        book = shelf.book(title, ["T Author"], description=description)
        shelf.db.execute(text("UPDATE books SET source_managed_fields = :f WHERE id = :i"), {"f": 2 if managed else 0, "i": book.id})
        shelf.db.commit()
        return book

    shelf.make = make
    yield shelf
    shelf.db.rollback()
    shelf.db.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "reclean_description"))
    shelf.db.commit()


def stored(tool, book):
    tool.db.rollback()
    return tool.db.scalar(text("SELECT description FROM books WHERE id = :i"), {"i": book.id})


def logs(tool):
    tool.db.rollback()
    return [json.loads(d) for d in tool.db.scalars(text("SELECT detail FROM catalogue_import_issues WHERE code = 'reclean_description' ORDER BY id"))]


def run(tool, **kwargs):
    return tool.module.reclean(tool.factory, only=set(tool.made["books"]), **kwargs)


def test_a_not_source_managed_text_is_re_cleaned_by_the_rules_alone_and_logged(tool):
    book = tool.make("Orient Test", ORIENT)
    report = run(tool, apply=True, tag="t59")
    assert stored(tool, book) == ORIENT_CLEAN
    assert report["counts"]["changed"] == 1 and report["counts"]["not_source_managed_changed"] == 1
    entry = logs(tool)[0]
    assert entry["before"] == ORIENT and entry["source"] == "stored" and entry["tag"] == "t59" and entry["kind"] == "changed"


def test_the_dry_run_writes_nothing_and_masks_email_addresses_in_the_report(tool):
    book = tool.make("Choirboys Test", REVIEW, managed=True)
    report = run(tool)
    assert stored(tool, book) == REVIEW and logs(tool) == []
    assert report["counts"]["emptied"] == 1 and report["counts"]["rule_email"] == 1 and report["counts"]["rule_review"] == 1
    assert report["db"]["rows_written"] == 0
    markdown = tool.module.markdown(report)
    assert "@" not in markdown and "[email removed]" in markdown


def test_a_description_with_an_email_is_emptied_and_its_old_text_is_not_kept_anywhere(tool):
    book = tool.make("Choirboys Apply", REVIEW, managed=True)
    run(tool, apply=True, tag="mail")
    assert stored(tool, book) is None
    entry = logs(tool)[0]
    assert entry["kind"] == "emptied" and entry["before"] is None and entry["before_withheld"] is True
    assert "@" not in json.dumps(entry)
    assert tool.undo(tool.factory, "mail") == {"restored": 0, "skipped_changed_since": 0, "not_restorable_privacy": 1}
    assert stored(tool, book) is None


def test_a_contents_list_is_emptied_and_the_samples_show_it(tool):
    book = tool.make("Elements Test", CONTENTS, managed=True)
    report = run(tool, apply=True)
    assert stored(tool, book) is None and report["counts"]["rule_contents"] == 1
    assert [v["book_id"] for v in report["contents_samples"]] == [book.id]


def test_untouched_cases_are_not_written(tool):
    clean_unmanaged = tool.make("Fine Unmanaged", ENGLISH)           # not ours, but already clean
    fine_managed = tool.make("Fine Managed", ENGLISH, managed=True)  # filtered out in the database
    report = run(tool, apply=True)
    assert report["counts"].get("changed", 0) == 0 and report["db"]["rows_written"] == 0 and logs(tool) == []
    assert stored(tool, clean_unmanaged) == ENGLISH and stored(tool, fine_managed) == ENGLISH
    assert report["counts"]["candidates"] == 1      # only the unmanaged one was even read


def test_a_description_changed_while_we_were_working_is_not_overwritten(tool, monkeypatch):
    book = tool.make("Race Test", ORIENT)
    from data import reclean_stored
    real = reclean_stored.cleaner.clean_description

    def edit_then_clean(value):
        with tool.factory.begin() as session:
            session.execute(text("UPDATE books SET description = 'Edited by someone else in the meantime, entirely.' WHERE id = :i"),
                            {"i": book.id})
        return real(value)

    monkeypatch.setattr(reclean_stored.cleaner, "clean_description", edit_then_clean)
    report = run(tool, apply=True)
    assert stored(tool, book).startswith("Edited by someone else") and report["db"]["rows_written"] == 0 and logs(tool) == []


def test_a_batch_is_one_update_and_one_log_insert(tool, app_modules):
    for n in range(4):
        tool.make(f"Batch {n}", ORIENT)
    seen = []
    engine = app_modules["database"].engine
    watch = lambda conn, cursor, statement, *a: seen.append(statement.split()[0].upper())  # noqa: E731
    event.listen(engine, "before_cursor_execute", watch)
    try:
        run(tool, apply=True, batch=10)
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert seen.count("UPDATE") == 1 and seen.count("INSERT") == 1


def test_undo_restores_an_unmanaged_text_and_skips_an_edited_one(tool):
    first, second = tool.make("Undo One", ORIENT), tool.make("Undo Two", ORIENT)
    run(tool, apply=True, tag="u_1")
    with tool.factory.begin() as session:
        session.execute(text("UPDATE books SET description = 'Edited afterwards by hand, nothing like before.' WHERE id = :i"), {"i": second.id})
    assert tool.undo(tool.factory, "u_1") == {"restored": 1, "skipped_changed_since": 1, "not_restorable_privacy": 0}
    assert stored(tool, first) == ORIENT and stored(tool, second).startswith("Edited afterwards")


def test_bad_tags_are_refused(tool):
    with pytest.raises(ValueError):
        run(tool, apply=True, tag="no spaces; drop")
