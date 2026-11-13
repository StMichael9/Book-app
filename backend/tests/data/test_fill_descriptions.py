"""T56: fill missing descriptions from Open Library with the cleaner's rules; dry run, logged apply, undo. Mocked Open Library."""
import json
import uuid

import pytest
from sqlalchemy import delete, event, func, select, text

from test_clean_catalogue import ENGLISH, shelf  # noqa: F401
from test_cleaner import SPANISH

SELLER_ONLY = "This edition is a reprint. Translated by someone. Free download of the ebook."
OTHER = ("A retired detective is drawn back into the one case he never solved, and finds that the only witness still alive "
         "is the man he once sent to prison for it.")


class OL:
    """A fake Open Library: answers from `pages` by path, records calls, raises for the paths in `down`."""

    def __init__(self, **pages):
        self.pages, self.calls, self.down, self.on_call = pages, [], set(), None

    def __call__(self, path, params=None, timeout=None):
        from services.catalogue_resolver import OpenLibraryUnavailable
        self.calls.append(path)
        if self.on_call:
            self.on_call(path)
        key = path[:-5] if path.endswith(".json") else path
        if key in self.down:
            raise OpenLibraryUnavailable("503")
        return self.pages.get(key)


@pytest.fixture()
def tool(shelf, app_modules):  # noqa: F811
    from data import fill_descriptions
    models = app_modules["models"]

    def empty_book(title="Untitled Fill", description=None, edition=False, **kwargs):
        book = shelf.book(title, ["Fill Author"], description=description, **kwargs)
        keys = {"work": book.source_id, "edition": None}
        if edition:
            keys["edition"] = f"/books/OL8{uuid.uuid4().int % 10**6:06d}M"
            row = models.Edition(book_id=book.id, source_id=keys["edition"])
            shelf.db.add(row)
            shelf.db.flush()
            book.preferred_edition_id = row.id
            shelf.db.commit()
        return book, keys

    shelf.empty_book, shelf.module = empty_book, fill_descriptions
    yield shelf
    shelf.db.rollback()
    shelf.db.execute(delete(models.CatalogueImportIssue).where(models.CatalogueImportIssue.code == "fill_description"))
    shelf.db.commit()


def issues(tool):
    tool.db.rollback()
    return [json.loads(row) for row in tool.db.scalars(text("SELECT detail FROM catalogue_import_issues WHERE code = 'fill_description' ORDER BY id"))]


def description_of(tool, book):
    tool.db.rollback()
    return tool.db.scalar(text("SELECT description FROM books WHERE id = :i"), {"i": book.id})


def run(tool, fetch, **kwargs):
    ids = tool.made["books"]
    original = tool.module.candidates
    tool.module.candidates = lambda db, limit=None: [c for c in original(db, limit) if c.book_id in ids]
    try:
        return tool.module.run(tool.db, fetch=fetch, **kwargs)
    finally:
        tool.module.candidates = original


# --- the rules (no database) ----------------------------------------------------------------------------------------

def test_judge_applies_the_shared_description_rules(app_modules):
    from data.fill_descriptions import judge
    assert judge(ENGLISH) == (ENGLISH, None)
    assert judge({"type": "/type/text", "value": ENGLISH}) == (ENGLISH, None)
    assert judge(ENGLISH + " Available now as an e-book for Kindle.") == (ENGLISH, None)
    for blank in (None, "", "   ", {"value": ""}, {"value": None}):
        assert judge(blank) == (None, "no_description")
    assert judge(SPANISH) == (None, "rejected_cleaner")
    assert judge(SELLER_ONLY) == (None, "rejected_cleaner")
    assert judge("x" * 262145) == (None, "rejected_clean")  # outlier records are refused, never truncated


def test_resolve_prefers_the_work_then_the_edition_and_asks_no_more_than_needed(app_modules):
    from data.fill_descriptions import Candidate, resolve
    one = Candidate(1, "/works/OL1W", "/books/OL1M", None)
    ol = OL(**{"/works/OL1W": {"description": ENGLISH}, "/books/OL1M": {"description": OTHER}})
    out = resolve(one, ol)
    assert (out.text, out.source, ol.calls) == (ENGLISH, "work", ["/works/OL1W.json"])
    ol = OL(**{"/works/OL1W": {"title": "no text"}, "/books/OL1M": {"description": {"value": OTHER}}})
    out = resolve(one, ol)
    assert (out.text, out.source, len(ol.calls)) == (OTHER, "edition", 2)
    ol = OL(**{"/works/OL1W": {"description": SPANISH}, "/books/OL1M": {"description": OTHER}})
    assert resolve(one, ol).source == "edition"  # unusable work text: the edition is tried, with the same rules
    assert resolve(Candidate(1, "/works/OL1W", None, None), OL(**{"/works/OL1W": {"title": "x"}})).reason == "no_description"


def test_resolve_reports_the_most_telling_reason_and_unavailable(app_modules):
    from data.fill_descriptions import Candidate, resolve
    one = Candidate(1, "/works/OL1W", "/books/OL1M", None)
    assert resolve(one, OL()).reason == "no_work"
    assert resolve(one, OL(**{"/works/OL1W": {"description": SPANISH}, "/books/OL1M": {"title": "x"}})).reason == "rejected_cleaner"
    ol = OL()
    ol.down = {"/works/OL1W"}
    assert resolve(one, ol).reason == "unavailable"


# --- the tool on a database -----------------------------------------------------------------------------------------

def test_the_dry_run_writes_nothing_and_reports(tool):
    book, keys = tool.empty_book("Dry One")
    other, other_keys = tool.empty_book("Dry Two")
    ol = OL(**{keys["work"]: {"description": ENGLISH}, other_keys["work"]: {"description": SPANISH}})
    report = run(tool, ol)
    assert report["applied"] is False and report["db"]["rows_written"] == 0
    assert report["counts"]["fillable"] == 1 and report["counts"]["skipped_rejected_cleaner"] == 1
    assert [s["book_id"] for s in report["samples"]] == [book.id] and report["samples"][0]["title"] == "Dry One"
    assert description_of(tool, book) is None and issues(tool) == []


def test_apply_fills_only_what_the_rules_accept_and_logs_the_old_value(tool):
    good, good_keys = tool.empty_book("Good")
    blank, blank_keys = tool.empty_book("Blank", description="   ")
    junk, junk_keys = tool.empty_book("Junk")
    ol = OL(**{good_keys["work"]: {"description": ENGLISH + " Available now as an e-book for Kindle."},
               blank_keys["work"]: {"description": {"value": OTHER}}, junk_keys["work"]: {"description": SPANISH}})
    report = run(tool, ol, apply=True, tag="t1")
    assert description_of(tool, good) == ENGLISH and description_of(tool, blank) == OTHER
    assert description_of(tool, junk) is None  # text the cleaner rejects never comes back
    logged = {entry["book_id"]: entry for entry in issues(tool)}
    assert set(logged) == {good.id, blank.id}
    assert logged[good.id]["before"] == {"description": None} and logged[blank.id]["before"] == {"description": "   "}
    assert logged[good.id]["after_chars"] == len(ENGLISH) and logged[good.id]["tag"] == "t1" and logged[good.id]["source"] == "work"
    assert report["db"]["rows_written"] == 4 and report["counts"]["fillable"] == 2  # 2 books + 2 log rows


def test_the_edition_is_the_fallback(tool):
    book, keys = tool.empty_book("Edition Only", edition=True)
    ol = OL(**{keys["work"]: {"title": "no description"}, keys["edition"]: {"description": ENGLISH}})
    report = run(tool, ol, apply=True)
    assert description_of(tool, book) == ENGLISH and report["counts"]["from_edition"] == 1
    assert issues(tool)[0]["source"] == "edition"


def test_a_book_with_a_description_is_never_asked_about_or_touched(tool):
    kept, kept_keys = tool.empty_book("Has One", description=ENGLISH)
    ol = OL(**{kept_keys["work"]: {"description": OTHER}})
    report = run(tool, ol, apply=True)
    assert ol.calls == [] and report["counts"]["candidates"] == 0 and description_of(tool, kept) == ENGLISH


def test_a_description_added_while_we_were_fetching_is_not_overwritten_or_logged(tool, app_modules):
    book, keys = tool.empty_book("Raced")
    ol = OL(**{keys["work"]: {"description": OTHER}})

    def someone_else_writes(path):
        with app_modules["database"].SessionLocal() as other:
            other.execute(text("UPDATE books SET description = :d WHERE id = :i"), {"d": ENGLISH, "i": book.id})
            other.commit()

    ol.on_call = someone_else_writes
    report = run(tool, ol, apply=True)
    assert description_of(tool, book) == ENGLISH and issues(tool) == [] and report["db"]["rows_written"] == 0


def test_unlisted_books_and_books_without_a_work_key_are_not_candidates(tool):
    unlisted, _ = tool.empty_book("No Cover", cover=None)
    keyless, _ = tool.empty_book("Keyless")
    tool.db.execute(text("UPDATE books SET source_id = NULL WHERE id = :i"), {"i": keyless.id})
    tool.db.commit()
    ol = OL()
    report = run(tool, ol, apply=True)
    assert report["counts"]["candidates"] == 0 and ol.calls == []


def test_a_stopped_run_resumes_by_running_again_without_double_logging(tool):
    books = [tool.empty_book(f"Resume {n}") for n in range(5)]
    pages = {keys["work"]: {"description": f"{ENGLISH} Part {n}."} for n, (_, keys) in enumerate(books)}
    ol = OL(**pages)
    seen = []

    def stop_on_third(path):
        seen.append(path)
        if len(seen) == 3:
            raise RuntimeError("the runner was cancelled")

    ol.on_call = stop_on_third
    with pytest.raises(RuntimeError):
        run(tool, ol, apply=True, batch=2, tag="r1")
    tool.db.rollback()
    done = sum(description_of(tool, book) is not None for book, _ in books)
    assert done == 2 and len(issues(tool)) == 2  # the finished batch is saved, the interrupted one is not
    ol.on_call = None
    report = run(tool, ol, apply=True, batch=2, tag="r2")
    assert report["counts"]["candidates"] == 3 and all(description_of(tool, book) for book, _ in books)
    assert len(issues(tool)) == 5 and len({entry["book_id"] for entry in issues(tool)}) == 5


def test_a_run_stops_when_open_library_keeps_failing(tool, monkeypatch):
    books = [tool.empty_book(f"Down {n}") for n in range(4)]
    monkeypatch.setattr(tool.module, "MAX_CONSECUTIVE_UNAVAILABLE", 3)
    ol = OL()
    ol.down = {keys["work"] for _, keys in books}
    report = run(tool, ol, apply=True)
    assert report["aborted"] == "open_library_unavailable" and len(ol.calls) == 3
    assert report["counts"]["skipped_unavailable"] == 3 and issues(tool) == []


def test_the_database_is_idle_while_open_library_is_asked(tool, app_modules):
    books = [tool.empty_book(f"Idle {n}") for n in range(3)]
    ol = OL(**{keys["work"]: {"description": ENGLISH} for _, keys in books})
    statements = []
    engine = app_modules["database"].engine
    listener = lambda conn, cursor, statement, *args: statements.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)

    def check(path):
        assert not tool.db.in_transaction(), "no transaction may stay open while Open Library is asked"

    ol.on_call = check
    try:
        report = run(tool, ol, apply=True)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    # one read of the candidates, one UPDATE and one INSERT for the batch, one title read for the samples
    assert report["counts"]["fillable"] == 3 and len([s for s in statements if s.lstrip().upper().startswith(("UPDATE", "INSERT"))]) == 2
    assert report["db"] == {"rows_read": 3 + 3, "rows_written": 6}


def test_undo_restores_the_old_value_unless_it_was_edited_since(tool):
    blank, blank_keys = tool.empty_book("Undo Blank", description="  ")
    edited, edited_keys = tool.empty_book("Undo Edited")
    ol = OL(**{blank_keys["work"]: {"description": ENGLISH}, edited_keys["work"]: {"description": OTHER}})
    run(tool, ol, apply=True, tag="u_1")
    tool.db.execute(text("UPDATE books SET description = 'Edited by hand.' WHERE id = :i"), {"i": edited.id})
    tool.db.commit()
    assert tool.module.undo(tool.db, "uX1") == {"restored": 0, "skipped_changed_since": 0}  # "_" is not a wildcard
    assert tool.module.undo(tool.db, "u_1") == {"restored": 1, "skipped_changed_since": 1}
    assert description_of(tool, blank) == "  " and description_of(tool, edited) == "Edited by hand."
    assert tool.module.undo(tool.db, "u_1") == {"restored": 0, "skipped_changed_since": 2}  # nothing left to put back


def test_a_bad_tag_is_refused(tool):
    with pytest.raises(ValueError):
        tool.module.run(tool.db, tag="bad tag; drop", fetch=OL())
    with pytest.raises(ValueError):
        tool.module.undo(tool.db, "bad%tag")
