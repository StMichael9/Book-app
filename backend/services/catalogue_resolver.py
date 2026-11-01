"""Find the catalogue book for an ISBN or a title and author: our own database first, then the Open Library API.

Only Open Library data (CC0) comes back as a candidate work. Nothing here writes to the database.
"""
from __future__ import annotations

import re
import threading
import time
import unicodedata
from dataclasses import dataclass

import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from data import clean
from database import settings
from models import Author, Book, CatalogueSourceAlias, Edition, EditionISBN, book_authors

OPEN_LIBRARY = "https://openlibrary.org"
TIMEOUT = 4
MAX_PER_SECOND = 3
MAX_CANDIDATES = 5
WORK_KEY = re.compile(r"^/works/OL[1-9][0-9]*W$")


class OpenLibraryUnavailable(Exception):
    """Open Library did not answer (timeout, 429 or 5xx): try the book again later."""


class _TokenBucket:
    def __init__(self, per_second: float):
        self.interval = 1.0 / per_second
        self.next_at = 0.0
        self.lock = threading.Lock()

    def take(self) -> None:
        with self.lock:
            now = time.monotonic()
            wait = max(0.0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if wait:
            time.sleep(wait)


bucket = _TokenBucket(MAX_PER_SECOND)


def ol_get(path: str, params: dict | None = None) -> dict | None:
    """One polite Open Library GET: a Bookvane User-Agent, at most 3 requests a second across the process."""
    bucket.take()
    try:
        response = requests.get(OPEN_LIBRARY + path, params=params, timeout=TIMEOUT,
                                headers={"User-Agent": settings.catalogue_user_agent})
    except requests.RequestException as exc:
        raise OpenLibraryUnavailable(type(exc).__name__) from None
    if response.status_code == 429 or response.status_code >= 500:
        raise OpenLibraryUnavailable(str(response.status_code))
    if response.status_code != 200:
        return None
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


@dataclass
class Resolution:
    book_id: int | None = None
    work: dict | None = None
    ol_description: str | None = None
    confidence: str = "none"  # "isbn" | "title_author" | "none"


def norm_title(value: str) -> str:
    """Title for matching: subtitle, series suffix and punctuation ignored."""
    text = unicodedata.normalize("NFKC", value or "").casefold()
    text = re.split(r"\s*[:(\[]|\s+-\s+|\s+--\s+", text)[0]
    return " ".join(re.findall(r"[^\W_]+", text))


def surname(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").casefold()
    if "," in text:
        text = text.split(",", 1)[0]
    tokens = re.findall(r"[^\W_]+", text)
    return tokens[-1] if tokens else ""


def author_names_match(wanted: str, names: list[str]) -> bool:
    last = surname(wanted)
    return bool(last) and last in {surname(name) for name in names}


# --- our own database ----------------------------------------------------------------------------------------------

def book_for_work_key(db: Session, key: str) -> int | None:
    canonical = db.scalar(select(CatalogueSourceAlias.canonical_source_id).where(CatalogueSourceAlias.old_source_id == key))
    return db.scalar(select(Book.id).where(Book.source_id == (canonical or key)))


def book_for_isbn(db: Session, isbn: str) -> int | None:
    found = db.scalar(select(Book.id).where(Book.isbn13 == isbn).order_by(Book.id).limit(1))
    if found:
        return found
    return db.scalar(select(Edition.book_id).join(EditionISBN, EditionISBN.edition_id == Edition.id)
                     .where(EditionISBN.isbn13 == isbn).order_by(Edition.book_id).limit(1))


def books_for_title(db: Session, title: str, author: str) -> list[int]:
    key = func.lower(func.regexp_replace(func.btrim(Book.title), r"\s+", " ", "g"))
    rows = db.execute(select(Book.id, Author.name).join(book_authors, book_authors.c.book_id == Book.id)
                      .join(Author, Author.id == book_authors.c.author_id)
                      .where(key == " ".join(title.split()).lower())).all()
    return sorted({book_id for book_id, name in rows if surname(name) == surname(author)})


def _from_neon(db: Session, isbn, title, author) -> Resolution | None:
    if isbn and (book_id := book_for_isbn(db, isbn)):
        return Resolution(book_id=book_id, confidence="isbn")
    if title and author:
        found = books_for_title(db, title, author)
        if len(found) == 1:
            return Resolution(book_id=found[0], confidence="title_author")
    return None


# --- Open Library -------------------------------------------------------------------------------------------------

def _work_description(work_json: dict | None) -> str | None:
    return clean.description(work_json.get("description")) if work_json else None


def _author_names(work_json: dict) -> tuple[list[str], list[str]]:
    names, keys = [], []
    for item in work_json.get("authors") or []:
        key = clean.author_key(item)
        if not key:
            continue
        data = ol_get(f"{key}.json")
        name = clean._text(data.get("name"), 225) if data else None
        if name:
            names.append(name)
            keys.append(key)
    return names, keys


def _by_isbn(db: Session, isbn: str, title, author) -> Resolution:
    edition = ol_get(f"/isbn/{isbn}.json")
    works = (edition or {}).get("works") or []
    key = clean.work_key(works[0].get("key")) if works and isinstance(works[0], dict) else None
    if not key:
        return Resolution()
    if book_id := book_for_work_key(db, key):
        return Resolution(book_id=book_id, confidence="isbn")
    work_json = ol_get(f"{key}.json")
    if not work_json:
        return Resolution()
    names, author_keys = _author_names(work_json)
    isbns = [valid for value in (edition.get("isbn_13") or []) if (valid := clean.isbn13(value))]
    isbns += [valid for value in (edition.get("isbn_10") or []) if (valid := clean.isbn10_to_13(value))]
    covers = work_json.get("covers") or edition.get("covers") or []
    work = {"source_id": key, "title": clean._text(work_json.get("title")), "authors": names, "author_keys": author_keys,
            "description": _work_description(work_json),
            "cover_image_url": next((url for item in covers if (url := clean.cover_url(item))), None),
            "published_year": clean.year(work_json.get("first_publish_date")) or clean.year(edition.get("publish_date")),
            "page_count": clean.page_count(edition.get("number_of_pages")),
            "isbns": list(dict.fromkeys([isbn, *isbns])), "edition_key": clean._text(edition.get("key"))}
    if not work["description"] and work["title"] and names:
        work["description"] = _description_from_siblings(work["title"], names[0], skip=key)
    return Resolution(work=work, ol_description=work["description"], confidence="isbn")


def _search_docs(title: str, author: str) -> list[dict]:
    data = ol_get("/search.json", {"title": title, "author": author, "limit": 10,
                                   "fields": "key,title,author_name,author_key,first_publish_year,cover_i,"
                                             "number_of_pages_median,isbn"})
    wanted = norm_title(title)
    return [doc for doc in (data or {}).get("docs", [])
            if isinstance(doc, dict) and clean.work_key(doc.get("key")) and norm_title(doc.get("title") or "") == wanted
            and author_names_match(author, doc.get("author_name") or [])][:MAX_CANDIDATES]


def _description_from_siblings(title: str, author: str, skip: str | None = None) -> str | None:
    """Open Library often keeps the description on only one of several works for the same book."""
    for doc in _search_docs(title, author):
        if doc["key"] == skip:
            continue
        if text := _work_description(ol_get(f"{doc['key']}.json")):
            return text
    return None


def _by_search(db: Session, title: str, author: str) -> Resolution:
    docs = _search_docs(title, author)
    if not docs:
        return Resolution()
    for doc in docs:
        if book_id := book_for_work_key(db, doc["key"]):
            return Resolution(book_id=book_id, confidence="title_author")
    best = docs[0]
    description = None
    for doc in docs:  # every candidate work is checked: take the first description found
        description = _work_description(ol_get(f"{doc['key']}.json"))
        if description:
            break
    isbns = [valid for value in (best.get("isbn") or [])[:40] if (valid := clean.isbn13(value))][:5]
    work = {"source_id": best["key"], "title": clean._text(best.get("title")),
            "authors": [name for name in best.get("author_name") or [] if isinstance(name, str)],
            "author_keys": [key for key in best.get("author_key") or [] if isinstance(key, str)],
            "description": description, "cover_image_url": clean.cover_url(best.get("cover_i")),
            "published_year": clean.year(best.get("first_publish_year")),
            "page_count": clean.page_count(best.get("number_of_pages_median")), "isbns": isbns, "edition_key": None}
    return Resolution(work=work, ol_description=description, confidence="title_author")


def resolve(db: Session, isbn: str | None = None, title: str | None = None, author: str | None = None) -> Resolution:
    """Neon first, then Open Library. An ISBN match is sure; title + author needs the same title and author surname."""
    isbn = clean.isbn13(isbn) if isbn else None
    if found := _from_neon(db, isbn, title, author):
        return found
    if isbn:
        return _by_isbn(db, isbn, title, author)
    if title and author:
        return _by_search(db, title, author)
    return Resolution()
