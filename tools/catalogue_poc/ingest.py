"""Bounded dump batches, source pinning, transactional checkpoints and guards.

Large jobs are runner-only. Local tests pass bounded iterators directly. The
first-N source prefix is an operational capacity sample, not a balanced or
popular-title production catalogue; coverage is measured separately.
"""
from __future__ import annotations

import hashlib
import json
import time

from . import normalize as n
from .storage import CatalogueError, bulk

PHASES = ('works', 'authors', 'editions', 'redirects', 'deletes', 'index', 'complete')


class Paused(CatalogueError):
    pass


class Bloom:
    """Fixed 16 MiB prefilter; every positive is confirmed against the database."""
    def __init__(self):
        self.bits = bytearray(16 * 1024 * 1024)

    def _positions(self, key):
        value = hashlib.sha256(key.encode()).digest()
        a, b = int.from_bytes(value[:8], 'big'), int.from_bytes(value[8:16], 'big') | 1
        for index in range(7):
            yield (a + index*b) % (len(self.bits)*8)

    def add(self, key):
        for value in self._positions(key):
            self.bits[value//8] |= 1 << (value % 8)

    def __contains__(self, key):
        return all(self.bits[value//8] & (1 << (value % 8)) for value in self._positions(key))


def keys_filter(store, table):
    if table not in ('works', 'authors'):
        raise ValueError('Unsupported source-identity filter')
    bloom, cursor = Bloom(), ''
    while True:
        rows = store.run(f'SELECT source_id FROM {table} WHERE source_id>? ORDER BY source_id LIMIT 1000', (cursor,))
        if not rows:
            return bloom
        for row in rows:
            bloom.add(row['source_id'])
        cursor = rows[-1]['source_id']


def selected(store, table, keys):
    keys = sorted(set(keys))
    if table not in ('works', 'authors', 'editions'):
        raise ValueError('Unsupported catalogue table')
    found = {}
    for offset in range(0, len(keys), 100):
        chunk = keys[offset:offset+100]
        for row in store.run(f'SELECT * FROM {table} WHERE source_id IN (' + ','.join('?' for _ in chunk) + ')', chunk):
            found[row['source_id']] = row
    return found


def start(store, run_id, manifest, target):
    if target < 1:
        raise ValueError('target must be positive')
    pinned = json.dumps(manifest, sort_keys=True, separators=(',', ':'))
    rows = store.run('SELECT * FROM import_runs WHERE id=?', (run_id,))
    if rows:
        row = rows[0]
        if row['manifest'] != pinned or row['target'] != target:
            raise ValueError('Resume requires the exact saved snapshot, manifest and target')
    else:
        unfinished = store.run("SELECT id FROM import_runs WHERE phase<>'complete' LIMIT 1")
        if unfinished:
            raise ValueError('Resume the unfinished catalogue run before starting another')
        count = store.run('SELECT count(*) AS n FROM works')[0]['n']
        if count > target:
            raise ValueError('Existing catalogue exceeds requested total target; nothing is deleted')
        store.transaction([('INSERT INTO import_runs(id,manifest,target,phase,counters) VALUES(?,?,?,?,?)',
            (run_id, pinned, target, 'works', json.dumps({'works': count, 'invalid': 0})))])
        row = store.run('SELECT * FROM import_runs WHERE id=?', (run_id,))[0]
    return row


def checkpoint(store, run, statements, line, counters, phase=None, verified=None):
    # An independent writer cannot advance a stale checkpoint and partially commit.
    guard = ('INSERT INTO checkpoint_guard(id,valid) VALUES(1,CASE WHEN EXISTS('
        'SELECT 1 FROM import_runs WHERE id=? AND phase=? AND checkpoint=?) THEN 1 ELSE 0 END) '
        'ON CONFLICT(id) DO UPDATE SET valid=excluded.valid', (run['id'], run['phase'], run['checkpoint']))
    next_phase = phase or run['phase']
    proofs = json.dumps(verified if verified is not None else json.loads(run['verified_phases']))
    store.transaction([guard, *statements, (
        'UPDATE import_runs SET phase=?,checkpoint=?,counters=?,verified_phases=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
        (next_phase, line, json.dumps(counters, sort_keys=True), proofs, run['id']))])
    run.update(phase=next_phase, checkpoint=line, counters=json.dumps(counters), verified_phases=proofs)


def work_statements(store, records, snapshot, available):
    values = {row['source_id']: row for record in records if (row := n.work(record))}
    existing = selected(store, 'works', values)
    accepted = []
    new = 0
    for source_id, row in values.items():
        if source_id not in existing:
            if new >= available:
                continue
            new += 1
        accepted.append(row)
    cols = ('source_id','title','title_key','subtitle','description','published_year','cover_id',
            'snapshot','source_revision','source_modified','fingerprint')
    rows = [tuple(snapshot if col == 'snapshot' else row[col] for col in cols) for row in accepted]
    updates = ','.join(col + '=excluded.' + col for col in cols if col != 'source_id')
    statements = bulk('INSERT INTO works', cols, rows,
        'ON CONFLICT(source_id) DO UPDATE SET ' + updates + ',deleted=0 WHERE works.fingerprint<>excluded.fingerprint OR works.deleted=1')
    author_ids = sorted({key for row in accepted for key in row['author_ids']})
    statements += bulk('INSERT INTO authors', ('source_id','snapshot'), [(key,snapshot) for key in author_ids],
                       'ON CONFLICT(source_id) DO NOTHING')
    # This isolated catalogue contains only source-managed relationships. Replace
    # a changed work's links atomically, rather than accumulating stale authors.
    changed = [row['source_id'] for row in accepted if row['source_id'] not in existing
               or row['fingerprint'] != existing[row['source_id']]['fingerprint']]
    if changed:
        statements.append(('DELETE FROM work_authors WHERE work_id IN '
            '(SELECT id FROM works WHERE source_id IN (SELECT value FROM json_each(?)))', (json.dumps(changed),)))
    pairs = [(row['source_id'], key) for row in accepted for key in row['author_ids']]
    if pairs:
        statements.append(('INSERT INTO work_authors(work_id,author_id) '
            "SELECT w.id,json_extract(j.value,'$[1]') FROM json_each(?) j "
            "JOIN works w ON w.source_id=json_extract(j.value,'$[0]') WHERE true ON CONFLICT DO NOTHING",
            (json.dumps(pairs),)))
    return statements, new


def phase_statements(store, phase, records, snapshot, available):
    if phase == 'works':
        return work_statements(store, records, snapshot, available)
    if phase == 'authors':
        rows = {value['source_id']: value for record in records if (value := n.author(record))}
        existing = selected(store, 'authors', rows)
        cols = ('source_id','name','name_key','snapshot','source_revision','fingerprint')
        values = [tuple(snapshot if col == 'snapshot' else row[col] for col in cols)
                  for key, row in rows.items() if key in existing]
        return bulk('INSERT INTO authors', cols, values,
            'ON CONFLICT(source_id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,'
            'snapshot=excluded.snapshot,source_revision=excluded.source_revision,fingerprint=excluded.fingerprint '
            'WHERE authors.fingerprint IS NOT excluded.fingerprint'), 0
    if phase == 'editions':
        normalized = [edition for record in records for edition in n.editions(record)]
        found = selected(store, 'works', [row['source_id'] for row in normalized])
        normalized = [row for row in normalized if row['source_id'] in found]
        unique = {row['edition_key']: row for row in normalized}
        existing = selected(store, 'editions', unique)
        changed = {key:row for key,row in unique.items() if key not in existing
                   or existing[key]['fingerprint'] != row['fingerprint']}
        normalized = [row for row in normalized if row['edition_key'] in changed]
        cols = ('source_id','title','page_count','cover_id','languages','publication_date','publishers',
                'physical_format','snapshot','source_revision','fingerprint')
        values = []
        for key, row in changed.items():
            values.append(tuple(key if col == 'source_id' else snapshot if col == 'snapshot'
                else json.dumps(row[col], ensure_ascii=False) if col in ('languages','publishers') else row[col]
                for col in cols))
        updates = ','.join(col+'=excluded.'+col for col in cols if col != 'source_id')
        statements = bulk('INSERT INTO editions', cols, values,
            'ON CONFLICT(source_id) DO UPDATE SET '+updates+' WHERE editions.fingerprint<>excluded.fingerprint')
        if changed:
            keys = (json.dumps(list(changed)),)
            statements.extend((f'DELETE FROM {table} WHERE edition_id IN (SELECT value FROM json_each(?))', keys)
                              for table in ('edition_works','edition_isbns'))
        pairs = sorted({(row['edition_key'], found[row['source_id']]['id']) for row in normalized})
        statements += bulk('INSERT INTO edition_works', ('edition_id','work_id'), pairs, 'ON CONFLICT DO NOTHING')
        identifiers = {(key, value['isbn13'], int(value['derived_from_isbn10']))
                       for key, row in changed.items() for value in row['isbns']}
        statements += bulk('INSERT INTO edition_isbns', ('edition_id','isbn13','derived_from_isbn10'),
                           sorted(identifiers), 'ON CONFLICT DO NOTHING')
        return statements, 0
    if phase == 'redirects':
        links = [value for record in records if (value := n.normalize_redirect(record))]
        found = selected(store, 'works', [key for pair in links for key in pair])
        values = [(old, new, snapshot) for old, new in links if old in found or new in found]
        return bulk('INSERT INTO source_aliases', ('source_id','canonical_source_id','snapshot'), values,
            'ON CONFLICT(source_id) DO UPDATE SET canonical_source_id=excluded.canonical_source_id,snapshot=excluded.snapshot'), 0
    if phase == 'deletes':
        keys = [key for record in records if (key := n.normalize_delete(record))]
        statements = []
        for offset in range(0, len(keys), 100):
            chunk = keys[offset:offset+100]
            statements.append(('UPDATE works SET deleted=1 WHERE source_id IN (' + ','.join('?' for _ in chunk) + ') AND deleted=0', chunk))
        return statements, 0
    raise ValueError('Unknown source phase')


def likely(phase, record, bloom):
    if phase == 'works' or bloom is None:
        return True
    if phase == 'authors':
        key = n.author_key(record.get('key'))
        return key is not None and key in bloom
    if phase == 'editions':
        values = record.get('works')
        return isinstance(values, list) and any(isinstance(item, dict) and isinstance(item.get('key'), str)
                                               and item['key'] in bloom for item in values)
    if phase == 'redirects':
        pair = n.normalize_redirect(record)
        return pair and any(key in bloom for key in pair)
    key = n.normalize_delete(record)
    return key is not None and key in bloom


def consume(store, run, rows, *, batch_size=50, max_bytes=4_000_000_000,
            max_rows_written=7_500_000, deadline=None, eof_verified=False):
    """Accepts a bounded iterator; tests cannot accidentally initiate a download."""
    phase, counters = run['phase'], json.loads(run['counters'])
    bloom = keys_filter(store, 'authors' if phase == 'authors' else 'works') if phase != 'works' else None
    pending, line, invalid = [], run['checkpoint'], 0
    snapshot = json.loads(run['manifest'])['date']

    def flush():
        nonlocal pending, invalid
        if store.size() >= max_bytes or store.rows_written >= max_rows_written:
            raise Paused('Storage/write safety threshold reached; checkpoint retained')
        statements, added = phase_statements(store, phase, pending, snapshot, max(0,run['target']-counters['works']))
        next_counts = {**counters, 'works': counters['works']+added, 'invalid': counters.get('invalid',0)+invalid}
        checkpoint(store, run, statements, line, next_counts)
        counters.update(next_counts)
        pending, invalid = [], 0

    for row in rows:
        if deadline and time.monotonic() >= deadline:
            if line > run['checkpoint']:
                flush()
            raise Paused('Time budget reached; resume the same pinned run')
        line = row.line_number
        if row.record is None:
            invalid += 1
        elif likely(phase, row.record, bloom):
            pending.append(row.record)
        if len(pending) >= batch_size or line-run['checkpoint'] >= 50_000:
            flush()
    if line > run['checkpoint'] or pending:
        flush()
    proofs = json.loads(run['verified_phases'])
    if eof_verified:
        proofs = sorted(set(proofs+[phase]))
        next_phase = PHASES[PHASES.index(phase)+1]
        checkpoint(store, run, [], 0, counters, next_phase, proofs)
    return run


def build_index(store, run, *, max_bytes=4_000_000_000, max_rows_written=7_500_000, deadline=None):
    if run['phase'] != 'index':
        raise ValueError('Source phases must finish before indexing')
    if set(json.loads(run['verified_phases'])) != set(PHASES[:5]):
        raise ValueError('All five full dump checksums must be verified before indexing')
    # Check before clearing the previous index or changing any checkpoint.
    if deadline and time.monotonic() >= deadline:
        raise Paused('Index time budget reached; checkpoint unchanged')
    if store.size() >= max_bytes or store.rows_written >= max_rows_written:
        raise Paused('Index storage/write safety threshold reached; checkpoint unchanged')
    if run['checkpoint'] == 0:
        checkpoint(store, run, [("INSERT INTO works_search(works_search) VALUES('delete-all')", ())],
                   -1, json.loads(run['counters']))
    cursor = max(0, run['checkpoint'])
    while True:
        if deadline and time.monotonic() >= deadline:
            raise Paused('Index time budget reached; resume the saved checkpoint')
        if store.size() >= max_bytes or store.rows_written >= max_rows_written:
            raise Paused('Index storage/write safety threshold reached')
        found = store.run('SELECT id FROM works WHERE id>? ORDER BY id LIMIT 100', (cursor,))
        if not found:
            checkpoint(store, run, [], 0, json.loads(run['counters']), 'complete')
            return
        end = found[-1]['id']
        statements = [(
            'UPDATE works SET authors_key=COALESCE((SELECT group_concat(name_key,\' \') FROM '
            '(SELECT a.name_key FROM work_authors wa JOIN authors a ON a.source_id=wa.author_id '
            'WHERE wa.work_id=works.id AND a.name IS NOT NULL ORDER BY a.source_id)),\'\') WHERE id>? AND id<=?', (cursor,end)),
            ('INSERT INTO works_search(rowid,title_key,authors_key) SELECT id,title_key,authors_key FROM works '
             'WHERE id>? AND id<=? AND deleted=0', (cursor,end))]
        checkpoint(store, run, statements, end, json.loads(run['counters']))
        cursor = end
