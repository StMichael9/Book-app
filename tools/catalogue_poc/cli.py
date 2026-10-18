"""Standalone experiment CLI. No app imports, dotenv loading or default DB URL."""
import argparse
import json
import os
import re
import statistics
import sys
import time

from . import normalize as n
from .ingest import Paused, build_index, consume, start
from .query import by_isbn, by_work, search
from .storage import CatalogueError, Store


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('init','status','ingest','search','isbn','work','benchmark'))
    parser.add_argument('--run-id')
    parser.add_argument('--snapshot', default='auto')
    parser.add_argument('--target-works', type=int)
    parser.add_argument('--query', default='')
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--time-budget-seconds', type=int, default=1200)
    parser.add_argument('--max-storage-bytes', type=int, default=4_000_000_000)
    parser.add_argument('--max-session-rows-written', type=int, default=100_000)
    args = parser.parse_args(argv)
    if not 1 <= args.batch_size <= 100 or not 10 <= args.time_budget_seconds <= 18_000:
        parser.error('Bounded batch/time limits required')
    if not 1_000_000 <= args.max_storage_bytes <= 4_000_000_000:
        parser.error('Storage guard must stay below the verified Free allowance')
    if not 1 <= args.max_session_rows_written <= 7_500_000:
        parser.error('Session write guard must retain Free-tier headroom')
    store = Store(url=os.environ.get('CATALOGUE_TURSO_URL'), token=os.environ.get('CATALOGUE_TURSO_TOKEN'))
    try:
        if args.command == 'init':
            store.initialize()
            result = {'schema': 1, 'bytes': store.size()}
        elif args.command == 'status':
            result = {'runs': store.run('SELECT id,target,phase,checkpoint,counters,verified_phases FROM import_runs'),
                      'allocated_bytes': store.size()}
        elif args.command == 'ingest':
            # No large import from a personal workstation, even accidentally.
            if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('CATALOGUE_POC_REMOTE_JOB_APPROVED') != 'yes':
                raise ValueError('Dump ingestion requires the approved isolated GitHub Actions job')
            if not args.run_id or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.run_id):
                raise ValueError('A safe explicit run ID is required')
            user_agent = os.environ.get('OPEN_LIBRARY_USER_AGENT', '')
            if not user_agent or '@' not in user_agent:
                raise ValueError('Set an identified Open Library User-Agent with an approved contact')
            rows = store.run('SELECT * FROM import_runs WHERE id=?', (args.run_id,))
            if rows:
                manifest = json.loads(rows[0]['manifest'])
                if args.snapshot != 'auto' and args.snapshot != manifest['date']:
                    raise ValueError('Resume cannot switch the pinned snapshot')
                target = args.target_works or rows[0]['target']
            else:
                if not args.target_works:
                    raise ValueError('Specify target works for a new run')
                manifest = n.resolve_snapshot(args.snapshot, user_agent=user_agent).manifest()
                target = args.target_works
            run = start(store, args.run_id, manifest, target)
            deadline = time.monotonic() + args.time_budget_seconds
            def heartbeat():
                if time.monotonic() >= deadline:
                    raise Paused('Runner deadline reached while replaying the pinned gzip prefix')
            while run['phase'] != 'complete':
                if run['phase'] == 'index':
                    build_index(store, run, max_bytes=args.max_storage_bytes,
                                max_rows_written=args.max_session_rows_written, deadline=deadline)
                    continue
                file = manifest['files'][run['phase']]
                stream = n.stream_dump(file['url'], start_line=run['checkpoint'], user_agent=user_agent,
                    expected_size=file['size'], expected_md5=file['md5'], progress_callback=heartbeat)
                try:
                    consume(store, run, stream, batch_size=args.batch_size, max_bytes=args.max_storage_bytes,
                            max_rows_written=args.max_session_rows_written, deadline=deadline, eof_verified=True)
                finally:
                    stream.close()
                print(json.dumps({'phase': run['phase'], 'checkpoint': run['checkpoint'],
                    'counters': json.loads(run['counters']), 'bytes': store.size()}), flush=True)
            result = {'run': run['id'], 'phase': run['phase'], 'counters': json.loads(run['counters']),
                      'verified_phases': json.loads(run['verified_phases']), 'bytes': store.size()}
        else:
            if not store.run("SELECT id FROM import_runs WHERE phase='complete' LIMIT 1"):
                raise ValueError('No fully verified/indexed catalogue run exists; lookup is not yet ready')
            if store.run("SELECT id FROM import_runs WHERE phase<>'complete' LIMIT 1"):
                raise ValueError('Catalogue refresh is incomplete; do not expose mixed-generation results')
            if args.command == 'search':
                result = search(store, args.query)
            elif args.command == 'isbn':
                result = by_isbn(store, args.query)
            elif args.command == 'work':
                result = by_work(store, args.query)
            else:
                if not args.query:
                    raise ValueError('Supply a representative benchmark query')
                latencies = []
                for _ in range(12):
                    before = time.perf_counter()
                    result = search(store, args.query)
                    latencies.append(1000*(time.perf_counter()-before))
                result = {'query': args.query, 'results': len(result), 'requests': len(latencies),
                    'first_ms': latencies[0], 'median_ms': statistics.median(latencies),
                    'max_ms': max(latencies), 'bytes': store.size(),
                    'session_rows_read': store.rows_read, 'session_rows_written': store.rows_written}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except Paused as exc:
        print(json.dumps({'status': 'paused', 'reason': str(exc)}))
        return 75
    except (CatalogueError, ValueError):
        print(json.dumps({'status': 'failed', 'reason': 'Catalogue operation refused or failed; credentials/raw records withheld'}))
        return 1
    finally:
        store.close()


if __name__ == '__main__':
    sys.exit(main())
