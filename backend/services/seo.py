"""Book sitemaps and bot-readable book pages.

Only stored Open Library data goes in here (never Google text, which is live-only), only public catalogue books
(`is_listed`), and nothing is read from or about a reader. Everything is cached in memory so a crawler cannot turn into
database traffic; a request for a book that is already cached makes no database round trip.
"""
from __future__ import annotations

import html
import json
import re
import threading
import time
from collections import OrderedDict
from datetime import timezone
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import settings
from models import Author, Book, book_authors

SITEMAP_CHUNK = 45_000
SITEMAP_TTL = 60 * 60
INDEX_TTL = 10 * 60
INDEX_RETRY = 60
BOOK_TTL = 10 * 60
BOOK_CACHE_SIZE = 5_000
META_DESCRIPTION_CHARS = 155
SITE = "https://bookvane.me"
OPEN_LIBRARY_COVER = re.compile(r"^https://(covers\.openlibrary\.org/b/[a-z0-9]+/[^/?#]+)-[SML](\.jpg)(?:\?[^#]*)?$", re.I)

_lock = threading.Lock()
_sitemaps: dict = {}
_books: OrderedDict = OrderedDict()
_authors: OrderedDict = OrderedDict()
_index = {"html": None, "fetched": 0.0, "retry_at": 0.0}


def site_url() -> str:
    return (settings.frontend_base_url or SITE).rstrip("/")


def api_url() -> str:
    return settings.public_api_base_url.rstrip("/")


def clear_caches() -> None:
    with _lock:
        _sitemaps.clear()
        _books.clear()
        _authors.clear()
        _shares.clear()
        _index.update(html=None, fetched=0.0, retry_at=0.0)


# --- sitemaps -----------------------------------------------------------------------------------------------------

def _cached_sitemap(key, build):
    now = time.monotonic()
    with _lock:
        hit = _sitemaps.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = build()
    with _lock:
        _sitemaps[key] = (now + SITEMAP_TTL, value)
    return value


def sitemap_count(db: Session) -> int:
    total = _cached_sitemap(("count",), lambda: db.scalar(select(func.count()).select_from(Book).where(Book.is_listed.is_(True))) or 0)
    return -(-total // SITEMAP_CHUNK)


def _with_listed_books():
    return (select(book_authors.c.author_id).join(Book, Book.id == book_authors.c.book_id)
            .where(book_authors.c.author_id == Author.id, Book.is_listed.is_(True)).correlate(Author).exists())


def author_sitemap_count(db: Session) -> int:
    """Chunks of authors that have at least one listed book."""
    total = _cached_sitemap(("author-count",), lambda: db.scalar(select(func.count()).select_from(Author).where(_with_listed_books())) or 0)
    return -(-total // SITEMAP_CHUNK)


def sitemap_index_xml(db: Session) -> str:
    def build():
        entries = ([f"{api_url()}/sitemaps/books-{n}.xml" for n in range(1, sitemap_count(db) + 1)]
                   + [f"{api_url()}/sitemaps/authors-{n}.xml" for n in range(1, author_sitemap_count(db) + 1)]
                   + [f"{site_url()}/sitemap.xml"])
        body = "".join(f"<sitemap><loc>{xml_escape(url)}</loc></sitemap>" for url in entries)
        return ('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"{body}</sitemapindex>")
    return _cached_sitemap(("index",), build)


def sitemap_chunk_xml(db: Session, n: int) -> str | None:
    """The n-th chunk (1-based) of listed books, or None when there is no such chunk."""
    if n < 1 or n > max(sitemap_count(db), 0):
        return None

    def build():
        rows = db.execute(select(Book.id, Book.added_at).where(Book.is_listed.is_(True)).order_by(Book.id)
                          .offset((n - 1) * SITEMAP_CHUNK).limit(SITEMAP_CHUNK)).all()
        parts = []
        for book_id, added_at in rows:
            lastmod = f"<lastmod>{added_at.astimezone(timezone.utc).date().isoformat()}</lastmod>" if added_at else ""
            parts.append(f"<url><loc>{site_url()}/book/{book_id}</loc>{lastmod}</url>")
        return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f'{"".join(parts)}</urlset>')
    return _cached_sitemap(("chunk", n), build)


def author_sitemap_chunk_xml(db: Session, n: int) -> str | None:
    """The n-th chunk (1-based) of author pages, or None when there is no such chunk."""
    if n < 1 or n > max(author_sitemap_count(db), 0):
        return None

    def build():
        ids = db.scalars(select(Author.id).where(_with_listed_books()).order_by(Author.id)
                         .offset((n - 1) * SITEMAP_CHUNK).limit(SITEMAP_CHUNK)).all()
        parts = "".join(f"<url><loc>{site_url()}/author/{author_id}</loc></url>" for author_id in ids)
        return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"{parts}</urlset>")
    return _cached_sitemap(("author-chunk", n), build)


# --- book pages ---------------------------------------------------------------------------------------------------

def deployed_index() -> str | None:
    """The deployed index.html (asset hashes change with every deploy), kept 10 minutes. If a refresh fails the last good
    copy keeps being served; with none at all the caller answers 503."""
    now = time.monotonic()
    with _lock:
        if _index["html"] is not None and now - _index["fetched"] < INDEX_TTL:
            return _index["html"]
        if now < _index["retry_at"]:
            return _index["html"]
        _index["retry_at"] = now + INDEX_RETRY  # one fetch at a time; a failure is retried after a minute
    page = None
    if settings.frontend_base_url:
        try:
            response = requests.get(site_url() + "/", timeout=3, headers={"User-Agent": settings.catalogue_user_agent})
            if response.status_code == 200 and 'id="root"' in response.text and "<head" in response.text:
                page = response.text
        except requests.RequestException:
            page = None
    with _lock:
        if page is not None:
            _index.update(html=page, fetched=time.monotonic(), retry_at=0.0)
        return _index["html"]


def book_facts(db: Session, book_id: int) -> dict | None:
    """Everything a book page needs, from one query, cached (LRU of 5,000). None for unknown or unlisted books."""
    now = time.monotonic()
    with _lock:
        hit = _books.get(book_id)
        if hit and hit[0] > now:
            _books.move_to_end(book_id)
            return hit[1]
    row = db.execute(select(Book.id, Book.title, Book.description, Book.published_year, Book.page_count, Book.isbn13,
                            Book.cover_image_url, Book.is_listed).where(Book.id == book_id)).first()
    facts = None
    if row is not None and row.is_listed:
        names = db.scalars(select(Author.name).join(book_authors, book_authors.c.author_id == Author.id)
                           .where(book_authors.c.book_id == book_id).order_by(Author.id)).all()
        facts = {"id": row.id, "title": row.title.strip(), "description": (row.description or "").strip(),
                 "year": row.published_year, "pages": row.page_count, "isbn13": row.isbn13,
                 "cover": row.cover_image_url, "authors": [name.strip() for name in names if name and name.strip()]}
    with _lock:
        _books[book_id] = (now + BOOK_TTL, facts)
        _books.move_to_end(book_id)
        while len(_books) > BOOK_CACHE_SIZE:
            _books.popitem(last=False)
    return facts


def cover_for_sharing(url: str | None) -> str | None:
    """The same image address the app uses for og:image: the cached 600px copy of an Open Library cover."""
    match = OPEN_LIBRARY_COVER.match(url or "")
    if not match:
        return url or None
    return f"https://wsrv.nl/?url={quote(match.group(1) + '-L' + match.group(2), safe='')}&w=600&we&output=webp&q=80"


def _names(authors: list[str]) -> str:
    return ", ".join(authors)


def meta_description(facts: dict) -> str:
    text = " ".join(facts["description"].split())
    if not text:
        by = f" by {_names(facts['authors'])}" if facts["authors"] else ""
        year = f", {facts['year']}" if facts["year"] else ""
        return f"{facts['title']}{by}{year}. Save it, track it and find what to read next on Bookvane."
    if len(text) <= META_DESCRIPTION_CHARS:
        return text
    cut = text[:META_DESCRIPTION_CHARS]
    return cut[:cut.rfind(" ")].rstrip(" ,;:.") + "…" if " " in cut else cut + "…"


def page_title(facts: dict) -> str:
    return f"{facts['title']} by {_names(facts['authors'])} · Bookvane" if facts["authors"] else f"{facts['title']} · Bookvane"


def json_ld(facts: dict, canonical: str) -> str:
    data = {"@context": "https://schema.org", "@type": "Book", "name": facts["title"],
            "author": [{"@type": "Person", "name": name} for name in facts["authors"]],
            "url": canonical}
    if facts["cover"]:
        data["image"] = cover_for_sharing(facts["cover"])
    if facts["isbn13"]:
        data["isbn"] = facts["isbn13"]
    if facts["pages"]:
        data["numberOfPages"] = facts["pages"]
    if facts["year"]:
        data["datePublished"] = str(facts["year"])
    # No "<", ">" or "&" appears literally inside the script element (they become JSON unicode escapes, the same data), so
    # nothing in a title can close it, open another tag or start a comment.
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def _set_content(page: str, pattern: str, value: str) -> str:
    """Replace the content="…" of one head tag; a tag that is not there is simply left alone."""
    return re.sub(pattern, lambda m: m.group(1) + html.escape(value, quote=True) + m.group(2), page, count=1, flags=re.I)


def static_summary(facts: dict) -> str:
    details = [f"by {html.escape(_names(facts['authors']))}" if facts["authors"] else None,
               f"first published {facts['year']}" if facts["year"] else None,
               f"{facts['pages']} pages" if facts["pages"] else None]
    line = ", ".join(item for item in details if item)
    parts = [f"<h1>{html.escape(facts['title'])}</h1>"]
    if line:
        parts.append(f"<p>{line}</p>")
    if facts["description"]:
        parts.append(f"<p>{html.escape(' '.join(facts['description'].split()))}</p>")
    parts.append('<p><a href="/browse">Explore more books on Bookvane</a></p>')
    return "\n      " + "\n      ".join(parts) + "\n    "


def render_book_page(index_html: str, facts: dict) -> str:
    """The deployed index.html with this book's head tags, JSON-LD and plain-HTML summary filled in. The app's root element
    and script tags are untouched, so the page still loads the app for a reader."""
    canonical = f"{site_url()}/book/{facts['id']}"
    title, description = page_title(facts), meta_description(facts)
    page = re.sub(r"<title>.*?</title>", lambda m: f"<title>{html.escape(title)}</title>", index_html, count=1, flags=re.S | re.I)
    page = _set_content(page, r'(<meta\s+name="description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:title"\s+content=")[^"]*("\s*/?>)', title)
    page = _set_content(page, r'(<meta\s+property="og:description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:type"\s+content=")[^"]*("\s*/?>)', "book")
    image = cover_for_sharing(facts["cover"])
    if image:
        page = _set_content(page, r'(<meta\s+property="og:image"\s+content=")[^"]*("\s*/?>)', image)
    head_extra = (f'    <link rel="canonical" href="{html.escape(canonical, quote=True)}" />\n'
                  f'    <script type="application/ld+json" id="bv-book-ld">{json_ld(facts, canonical)}</script>\n')
    page = re.sub(r"</head>", lambda m: head_extra + "  </head>", page, count=1, flags=re.I)
    return re.sub(r'(<main\s+id="static-landing">).*?(</main>)', lambda m: m.group(1) + static_summary(facts) + m.group(2),
                  page, count=1, flags=re.S | re.I)


# --- author pages -------------------------------------------------------------------------------------------------

AUTHOR_BOOKS_LISTED = 24


def author_page_facts(db: Session, author_id: int) -> dict | None:
    """What an author page needs, from two statements, cached (LRU of 5,000). None for an unknown author or one with no
    listed books (such an author is not in the sitemap and has nothing to show a crawler)."""
    now = time.monotonic()
    with _lock:
        hit = _authors.get(author_id)
        if hit and hit[0] > now:
            _authors.move_to_end(author_id)
            return hit[1]
    from services import authors as author_service
    facts = None
    base = author_service.author_facts(db, author_id)
    if base is not None and base["book_count"] > 0:
        books = db.execute(select(Book.id, Book.title).join(book_authors, book_authors.c.book_id == Book.id)
                           .where(book_authors.c.author_id == author_id, Book.is_listed.is_(True))
                           .order_by(Book.popularity.desc().nulls_last(), Book.id).limit(AUTHOR_BOOKS_LISTED)).all()
        facts = {"id": base["id"], "name": base["name"], "bio": (base["bio"] or "").strip(), "photo_url": base["photo_url"],
                 "same_as": author_service.open_library_url(base["source_id"]), "book_count": base["book_count"],
                 "books": [{"id": row.id, "title": row.title.strip()} for row in books]}
    with _lock:
        _authors[author_id] = (now + BOOK_TTL, facts)
        _authors.move_to_end(author_id)
        while len(_authors) > BOOK_CACHE_SIZE:
            _authors.popitem(last=False)
    return facts


def author_title(facts: dict) -> str:
    return f"{facts['name']} · Books and bio · Bookvane" if facts["bio"] else f"{facts['name']} · Books · Bookvane"


def author_description(facts: dict) -> str:
    text = " ".join(facts["bio"].split())
    if not text:
        count = facts["book_count"]
        return f"{facts['name']}: {count} book{'s' if count != 1 else ''} on Bookvane. Save them, track them and find what to read next."
    if len(text) <= META_DESCRIPTION_CHARS:
        return text
    cut = text[:META_DESCRIPTION_CHARS]
    return cut[:cut.rfind(" ")].rstrip(" ,;:.") + "…" if " " in cut else cut + "…"


def author_json_ld(facts: dict, canonical: str) -> str:
    data = {"@context": "https://schema.org", "@type": "Person", "name": facts["name"], "url": canonical}
    if facts["bio"]:
        data["description"] = facts["bio"]
    if facts["photo_url"]:
        data["image"] = facts["photo_url"]
    if facts["same_as"]:
        data["sameAs"] = [facts["same_as"]]
    # Same escaping as the book page: nothing in a name or bio can close the script element.
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def author_static_summary(facts: dict) -> str:
    parts = [f"<h1>{html.escape(facts['name'])}</h1>"]
    if facts["bio"]:
        parts.append(f"<p>{html.escape(' '.join(facts['bio'].split()))}</p>")
    items = "".join(f'<li><a href="/book/{book["id"]}">{html.escape(book["title"])}</a></li>' for book in facts["books"])
    parts.append(f"<ul>{items}</ul>")
    parts.append('<p><a href="/browse">Explore more books on Bookvane</a></p>')
    return "\n      " + "\n      ".join(parts) + "\n    "


def render_author_page(index_html: str, facts: dict) -> str:
    """The deployed index.html with this author's head tags, JSON-LD (Person) and a plain-HTML list of their books."""
    canonical = f"{site_url()}/author/{facts['id']}"
    title, description = author_title(facts), author_description(facts)
    page = re.sub(r"<title>.*?</title>", lambda m: f"<title>{html.escape(title)}</title>", index_html, count=1, flags=re.S | re.I)
    page = _set_content(page, r'(<meta\s+name="description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:title"\s+content=")[^"]*("\s*/?>)', title)
    page = _set_content(page, r'(<meta\s+property="og:description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:type"\s+content=")[^"]*("\s*/?>)', "profile")
    if facts["photo_url"]:
        page = _set_content(page, r'(<meta\s+property="og:image"\s+content=")[^"]*("\s*/?>)', facts["photo_url"])
    head_extra = (f'    <link rel="canonical" href="{html.escape(canonical, quote=True)}" />\n'
                  f'    <script type="application/ld+json" id="bv-author-ld">{author_json_ld(facts, canonical)}</script>\n')
    page = re.sub(r"</head>", lambda m: head_extra + "  </head>", page, count=1, flags=re.I)
    return re.sub(r'(<main\s+id="static-landing">).*?(</main>)', lambda m: m.group(1) + author_static_summary(facts) + m.group(2),
                  page, count=1, flags=re.S | re.I)


# --- shared profile and list pages (T73 G3) -----------------------------------------------------------------------

SHARE_TTL = 10 * 60
_shares: dict = {}


def _drop_canonical(page: str) -> str:
    return re.sub(r'<link\s+rel="canonical"[^>]*>\s*', "", page, flags=re.I)


def _first_titles(titles: list[str]) -> str:
    return ", ".join(titles[:3])


def _shelf_description(count: int, titles: list[str]) -> str:
    if not count:
        return "A shelf on Bookvane, where readers keep their books together."
    books = f"{count} book{'s' if count != 1 else ''}"
    return f"{books}, including {_first_titles(titles)}." if titles else f"{books}."


def share_facts(db: Session, handle: str, list_id: int | None = None) -> dict | None:
    """What a shared profile (or list) page may show, only from data the owner already made public: the name, the list title, a
    count of books, the first three titles and the first cover. Never notes, reactions, dates or private books. None (a 404)
    for a profile or list that is private, hidden or unknown. Cached 10 minutes."""
    from fastapi import HTTPException
    from services import profile as profile_service
    key = (handle.lower(), list_id)
    now = time.monotonic()
    with _lock:
        hit = _shares.get(key)
        if hit and hit[0] > now:
            return hit[1]
    facts = None
    try:
        if list_id is None:
            page = profile_service.public_profile(db, handle)
            name = page["display_name"] or handle
            lists = page["lists"]
            titles, cover = [], None
            if lists:
                first = profile_service.public_list(db, handle, lists[0]["id"])
                titles = [book["title"] for book in first["books"]]
                cover = next((book["cover_image_url"] for book in first["books"] if book["cover_image_url"]), None)
            facts = {"kind": "profile", "handle": handle.lower(), "title": f"{name}'s shelf on Bookvane",
                     "description": _shelf_description(sum(item["book_count"] for item in lists), titles),
                     "cover": cover, "path": f"/u/{handle.lower()}"}
        else:
            page = profile_service.public_list(db, handle, list_id)
            titles = [book["title"] for book in page["books"]]
            cover = next((book["cover_image_url"] for book in page["books"] if book["cover_image_url"]), None)
            facts = {"kind": "list", "handle": handle.lower(), "title": f"{page['name']} · a reading list on Bookvane",
                     "description": _shelf_description(len(titles), titles), "cover": cover,
                     "path": f"/u/{handle.lower()}/lists/{list_id}"}
    except HTTPException:
        facts = None
    with _lock:
        _shares[key] = (now + SHARE_TTL, facts)
        if len(_shares) > BOOK_CACHE_SIZE:
            _shares.pop(next(iter(_shares)))
    return facts


def render_share_page(index_html: str, facts: dict) -> str:
    """The deployed index.html with a public profile's or list's head tags: title, description, og:image (the first book's cached
    cover) and twitter:card summary_large_image. The page body is left to the app."""
    canonical = f"{site_url()}{facts['path']}"
    title, description = facts["title"], facts["description"]
    page = _drop_canonical(index_html)
    page = re.sub(r"<title>.*?</title>", lambda m: f"<title>{html.escape(title)}</title>", page, count=1, flags=re.S | re.I)
    page = _set_content(page, r'(<meta\s+name="description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:title"\s+content=")[^"]*("\s*/?>)', title)
    page = _set_content(page, r'(<meta\s+property="og:description"\s+content=")[^"]*("\s*/?>)', description)
    page = _set_content(page, r'(<meta\s+property="og:type"\s+content=")[^"]*("\s*/?>)', "profile" if facts["kind"] == "profile" else "website")
    image = cover_for_sharing(facts["cover"])
    if image:
        page = _set_content(page, r'(<meta\s+property="og:image"\s+content=")[^"]*("\s*/?>)', image)
        page = _set_content(page, r'(<meta\s+name="twitter:card"\s+content=")[^"]*("\s*/?>)', "summary_large_image")
    head_extra = f'    <link rel="canonical" href="{html.escape(canonical, quote=True)}" />\n'
    return re.sub(r"</head>", lambda m: head_extra + "  </head>", page, count=1, flags=re.I)


def render_home_page(index_html: str) -> str:
    """The deployed index.html with a canonical tag for the home page (served to crawlers at /seo/home)."""
    head_extra = f'    <link rel="canonical" href="{html.escape(site_url() + "/", quote=True)}" />\n'
    return re.sub(r"</head>", lambda m: head_extra + "  </head>", _drop_canonical(index_html), count=1, flags=re.I)
