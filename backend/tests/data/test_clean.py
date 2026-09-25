from __future__ import annotations

import gzip
import io
import json

import pytest

from data import clean


def test_work_normalization_and_curated_tags():
    work = clean.normalize_work({
        "key": "/works/OL123W",
        "title": "  Shared   Title ",
        "subjects": ["Fantasy fiction", "SCIENCE", "Fantasy"],
        "authors": [
            {"author": {"key": "/authors/OL1A"}},
            {"author": {"key": "/authors/OL1A"}},
            {"author": {"key": "/authors/OL2A"}},
        ],
        "first_publish_date": "June 1998",
        "description": {"value": " A  description "},
        "covers": [123],
    })
    assert work == {
        "source_id": "/works/OL123W",
        "title": "Shared Title",
        "description": "A description",
        "published_year": 1998,
        "cover_image_url": "https://covers.openlibrary.org/b/id/123-L.jpg",
        "author_keys": ["/authors/OL1A", "/authors/OL2A"],
        "tags": [{"name": "fantasy", "type": "genre"}, {"name": "science", "type": "topic"}],
        "categories": ["fantasy", "science"],
        "quality": 3,
    }
    assert clean.normalize_work({"key": "/works/OL7W", "title": "Unmapped", "subjects": []}) is None
    assert clean.normalize_work({"key": "/works/OL7W", "title": "Книга",
                                 "subjects": ["fantasy"], "authors": [{"key": "/authors/OL1A"}]})["title"] == "Книга"


def test_malformed_and_missing_metadata():
    assert clean.normalize_work({"key": "/works/OL7W", "title": "A",
                                 "subjects": "fantasy", "authors": None}) is None
    assert clean.normalize_author({"key": "/authors/OL8A", "name": "  Jane   Doe "}) == {
        "source_id": "/authors/OL8A", "name": "Jane Doe"
    }
    assert clean.normalize_author({"key": "/authors/OL8A", "name": None}) is None
    assert clean.year("unknown") is None
    assert clean.page_count(0) is None
    assert clean.page_count("301") is None
    assert clean.isbn13("978-0-14-032872-1") == "9780140328721"
    assert clean.isbn13("9780140328722") is None


def test_edition_values_come_from_one_record():
    editions = clean.normalize_edition({
        "key": "/books/OL10M",
        "works": [{"key": "/works/OL123W"}],
        "languages": [{"key": "/languages/eng"}],
        "isbn_13": ["bad", "9780140328721"],
        "number_of_pages": 321,
    })
    assert editions == [{
        "source_id": "/works/OL123W", "edition_key": "/books/OL10M",
        "quality": 115, "isbns": [{"isbn13": "9780140328721", "derived_from_isbn10": False}],
        "page_count": 321, "languages": ["/languages/eng"],
        "publication_date": None, "publishers": [], "physical_format": None,
        "cover_image_url": None,
    }]
    assert clean.normalize_edition({"key": "/books/OL10M", "works": None}) == []


def test_dump_is_streamed_without_file_outputs(monkeypatch):
    rows = [
        "/type/work\t/works/OL1W\t1\t2026-01-01\t" + json.dumps({"key": "/works/OL1W"}),
        "broken",
        "/type/work\t/works/OL2W\t1\t2026-01-01\t" + json.dumps({"key": "/works/OL2W"}),
    ]
    compressed = gzip.compress(("\n".join(rows) + "\n").encode("utf-8"))

    class Response:
        def __init__(self):
            self.raw = io.BytesIO(compressed)
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            pass
        def raise_for_status(self):
            pass

    monkeypatch.setattr(clean.requests, "get", lambda *_args, **_kwargs: Response())
    result = list(clean.stream_dump("https://openlibrary.org/data/ol_dump_works_2026-09-01.txt.gz",
                                    start_line=1, user_agent="Bookvane (contact@example.org)"))
    assert [row.line_number for row in result] == [2, 3]
    assert result[0].error
    assert result[1].record["key"] == "/works/OL2W"
    with pytest.raises(ValueError):
        list(clean.stream_dump("https://openlibrary.org/data/ol_dump_works_latest.txt.gz",
                               user_agent="Bookvane (contact@example.org)"))


def test_exact_mood_theme_and_historical_fiction_rules():
    work = clean.normalize_work({
        "key": "/works/OL44W", "title": "История",
        "subjects": ["Historical fiction", " friendship -- FICTION ", "Anxious"],
        "authors": [{"author": {"key": "/authors/OL4A"}}],
    })
    assert work["source_id"] == "/works/OL44W"
    assert {tuple(tag.values()) for tag in work["tags"]} == {
        ("historical_fiction", "genre"), ("Friendship", "theme")
    }


def test_multiple_valid_isbns_and_isbn10_conversion():
    edition = clean.normalize_edition({
        "key": "/books/OL11M", "works": [{"key": "/works/OL1W"}],
        "isbn_13": ["9780140328721", "bad"], "isbn_10": ["0306406152"],
        "number_of_pages": 400, "publishers": ["Publisher"],
    })[0]
    assert {item["isbn13"] for item in edition["isbns"]} == {
        "9780140328721", "9780306406157"
    }
    assert next(item for item in edition["isbns"] if item["isbn13"] == "9780306406157")[
        "derived_from_isbn10"
    ] is True
    assert clean.normalize_edition({"key": "/books/OL12M", "works": [{"key": "/works/OL1W"}],
                                    "isbn_13": ["bad"], "number_of_pages": 0}) == []
