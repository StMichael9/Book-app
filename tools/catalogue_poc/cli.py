"""Standalone experiment CLI. No app imports, dotenv loading or default DB URL."""
import argparse
import json
import os
import re
import statistics
import sys
import time
import requests
from urllib3.exceptions import HTTPError as StreamNetworkError

from . import normalize as n
from .dumps import stream_dump
from .ingest import Paused, build_index, consume, start
from .query import by_isbn, by_work, search
from .quota import Account, Guard, QuotaPaused
from .storage import CatalogueError, Store


def main(argv=None, *, store=None, guard=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('init','status','ingest','search','isbn','work','benchmark'))
    parser.add_argument('--run-id')
    parser.add_argument('--snapshot', default='auto')
    parser.add_argument('--target-works', type=int)
    parser.add_argument('--from-run', help='Reuse a completed run\'s exact pinned manifest for expansion')
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
    owns_store = store is None
    store = store or Store(url=os.environ.get('CATALOGUE_TURSO_URL'), token=os.environ.get('CATALOGUE_TURSO_TOKEN'))
    try:
        if os.environ.get('CATALOGUE_ACCOUNT_GUARD') == 'required':
            guard = guard or Guard(Account(os.environ.get('TURSO_CATALOGUE_USAGE_TOKEN')), store)
            store.before_request = guard.check
            print(json.dumps(guard.check()), flush=True)
        elif args.command == 'ingest' and args.target_works and args.target_works > 1000:
            raise QuotaPaused('Imports beyond the initial sample require the account-wide 80% guard')
        if args.command == 'init':
            store.initialize()
            result = {'schema': 2, 'bytes': store.size()}
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
            elif args.from_run:
                previous = store.run("SELECT manifest FROM import_runs WHERE id=? AND phase='complete'",
                                     (args.from_run,))
                if not previous or not args.target_works:
                    raise ValueError('Expansion requires a completed source run and explicit target')
                manifest = json.loads(previous[0]['manifest'])
                if args.snapshot != 'auto' and args.snapshot != manifest['date']:
                    raise ValueError('Expansion cannot change the pinned snapshot')
                target = args.target_works
            else:
                if not args.target_works:
                    raise ValueError('Specify target works for a new run')
                manifest = n.resolve_snapshot(args.snapshot, user_agent=user_agent).manifest()
                manifest['adapter_version']=2
                manifest['code_ref']=os.environ.get('SOURCE_SHA','explicit-local-test')
                target = args.target_works
            if manifest.get('adapter_version')!=2:
                raise ValueError('Run uses an unsupported source adapter; review rather than silently changing it')
            print(json.dumps({'pinned_snapshot':manifest['date'],'target_works':target,
                              'files':manifest['files'],'adapter_version':2}),flush=True)
            run = start(store, args.run_id, manifest, target)
            if guard:
                args.max_storage_bytes = min(args.max_storage_bytes, guard.limits['storage_bytes'] * 80 // 100)
            elif run['target'] > 1000:
                raise QuotaPaused('A larger saved run also requires the account-wide guard')
            deadline = time.monotonic() + args.time_budget_seconds
            last_progress=time.monotonic()
            metrics={}
            def heartbeat():
                nonlocal last_progress
                now=time.monotonic()
                if now>=deadline:
                    raise Paused('Runner deadline reached while replaying the pinned gzip prefix')
                if now-last_progress>=30:
                    print(json.dumps({'phase':run['phase'],'checkpoint':run['checkpoint'],
                        'counters':json.loads(run['counters']),'source':metrics,
                        'account':guard.check() if guard else None}),flush=True)
                    last_progress=now
            while run['phase'] != 'complete':
                if run['phase'] == 'index':
                    build_index(store, run, max_bytes=args.max_storage_bytes,
                                max_rows_written=args.max_session_rows_written, deadline=deadline)
                    continue
                file = manifest['files'][run['phase']]
                metrics={}
                for attempt in range(3):
                    stream = stream_dump(file['url'], start_line=run['checkpoint'], user_agent=user_agent,
                        expected_size=file['size'], expected_md5=file['md5'], progress_callback=heartbeat,metrics=metrics)
                    try:
                        consume(store, run, stream, batch_size=args.batch_size, max_bytes=args.max_storage_bytes,
                                max_rows_written=args.max_session_rows_written, deadline=deadline, eof_verified=True)
                        break
                    except (requests.RequestException,StreamNetworkError) as exc:
                        status=getattr(getattr(exc,'response',None),'status_code',None)
                        if attempt==2 or status is not None and status not in (429,500,502,503,504):
                            raise CatalogueError('Source network request failed after bounded retries; checkpoint retained') from None
                        print(json.dumps({'phase':run['phase'],'source_retry':attempt+1,
                                          'checkpoint':run['checkpoint']}),flush=True)
                        heartbeat()
                        time.sleep(2**(attempt+1))
                    except (EOFError,OSError):
                        raise CatalogueError('Truncated or invalid compressed source; checkpoint retained, phase unverified') from None
                    finally:
                        stream.close()
                print(json.dumps({'phase': run['phase'], 'checkpoint': run['checkpoint'],
                    'counters': json.loads(run['counters']), 'bytes': store.size(),'source':metrics}), flush=True)
            result = {'run': run['id'], 'phase': run['phase'], 'counters': json.loads(run['counters']),
                      'target_reached':json.loads(run['counters'])['works']>=run['target'],
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
    except (Paused, QuotaPaused) as exc:
        print(json.dumps({'status': 'paused', 'reason': str(exc),
                          'quota_stop': isinstance(exc, QuotaPaused)}))
        return 75
    except CatalogueError as exc:
        print(json.dumps({'status':'failed','reason':str(exc)}))
        return 1
    except ValueError:
        print(json.dumps({'status': 'failed', 'reason': 'Catalogue operation refused or failed; credentials/raw records withheld'}))
        return 1
    finally:
        if owns_store:
            store.close()


if __name__ == '__main__':
    sys.exit(main())
