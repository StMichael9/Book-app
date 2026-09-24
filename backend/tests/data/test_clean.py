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
        "tags": ["fantasy", "science"],
    }
    assert clean.normalize_work({"key": "/works/OL7W", "title": "Unmapped", "subjects": []}) is None
    assert clean.normalize_work({"key": "/works/OL7W", "title": "Книга",
                                 "subjects": ["fantasy"], "authors": [{"key": "/authors/OL1A"}]}) is None


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
        "quality": 7, "isbn13": "9780140328721", "page_count": 321,
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
