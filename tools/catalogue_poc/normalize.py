"""Reuse Bookvane's import-safe OL validators, not its PostgreSQL importer."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import unicodedata

BACKEND = str(Path(__file__).resolve().parents[2] / 'backend')
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)
from data.clean import (  # noqa: E402
    _text, author_key, cover_url, description, isbn13, isbn10_to_13,
    normalize_author, normalize_edition, normalize_redirect, normalize_delete,
    work_key, year,
)
from data.sources import resolve_snapshot, stream_dump  # noqa: E402


def search_key(value):
    return ' '.join(unicodedata.normalize('NFKC', value or '').casefold().split())


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def cover_id(value):
    values = value if isinstance(value, list) else []
    return next((item for item in values if cover_url(item)), None)


def work(data):
    """External reference coverage is not gated by the public catalogue's genres.

    All text, key, year, description, cover and ISBN validation stays shared.
    Missing authors remain explicit unresolved identities, never invented names.
    """
    source, title = work_key(data.get('key')), _text(data.get('title'))
    if not source or not title:
        return None
    author_values = data.get('authors')
    author_values = author_values if isinstance(author_values, list) else []
    result = dict(source_id=source, title=title, title_key=search_key(title),
        subtitle=_text(data.get('subtitle')), description=description(data.get('description')),
        published_year=year(data.get('first_publish_year')) or year(data.get('first_publish_date')),
        cover_id=cover_id(data.get('covers')),
        author_ids=list(dict.fromkeys(key for item in author_values if (key := author_key(item)))),
        source_revision=data.get('revision') if type(data.get('revision')) is int else None,
        source_modified=_text((data.get('last_modified') or {}).get('value'))
            if isinstance(data.get('last_modified'), dict) else None)
    result['fingerprint'] = fingerprint(result)
    return result


def author(data):
    result = normalize_author(data)
    if result:
        result['name_key'] = search_key(result['name'])
        result['source_revision'] = data.get('revision') if type(data.get('revision')) is int else None
        result['fingerprint'] = fingerprint(result)
    return result


def editions(data):
    result = normalize_edition(data)
    work_ids = sorted({row['source_id'] for row in result})
    for row in result:
        row.update(title=_text(data.get('title')), cover_id=cover_id(data.get('covers')),
            source_revision=data.get('revision') if type(data.get('revision')) is int else None)
        # A multi-work edition has one identity and one metadata fingerprint.
        row['fingerprint'] = fingerprint({**{key: value for key, value in row.items() if key != 'source_id'},
                                         'associated_work_ids': work_ids})
    return result
