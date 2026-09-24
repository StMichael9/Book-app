"""Streaming Open Library dump reader and catalogue normalizers.

Run ``python -m data.load`` to import. Importing this module never fetches data.
The category map is curated to avoid filling Bookvane with raw subject noise.
"""
from __future__ import annotations

import gzip
import io
import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterator
from urllib.parse import urlparse

import requests


# Existing fifteen labels stay intact. Edit this map to expand the catalogue.
SUBJECT_ALIASES: dict[str, tuple[str, ...]] = {
    "fantasy": ("fantasy", "fantasy fiction"),
    "mystery": ("mystery", "mystery fiction", "detective and mystery stories"),
    "horror": ("horror", "horror stories"),
    "romance": ("romance", "romance fiction", "love stories"),
    "science_fiction": ("science fiction", "science-fiction"),
    "thriller": ("thriller", "thrillers", "suspense fiction"),
    "biography": ("biography", "biographies"),
    "poetry": ("poetry", "poems"),
    "history": ("history", "historical fiction"),
    "drama": ("drama", "plays"),
    "adventure": ("adventure", "adventure stories"),
    "humor": ("humor", "humour", "humorous stories"),
    "classics": ("classics", "classic literature"),
    "young_adult": ("young adult", "young adult fiction"),
    "philosophy": ("philosophy",),
    "science": ("science", "popular science"),
    "technology": ("technology", "computers", "computer science"),
    "business": ("business", "management"),
    "art": ("art", "arts"),
    "music": ("music",),
    "cooking": ("cooking", "cookbooks", "cookery"),
    "travel": ("travel", "travel writing"),
    "health": ("health", "medicine"),
    "nature": ("nature", "natural history"),
    "sports": ("sports", "sport"),
    "psychology": ("psychology",),
    "religion": ("religion", "religions"),
    "politics": ("politics", "political science"),
    "education": ("education",),
}


def _text(value: object, limit: int | None = None) -> str | None:
    if not isinstance(value, str):
        return None
    result = " ".join(unicodedata.normalize("NFKC", value).split())
    if not result or (limit is not None and len(result) > limit):
        return None
    return result


def _subject_key(value: str) -> str:
    return re.sub(r"[\s_-]+", " ", value.casefold()).strip()


def subject_map() -> dict[str, str]:
    return {_subject_key(alias): label for label, aliases in SUBJECT_ALIASES.items() for alias in aliases}


def work_key(value: object) -> str | None:
    if isinstance(value, str) and re.fullmatch(r"/works/OL[0-9]+W", value):
        return value
    return None


def author_key(value: object) -> str | None:
    if isinstance(value, dict):
        nested = value.get("author", value)
        value = nested.get("key") if isinstance(nested, dict) else None
    if isinstance(value, str) and re.fullmatch(r"/authors/OL[0-9]+A", value):
        return value
    return None


def year(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        candidate = value
    elif isinstance(value, str):
        match = re.search(r"\b(1[4-9][0-9]{2}|20[0-9]{2})\b", value)
        candidate = int(match.group(1)) if match else None
    else:
        candidate = None
    return candidate if candidate is not None and 1400 <= candidate <= 2100 else None


def description(value: object) -> str | None:
    return _text(value.get("value") if isinstance(value, dict) else value)


def cover_url(cover_id: object) -> str | None:
    if isinstance(cover_id, int) and not isinstance(cover_id, bool) and cover_id > 0:
        return f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
    return None


def isbn13(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    digits = re.sub(r"[-\s]", "", value)
    if not re.fullmatch(r"(?:978|979)[0-9]{10}", digits):
        return None
    total = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(digits[:12]))
    return digits if (10 - total % 10) % 10 == int(digits[12]) else None


def page_count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 20000 else None


def normalize_work(data: dict, mapped_subjects: dict[str, str] | None = None) -> dict | None:
    key = work_key(data.get("key"))
    title = _text(data.get("title"))
    if not key or not title or not title.isascii():
        return None
    mapping = mapped_subjects or subject_map()
    subjects = data.get("subjects")
    if not isinstance(subjects, list):
        subjects = []
    tags = sorted({mapping[_subject_key(item)] for item in subjects
                   if isinstance(item, str) and _subject_key(item) in mapping})
    if not tags:
        return None
    authors = data.get("authors")
    if not isinstance(authors, list):
        authors = []
    author_keys = list(dict.fromkeys(filter(None, (author_key(item) for item in authors))))
    if not author_keys:
        return None
    covers = data.get("covers")
    if not isinstance(covers, list):
        covers = []
    cover = next((valid for item in covers if (valid := cover_url(item))), None)
    return {
        "source_id": key,
        "title": title,
        "description": description(data.get("description")),
        "published_year": year(data.get("first_publish_year")) or year(data.get("first_publish_date")),
        "cover_image_url": cover,
        "author_keys": author_keys,
        "tags": tags,
    }


def normalize_author(data: dict) -> dict | None:
    key = author_key(data.get("key"))
    name = _text(data.get("name"), 225)
    return {"source_id": key, "name": name} if key and name else None


def normalize_edition(data: dict) -> list[dict]:
    key = data.get("key")
    if not isinstance(key, str) or not re.fullmatch(r"/books/OL[0-9]+M", key):
        return []
    raw_isbns = data.get("isbn_13")
    if not isinstance(raw_isbns, list):
        raw_isbns = []
    isbn = next((valid for item in raw_isbns if (valid := isbn13(item))), None)
    pages = page_count(data.get("number_of_pages"))
    languages = data.get("languages")
    if not isinstance(languages, list):
        languages = []
    english = any(isinstance(item, dict) and item.get("key") == "/languages/eng" for item in languages)
    # Prefer complete, usable metadata; English breaks ties.
    rank = 4 * bool(isbn) + 2 * bool(pages) + english
    works = data.get("works")
    if not isinstance(works, list):
        works = []
    result = []
    for item in works:
        source_id = work_key(item.get("key")) if isinstance(item, dict) else None
        if source_id:
            result.append({"source_id": source_id, "edition_key": key,
                           "quality": rank, "isbn13": isbn, "page_count": pages})
    return result


@dataclass(frozen=True)
class DumpRow:
    line_number: int
    record: dict | None
    error: str | None = None
    byte_size: int = 0


def stream_dump(url: str, *, start_line: int = 0, user_agent: str, timeout: int = 120) -> Iterator[DumpRow]:
    """Decode a pinned Open Library TSV gzip stream without storing its body."""
    parsed = urlparse(url)
    if (parsed.scheme != "https" or "latest" in url.casefold()
            or parsed.hostname not in ("openlibrary.org", "archive.org")
            and not (parsed.hostname or "").endswith(".archive.org")):
        raise ValueError("Use a pinned HTTPS dump URL, never a changing 'latest' URL")
    with requests.get(url, headers={"User-Agent": user_agent}, stream=True, timeout=(20, timeout)) as response:
        response.raise_for_status()
        response.raw.decode_content = False
        with gzip.GzipFile(fileobj=response.raw) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", errors="replace") as lines:
                number = 0
                while True:
                    line = lines.readline(4_000_001)
                    if not line:
                        break
                    number += 1
                    if len(line) > 4_000_000 and not line.endswith("\n"):
                        while line and not line.endswith("\n"):
                            line = lines.readline(4_000_001)
                        if number > start_line:
                            yield DumpRow(number, None, "record exceeds four million characters", 4_000_001)
                        continue
                    if number <= start_line:
                        continue
                    try:
                        fields = line.rstrip("\n").split("\t", 4)
                        if len(fields) != 5:
                            raise ValueError("expected five TSV fields")
                        record = json.loads(fields[4])
                        if not isinstance(record, dict):
                            raise ValueError("JSON record is not an object")
                        yield DumpRow(number, record, byte_size=len(line))
                    except ValueError as exc:
                        yield DumpRow(number, None, str(exc)[:200], len(line))
