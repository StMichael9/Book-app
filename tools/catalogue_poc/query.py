"""Bounded read-only catalogue lookup and measurements; never creates a match."""
import re
from .normalize import isbn13, isbn10_to_13, search_key, work_key


def search(store, query, limit=10):
    if not 1 <= limit <= 25 or not isinstance(query, str) or len(query) > 500:
        raise ValueError('Bounded query and limit required')
    tokens = re.findall(r'[^\W_]+', search_key(query), flags=re.UNICODE)[:12]
    if not tokens:
        return []
    expression = ' AND '.join('"'+token+'"*' for token in tokens)
    return store.run('SELECT w.source_id,w.title,w.cover_id,w.published_year,w.authors_key '
        'FROM works_search JOIN works w ON w.id=works_search.rowid '
        'WHERE works_search MATCH ? AND w.deleted=0 ORDER BY rank LIMIT ?', (expression,limit))


def by_isbn(store, identifier):
    value = isbn13(identifier) or isbn10_to_13(identifier)
    if not value:
        raise ValueError('A checksum-valid ISBN is required')
    return store.run('SELECT DISTINCT w.source_id,w.title,e.source_id AS edition_id,e.page_count,e.languages '
        'FROM edition_isbns i JOIN editions e ON e.source_id=i.edition_id '
        'JOIN edition_works ew ON ew.edition_id=e.source_id JOIN works w ON w.id=ew.work_id '
        'WHERE i.isbn13=? AND w.deleted=0 AND e.active=1 ORDER BY w.source_id,e.source_id LIMIT 26', (value,))


def by_work(store, identifier):
    if not work_key(identifier):
        raise ValueError('Canonical Open Library work key required')
    seen, current = set(), identifier
    for _ in range(8):
        if current in seen:
            raise ValueError('Redirect cycle requires review')
        seen.add(current)
        aliases = store.run('SELECT canonical_source_id FROM source_aliases WHERE source_id=?', (current,))
        if not aliases:
            return store.run('SELECT * FROM works WHERE source_id=? AND deleted=0', (current,))
        current = aliases[0]['canonical_source_id']
    raise ValueError('Redirect chain exceeds bounded lookup; review required')
