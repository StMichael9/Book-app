"""Explicit, tiny Turso-only capability check. No catalogue import or app data.

Requires the approved database-scoped environment credentials. A deliberate
foreign-key violation must roll back its preceding metadata marker. Never run
automatically as part of unit tests; this makes a few metered cloud requests.
"""
import json
import os
import time

from .storage import CatalogueError, Store


def main():
    store = Store(url=os.environ.get('CATALOGUE_TURSO_URL'),token=os.environ.get('CATALOGUE_TURSO_TOKEN'))
    try:
        started = time.perf_counter()
        version = store.run('SELECT sqlite_version() AS version')[0]['version']
        if store.run('PRAGMA foreign_keys') != [{'foreign_keys':1}]:
            raise CatalogueError('Foreign-key enforcement is not enabled remotely')
        # No synthetic bibliographic records are committed. A failed statement
        # must not permit an earlier successful write to commit.
        marker = 'remote-smoke-rollback'
        try:
            store.transaction([
                ('INSERT INTO catalogue_meta(key,value) VALUES(?,?)',(marker,'temporary')),
                ('INSERT INTO work_authors(work_id,author_id) VALUES(?,?)',(-999,'/authors/OL0A')),
            ])
        except CatalogueError:
            pass
        else:
            raise CatalogueError('Expected foreign-key failure was not raised')
        if store.run('SELECT value FROM catalogue_meta WHERE key=?',(marker,)):
            raise CatalogueError('Rollback marker incorrectly persisted')
        tables = store.run("SELECT name FROM sqlite_master WHERE name IN ('works_search','edition_isbns','import_runs') ORDER BY name")
        if len(tables) != 3 or store.run('PRAGMA foreign_key_check'):
            raise CatalogueError('Schema/index/foreign-key capability check failed')
        counts = {table:store.run(f'SELECT count(*) AS n FROM {table}')[0]['n']
                  for table in ('works','authors','editions','import_runs')}
        print(json.dumps({'status':'passed','sqlite_version':version,'foreign_keys':True,
            'failed_batch_rolled_back':True,'counts':counts,'allocated_bytes':store.size(),
            'session_rows_read':store.rows_read,'session_rows_written':store.rows_written,
            'elapsed_ms':round(1000*(time.perf_counter()-started),1)},sort_keys=True))
    finally:
        store.close()


if __name__ == '__main__':
    main()
