"""Search key: one normalised form of a title for matching ("Nineteen Eighty-Four" and "1984" share a key).

`bookvane_search_key(text)` lower-cases, removes accents, folds "&" to "and", drops punctuation and hyphens, turns number words
into digits ("nineteen eighty-four" -> 1984, "twenty-two" -> 22, "two thousand and one" -> 2001) and ignores a leading the/a/an.
It is IMMUTABLE so it can fill generated, indexed columns on books and book_title_aliases; queries call the same function, so
the stored titles and the reader's words are always normalised by the same code.

Revision ID: b2d5f9a31c68
Revises: d2b7c4e9f1a3
"""
from alembic import op

revision = 'b2d5f9a31c68'
down_revision = 'd2b7c4e9f1a3'
branch_labels = None
depends_on = None

NUMWORD = """
CREATE OR REPLACE FUNCTION bookvane_numword(t text) RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE t
    WHEN 'zero' THEN 0 WHEN 'one' THEN 1 WHEN 'two' THEN 2 WHEN 'three' THEN 3 WHEN 'four' THEN 4 WHEN 'five' THEN 5
    WHEN 'six' THEN 6 WHEN 'seven' THEN 7 WHEN 'eight' THEN 8 WHEN 'nine' THEN 9 WHEN 'ten' THEN 10 WHEN 'eleven' THEN 11
    WHEN 'twelve' THEN 12 WHEN 'thirteen' THEN 13 WHEN 'fourteen' THEN 14 WHEN 'fifteen' THEN 15 WHEN 'sixteen' THEN 16
    WHEN 'seventeen' THEN 17 WHEN 'eighteen' THEN 18 WHEN 'nineteen' THEN 19 WHEN 'twenty' THEN 20 WHEN 'thirty' THEN 30
    WHEN 'forty' THEN 40 WHEN 'fifty' THEN 50 WHEN 'sixty' THEN 60 WHEN 'seventy' THEN 70 WHEN 'eighty' THEN 80
    WHEN 'ninety' THEN 90 ELSE NULL END
$$;
"""

SEARCH_KEY = r"""
CREATE OR REPLACE FUNCTION bookvane_search_key(input text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text; toks text[]; out_t text[] := ARRAY[]::text[];
  n int; i int; j int; v int; w int; total int; cur int; has_big boolean; chunks int[]; c int;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  s := translate(lower(input), 'àáâãäåçèéêëìíîïñòóôõöøùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝ', 'aaaaaaceeeeiiiinoooooouuuuyyaaaaaaceeeeiiiinoooooouuuuy');
  s := replace(replace(replace(replace(s, 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'), '&', ' and ');
  s := regexp_replace(s, '[''’‘`´]', '', 'g');
  s := regexp_replace(s, '[[:space:]"“”()\[\]{}/|*+=<>@#$%^~_.,;:!?-]+', ' ', 'g');
  s := btrim(s);
  IF s = '' THEN RETURN ''; END IF;
  toks := string_to_array(s, ' ');
  n := array_length(toks, 1);
  i := 1;
  WHILE i <= n LOOP
    v := bookvane_numword(toks[i]);
    IF v IS NULL AND toks[i] NOT IN ('hundred', 'thousand') THEN
      out_t := out_t || toks[i];
      i := i + 1;
      CONTINUE;
    END IF;
    j := i; has_big := false; total := 0; cur := 0; chunks := ARRAY[]::int[];
    WHILE j <= n LOOP
      w := bookvane_numword(toks[j]);
      IF w IS NOT NULL THEN
        IF w >= 20 AND j < n AND bookvane_numword(toks[j + 1]) BETWEEN 1 AND 9 THEN
          w := w + bookvane_numword(toks[j + 1]);
          j := j + 1;
        END IF;
        cur := cur + w;
        chunks := chunks || w;
      ELSIF toks[j] = 'hundred' THEN
        has_big := true; cur := GREATEST(cur, 1) * 100;
      ELSIF toks[j] = 'thousand' THEN
        has_big := true; total := total + GREATEST(cur, 1) * 1000; cur := 0;
      ELSIF toks[j] = 'and' AND has_big AND j < n AND bookvane_numword(toks[j + 1]) IS NOT NULL THEN
        NULL;
      ELSE
        EXIT;
      END IF;
      j := j + 1;
    END LOOP;
    IF has_big THEN
      out_t := out_t || (total + cur)::text;
    ELSIF coalesce(array_length(chunks, 1), 0) = 2 AND chunks[1] >= 10 AND chunks[2] >= 10 THEN
      out_t := out_t || (chunks[1] * 100 + chunks[2])::text;
    ELSE
      FOREACH c IN ARRAY chunks LOOP
        out_t := out_t || c::text;
      END LOOP;
    END IF;
    i := j;
  END LOOP;
  IF coalesce(array_length(out_t, 1), 0) > 1 AND out_t[1] IN ('the', 'a', 'an') THEN
    out_t := out_t[2:array_length(out_t, 1)];
  END IF;
  RETURN array_to_string(out_t, ' ');
END $$;
"""


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(NUMWORD)
    op.execute(SEARCH_KEY)
    for table, column in (("books", "title"), ("book_title_aliases", "title")):
        op.execute(f"ALTER TABLE {table} ADD COLUMN title_key text GENERATED ALWAYS AS (bookvane_search_key({column})) STORED")
        op.execute(f"CREATE INDEX ix_{table}_title_key ON {table} (title_key text_pattern_ops)")
        op.execute(f"CREATE INDEX ix_{table}_title_key_trgm ON {table} USING gin (title_key gin_trgm_ops)")


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    for table in ("book_title_aliases", "books"):
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_title_key_trgm")
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_title_key")
        op.execute(f"ALTER TABLE {table} DROP COLUMN title_key")
    op.execute("DROP FUNCTION bookvane_search_key(text)")
    op.execute("DROP FUNCTION bookvane_numword(text)")
