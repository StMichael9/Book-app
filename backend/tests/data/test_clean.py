from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


class DummyResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


@pytest.fixture()
def clean_module(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    payload_by_genre = {
        "fantasy": {
            "works": [
                {
                    "title": "Shared Title",
                    "authors": [{"name": "Author One"}],
                    "first_publish_year": 2001,
                },
                {
                    "title": "Null Year",
                    "authors": [{"name": "Author Two"}],
                    "first_publish_year": 0,
                },
            ]
        },
        "mystery": {
            "works": [
                {
                    "title": "Shared Title",
                    "authors": [{"name": "Author One"}],
                    "first_publish_year": 2001,
                },
                {
                    "title": "Second Mystery",
                    "authors": [],
                    "first_publish_year": 1999,
                },
            ]
        },
        "horror": {"works": []},
        "romance": {"works": []},
        "science_fiction": {"works": []},
    }

    def fake_get(url, headers, timeout):
        genre = url.split("/subjects/")[1].split(".")[0]
        return DummyResponse(payload_by_genre[genre])

    monkeypatch.setattr("requests.get", fake_get)
    monkeypatch.setattr("time.sleep", lambda seconds: None)

    sys.modules.pop("data.clean", None)
    return importlib.import_module("data.clean")


def test_fetch_with_retry_retries_then_succeeds(clean_module, monkeypatch):
    calls = {"count": 0, "slept": []}

    def fake_get(url, headers, timeout):
        calls["count"] += 1
        if calls["count"] < 3:
            raise clean_module.requests.exceptions.RequestException("temporary failure")
        return DummyResponse({"works": []})

    monkeypatch.setattr(clean_module.requests, "get", fake_get)
    monkeypatch.setattr(clean_module.time, "sleep", lambda seconds: calls["slept"].append(seconds))

    result = clean_module.fetch_with_retry("https://example.com", {"User-Agent": "x"}, max_attempts=3, timeout=5)

    assert result == {"works": []}
    assert calls["count"] == 3
    assert calls["slept"] == [2, 4]


def test_fetch_with_retry_raises_after_max_attempts(clean_module, monkeypatch):
    calls = {"count": 0, "slept": []}

    def fake_get(url, headers, timeout):
        calls["count"] += 1
        raise clean_module.requests.exceptions.RequestException("still failing")

    monkeypatch.setattr(clean_module.requests, "get", fake_get)
    monkeypatch.setattr(clean_module.time, "sleep", lambda seconds: calls["slept"].append(seconds))

    with pytest.raises(clean_module.requests.exceptions.RequestException):
        clean_module.fetch_with_retry("https://example.com", {"User-Agent": "x"}, max_attempts=3, timeout=5)

    assert calls["count"] == 3
    assert calls["slept"] == [2, 4]


def test_pipeline_builds_clean_and_combined_outputs(clean_module):
    fantasy_clean = Path("json_data/clean/fantasy_clean.json")
    mystery_clean = Path("json_data/clean/mystery_clean.json")
    combined = Path("json_data/books_combined.json")

    assert fantasy_clean.exists()
    assert mystery_clean.exists()
    assert combined.exists()

    fantasy_rows = clean_module.pd.read_json(fantasy_clean).to_dict(orient="records")
    mystery_rows = clean_module.pd.read_json(mystery_clean).to_dict(orient="records")
    combined_rows = clean_module.pd.read_json(combined).to_dict(orient="records")

    assert fantasy_rows[0]["genre"] == "fantasy"
    assert fantasy_rows[0]["author"] == "Author One"
    assert fantasy_rows[1]["first_publish_year"] is None

    assert mystery_rows[0]["genre"] == "mystery"
    assert mystery_rows[1]["author"] is None

    assert len(combined_rows) == 3

    shared_title = next(row for row in combined_rows if row["title"] == "Shared Title")
    null_year = next(row for row in combined_rows if row["title"] == "Null Year")
    second_mystery = next(row for row in combined_rows if row["title"] == "Second Mystery")

    assert shared_title["author"] == "Author One"
    assert shared_title["genre"] == ["fantasy", "mystery"]
    assert null_year["first_publish_year"] is None
    assert second_mystery["author"] is None