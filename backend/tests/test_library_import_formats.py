"""Engineering fixtures, NOT evidence of fresh native platform exports."""
import json

import pytest
from pydantic import ValidationError

from library_import_schemas import ImportDecision, StartImport, UploadImportBatch
from services.library_imports.formats import (
    BOOKVANE_HEADERS, FormatError, canonical, digest, inspect_headers, normalize_row, paste_rows,
)


def normalized(headers, cells, mapping=None, status_map=None):
    inspected = inspect_headers(headers, mapping)
    return normalize_row(inspected["source"], headers, inspected["mapping"], cells, status_map=status_map)


def test_goodreads_recognition_reordered_and_formula_wrapped_isbn():
    headers = ["Exclusive Shelf", "Author", "Title", "Book Id", "ISBN13", "My Rating", "Date Added", "Date Read", "Read Count"]
    row = normalized(headers, ["read", "An Author", "A Book", "123", '="9781250313195"', "0", "2020/01/01", "2020/02/02", "5"])
    assert row["status"] == "finished"
    assert row["isbns"] == ["9781250313195"]
    assert row["context"]["rating"] is None
    assert row["events"][0]["started_on"] is None
    assert row["events"][0]["ended_on"] == "2020-02-02"
    assert "incomplete_read_history" in row["warnings"]
    assert len(row["events"]) == 1


def test_storygraph_opaque_uid_is_not_isbn_or_work_and_dates_are_not_guessed():
    headers = ["Title", "Authors", "ISBN/UID", "Read Status", "Dates Read", "Star Rating", "Moods"]
    row = normalized(headers, ["Un livre", "É. Auteur", "private-uid", "read", "03/04/2025; 2024", "4.25", "reflective"])
    assert row["isbns"] == [] and row["work_source_id"] is None
    assert row["context"]["dates_read"] == "03/04/2025; 2024"
    assert row["context"]["rating"] == "4.25"
    assert row["context"]["platform"] == {"Moods": "reflective"}
    assert "dates_read_requires_review" in row["warnings"]
    assert row["events"][0]["ended_on"] is None


@pytest.mark.parametrize("rating", ["NaN", "Infinity", "-1", "6", "1.234", "=1+1"])
def test_invalid_ratings_are_retained_as_context_but_not_invented(rating):
    row = normalized(["title", "rating"], ["A Book", rating])
    assert row["context"]["rating"] is None
    assert "invalid_rating" in row["warnings"]
    assert row["context"]["reported_rating"] == rating


def test_unicode_and_qualifiers_and_inert_private_text_preserved():
    review = "  =HYPERLINK(\"https://example.test\",\"x\")\n<script>test</script>  "
    row = normalized(["title", "author", "review"], ["夜の本 — Volume 2 (abridged)", "李 白", review])
    assert row["title"] == "夜の本 — Volume 2 (abridged)"
    assert row["context"]["review"] == review
    assert canonical(" É\tAUTEUR ") == "é auteur"


@pytest.mark.parametrize("headers", [["Title", " title "], ["Title", ""], ["title", "x\x00"]])
def test_duplicate_or_invalid_headers_rejected(headers):
    with pytest.raises(FormatError, match="duplicate_or_invalid_headers"):
        inspect_headers(headers)


def test_ambiguous_columns_require_clarification():
    result = inspect_headers(["Title", "Author", "Authors"])
    assert result["ambiguous"] == {"author": [1, 2]}
    assert "author" not in result["mapping"]
    clarified = inspect_headers(["Title", "Author", "Authors"], {"author": 2})
    assert not clarified["ambiguous"] and clarified["mapping"]["author"] == 2
    with pytest.raises(FormatError, match="overlapping"):
        inspect_headers(["Title", "Author"], {"title": 0, "author": 0})


def test_generic_status_and_locale_dates_never_guessed():
    row = normalized(["title", "status", "started_on", "finished_on"], ["A", "shelf-x", "03/04/2025", "2025"])
    assert row["status"] is None and row["events"] == []
    assert {"unmapped_status", "unparsed_started_on", "unparsed_finished_on"} <= set(row["warnings"])
    mapped = normalized(["title", "status"], ["A", "shelf-x"], status_map={"shelf-x": "dnf"})
    assert mapped["status"] == "dnf"


def test_generic_blank_fields_do_not_invent_flags_or_attempts():
    row = normalized(["title", "owned", "wanted", "status"], ["A", "", "", ""])
    assert row["is_owned"] is None and row["is_wanted"] is None and not row["events"]


def test_goodreads_ownership_count_not_duplicate_books():
    row = normalized(["Title", "Author", "Book Id", "Exclusive Shelf", "Owned Copies"], ["A", "B", "1", "to-read", "3"])
    assert row["is_owned"] is True and row["is_wanted"] is True
    assert row["events"] == [] and row["context"]["owned"] == "3"


def test_bookvane_multiple_event_rows_share_source_identity_not_event():
    headers = ["version", "record_id", "attempt_id", "title", "status", "finished_on", "labels"]
    first = normalized(headers, ["1", "record", "event-1", "A", "finished", "2025-01-01", '["a,b","night"]'])
    second = normalized(headers, ["1", "record", "event-2", "A", "finished", "2026-01-01", '["a,b","night"]'])
    assert first["record_key"] == second["record_key"]
    assert first["events"][0]["key"] != second["events"][0]["key"]
    assert first["context"]["labels"] == ["a,b", "night"]
    with pytest.raises(FormatError, match="unsupported_bookvane"):
        normalized(headers, ["2", "x", "e", "A", "", "", ""])


def test_weak_identity_includes_title_author_not_isbn_only():
    one = normalized(["title", "author", "isbn"], ["A", "B", "9781250313195"])
    other = normalized(["title", "author", "isbn"], ["C", "D", "9781250313195"])
    assert one["record_key"] != other["record_key"]
    reordered = normalized(["isbn", "author", "title"], ["9781250313195", "B", "A"])
    assert one == reordered
    assert digest(one) == digest(reordered)


@pytest.mark.parametrize("value", ["a\x00b", "a\x01b", "é" * 32769], ids=["nul", "control", "utf8-byte-limit"])
def test_server_cell_byte_and_binary_limits(value):
    with pytest.raises(FormatError):
        normalized(["title", "review"], ["A", value])


def test_label_bounds_and_no_silent_truncation():
    with pytest.raises(FormatError, match="labels"):
        normalized(["title", "labels"], ["A", json.dumps(["x"] * 101)])
    with pytest.raises(FormatError, match="identity_too_long"):
        normalized(["title"], ["x" * 501])


def test_paste_preserves_title_hyphens_no_unsupported_history():
    headers, rows = paste_rows("A-B\nA Title — An Author\n9781250313195\n")
    assert rows == [["A-B", "", ""], ["A Title", "An Author", ""], ["", "", "9781250313195"]]
    for row in rows:
        assert not normalize_row("paste", headers, {"title": 0, "author": 1, "isbn13": 2}, row)["events"]
    with pytest.raises(FormatError, match="ambiguous_paste"):
        paste_rows("A — B — C")
    with pytest.raises(FormatError, match="paste_line_limit"):
        paste_rows("a\n" * 1001)


def test_request_contract_rejects_coercions_extra_fields_and_large_batches():
    with pytest.raises(ValidationError):
        UploadImportBatch(rows=[[42]])
    with pytest.raises(ValidationError):
        UploadImportBatch(rows=[["x"]] * 101)
    with pytest.raises(ValidationError):
        StartImport(id="d2d414ad-67d6-4702-9ca1-21fc348c3385", headers=["title"], user_id="other")
    with pytest.raises(ValidationError):
        ImportDecision(expected_revision=1, action="match", book_id=1, entry_id=2)
    assert "title" in BOOKVANE_HEADERS
