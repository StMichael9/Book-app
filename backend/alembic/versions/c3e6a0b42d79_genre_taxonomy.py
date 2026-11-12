"""One genre system: rename or merge the old tags into the 28 genres, re-link books and readers' picks, show all 28.

Old tags that map to a genre are renamed in place when the genre does not exist yet (so ids, book links and readers' favourite
genres survive) or merged into it when it does (links and picks move, then the old tag is removed). Old tags with no genre
(adventure, health, sports, education) stay as plain topics and drop out of the picker. Re-mapping existing books from their
subjects is a separate, fill-only data run (`python -m data.remap_genres`), not part of this schema step.

Downgrade restores the old names for the 1:1 renames and the old pick-list visibility. A merge (for example art + music into
art_music) is not split again; the merged tag keeps one of the old names.

Revision ID: c3e6a0b42d79
Revises: a1c4e8b27d56
"""
import sqlalchemy as sa
from alembic import op

revision = 'c3e6a0b42d79'
down_revision = 'a1c4e8b27d56'
branch_labels = None
depends_on = None

GENRES = ["fantasy", "science_fiction", "mystery_crime", "thriller", "horror", "romance", "historical_fiction", "literary_fiction",
          "classics", "young_adult", "childrens", "humor", "poetry", "drama", "short_stories", "graphic_novels", "biography_memoir",
          "history", "science_nature", "business_money", "self_help", "psychology", "philosophy_religion", "christian_faith",
          "politics_society", "travel", "food_cooking", "art_music"]
OLD = {"fantasy": "fantasy", "mystery": "mystery_crime", "horror": "horror", "romance": "romance",
       "science_fiction": "science_fiction", "thriller": "thriller", "biography": "biography_memoir", "poetry": "poetry",
       "history": "history", "historical_fiction": "historical_fiction", "drama": "drama", "humor": "humor",
       "classics": "classics", "young_adult": "young_adult", "philosophy": "philosophy_religion", "science": "science_nature",
       "technology": "science_nature", "business": "business_money", "art": "art_music", "music": "art_music",
       "cooking": "food_cooking", "travel": "travel", "nature": "science_nature", "psychology": "psychology",
       "religion": "philosophy_religion", "politics": "politics_society"}
NO_GENRE = ["adventure", "health", "sports", "education"]
# For the downgrade: the old name of each 1:1 rename (the first old tag listed for a merged genre).
BACK = {}
for _old, _new in OLD.items():
    BACK.setdefault(_new, _old)
OLD_TYPES = {"fantasy": "genre", "mystery": "genre", "horror": "genre", "romance": "genre", "science_fiction": "genre",
             "thriller": "genre", "biography": "genre", "adventure": "genre", "humor": "genre", "classics": "genre",
             "poetry": "form", "drama": "form", "young_adult": "audience", "historical_fiction": "genre"}


def _tag(conn, name):
    return conn.execute(sa.text("SELECT id, type::text FROM tags WHERE name = :n ORDER BY (type::text = 'genre') DESC LIMIT 1"),
                        {"n": name}).first()


def _merge(conn, old_id, new_id):
    conn.execute(sa.text("INSERT INTO book_tags (book_id, tag_id, source_managed) "
                         "SELECT book_id, :new, source_managed FROM book_tags WHERE tag_id = :old ON CONFLICT DO NOTHING"),
                 {"old": old_id, "new": new_id})
    conn.execute(sa.text("INSERT INTO user_preferences (user_id, tag_id, source_text, created_at) "
                         "SELECT user_id, :new, source_text, created_at FROM user_preferences WHERE tag_id = :old "
                         "ON CONFLICT (user_id, tag_id) DO NOTHING"), {"old": old_id, "new": new_id})
    conn.execute(sa.text("DELETE FROM tags WHERE id = :old"), {"old": old_id})     # cascades the old links and picks


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    for old, new in OLD.items():
        found = _tag(conn, old)
        if found is None:
            continue
        target = conn.execute(sa.text("SELECT id FROM tags WHERE name = :n AND type::text = 'genre'"), {"n": new}).first()
        if old == new and found[1] == "genre":
            continue
        if target is None:
            conn.execute(sa.text("UPDATE tags SET name = :n, type = 'genre' WHERE id = :i"), {"n": new, "i": found[0]})
        elif target[0] != found[0]:
            _merge(conn, found[0], target[0])
    for name in GENRES:
        conn.execute(sa.text("INSERT INTO tags (name, type, visible_in_v2) VALUES (:n, 'genre', true) "
                             "ON CONFLICT (name, type) DO NOTHING"), {"n": name})
    conn.execute(sa.text("UPDATE tags SET visible_in_v2 = true WHERE type::text = 'genre' AND name = ANY(:g)"), {"g": GENRES})
    conn.execute(sa.text("UPDATE tags SET visible_in_v2 = false WHERE name = ANY(:g) AND NOT (type::text = 'genre' AND name = ANY(:k))"),
                 {"g": NO_GENRE, "k": GENRES})
    conn.execute(sa.text("UPDATE tags SET visible_in_v2 = false WHERE type::text IN ('mood', 'theme')"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    for new, old in BACK.items():
        found = conn.execute(sa.text("SELECT id FROM tags WHERE name = :n AND type::text = 'genre'"), {"n": new}).first()
        taken = conn.execute(sa.text("SELECT 1 FROM tags WHERE name = :o AND type::text = :t"),
                             {"o": old, "t": OLD_TYPES.get(old, "topic")}).first()
        if found and not taken and old != new:
            conn.execute(sa.text("UPDATE tags SET name = :o, type = CAST(:t AS tagtype) WHERE id = :i"),
                         {"o": old, "t": OLD_TYPES.get(old, "topic"), "i": found[0]})
    conn.execute(sa.text("UPDATE tags SET visible_in_v2 = true WHERE name = ANY(:n)"),
                 {"n": [name for name in OLD if OLD[name] and name not in ("technology", "nature", "music", "education")]})
