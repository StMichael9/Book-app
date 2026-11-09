"""T44: imports match on the book's own evidence, never block on a value clash, count rows once and take few round trips."""
import time
from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select

from test_library_import_workflow import analyzed, importing, seal, start  # noqa: F401

HEADERS = ["title", "author", "isbn13", "isbn10", "status", "started_on", "finished_on"]


def book(db, title, author, isbn13=None, edition_isbn=None):
    from models import Author, Book, Edition, EditionISBN
    row = Book(title=title, source_id=f"/works/OLT44{uuid4().hex[:10]}W", isbn13=isbn13)
    row.authors.append(Author(name=author, source_id=f"/authors/OLT44{uuid4().hex[:10]}A"))
    db.add(row)
    db.flush()
    if edition_isbn:
        edition = Edition(book_id=row.id, source_id=f"/books/OLT44{uuid4().hex[:10]}M")
        db.add(edition)
        db.flush()
        db.add(EditionISBN(edition_id=edition.id, isbn13=edition_isbn))
    db.commit()
    return row


def run_rows(importing, rows, headers=None):
    user, workflow = importing
    _, run = start(user, workflow, headers or HEADERS)
    seal(user, workflow, run, rows)
    state = analyzed(user, workflow, run)
    items = workflow.preview(user.id, run["id"], limit=500)["items"]
    return user, workflow, run, state, items


def test_edition_isbn_matches_with_exact_title_even_when_a_date_in_the_file_is_unreadable(importing):
    db = importing[1].db
    carol = book(db, "A Christmas Carol", "Charles Dickens", edition_isbn="9780141324524")
    _, _, _, state, items = run_rows(importing, [["A Christmas Carol", "Charles Dickens", "9780141324524", "", "finished", "sometime", "2025-12-20"]])
    row = items[0]
    assert row["source"]["warnings"] and row["disposition"] == "ready"      # an unreadable date is a notice, not a block
    assert row["plan"]["kind"] == "catalogue" and row["plan"]["book_id"] == carol.id and row["plan"]["confidence"] == "identifier"
    assert state["summary"]["counts"]["matched"] == 1 and state["summary"]["counts"]["needs_choice"] == 0


def test_isbn10_in_the_file_matches_the_edition_isbn13(importing):
    db = importing[1].db
    carol = book(db, "A Christmas Carol", "Charles Dickens", edition_isbn="9780141324524")
    row = run_rows(importing, [["A Christmas Carol", "Charles Dickens", "", "014132452X", "want", "", ""]])[4][0]
    assert row["plan"]["book_id"] == carol.id and row["disposition"] == "ready"


def test_isbn_wins_over_a_title_variant_when_the_author_agrees_but_not_when_both_disagree(importing):
    db = importing[1].db
    carol = book(db, "A Christmas Carol (Penguin Classics)", "Charles Dickens", edition_isbn="9780141324524")
    items = run_rows(importing, [["A Christmas Carol", "C. Dickens", "9780141324524", "", "want", "", ""],
                                 ["Something else entirely", "Another Person", "9780141324524", "", "want", "", ""]])[4]
    assert items[0]["plan"]["book_id"] == carol.id and items[0]["disposition"] == "ready"
    assert items[1]["disposition"] == "review" and "title_disagreement" in items[1]["plan"]["reasons"]   # a wrong ISBN still asks


def test_one_exact_author_among_adaptations_is_chosen(importing):
    db = importing[1].db
    own = book(db, "The Hobbit", "J. R. R. Tolkien")
    book(db, "The Hobbit", "Charles Dixon")
    book(db, "The Hobbit", "Jeff Barton")
    row = run_rows(importing, [["The Hobbit", "J.R.R. Tolkien", "", "", "want", "", ""]])[4][0]
    assert row["plan"]["book_id"] == own.id and row["plan"]["confidence"] == "title_author" and row["disposition"] == "ready"


def test_a_subtitle_or_edition_note_does_not_stop_the_match(importing):
    db = importing[1].db
    dune = book(db, "Dune: Deluxe Edition", "Frank Herbert")
    row = run_rows(importing, [["Dune", "Frank Herbert", "", "", "want", "", ""]])[4][0]
    assert row["plan"]["book_id"] == dune.id and row["disposition"] == "ready"


def test_a_true_tie_still_asks_and_lists_only_the_tied_books(importing):
    db = importing[1].db
    first = book(db, "The Silmarillion", "J.R.R. Tolkien")
    second = book(db, "The Silmarillion", "J.R.R. Tolkien")
    book(db, "The Silmarillion", "Someone Else")
    row = run_rows(importing, [["The Silmarillion", "J.R.R. Tolkien", "", "", "want", "", ""]])[4][0]
    assert row["disposition"] == "review" and row["plan"]["kind"] == "review"
    assert {first.id, second.id} <= {c["book_id"] for c in row["candidates"]}


def test_a_different_author_with_the_same_title_is_not_matched(importing):
    db = importing[1].db
    book(db, "The Hobbit", "Charles Dixon")
    row = run_rows(importing, [["The Hobbit", "J.R.R. Tolkien", "", "", "want", "", ""]])[4][0]
    assert row["plan"].get("book_id") is None and row["plan"]["kind"] in ("review", "private")


def attempt(db, entry, state="finished", started=None, ended=None):
    from models import ReadingAttempt
    db.add(ReadingAttempt(id=uuid4(), user_book_id=entry.id, state=state, started_on=started, ended_on=ended,
                          creation_fingerprint=uuid4().hex))
    db.commit()


def entry_for(db, user, book_row):
    from models import UserBook
    entry = UserBook(user_id=user.id, book_id=book_row.id, is_owned=True)
    db.add(entry)
    db.commit()
    return entry


def test_an_empty_existing_date_is_a_named_difference_and_is_filled_from_the_file(importing):
    from models import ReadingAttempt
    user, workflow = importing
    db = workflow.db
    carol = book(db, "A Christmas Carol", "Charles Dickens", edition_isbn="9780141324524")
    entry = entry_for(db, user, carol)
    attempt(db, entry, "finished")
    _, _, run, _, items = run_rows(importing, [["A Christmas Carol", "Charles Dickens", "9780141324524", "", "finished", "", "2025-12-20"]])
    row = items[0]
    assert row["disposition"] == "ready" and row["plan"]["kind"] == "existing"
    assert row["plan"]["differences"] == [{"field": "finished_on", "file": "2025-12-20", "existing": None, "use": "file"}]
    from test_library_import_workflow import apply
    apply(user, workflow, run)
    db.expire_all()
    attempts = list(db.scalars(select(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)))
    assert len(attempts) == 1 and attempts[0].ended_on == date(2025, 12, 20)


def test_a_different_existing_date_is_a_named_difference_that_keeps_the_existing_value(importing):
    from models import ReadingAttempt
    user, workflow = importing
    db = workflow.db
    carol = book(db, "A Christmas Carol", "Charles Dickens", edition_isbn="9780141324524")
    entry = entry_for(db, user, carol)
    attempt(db, entry, "finished", date(2025, 1, 1), date(2025, 1, 9))
    _, _, run, _, items = run_rows(importing, [["A Christmas Carol", "Charles Dickens", "9780141324524", "", "finished", "", "2025-12-20"]])
    row = items[0]
    assert row["disposition"] == "ready"
    assert row["plan"]["differences"] == [{"field": "finished_on", "file": "2025-12-20", "existing": "2025-01-09", "use": "existing"}]
    assert row["plan"]["existing_events"] == [{"started_on": "2025-01-01", "ended_on": "2025-01-09"}]
    from test_library_import_workflow import apply
    apply(user, workflow, run)
    db.expire_all()
    attempts = list(db.scalars(select(ReadingAttempt).where(ReadingAttempt.user_book_id == entry.id)))
    assert [(a.started_on, a.ended_on) for a in attempts] == [(date(2025, 1, 1), date(2025, 1, 9))]


def test_a_status_clash_is_named_and_does_not_block(importing):
    user, workflow = importing
    db = workflow.db
    carol = book(db, "A Christmas Carol", "Charles Dickens", edition_isbn="9780141324524")
    attempt(db, entry_for(db, user, carol), "reading", date(2025, 3, 1))
    row = run_rows(importing, [["A Christmas Carol", "Charles Dickens", "9780141324524", "", "finished", "", ""]])[4][0]
    assert row["disposition"] == "ready"
    assert {"field": "status", "file": "finished", "existing": "reading", "use": "existing"} in row["plan"]["differences"]


def test_summary_counts_are_exclusive_and_add_up_to_the_rows(importing):
    db = importing[1].db
    book(db, "Matched One", "Author One", edition_isbn="9780141324524")
    book(db, "Tied Title", "Same Person")
    book(db, "Tied Title", "Same Person")
    rows = [["Matched One", "Author One", "9780141324524", "", "want", "", ""],
            ["Tied Title", "Same Person", "", "", "want", "", ""],
            ["Only In My File", "Nobody", "", "", "want", "", ""],
            ["Matched One", "Author One", "9780141324524", "", "want", "", ""],      # the same book twice in the file
            ["Another Private Book", "Somebody", "", "", "want", "", ""]]
    state = run_rows(importing, rows)[3]
    counts = state["summary"]["counts"]
    assert counts["total"] == 5 == state["row_count"]
    parts = {key: value for key, value in counts.items() if key != "total"}
    assert sum(parts.values()) == 5, counts
    assert counts["private"] == 2 and counts["needs_choice"] >= 1 and counts["matched"] >= 1


def test_private_entries_and_other_readers_are_untouched(importing):
    from models import User, UserBook
    user, workflow = importing
    db = workflow.db
    other = User(email=f"other-{uuid4().hex}@example.test", hashed_password="x")
    db.add(other)
    db.flush()
    db.add(UserBook(user_id=other.id, private_title="Only Theirs", private_author="Them", is_wanted=True))
    db.add(UserBook(user_id=user.id, private_title="Mine Alone", private_author="Me", is_wanted=True))
    db.commit()
    items = run_rows(importing, [["Only Theirs", "Them", "", "", "want", "", ""], ["Mine Alone", "Me", "", "", "want", "", ""]])[4]
    assert all("Only Theirs" not in str(c) for item in items for c in item["candidates"])
    assert items[0]["plan"]["kind"] == "private"
    assert items[1]["disposition"] == "review" and "private_library_match_requires_review" in items[1]["plan"]["reasons"]


@pytest.mark.parametrize("count", [5, 300, 2000])
def test_analysis_takes_few_round_trips(importing, app_modules, count):
    user, workflow = importing
    db = workflow.db
    for n in range(min(count, 30)):
        book(db, f"Speed Fixture {n}", f"Speed Author {n}")
    rows = [[f"Speed Fixture {n % 30}" if n % 2 == 0 else f"Unknown Speed Title {n}", f"Speed Author {n % 30}", "", "", "want", "", ""] for n in range(count)]
    _, run = start(user, workflow, HEADERS)
    result = workflow.upload(user.id, run["id"], 0, __import__("library_import_schemas").UploadImportBatch(rows=rows[:100]))
    batches = [(0, result["batch_hash"], len(rows[:100]))]
    from library_import_schemas import FinalizeImport, UploadImportBatch
    for ordinal, start_at in enumerate(range(100, count, 100), start=1):
        chunk = rows[start_at:start_at + 100]
        batches.append((ordinal, workflow.upload(user.id, run["id"], ordinal, UploadImportBatch(rows=chunk))["batch_hash"], len(chunk)))
    from services.library_imports.formats import digest
    manifest = digest([{"ordinal": o, "hash": h, "length": n} for o, h, n in batches])
    workflow.finalize(user.id, run["id"], FinalizeImport(row_count=count, batch_count=len(batches), manifest_hash=manifest))
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    calls, began = 0, time.perf_counter()
    try:
        while workflow.status(user.id, run["id"])["phase"] in ("analyzing", "grouping"):
            workflow.advance_analysis(user.id, run["id"])
            calls += 1
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    elapsed = time.perf_counter() - began
    print(f"\nT44 timing: {count} rows -> {calls} advance call(s), {len(statements)} statements, {elapsed:.2f}s locally")
    assert calls <= 1 + count // 300 and workflow.status(user.id, run["id"])["phase"] == "preview_ready"
    kinds = {}
    for statement in statements:
        kinds[statement[:40]] = kinds.get(statement[:40], 0) + 1
    assert len(statements) <= 40 + count // 3       # never one statement per row


def test_candidates_carry_cover_and_year(importing):
    db = importing[1].db
    first = book(db, "The Silmarillion", "J.R.R. Tolkien")
    first.cover_image_url, first.published_year = "https://covers.example/s.jpg", 1977
    book(db, "The Silmarillion", "J.R.R. Tolkien")
    db.commit()
    row = run_rows(importing, [["The Silmarillion", "J.R.R. Tolkien", "", "", "want", "", ""]])[4][0]
    mine = next(c for c in row["candidates"] if c["book_id"] == first.id)
    assert (mine["cover_image_url"], mine["published_year"]) == ("https://covers.example/s.jpg", 1977)
