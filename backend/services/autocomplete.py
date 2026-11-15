from sqlalchemy import select, text
from sqlalchemy.orm import Session
from models import Author, Tag


class AutocompleteService:
    def __init__(self, db: Session):
        self.db = db

    def suggest_authors(self, q: str, limit: int = 10):
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = (
            select(Author)
            .where(Author.name.ilike(pattern, escape="\\"))
            .distinct(Author.name)
            .order_by(Author.name, Author.id)
            .limit(limit)
        )
        return self.db.execute(query).scalars().all()

    def suggest_tags(self, q: str, limit: int = 10):
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = (
            select(Tag)
            .where(Tag.name.ilike(pattern, escape="\\"), Tag.visible_in_v2.is_(True))
            .order_by(Tag.name)
            .limit(limit)
        )
        return self.db.execute(query).scalars().all()

    def resolve_tags(self, names: list[str]):
        return self.db.execute(
            select(Tag).where(Tag.name.in_(names), Tag.visible_in_v2.is_(True)).order_by(Tag.name)
        ).scalars().all()


MIN_TITLE_CHARS = 2
MAX_TITLE_SUGGESTIONS = 8
PREFIX_SCAN = 2000             # a one- or two-letter prefix matches thousands of titles: rank within the first 2,000, not all
FUZZY_SCAN = 300               # look at no more than this many trigram candidates per source, then keep the closest
FUZZY_MIN_CHARS = 4            # two or three letters are too short for a trigram match to mean anything
FUZZY_WORD_SIMILARITY = 0.5    # a typo like "hary pot" still reaches "Harry Potter ..."; words that merely look alike do not

# One statement. The query goes through the same bookvane_search_key as every title key. Prefix matches (book titles, then alias
# titles) come first, best-known first (popularity, then the shorter title); each source keeps only its best few (`pool`), so a
# common two-letter prefix never sorts thousands of rows. A fuzzy pass over the trigram index is only run when the prefix matches
# do not fill the list. Books are listed once, with their first author. Sequential scans are switched off for this one statement
# (SET LOCAL ends with the request's transaction): with a LIMIT the planner would otherwise guess that a trigram match is
# common and walk the whole table, which is 1-2 s on 150,000 books when the typo matches almost nothing.
_TITLE_SQL = text("""
SET LOCAL pg_trgm.word_similarity_threshold = 0.5;
SET LOCAL enable_seqscan = off;
WITH k AS (SELECT bookvane_search_key(:q) AS key),
title_prefix_all AS MATERIALIZED (
    SELECT b.id AS book_id, length(b.title_key) AS len, b.popularity AS pop FROM books b, k
    WHERE b.is_listed AND length(k.key) >= :min AND b.title_key LIKE k.key || '%'
    LIMIT :scan
),
title_prefix AS (SELECT book_id, len FROM title_prefix_all ORDER BY coalesce(pop, -1) DESC, len, book_id LIMIT :pool),
alias_prefix_all AS MATERIALIZED (
    SELECT a.book_id, length(a.title_key) AS len FROM book_title_aliases a, k
    WHERE length(k.key) >= :min AND a.title_key LIKE k.key || '%'
    LIMIT :scan
),
alias_prefix AS (
    SELECT a.book_id, a.len FROM alias_prefix_all a JOIN books b ON b.id = a.book_id WHERE b.is_listed
    ORDER BY coalesce(b.popularity, -1) DESC, a.len, a.book_id LIMIT :pool
),
prefix_books AS (
    SELECT book_id, min(len) AS len FROM (SELECT book_id, len FROM title_prefix UNION ALL SELECT book_id, len FROM alias_prefix) u
    GROUP BY book_id
),
title_fuzzy AS (
    SELECT book_id, sim FROM (
        SELECT b.id AS book_id, word_similarity(k.key, b.title_key) AS sim FROM books b, k
        WHERE b.is_listed AND length(k.key) >= :fuzzy_min AND k.key <% b.title_key AND (SELECT count(*) FROM prefix_books) < :limit
        LIMIT :fuzzy_scan) f
    ORDER BY sim DESC LIMIT :pool
),
alias_fuzzy AS (
    SELECT book_id, sim FROM (
        SELECT a.book_id, word_similarity(k.key, a.title_key) AS sim FROM book_title_aliases a, k
        WHERE length(k.key) >= :fuzzy_min AND k.key <% a.title_key AND (SELECT count(*) FROM prefix_books) < :limit
        LIMIT :fuzzy_scan) f
    ORDER BY sim DESC LIMIT :pool
),
fuzzy_books AS (
    SELECT book_id, max(sim) AS sim FROM (SELECT * FROM title_fuzzy UNION ALL SELECT * FROM alias_fuzzy) u
    WHERE sim >= :sim AND book_id NOT IN (SELECT book_id FROM prefix_books) GROUP BY book_id
),
ranked AS (
    SELECT p.book_id, 0 AS tier, p.len, NULL::real AS sim FROM prefix_books p
    UNION ALL
    SELECT f.book_id, 1, NULL, f.sim FROM fuzzy_books f
)
SELECT b.id, b.title, b.cover_image_url, b.published_year,
       (SELECT au.name FROM book_authors ba JOIN authors au ON au.id = ba.author_id WHERE ba.book_id = b.id
        ORDER BY au.id LIMIT 1) AS author
FROM ranked r JOIN books b ON b.id = r.book_id
WHERE b.is_listed
ORDER BY r.tier, CASE WHEN r.tier = 0 THEN b.popularity END DESC NULLS LAST, r.len, r.sim DESC NULLS LAST, b.popularity DESC NULLS LAST, b.id
LIMIT :limit
""")


def suggest_books(db: Session, q: str, limit: int = 6) -> list[dict]:
    """Title type-ahead (T61): listed books whose title (or alias) starts with what was typed, then close misspellings."""
    q = " ".join((q or "").split())
    limit = max(1, min(limit, MAX_TITLE_SUGGESTIONS))
    if len(q) < MIN_TITLE_CHARS:
        return []
    rows = db.execute(_TITLE_SQL, {"q": q, "limit": limit, "pool": limit + 4, "scan": PREFIX_SCAN, "fuzzy_scan": FUZZY_SCAN, "min": MIN_TITLE_CHARS, "fuzzy_min": FUZZY_MIN_CHARS, "sim": FUZZY_WORD_SIMILARITY}).all()
    return [{"id": row.id, "title": row.title, "authors": [row.author] if row.author else [],
             "cover_url": row.cover_image_url, "year": row.published_year} for row in rows]
