"""T53: every real Google description lookup logs one reason code, and nothing identifying. Mocked; no database."""
import logging

import pytest
import requests

from test_google_books import ISBN, MARK, Google, google, volume  # noqa: F401

TITLE, AUTHOR, KEY = "Orphan X", "Gregg Hurwitz", "test-key"


@pytest.fixture()
def lines(google):  # noqa: F811
    """The messages the description lookup logs, captured from its own logger."""
    from services import google_books
    captured = []

    class Capture(logging.Handler):
        def emit(self, record):
            captured.append(record)

    handler, old_level = Capture(level=logging.INFO), google_books.log.level
    google_books.log.addHandler(handler)
    google_books.log.setLevel(logging.INFO)
    yield captured
    google_books.log.removeHandler(handler)
    google_books.log.setLevel(old_level)


def lookup(isbn=ISBN, **kwargs):
    from services import google_books
    return google_books.description_for(isbn, TITLE, AUTHOR, **kwargs)


def messages(lines):
    return [record.getMessage() for record in lines]


def test_a_hit_is_logged_once_with_the_word_hit(google, lines):  # noqa: F811
    google.items = [volume()]
    assert lookup()["text"] == MARK
    assert messages(lines) == ["google description: hit"]
    assert lines[0].levelno == logging.INFO


def test_disabled_is_logged_and_makes_no_call(google, lines, monkeypatch):  # noqa: F811
    from services import google_books
    google.forbidden = True
    monkeypatch.setattr(google_books.settings, "google_books_enabled", False)
    assert lookup() is None
    assert messages(lines) == ["google description: disabled"]


def test_a_blank_key_counts_as_disabled(google, lines, monkeypatch):  # noqa: F811
    from pydantic import SecretStr
    from services import google_books
    google.forbidden = True
    monkeypatch.setattr(google_books.settings, "google_books_api_key", SecretStr(" "))
    assert lookup() is None
    assert messages(lines) == ["google description: disabled"]


def test_no_query_is_logged_when_there_is_no_isbn_and_no_title_and_author(google, lines):  # noqa: F811
    from services import google_books
    google.forbidden = True
    assert google_books.description_for(None, TITLE, None) is None
    assert messages(lines) == ["google description: no_query"]


@pytest.mark.parametrize("status", [400, 403, 429, 500])
def test_a_non_200_answer_is_logged_with_its_status(google, lines, status):  # noqa: F811
    google.status = status
    assert lookup() is None
    assert messages(lines) == [f"google description: http_{status}"]


def test_a_network_error_is_logged_as_error_without_the_exception_text(google, lines, monkeypatch):  # noqa: F811
    from services import google_books

    def boom(*args, **kwargs):
        raise requests.ConnectionError(f"https://www.googleapis.com/books/v1/volumes?q=isbn:{ISBN}&key={KEY}")

    monkeypatch.setattr(google_books.requests, "get", boom)
    assert lookup() is None
    assert messages(lines) == ["google description: error"]
    assert lines[0].exc_info is None


def test_an_unreadable_body_is_logged_as_error(google, lines, monkeypatch):  # noqa: F811
    from services import google_books

    class Broken:
        status_code, headers = 200, {}

        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(google_books.requests, "get", lambda *a, **k: Broken())
    assert lookup() is None
    assert messages(lines) == ["google description: error"]


def test_an_answer_with_no_volumes_is_logged_as_no_items(google, lines):  # noqa: F811
    google.items = []
    assert lookup() is None
    assert messages(lines) == ["google description: no_items"]


def test_volumes_that_do_not_match_the_title_and_author_count_as_no_items(google, lines):  # noqa: F811
    google.items = [volume(title="Another Book", authors=["Someone Else"])]
    from services import google_books
    assert google_books.description_for(None, TITLE, AUTHOR) is None
    assert messages(lines) == ["google description: no_items"]


@pytest.mark.parametrize("description", ["   ", "<p></p>", None])
def test_volumes_without_description_text_are_logged_as_no_description(google, lines, description):  # noqa: F811
    item = volume(description=description)
    if description is None:
        del item["description"]
    google.items = [item]
    assert lookup() is None
    assert messages(lines) == ["google description: no_description"]


@pytest.mark.parametrize("link", ["http://books.google.com/books?id=abc", "https://evil.example/x", None])
def test_text_without_a_valid_google_link_is_logged_as_bad_link(google, lines, link):  # noqa: F811
    item = volume(link=link)
    if link is None:
        del item["infoLink"]
    google.items = [item]
    assert lookup() is None
    assert messages(lines) == ["google description: bad_link"]


def test_a_cached_answer_does_not_log_again_hit_or_miss(google, lines):  # noqa: F811
    google.items = [volume()]
    lookup(), lookup(), lookup()
    assert len(google.calls) == 1 and messages(lines) == ["google description: hit"]
    from services import google_books
    google_books.clear_cache()
    lines.clear()
    google.calls.clear()
    google.items = []
    for _ in range(3):
        assert lookup() is None
    assert len(google.calls) == 1 and messages(lines) == ["google description: no_items"]


def test_the_book_id_is_logged_when_given_and_nothing_else_identifies_the_book(google, lines):  # noqa: F811
    google.items = [volume()]
    lookup(book_id=1816)
    assert messages(lines) == ["google description: hit book=1816"]


def test_no_key_title_author_isbn_link_or_text_ever_appears_in_a_log_record(google, lines, monkeypatch):  # noqa: F811
    from services import google_books
    secret = "SECRET-KEY-VALUE-77"
    monkeypatch.setattr(google_books.settings, "google_books_api_key", __import__("pydantic").SecretStr(secret))
    outcomes = [([volume()], 200), ([], 200), ([volume(description="  ")], 200), ([volume(link="http://x")], 200),
                ([], 403), ([], 429)]
    for items, status in outcomes:
        google_books.clear_cache()
        google.items, google.status = items, status
        lookup(book_id=7)
    google_books.clear_cache()
    google.items, google.status = [], 200
    google_books.description_for(None, TITLE, AUTHOR)
    assert len(lines) == len(outcomes) + 1
    for record in lines:
        text = f"{record.getMessage()} {record.args} {record.name}"
        for forbidden in (secret, KEY, TITLE, AUTHOR, ISBN, MARK, "books.google.com", "googleapis", "Hurwitz"):
            assert forbidden not in text
