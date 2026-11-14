"""T58: re-clean descriptions from the source: dry run, logged apply, fills, emptied, undo. A fake dump and a fake Open Library."""
import json
import uuid

import pytest
from sqlalchemy import delete, event, text
from sqlalchemy.orm import sessionmaker

from test_clean_catalogue import ENGLISH, shelf  # noqa: F401

MARKDOWN = ("***A Game of Thrones*** is the first novel in a long and famous series of fantasy books.\n\n"
            "### Key Characters\n- **Eddard Stark**: Lord of Winterfell\n\n### Plot Summary\nA king asks his oldest friend to serve "
            "as his Hand, and the realm slowly slides toward a war that nobody wanted.")
PLAIN = ("A Game of Thrones is the first novel in a long and famous series of fantasy books.\n\n"
         "A king asks his oldest friend to serve as his Hand, and the realm slowly slides toward a war that nobody wanted.")
CREDITS = "Written and edited by Leonard Wolf ; notes, bibliography, and filmography"


class OL:
    def __init__(self, **pages):
        self.pages, self.calls = pages, []

    def __call__(self, path, params=None, timeout=None):
        self.calls.append(path)
        key = path[:-5] if path.endswith(".json") else path
        return self.pages.get(key)


@pytest.fixture()
def tool(shelf, app_modules):  # noqa: F811
    from data import reclean_descriptions
    models = app_modules["models"]
    shelf.module, shelf.factory = reclean_descriptions, sessionmaker(bind=app_modules["database"].engine)

    def make(title, description, managed=True):
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


def run(tool, rows, **kwargs):
    kwargs.setdefault("fetch", OL())
    # Only the books this test made are in play: the rest of the shared test database is not touched.
    ids = set(tool.made["books"])
    original = tool.module._books
    tool.module._books = lambda db: [b for b in original(db) if b.id in ids]
    try:
        return tool.module.reclean(tool.factory, rows, **kwargs)
    finally:
        tool.module._books = original


def test_markdown_becomes_plain_paragraphs_and_the_old_value_is_logged(tool):
    book = tool.make("Markdown Book", MARKDOWN)
    report = run(tool, [(book.source_id, MARKDOWN)], apply=True, tag="t58")
    assert stored(tool, book) == PLAIN and report["counts"]["changed"] == 1
    entry = logs(tool)[0]
    assert entry["tag"] == "t58" and entry["before"] == MARKDOWN and entry["kind"] == "changed" and entry["source"] == "dump"
    assert report["db"]["rows_written"] == 1 and report["db"]["batches"] == 1


def test_the_dry_run_writes_nothing_and_shows_before_and_after(tool):
    book = tool.make("Dry Book", MARKDOWN)
    report = run(tool, [(book.source_id, MARKDOWN)])
    assert stored(tool, book) == MARKDOWN and logs(tool) == []
    assert report["applied"] is False and report["counts"]["changed"] == 1 and report["db"]["rows_written"] == 0
    sample = next(v for v in report["samples"] if v["book_id"] == book.id)
    assert sample["before"] == MARKDOWN and sample["after"] == PLAIN
    assert [v["book_id"] for v in report["longest"]] == [book.id]


def test_a_value_that_has_not_changed_is_not_written(tool):
    book = tool.make("Same Book", PLAIN)
    report = run(tool, [(book.source_id, PLAIN)], apply=True)
    assert report["counts"].get("changed", 0) == 0 and report["counts"]["unchanged"] == 1
    assert report["db"]["rows_written"] == 0 and logs(tool) == []


def test_a_hand_edited_description_is_left_alone(tool):
    book = tool.make("Edited Book", "My own words about this book, written by a person who knows it well.", managed=False)
    report = run(tool, [(book.source_id, MARKDOWN)], apply=True)
    assert stored(tool, book).startswith("My own words") and report["counts"]["kept_not_source_managed"] == 1


def test_an_empty_description_is_filled_from_the_dump_and_then_from_the_api(tool):
    first, second = tool.make("Empty One", None), tool.make("Empty Two", "   ")
    ol = OL(**{second.source_id: {"description": ""},
               "/books/OL1M": {"description": {"value": "An edition text with *emphasis* in it that tells a long enough tale for readers."}}})
    row = tool.models.Edition(book_id=second.id, source_id="/books/OL1M")
    tool.db.add(row)
    tool.db.flush()
    second.preferred_edition_id = row.id
    tool.db.commit()
    try:
        report = run(tool, [(first.source_id, MARKDOWN)], apply=True, fetch=ol)
        assert stored(tool, first) == PLAIN
        assert stored(tool, second) == "An edition text with emphasis in it that tells a long enough tale for readers."
        assert report["counts"]["filled"] == 2 and report["counts"]["api_asked"] == 1
        assert {e["kind"] for e in logs(tool)} == {"filled"} and {e["source"] for e in logs(tool)} == {"dump", "api"}
    finally:
        tool.db.execute(text("UPDATE books SET preferred_edition_id = NULL WHERE id = :b"), {"b": second.id})
        tool.db.execute(text("DELETE FROM editions WHERE source_id = '/books/OL1M'"))
        tool.db.commit()


def test_skip_api_never_asks_open_library(tool):
    book = tool.make("No Api", None)
    ol = OL()
    report = run(tool, [], apply=True, use_api=False, fetch=ol)
    assert ol.calls == [] and report["counts"]["api_skipped"] == 1 and stored(tool, book) is None


def test_a_credits_only_source_empties_a_stored_credit_line_and_cleans_a_stored_text_it_cannot_replace(tool):
    junk = tool.make("Credits Book", CREDITS)
    fixable = tool.make("Stored Markdown", "A **bold** story of a girl and a horse in the hills and the long road home to the farm.")
    report = run(tool, [(junk.source_id, CREDITS)], apply=True)       # fixable is not in the dump: its stored text is re-cleaned
    assert stored(tool, junk) is None
    assert stored(tool, fixable) == "A bold story of a girl and a horse in the hills and the long road home to the farm."
    assert report["counts"]["emptied"] == 1 and report["counts"]["changed"] == 1
    kinds = {e["book_id"]: (e["kind"], e["source"]) for e in logs(tool)}
    assert kinds[junk.id] == ("emptied", "stored") and kinds[fixable.id] == ("changed", "stored")


def test_a_description_that_changed_while_we_were_fetching_is_not_overwritten(tool):
    book = tool.make("Race Book", MARKDOWN)

    def rows():
        yield book.source_id, MARKDOWN
        with tool.factory.begin() as session:     # someone else edits it after we read it and before we write
            session.execute(text("UPDATE books SET description = 'Changed by someone else in the meantime, entirely.' WHERE id = :i"), {"i": book.id})

    report = run(tool, rows(), apply=True)
    assert stored(tool, book).startswith("Changed by someone else") and logs(tool) == [] and report["db"]["rows_written"] == 0


def test_no_connection_is_held_while_the_dump_streams(tool, app_modules):
    book = tool.make("Idle Book", MARKDOWN)
    pool = app_modules["database"].engine.pool
    seen = []

    def rows():
        seen.append(pool.checkedout())
        yield book.source_id, MARKDOWN

    run(tool, rows(), apply=True)
    assert seen == [0]


def test_a_batch_is_one_update_and_one_log_insert(tool, app_modules):
    books = [tool.make(f"Batch {n}", MARKDOWN) for n in range(4)]
    seen = []
    engine = app_modules["database"].engine
    watch = lambda conn, cursor, statement, *a: seen.append(statement.split()[0].upper())  # noqa: E731
    event.listen(engine, "before_cursor_execute", watch)
    try:
        run(tool, [(b.source_id, MARKDOWN) for b in books], apply=True, batch=10)
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert seen.count("UPDATE") == 1 and seen.count("INSERT") == 1


def test_undo_round_trip_and_an_edited_book_is_skipped(tool):
    changed, edited, emptied = tool.make("Undo One", MARKDOWN), tool.make("Undo Two", MARKDOWN), tool.make("Undo Three", CREDITS)
    run(tool, [(b.source_id, d) for b, d in ((changed, MARKDOWN), (edited, MARKDOWN), (emptied, CREDITS))], apply=True, tag="u_1")
    assert stored(tool, changed) == PLAIN and stored(tool, emptied) is None
    with tool.factory.begin() as session:
        session.execute(text("UPDATE books SET description = 'Edited afterwards by the owner of the library.' WHERE id = :i"), {"i": edited.id})
    assert tool.module.undo(tool.factory, "uXd")["restored"] == 0                       # "_" is not a wildcard
    result = tool.module.undo(tool.factory, "u_1")
    assert result == {"restored": 2, "skipped_changed_since": 1}
    assert stored(tool, changed) == MARKDOWN and stored(tool, emptied) == CREDITS
    assert stored(tool, edited).startswith("Edited afterwards")
    assert tool.module.undo(tool.factory, "u_1")["restored"] == 0


def test_bad_tags_are_refused(tool):
    with pytest.raises(ValueError):
        run(tool, [], apply=True, tag="no spaces; drop")
    with pytest.raises(ValueError):
        tool.module.undo(tool.factory, "x y")
