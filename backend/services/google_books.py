"""Google Books, used live and never stored.

Two uses only: (a) turn a title and author into an ISBN when Open Library finds nothing (the ISBN then goes back into
the Open Library lookup), and (b) supply a description when Open Library has none. Descriptions are shown unaltered
(HTML turned into plain text, never shortened) with a link to the volume's Google Books page. Results live in a small
in-memory cache only; nothing from Google is ever written to the database.
"""
from __future__ import annotations

import html
import re
import threading
import time
from collections import OrderedDict
from urllib.parse import urlsplit

import requests

from data import clean
from database import settings
from services.catalogue_resolver import _TokenBucket, author_names_match, norm_title

API = "https://www.googleapis.com/books/v1/volumes"
TIMEOUT = 3
MAX_PER_SECOND = 5
MAX_TTL = 24 * 60 * 60
DEFAULT_TTL = 60 * 60
MAX_ENTRIES = 500

bucket = _TokenBucket(MAX_PER_SECOND)
_lock = threading.Lock()
_cache: OrderedDict = OrderedDict()


def enabled() -> bool:
    """The kill switch: off unless GOOGLE_BOOKS_ENABLED is set and a key is configured."""
    key = settings.google_books_api_key
    return bool(settings.google_books_enabled and key is not None and key.get_secret_value().strip())


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def html_to_text(value: str) -> str:
    """Plain text from a Google description: <br> and </p> become newlines, other tags go, entities are decoded.
    Every word is kept and nothing is truncated."""
    text = re.sub(r"(?i)<\s*br\s*/?\s*>|<\s*/\s*p\s*>", "\n", value)
    text = html.unescape(re.sub(r"<[^>]*>", "", text))
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def _ttl(response) -> int:
    match = re.search(r"max-age=(\d+)", response.headers.get("Cache-Control", "") or "")
    return min(int(match.group(1)), MAX_TTL) if match else min(DEFAULT_TTL, MAX_TTL)


def _get(params: dict) -> dict | None:
    key = tuple(sorted(params.items()))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            _cache.move_to_end(key)
            return hit[1]
    bucket.take()
    try:
        response = requests.get(API, params={**params, "key": settings.google_books_api_key.get_secret_value()},
                                timeout=TIMEOUT)
        if response.status_code != 200:
            return None
        data = response.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    with _lock:
        _cache[key] = (time.monotonic() + _ttl(response), data)
        _cache.move_to_end(key)
        while len(_cache) > MAX_ENTRIES:
            _cache.popitem(last=False)
    return data


def _query(isbn: str | None, title: str | None, author: str | None) -> str | None:
    if isbn:
        return f"isbn:{isbn}"
    if title and author:
        return f'intitle:"{title}" inauthor:"{author}"'
    return None


def _items(isbn, title, author, fields: str) -> list[dict]:
    query = _query(isbn, title, author)
    if not query or not enabled():
        return []
    data = _get({"q": query, "maxResults": 5, "printType": "books", "fields": f"items(volumeInfo({fields}))"})
    items = [item.get("volumeInfo") for item in (data or {}).get("items") or [] if isinstance(item, dict)]
    items = [item for item in items if isinstance(item, dict)]
    if isbn:
        return items
    return [item for item in items if norm_title(item.get("title") or "") == norm_title(title or "")
            and author_names_match(author or "", [a for a in item.get("authors") or [] if isinstance(a, str)])]


def isbn_for(title: str, author: str) -> str | None:
    """Tier 4 of the resolver: an ISBN only, which goes back into the Open Library lookup. Nothing else is used."""
    for item in _items(None, title, author, "title,authors,industryIdentifiers"):
        for identifier in item.get("industryIdentifiers") or []:
            if isinstance(identifier, dict) and identifier.get("type") == "ISBN_13":
                if isbn := clean.isbn13(identifier.get("identifier")):
                    return isbn
    return None


def _google_link(value) -> str | None:
    parts = urlsplit(value) if isinstance(value, str) else None
    if parts and parts.scheme == "https" and parts.hostname and re.search(r"(^|\.)google\.[a-z.]+$", parts.hostname):
        return value
    return None


def description_for(isbn: str | None, title: str | None, author: str | None) -> dict | None:
    """{text, link} for the first volume with a description, or None. Needs the volume's Google Books link to show it."""
    for item in _items(isbn, title, author, "title,authors,description,infoLink"):
        text = html_to_text(item["description"]) if isinstance(item.get("description"), str) else ""
        link = _google_link(item.get("infoLink"))
        if text and link:
            return {"text": text, "link": link}
    return None
