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

CATEGORY_TYPES = {
    **{name: "genre" for name in (
        "fantasy", "mystery", "horror", "romance", "science_fiction", "thriller",
        "biography", "adventure", "humor", "classics",
    )},
    "poetry": "form", "drama": "form", "young_adult": "audience",
    **{name: "topic" for name in (
        "history", "philosophy", "science", "technology", "business", "art", "music",
        "cooking", "travel", "health", "nature", "sports", "psychology", "religion",
        "politics", "education",
    )},
}

MOOD_THEME_ALIASES = {
    "Friendship -- Fiction": ("Friendship", "theme"),
    "Coming of age -- Fiction": ("Coming of age", "theme"),
    "Bildungsromans": ("Coming of age", "theme"),
    "Family life -- Fiction": ("Family", "theme"),
    "Families -- Fiction": ("Family", "theme"),
    "Survival -- Fiction": ("Survival", "theme"),
    "Survival stories": ("Survival", "theme"),
    "Cozy mysteries": ("Cozy", "mood"),
    "Cozy mystery fiction": ("Cozy", "mood"),
    "Humorous stories": ("Humorous", "mood"),
    "Humorous fiction": ("Humorous", "mood"),
    "Suspense fiction": ("Suspenseful", "mood"),
    "Suspense stories": ("Suspenseful", "mood"),
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
        match = re.search(r"\b([1-9][0-9]{2,3}|20[0-9]{2})\b", value)
        candidate = int(match.group(1)) if match else None
    else:
        candidate = None
    return candidate if candidate is not None and 1 <= candidate <= 2100 else None


def description(value: object) -> str | None:
    result = _text(value.get("value") if isinstance(value, dict) else value)
    # Outlier records are reported and omitted, never silently truncated.
    return result if result is None or len(result.encode("utf-8")) <= 262144 else None


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


def isbn10_to_13(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    digits = re.sub(r"[-\s]", "", value).upper()
    if not re.fullmatch(r"[0-9]{9}[0-9X]", digits):
        return None
    checksum = sum((10 - i) * int(char) for i, char in enumerate(digits[:9]))
    checksum += 10 if digits[9] == "X" else int(digits[9])
    if checksum % 11:
        return None
    stem = "978" + digits[:9]
    total = sum(int(char) * (1 if i % 2 == 0 else 3) for i, char in enumerate(stem))
    return stem + str((10 - total % 10) % 10)


def page_count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 20000 else None


def normalize_work(data: dict, mapped_subjects: dict[str, str] | None = None) -> dict | None:
    key = work_key(data.get("key"))
    title = _text(data.get("title"))
    if not key or not title:
        return None
    mapping = mapped_subjects or subject_map()
    subjects = data.get("subjects")
    if not isinstance(subjects, list):
        subjects = []
    categories = sorted({mapping[_subject_key(item)] for item in subjects
                   if isinstance(item, str) and _subject_key(item) in mapping})
    if not categories:
        return None
    subject_keys = {_subject_key(item) for item in subjects if isinstance(item, str)}
    tags = {(name, CATEGORY_TYPES[name]) for name in categories}
    if "historical fiction" in subject_keys:
        if "history" not in subject_keys:
            tags.discard(("history", "topic"))
        tags.add(("historical_fiction", "genre"))
    mood_theme = {_subject_key(alias): target for alias, target in MOOD_THEME_ALIASES.items()}
    tags.update(mood_theme[subject_key] for item in subjects if isinstance(item, str)
                if (subject_key := _subject_key(item)) in mood_theme)
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
        "tags": [{"name": name, "type": tag_type} for name, tag_type in sorted(tags)],
        "categories": categories,
        "quality": sum(bool(value) for value in (
            description(data.get("description")), cover, year(data.get("first_publish_year")) or year(data.get("first_publish_date"))
        )),
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
    isbns = {valid: False for item in raw_isbns if (valid := isbn13(item))}
    raw_isbn10 = data.get("isbn_10")
    if isinstance(raw_isbn10, list):
        for item in raw_isbn10:
            valid = isbn10_to_13(item)
            if valid and valid not in isbns:
                isbns[valid] = True
    pages = page_count(data.get("number_of_pages"))
    languages = data.get("languages")
    if not isinstance(languages, list):
        languages = []
    language_keys = sorted({item["key"] for item in languages
                            if isinstance(item, dict) and isinstance(item.get("key"), str)
                            and item["key"].startswith("/languages/")})
    english = "/languages/eng" in language_keys
    if not isbns and not pages:
        return []
    # English takes priority; completeness and stable key break the rest.
    rank = 100 * english + 10 * bool(isbns) + 5 * bool(pages)
    publishers = data.get("publishers")
    publisher_names = list(dict.fromkeys(filter(None, (_text(item, 225) for item in publishers)))) if isinstance(publishers, list) else []
    covers = data.get("covers")
    edition_cover = next((url for item in covers if (url := cover_url(item))), None) if isinstance(covers, list) else None
    works = data.get("works")
    if not isinstance(works, list):
        works = []
    result = []
    for item in works:
        source_id = work_key(item.get("key")) if isinstance(item, dict) else None
        if source_id:
            result.append({"source_id": source_id, "edition_key": key,
                           "quality": rank, "isbns": [
                               {"isbn13": isbn, "derived_from_isbn10": derived}
                               for isbn, derived in sorted(isbns.items())
                           ], "page_count": pages, "languages": language_keys,
                           "publication_date": _text(data.get("publish_date"), 100),
                           "publishers": publisher_names[:20],
                           "physical_format": _text(data.get("physical_format"), 100),
                           "cover_image_url": edition_cover})
    return result


def normalize_redirect(data: dict) -> tuple[str, str] | None:
    old, new = work_key(data.get("key")), work_key(data.get("location"))
    return (old, new) if old and new and old != new else None


def normalize_delete(data: dict) -> str | None:
    return work_key(data.get("key"))


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
