"""Synthetic usage-meter, continuation and fail-closed tests; no cloud access."""
import copy
import contextlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tools.catalogue_poc.quota import Account, FREE_LIMITS, Guard, QuotaPaused
from tools.catalogue_poc import cli, grow
from tools.catalogue_poc.storage import Store, CatalogueError
from tools.catalogue_poc.ingest import Paused


def account(usage=None):
    value = Mock()
    value.limits.return_value = dict(FREE_LIMITS)
    value.usage.return_value = dict(usage or {key: 0 for key in FREE_LIMITS})
    return value


class QuotaTests(unittest.TestCase):
    def test_every_crossed_tenth_is_emitted_without_skipping(self):
        events = []
        api = account()
        guard = Guard(api, SimpleNamespace(rows_read=0, rows_written=0), emit=events.append)
        api.usage.return_value['rows_written'] = 3_100_000
        guard.check(force=True)
        self.assertEqual([e['percent'] for e in events if e['resource'] == 'rows_written'], [10, 20, 30])
        guard.check(force=True)
        self.assertEqual(len(events), 3)

    def test_eighty_percent_and_pre_request_headroom_stop_each_resource(self):
        for resource in FREE_LIMITS:
            for numerator in (80, 90):
                with self.subTest(resource=resource, percent=numerator):
                    used = {key: 0 for key in FREE_LIMITS}
                    used[resource] = FREE_LIMITS[resource] * numerator // 100
                    with self.assertRaises(QuotaPaused):
                        Guard(account(used), SimpleNamespace(rows_read=0, rows_written=0), emit=lambda e: None)
        store = SimpleNamespace(rows_read=0, rows_written=0)
        guard = Guard(account(), store, emit=lambda e: None)
        store.rows_written = 7_900_000
        with self.assertRaises(QuotaPaused):
            guard.check()

    def test_local_counters_cover_provider_lag_without_double_counting(self):
        api = account()
        store = SimpleNamespace(rows_read=11, rows_written=10)
        guard = Guard(api, store, emit=lambda e: None)
        store.rows_written += 123
        self.assertEqual(guard.check()['used']['rows_written'], 123)
        api.usage.return_value['rows_written'] = 123
        self.assertEqual(guard.check(force=True)['used']['rows_written'], 123)

    def test_meter_regression_or_month_reset_does_not_replenish_running_job(self):
        api = account()
        api.usage.return_value['rows_written'] = 7_000_000
        store = SimpleNamespace(rows_read=0, rows_written=0)
        guard = Guard(api, store, emit=lambda e: None)
        api.usage.return_value['rows_written'] = 0
        self.assertEqual(guard.check(force=True)['used']['rows_written'], 7_000_000)

    def test_poll_is_bounded_and_expired_or_missing_access_fails_closed(self):
        now = [1]
        api = account()
        guard = Guard(api, SimpleNamespace(rows_read=0, rows_written=0), clock=lambda: now[0])
        api.usage.reset_mock()
        for _ in range(100):
            guard.check()
        api.usage.assert_not_called()
        now[0] += 31
        guard.check()
        api.usage.assert_called_once()
        api.usage.side_effect = QuotaPaused('Token expired')
        with self.assertRaises(QuotaPaused):
            guard.check(force=True)
        with self.assertRaises(QuotaPaused):
            Account(None)

    def test_paid_or_unverifiable_subscription_and_missing_usage_are_refused(self):
        api = Account('synthetic-not-a-credential')
        good = {'subscription': {'plan': 'starter', 'overages': False, 'timeline': 'monthly'}}
        for field, bad in [('overages', True), ('overages', None), ('plan', 'scaler'), ('timeline', 'yearly')]:
            value = copy.deepcopy(good)
            value['subscription'][field] = bad
            api.get = Mock(return_value=value)
            with self.assertRaises(QuotaPaused):
                api.limits()
        api.get = Mock(return_value={'organization': {'usage': {'rows_written': 0}}})
        with self.assertRaises(QuotaPaused):
            api.usage()

    def test_caps_never_expand_and_reduced_allowance_is_honored(self):
        api = Account('synthetic-not-a-credential')
        plan = {'name': 'starter', 'price': '0', 'quotas': {
            'rowsRead': 1_000_000_000, 'rowsWritten': 10_000_000,
            'storage': 4_000_000_000, 'bytesSynced': 3_000_000_000}}
        api.get = Mock(side_effect=[{'subscription': {'plan': 'starter', 'overages': False,
                                      'timeline': 'monthly'}}, {'plans': [plan]}])
        limits = api.limits()
        self.assertEqual(limits['rows_read'], 500_000_000)
        self.assertEqual(limits['storage_bytes'], 4_000_000_000)

    def test_only_read_only_approved_endpoints_and_no_redirects(self):
        api = Account('synthetic-not-a-credential')
        api.opener = Mock()
        with self.assertRaises(ValueError):
            api.get('billing')
        api.opener.open.assert_not_called()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({'organization': {'usage': {}}}).encode()
        api.opener.open.return_value = response
        api.get('usage')
        request = api.opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.full_url, 'https://api.turso.tech/v1/organizations/stmichael9/usage')
        api.opener.open.side_effect = OSError('synthetic secret-shaped error should be redacted')
        with self.assertRaisesRegex(QuotaPaused, '^Account usage could not be verified'):
            api.get('usage')

    def test_guard_prevents_the_http_request_and_counts_failed_transaction_statistics(self):
        store = Store(url='libsql://bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io',
                      token='synthetic')
        store.before_request = Mock(side_effect=QuotaPaused('Synthetic stop'))
        with patch.object(store.opener, 'open') as network, self.assertRaises(QuotaPaused):
            store.run('SELECT 1')
        network.assert_not_called()
        store.before_request = None
        body = {'results': [
            {'type':'ok', 'response':{'type':'execute', 'result':{'rows_read':1, 'rows_written':0}}},
            {'type':'ok', 'response':{'type':'batch', 'result':{
                'step_results':[{'rows_read':2, 'rows_written':0},
                                {'rows_read':3, 'rows_written':7}, None, None,
                                {'rows_read':0, 'rows_written':0}],
                'step_errors':[None, None, {'code':'constraint'}, None, None]}}},
            {'type':'ok', 'response':{'type':'close'}}]}
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(body).encode()
        with patch.object(store.opener,'open',return_value=response), self.assertRaises(CatalogueError):
            store.transaction([('SELECT 1',()), ('SELECT 2',())])
        self.assertEqual(store.rows_read, 6)
        self.assertEqual(store.rows_written, 7)

    def test_growth_refuses_workstation_and_stops_on_first_pause(self):
        with patch.dict('os.environ', {}, clear=True), self.assertRaises(SystemExit):
            grow.main()
        with patch.dict('os.environ', {'GITHUB_ACTIONS':'true', 'CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
                                     'CATALOGUE_ACCOUNT_GUARD':'required'}):
            store = Mock()
            store.run.return_value = []
            with patch.object(grow, 'Store', return_value=store), patch.object(grow, 'Guard'), \
                    patch.object(grow, 'Account'), patch.object(cli, 'main', return_value=75) as run:
                self.assertEqual(grow.main(), 75)
                self.assertEqual(run.call_count, 1)
                store.close.assert_called_once()

    def test_growth_skips_completed_stage_and_reuses_exact_manifest_for_next(self):
        with patch.dict('os.environ', {'GITHUB_ACTIONS':'true', 'CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
                                     'CATALOGUE_ACCOUNT_GUARD':'required'}):
            store = Mock()
            store.run.side_effect = [[{'target':1000, 'phase':'complete'}],
                                    [{'phase':'complete', 'counters':json.dumps({'works':1000})}],
                                    [{'n':1000}], []]
            with patch.object(grow, 'Store', return_value=store), patch.object(grow, 'Guard') as guard, \
                    patch.object(grow, 'Account'), patch.object(cli, 'main', return_value=75) as run:
                self.assertEqual(grow.main(), 75)
                args = run.call_args.args[0]
                self.assertIn('100000', args)
                self.assertEqual(args[-2:], ['--from-run', 'turso-poc-sample-001'])
                self.assertIs(run.call_args.kwargs['store'], store)
                self.assertIs(run.call_args.kwargs['guard'], guard.return_value)
                self.assertGreater(run.call_args.kwargs['absolute_deadline'], 0)

    def test_growth_cannot_expand_beyond_goal_or_replace_changed_stage_target(self):
        self.assertEqual(grow.STAGES[-1][0], 500_000)
        with patch.dict('os.environ', {'GITHUB_ACTIONS':'true', 'CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
                                     'CATALOGUE_ACCOUNT_GUARD':'required'}):
            store = Mock()
            store.run.return_value = [{'target':500_001, 'phase':'complete'}]
            with patch.object(grow, 'Store', return_value=store), patch.object(grow, 'Guard'), \
                    patch.object(grow, 'Account'), self.assertRaises(SystemExit):
                grow.main()

    def test_shortfall_in_saved_or_newly_completed_stage_never_advances(self):
        for saved in (True, False):
            with self.subTest(saved=saved), patch.dict('os.environ', {
                    'GITHUB_ACTIONS':'true', 'CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
                    'CATALOGUE_ACCOUNT_GUARD':'required'}):
                store = Mock()
                first = [{'target':1000, 'phase':'complete'}] if saved else []
                store.run.side_effect = [first, [{'phase':'complete', 'counters':
                    json.dumps({'works':2, 'target_shortfall':998})}], [{'n':2}]]
                output = io.StringIO()
                with patch.object(grow, 'Store', return_value=store), patch.object(grow, 'Guard'), \
                        patch.object(grow, 'Account'), patch.object(cli, 'main', return_value=0) as run, \
                        contextlib.redirect_stdout(output):
                    self.assertEqual(grow.main(), 1)
                    self.assertEqual(run.call_count, 0 if saved else 1)
                    self.assertIn('Stage target shortfall: requested 1000, actual 2', output.getvalue())
                    self.assertNotIn('"status": "complete"', output.getvalue())

    def test_verified_stage_requires_actual_count_and_honors_shortfall(self):
        for count, counters in [(999, {'works':1000}), (1000, {'works':999}),
                                (1000, {'works':1000, 'target_shortfall':1})]:
            store = Mock()
            store.run.side_effect = [[{'phase':'complete', 'counters':json.dumps(counters)}], [{'n':count}]]
            with self.assertRaises(CatalogueError):
                grow.verified_stage_count(store, 'synthetic', 1000)
        store.run.side_effect = [[{'phase':'complete', 'counters':json.dumps({'works':1000})}], [{'n':1000}]]
        self.assertEqual(grow.verified_stage_count(store, 'synthetic', 1000), 1000)

    def test_delayed_preflight_cannot_rebase_absolute_deadline(self):
        now = [1]
        store, guard = Mock(), Mock()
        def delay():
            now[0] = 20
            return {}
        guard.check.side_effect = delay
        output = io.StringIO()
        with patch.dict('os.environ', {'CATALOGUE_ACCOUNT_GUARD':'required'}), \
                patch.object(cli.time, 'monotonic', side_effect=lambda: now[0]), \
                contextlib.redirect_stdout(output):
            result = cli.main(['ingest', '--run-id','synthetic', '--target-works','1000'],
                              store=store, guard=guard, absolute_deadline=10)
        self.assertEqual(result, 75)
        store.run.assert_not_called()
        self.assertIn('"pause_kind": "time"', output.getvalue())
        self.assertIn('"resume_allowed": true', output.getvalue())

    def test_capacity_pause_is_not_time_continuation_permission(self):
        guard = Mock()
        guard.check.side_effect = Paused('Synthetic reserved storage pause', kind='capacity')
        output = io.StringIO()
        with patch.dict('os.environ', {'CATALOGUE_ACCOUNT_GUARD':'required'}), \
                contextlib.redirect_stdout(output):
            result = cli.main(['ingest','--run-id','synthetic'], store=Mock(), guard=guard)
        self.assertEqual(result, 75)
        self.assertIn('"pause_kind": "capacity"', output.getvalue())
        self.assertIn('"resume_allowed": false', output.getvalue())


if __name__ == '__main__':
    unittest.main()
