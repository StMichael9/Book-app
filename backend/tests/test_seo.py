"""T39: book sitemaps and bot-readable book pages. Only stored Open Library text, only public (listed) catalogue books."""
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import event, select

INDEX = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")
MARK = "GOOGLE-ONLY-TEXT-77aa"


class Site:
    """A fake deployed site: serves index.html and counts how often it was fetched."""

    def __init__(self):
        self.calls, self.text, self.status, self.fail = 0, INDEX, 200, False

    def __call__(self, url, timeout=None, headers=None, **kwargs):
        import requests
        self.calls += 1
        if self.fail:
            raise requests.ConnectionError("down")
        outer = self

        class Response:
            status_code = outer.status
            text = outer.text

        return Response()


@pytest.fixture()
def seo(client, db_session, app_modules, seeded_books, monkeypatch):
    from services import seo as module
    settings = app_modules["database"].settings
    monkeypatch.setattr(settings, "frontend_base_url", "https://bookvane.me")
    site = Site()
    monkeypatch.setattr(module.requests, "get", site)
    module.clear_caches()
    models = app_modules["models"]
    created = []

    class Env:
        pass

    env = Env()
    env.client, env.db, env.models, env.module, env.site, env.books = client, db_session, models, module, site, seeded_books

    def make_book(title="Seo Book", authors=("Ann Seo",), description="A stored Open Library description.", year=1999, pages=321,
                  listed=True, isbn="9780306406157", cover="https://covers.openlibrary.org/b/id/123-L.jpg", added=None):
        book = models.Book(title=title, description=description, published_year=year if listed or year else None,
                           page_count=pages if listed else None, isbn13=isbn, cover_image_url=cover, added_at=added,
                           source_id=f"/works/OLS{uuid.uuid4().hex[:6]}W")
        book.authors = [models.Author(name=name) for name in authors]
        db_session.add(book)
        db_session.commit()
        created.append(book.id)
        return book

    env.make_book = make_book
    yield env
    module.clear_caches()
    db_session.rollback()
    for book_id in created:
        book = db_session.get(models.Book, book_id)
        if book is not None:
            db_session.delete(book)
    db_session.commit()


def listed_ids(env):
    return sorted(book.id for book in env.db.scalars(select(env.models.Book)) if book.is_listed)


# --- sitemaps ----------------------------------------------------------------------------------------------------

def test_the_sitemap_lists_exactly_the_listed_books(seo):
    listed = seo.make_book(added=datetime(2026, 3, 4, tzinfo=timezone.utc))
    unlisted = seo.make_book(title="No pages", listed=False)
    assert not unlisted.is_listed
    r = seo.client.get("/sitemaps/books-1.xml")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    assert r.headers["cache-control"] == "public, max-age=86400"
    urls = re.findall(r"<loc>(.*?)</loc>", r.text)
    assert urls == [f"https://bookvane.me/book/{i}" for i in listed_ids(seo)]
    assert f"https://bookvane.me/book/{unlisted.id}" not in urls and f"https://bookvane.me/book/{listed.id}" in urls
    assert f"<loc>https://bookvane.me/book/{listed.id}</loc><lastmod>2026-03-04</lastmod>" in r.text
    assert f"<url><loc>https://bookvane.me/book/{seo.books['Dracula'].id}</loc></url>" in r.text   # no added_at, so no lastmod


def test_the_sitemap_splits_into_chunks_and_the_index_lists_them(seo, monkeypatch):
    for n in range(4):
        seo.make_book(title=f"Chunk {n}")
    ids = listed_ids(seo)
    monkeypatch.setattr(seo.module, "SITEMAP_CHUNK", 2)
    seo.module.clear_caches()
    chunks = -(-len(ids) // 2)
    index = seo.client.get("/sitemaps/index.xml")
    assert index.status_code == 200 and index.headers["cache-control"] == "public, max-age=86400"
    locs = re.findall(r"<loc>(.*?)</loc>", index.text)
    assert locs == [f"https://api.bookvane.me/sitemaps/books-{n}.xml" for n in range(1, chunks + 1)] + ["https://bookvane.me/sitemap.xml"]
    seen = []
    for n in range(1, chunks + 1):
        urls = re.findall(r"/book/(\d+)</loc>", seo.client.get(f"/sitemaps/books-{n}.xml").text)
        assert 1 <= len(urls) <= 2
        seen += [int(u) for u in urls]
    assert seen == ids                                   # every listed book once, in order
    assert seo.client.get(f"/sitemaps/books-{chunks + 1}.xml").status_code == 404
    assert seo.client.get("/sitemaps/books-0.xml").status_code == 404


def test_a_crawler_cannot_turn_the_sitemap_into_database_traffic(seo, app_modules):
    seo.client.get("/sitemaps/books-1.xml")
    seo.client.get("/sitemaps/index.xml")
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        for _ in range(5):
            seo.client.get("/sitemaps/books-1.xml")
            seo.client.get("/sitemaps/index.xml")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert statements == []


# --- book pages --------------------------------------------------------------------------------------------------

def head_value(page, pattern):
    return re.search(pattern, page, re.S).group(1)


def test_a_book_page_has_its_own_head_tags_json_ld_and_a_plain_html_summary(seo):
    book = seo.make_book(title="The Stored Book", authors=("Ann Seo", "Bo Seo"))
    r = seo.client.get(f"/seo/book/{book.id}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    page = r.text
    assert head_value(page, r"<title>(.*?)</title>") == "The Stored Book by Ann Seo, Bo Seo · Bookvane"
    assert head_value(page, r'<meta name="description" content="([^"]*)"') == "A stored Open Library description."
    assert head_value(page, r'<meta property="og:title" content="([^"]*)"') == "The Stored Book by Ann Seo, Bo Seo · Bookvane"
    assert head_value(page, r'<meta property="og:description" content="([^"]*)"') == "A stored Open Library description."
    assert head_value(page, r'<meta property="og:type" content="([^"]*)"') == "book"
    assert head_value(page, r'<meta property="og:image" content="([^"]*)"').startswith("https://wsrv.nl/?url=covers.openlibrary.org")
    assert "w=600" in head_value(page, r'<meta property="og:image" content="([^"]*)"')
    assert head_value(page, r'<link rel="canonical" href="([^"]*)"') == f"https://bookvane.me/book/{book.id}"
    ld = json.loads(head_value(page, r'<script type="application/ld\+json" id="bv-book-ld">(.*?)</script>'))
    assert ld == {"@context": "https://schema.org", "@type": "Book", "name": "The Stored Book",
                  "author": [{"@type": "Person", "name": "Ann Seo"}, {"@type": "Person", "name": "Bo Seo"}],
                  "url": f"https://bookvane.me/book/{book.id}", "image": ld["image"], "isbn": "9780306406157",
                  "numberOfPages": 321, "datePublished": "1999"}
    summary = head_value(page, r'<main id="static-landing">(.*?)</main>')
    assert "<h1>The Stored Book</h1>" in summary and "by Ann Seo, Bo Seo, first published 1999, 321 pages" in summary
    assert "A stored Open Library description." in summary and '<a href="/browse">' in summary
    assert "Your personal reading home" not in head_value(page, r"<title>(.*?)</title>")


def test_the_injected_page_still_loads_the_app(seo):
    book = seo.make_book()
    page = seo.client.get(f"/seo/book/{book.id}").text
    for needle in ('<div id="root"></div>', '<script type="module" src="/src/main.jsx"></script>', "bookvane-theme",
                   '<style>.js #static-landing { display: none; }</style>', '<link rel="icon"', '<meta name="viewport"'):
        assert needle in INDEX and needle in page, needle
    assert page.count("<title>") == 1 and page.count('id="static-landing"') == 1 and page.count('id="bv-book-ld"') == 1
    assert page.index('id="root"') < page.index('id="static-landing"') < page.index('src="/src/main.jsx"')


def test_a_long_description_is_cut_for_the_meta_tag_and_a_missing_one_gets_the_fallback(seo):
    long = seo.make_book(description=("word " * 100).strip())
    meta = head_value(seo.client.get(f"/seo/book/{long.id}").text, r'<meta name="description" content="([^"]*)"')
    assert 100 < len(meta) <= 156 and meta.endswith("…") and "  " not in meta
    bare = seo.make_book(title="Bare", description=None, year=2001)
    page = seo.client.get(f"/seo/book/{bare.id}").text
    assert head_value(page, r'<meta name="description" content="([^"]*)"') == (
        "Bare by Ann Seo, 2001. Save it, track it and find what to read next on Bookvane.")
    assert "<p>" in head_value(page, r'<main id="static-landing">(.*?)</main>')


def test_titles_and_text_are_escaped(seo):
    book = seo.make_book(title='Evil </title><script>alert(1)</script> "x"', authors=("A & B <i>",),
                         description="</script><script>alert(2)</script>")
    page = seo.client.get(f"/seo/book/{book.id}").text
    assert "<script>alert" not in page and "alert(1)</script>" not in page
    assert "&lt;script&gt;alert(1)" in page
    ld = json.loads(head_value(page, r'<script type="application/ld\+json" id="bv-book-ld">(.*?)</script>'))
    assert ld["name"] == 'Evil </title><script>alert(1)</script> "x"'    # the data is intact; only the markup is made safe


def test_unknown_and_unlisted_books_get_the_untouched_page_with_a_404(seo):
    unlisted = seo.make_book(title="No pages", listed=False)
    for book_id in (unlisted.id, 999999999):
        r = seo.client.get(f"/seo/book/{book_id}")
        assert r.status_code == 404 and r.text == INDEX
        assert "bv-book-ld" not in r.text and "No pages" not in r.text


def test_private_entries_have_no_book_page(seo):
    user = seo.models.User(email=f"seo-{uuid.uuid4().hex[:8]}@example.test", hashed_password="x")
    seo.db.add(user)
    seo.db.flush()
    entry = seo.models.UserBook(user_id=user.id, private_title="Secret private title", private_author="Secret Person", is_wanted=True)
    seo.db.add(entry)
    seo.db.commit()
    try:
        for path in (f"/seo/book/{entry.id}", "/sitemaps/books-1.xml", "/sitemaps/index.xml"):
            assert "Secret" not in seo.client.get(path).text
    finally:
        seo.db.delete(user)
        seo.db.commit()


def test_no_google_text_is_ever_published(seo, app_modules, monkeypatch):
    from services import google_books
    monkeypatch.setattr(google_books.settings, "google_books_enabled", True)
    monkeypatch.setattr(google_books.settings, "google_books_api_key", SecretStr("k"))

    deployed = seo.site

    def forbidden(url, *args, **kwargs):
        if "googleapis" in url:
            raise AssertionError("Google must not be called by the SEO endpoints")
        return deployed(url, *args, **kwargs)   # `requests` is one shared module: only Google is refused

    monkeypatch.setattr(google_books.requests, "get", forbidden)
    book = seo.make_book(description=None)                  # no stored text: Google could have supplied some, and must not
    for path in (f"/seo/book/{book.id}", "/sitemaps/books-1.xml", "/sitemaps/index.xml"):
        r = seo.client.get(path)
        assert r.status_code == 200 and MARK not in r.text
    page = seo.client.get(f"/seo/book/{book.id}").text
    assert "Save it, track it and find what to read next" in page      # the generic fallback, not borrowed text


# --- caching and resilience --------------------------------------------------------------------------------------

def test_a_cached_book_page_makes_no_database_round_trip_and_the_index_is_fetched_once(seo, app_modules):
    book = seo.make_book()
    seo.client.get(f"/seo/book/{book.id}")
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        for _ in range(5):
            assert seo.client.get(f"/seo/book/{book.id}").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert statements == [] and seo.site.calls == 1


def test_a_book_costs_one_query_for_the_page_and_one_for_its_authors_at_most(seo, app_modules):
    book = seo.make_book(authors=("A One", "B Two", "C Three"))
    book_id = book.id
    seo.client.get(f"/seo/book/{seo.make_book().id}")      # warm the index copy
    engine = app_modules["database"].engine
    statements = []
    listener = lambda conn, cur, stmt, *rest: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        seo.client.get(f"/seo/book/{book_id}")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len([s for s in statements if s.lstrip().upper().startswith("SELECT")]) <= 2


def test_the_index_copy_is_refreshed_after_ten_minutes_and_a_failed_refresh_keeps_the_last_good_one(seo, monkeypatch):
    book = seo.make_book()
    assert seo.client.get(f"/seo/book/{book.id}").status_code == 200 and seo.site.calls == 1
    clock = {"t": time.monotonic()}
    monkeypatch.setattr(seo.module.time, "monotonic", lambda: clock["t"])
    seo.module._index["fetched"] = clock["t"]
    clock["t"] += 9 * 60
    seo.client.get(f"/seo/book/{book.id}")
    assert seo.site.calls == 1                                # still fresh
    clock["t"] += 2 * 60
    seo.site.text = INDEX.replace("/src/main.jsx", "/assets/index-NEW.js")
    assert "index-NEW.js" in seo.client.get(f"/seo/book/{book.id}").text and seo.site.calls == 2   # new asset hashes picked up
    clock["t"] += 11 * 60
    seo.site.fail = True
    r = seo.client.get(f"/seo/book/{book.id}")
    assert r.status_code == 200 and "index-NEW.js" in r.text   # the site was unreachable: the last good copy still serves


def test_without_any_copy_of_the_site_the_answer_is_a_503_not_a_broken_page(seo):
    book = seo.make_book()
    seo.site.fail = True
    seo.module.clear_caches()
    r = seo.client.get(f"/seo/book/{book.id}")
    assert r.status_code == 503 and r.headers["cache-control"] == "no-store" and "<html" not in r.text
    seo.site.fail, seo.site.text = False, "<html>not the app</html>"
    seo.module.clear_caches()
    assert seo.client.get(f"/seo/book/{book.id}").status_code == 503        # a page without the app's root is refused


def test_a_warm_book_page_is_fast(seo):
    book = seo.make_book(description="word " * 200)
    seo.client.get(f"/seo/book/{book.id}")
    timings = []
    for _ in range(40):
        start = time.perf_counter()
        assert seo.client.get(f"/seo/book/{book.id}").status_code == 200
        timings.append(time.perf_counter() - start)
    timings.sort()
    p95 = timings[int(len(timings) * 0.95) - 1]
    print(f"T39 warm /seo/book p95 {p95 * 1000:.1f} ms")
    # Target: p95 under 60 ms warm on an idle machine (BOOKVANE_STRICT_TIMING=yes); loose by default so a busy one cannot fail it.
    assert p95 < (0.06 if os.getenv("BOOKVANE_STRICT_TIMING") == "yes" else 0.5), f"p95 {p95 * 1000:.1f} ms"
