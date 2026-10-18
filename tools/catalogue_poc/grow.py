"""Cloud-only 1K -> 100K -> 500K sessions with one shared job deadline.

Only a time pause is eligible for a later reviewed continuation. Any quota pause,
source error or ambiguous write stops this process; it never resets a run or pays.
"""
import json
import os
import time

from . import cli
from .quota import Account, Guard, QuotaPaused
from .storage import CatalogueError, Store

STAGES = ((1000, 'turso-poc-sample-001'), (100_000, 'turso-poc-100k-001'),
          (500_000, 'turso-poc-500k-001'))


def verified_stage_count(store, run_id, target):
    rows = store.run('SELECT phase,counters FROM import_runs WHERE id=?', (run_id,))
    if not rows or rows[0]['phase'] != 'complete':
        raise CatalogueError('Stage did not reach verified completion; do not advance')
    counters = json.loads(rows[0]['counters'])
    actual = store.run('SELECT count(*) AS n FROM works')[0]['n']
    accepted = counters.get('works')
    if (type(accepted) is not int or accepted < target or actual < target
            or counters.get('target_shortfall', 0) != 0):
        raise CatalogueError(f'Stage target shortfall: requested {target}, actual {actual}; no larger stage started')
    return actual


def main():
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('CATALOGUE_POC_REMOTE_JOB_APPROVED') != 'yes'
            or os.environ.get('CATALOGUE_ACCOUNT_GUARD') != 'required'):
        raise SystemExit('Only the approved guarded cloud workflow may grow this catalogue')
    deadline = time.monotonic() + 17_400
    store = Store(url=os.environ.get('CATALOGUE_TURSO_URL'), token=os.environ.get('CATALOGUE_TURSO_TOKEN'))
    try:
        guard = Guard(Account(os.environ.get('TURSO_CATALOGUE_USAGE_TOKEN')), store)
        store.before_request = guard.check
        previous = None
        for target, run_id in STAGES:
            existing = store.run('SELECT target,phase FROM import_runs WHERE id=?', (run_id,))
            if existing and existing[0]['target'] != target:
                raise SystemExit('Saved stage target is inconsistent; review required')
            if existing and existing[0]['phase'] == 'complete':
                verified_stage_count(store, run_id, target)
                previous = run_id
                continue
            remaining = int(deadline - time.monotonic())
            if remaining < 60:
                print(json.dumps({'status': 'paused', 'reason': 'Shared cloud job deadline',
                                  'quota_stop': False, 'pause_kind': 'time', 'resume_allowed': True}))
                return 75
            args = ['ingest', '--run-id', run_id, '--snapshot', '2026-09-30',
                    '--target-works', str(target), '--batch-size', '50',
                    '--max-storage-bytes', '4000000000',
                    '--max-session-rows-written', '7500000',
                    '--time-budget-seconds', str(min(18_000, remaining))]
            if previous and not existing:
                args += ['--from-run', previous]
            result = cli.main(args, store=store, guard=guard, absolute_deadline=deadline)
            if result:
                return result
            verified_stage_count(store, run_id, target)
            previous = run_id
        actual = verified_stage_count(store, STAGES[-1][1], STAGES[-1][0])
        print(json.dumps({'status': 'complete', 'target_works': 500_000, 'actual_works': actual,
                          'message': 'Stop at the approved goal; do not automatically expand'}))
        return 0
    except QuotaPaused as exc:
        print(json.dumps({'status': 'paused', 'reason': str(exc), 'quota_stop': True,
                          'pause_kind': 'quota', 'resume_allowed': False}))
        return 75
    except CatalogueError as exc:
        print(json.dumps({'status': 'stopped', 'reason': str(exc), 'resume_allowed': False}))
        return 1
    finally:
        store.close()


if __name__ == '__main__':
    raise SystemExit(main())
