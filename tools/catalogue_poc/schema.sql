-- Independent libSQL catalogue. No users, shelves, private files or application IDs.
CREATE TABLE IF NOT EXISTS catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO catalogue_meta VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING;
CREATE TABLE IF NOT EXISTS import_runs (
 id TEXT PRIMARY KEY, manifest TEXT NOT NULL, target INTEGER NOT NULL CHECK(target>0),
 phase TEXT NOT NULL, checkpoint INTEGER NOT NULL DEFAULT 0,
 counters TEXT NOT NULL DEFAULT '{}', verified_phases TEXT NOT NULL DEFAULT '[]',
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS checkpoint_guard (id INTEGER PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE IF NOT EXISTS works (
 id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, title_key TEXT NOT NULL, subtitle TEXT, description TEXT,
 published_year INTEGER, cover_id INTEGER, authors_key TEXT NOT NULL DEFAULT '',
 snapshot TEXT NOT NULL, source_revision INTEGER, source_modified TEXT,
 fingerprint TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
);
CREATE INDEX IF NOT EXISTS works_title ON works(title_key,source_id);
CREATE TABLE IF NOT EXISTS authors (
 source_id TEXT PRIMARY KEY, name TEXT, name_key TEXT, snapshot TEXT NOT NULL,
 source_revision INTEGER, fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS authors_name ON authors(name_key,source_id);
CREATE TABLE IF NOT EXISTS work_authors (
 work_id INTEGER NOT NULL REFERENCES works(id), author_id TEXT NOT NULL REFERENCES authors(source_id),
 PRIMARY KEY(work_id,author_id)
);
CREATE INDEX IF NOT EXISTS work_authors_author ON work_authors(author_id,work_id);
CREATE TABLE IF NOT EXISTS editions (
 source_id TEXT PRIMARY KEY, title TEXT, page_count INTEGER, cover_id INTEGER,
 languages TEXT NOT NULL, publication_date TEXT, publishers TEXT NOT NULL, physical_format TEXT,
 snapshot TEXT NOT NULL, source_revision INTEGER, fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edition_works (
 edition_id TEXT NOT NULL REFERENCES editions(source_id), work_id INTEGER NOT NULL REFERENCES works(id),
 PRIMARY KEY(edition_id,work_id)
);
CREATE INDEX IF NOT EXISTS edition_works_work ON edition_works(work_id,edition_id);
CREATE TABLE IF NOT EXISTS edition_isbns (
 edition_id TEXT NOT NULL REFERENCES editions(source_id), isbn13 TEXT NOT NULL,
 derived_from_isbn10 INTEGER NOT NULL CHECK(derived_from_isbn10 IN(0,1)),
 PRIMARY KEY(edition_id,isbn13)
);
CREATE INDEX IF NOT EXISTS isbn_lookup ON edition_isbns(isbn13,edition_id);
CREATE TABLE IF NOT EXISTS source_aliases (
 source_id TEXT PRIMARY KEY, canonical_source_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 CHECK(source_id<>canonical_source_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS works_search USING fts5(
 title_key, authors_key, content='works', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
