"""Fault-injected source recovery with synthetic records/in-memory SQL only."""
import contextlib
from datetime import datetime, timezone
from email.utils import format_datetime
import io
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tools.catalogue_poc import cli
from tools.catalogue_poc.ingest import Paused
from tools.catalogue_poc.normalize import DumpRow
from tools.catalogue_poc.quota import QuotaPaused
from tools.catalogue_poc.storage import CatalogueError, Store

PHASES = ('works','authors','editions','redirects','deletes')
MANIFEST = {'date':'2026-09-30','identifier':'synthetic-recovery','adapter_version':2,
            'files':{phase:{'url':phase,'size':1,'md5':'0'*32} for phase in PHASES}}
ENV = {'GITHUB_ACTIONS':'true','CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
       'OPEN_LIBRARY_USER_AGENT':'synthetic@example.invalid'}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(sqlite_path=':memory:')
        self.store.initialize()
        self.output = io.StringIO()

    def tearDown(self):
        self.store.close()

    def execute(self, reader, target=6, **kwargs):
        with (patch.dict(os.environ,ENV,clear=True),
              patch.object(cli.n,'resolve_snapshot',return_value=SimpleNamespace(manifest=lambda:MANIFEST)),
              patch.object(cli,'stream_dump',side_effect=reader),patch.object(cli.time,'sleep') as sleep,
              contextlib.redirect_stdout(self.output)):
            result = cli.main(['ingest','--run-id','recovery','--target-works',str(target),
                               '--batch-size','1'],store=self.store,**kwargs)
        return result, sleep

    def test_more_than_three_progressing_interruptions_then_full_completion(self):
        starts = []
        def reader(url, **kwargs):
            if url != 'works':
                return
            starts.append(kwargs['start_line'])
            number = kwargs['start_line'] + 1
            yield DumpRow(number,{'key':f'/works/OL{number}W','title':f'Synthetic {number}'})
            if len(starts) <= 5:
                raise cli.requests.ConnectionError('private-url-or-secret-must-not-be-logged')
        result, sleep = self.execute(reader)
        self.assertEqual(result,0)
        self.assertEqual(starts,[0,1,2,3,4,5])
        self.assertEqual(self.store.run('SELECT count(*) n FROM works'),[{'n':6}])
        self.assertEqual(self.store.run('SELECT phase FROM import_runs'),[{'phase':'complete'}])
        self.assertEqual(sleep.call_count,5)
        self.assertNotIn('private-url-or-secret',self.output.getvalue())
        self.assertEqual(self.output.getvalue().count('"event": "source_retry"'),5)

    def test_total_budget_stops_even_when_every_attempt_commits_progress(self):
        attempts = []
        def reader(url, **kwargs):
            attempts.append(kwargs['start_line'])
            number = kwargs['start_line'] + 1
            yield DumpRow(number,{'key':f'/works/OL{number}W','title':'Synthetic progressing fault'})
            raise cli.requests.ConnectionError('synthetic')
        result,_ = self.execute(reader,target=20)
        self.assertEqual(result,1)
        self.assertEqual(len(attempts),cli.MAX_SOURCE_ATTEMPTS)
        self.assertEqual(self.store.run('SELECT checkpoint,phase FROM import_runs'),
                         [{'checkpoint':12,'phase':'works'}])
        self.assertIn('"event": "source_failure"',self.output.getvalue())
        self.assertNotIn('"target_reached": true',self.output.getvalue())

    def test_three_no_progress_failures_stop_and_keep_checkpoint(self):
        calls = []
        def reader(url, **kwargs):
            calls.append(kwargs['start_line'])
            raise cli.requests.ConnectionError('synthetic')
            yield
        result,sleep = self.execute(reader)
        self.assertEqual(result,1)
        self.assertEqual(calls,[0,0,0])
        self.assertEqual([item.args[0] for item in sleep.call_args_list],[2,4])

    def test_resume_reuses_saved_manifest_and_does_not_duplicate_committed_rows(self):
        first = []
        def interrupted(url,**kwargs):
            first.append(kwargs['start_line'])
            if len(first)==1:
                yield DumpRow(1,{'key':'/works/OL1W','title':'Synthetic retained'})
            raise cli.requests.ConnectionError('synthetic')
        result,_ = self.execute(interrupted,target=2)
        self.assertEqual(result,1)
        self.assertEqual(first,[0,1,1,1])
        def resumed(url,**kwargs):
            if url=='works':
                self.assertEqual(kwargs['start_line'],1)
                yield DumpRow(2,{'key':'/works/OL2W','title':'Synthetic resumed'})
        with (patch.dict(os.environ,ENV,clear=True),patch.object(cli.n,'resolve_snapshot') as resolver,
              patch.object(cli,'stream_dump',side_effect=resumed),contextlib.redirect_stdout(self.output)):
            result=cli.main(['ingest','--run-id','recovery','--target-works','2','--batch-size','1'],store=self.store)
        resolver.assert_not_called()
        self.assertEqual(result,0)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works'),[{'n':2}])

    def test_nonretryable_http_ssl_and_configuration_errors_stop_immediately(self):
        for error in (cli.requests.HTTPError(response=SimpleNamespace(status_code=404)),
                      cli.requests.exceptions.SSLError('synthetic'),cli.requests.exceptions.InvalidURL('synthetic')):
            with self.subTest(error=type(error).__name__):
                def reader(*args,**kwargs):
                    raise error
                    yield
                result,sleep = self.execute(reader)
                self.assertEqual(result,1)
                sleep.assert_not_called()

    def test_http_429_and_503_are_retried_and_retry_after_is_respected(self):
        for status in (429,503):
            error=cli.requests.HTTPError(response=SimpleNamespace(status_code=status,headers={'Retry-After':'25'}))
            self.assertEqual(cli.source_retry_delay(error,1),25)

    def test_retry_after_wait_is_chunked_and_next_attempt_can_finish(self):
        attempts=[]
        def reader(url,**kwargs):
            if url!='works':
                return
            attempts.append(kwargs['start_line'])
            if len(attempts)==1:
                raise cli.requests.HTTPError(response=SimpleNamespace(status_code=429,
                    headers={'Retry-After':'25'}))
            yield DumpRow(1,{'key':'/works/OL1W','title':'Synthetic recovered rate limit'})
        result,sleep=self.execute(reader,target=1)
        self.assertEqual(result,0)
        self.assertEqual(attempts,[0,0])
        self.assertEqual([item.args[0] for item in sleep.call_args_list],[10,10,5])

    def test_cooldown_outlasting_deadline_is_source_pause_not_time_permission(self):
        def reader(*args,**kwargs):
            raise cli.requests.HTTPError(response=SimpleNamespace(status_code=503,
                headers={'Retry-After':'3600'}))
            yield
        result,sleep=self.execute(reader)
        self.assertEqual(result,75)
        sleep.assert_not_called()
        self.assertIn('"pause_kind": "source"',self.output.getvalue())
        self.assertIn('"resume_allowed": false',self.output.getvalue())

    def test_guard_is_checked_during_backoff_and_can_stop_before_replay(self):
        attempts=[]
        def reader(*args,**kwargs):
            attempts.append(1)
            raise cli.requests.ConnectionError('synthetic')
            yield
        guard=SimpleNamespace(check=Mock(side_effect=[{},QuotaPaused('Synthetic usage stop during wait')]),
                              limits={'storage_bytes':5_000_000_000})
        guarded_env={**ENV,'CATALOGUE_ACCOUNT_GUARD':'required'}
        with (patch.dict(os.environ,guarded_env,clear=True),
              patch.object(cli.n,'resolve_snapshot',return_value=SimpleNamespace(manifest=lambda:MANIFEST)),
              patch.object(cli,'stream_dump',side_effect=reader),patch.object(cli.time,'sleep') as sleep,
              contextlib.redirect_stdout(self.output)):
            result=cli.main(['ingest','--run-id','recovery','--target-works','6'],store=self.store,guard=guard)
        self.assertEqual(result,75)
        self.assertEqual(attempts,[1])
        sleep.assert_not_called()
        self.assertIn('"quota_stop": true',self.output.getvalue())

    def test_http_date_retry_after_uses_the_source_cooldown(self):
        error=cli.requests.HTTPError(response=SimpleNamespace(status_code=429,headers={
            'Retry-After':format_datetime(datetime.fromtimestamp(1025,timezone.utc),usegmt=True)}))
        with patch.object(cli.time,'time',return_value=1000):
            self.assertEqual(cli.source_retry_delay(error,1),25)

    def test_missing_bad_or_extreme_retry_after_does_not_remove_safety(self):
        for value in ('bad-date','-100',''):
            error=cli.requests.HTTPError(response=SimpleNamespace(headers={'Retry-After':value}))
            self.assertEqual(cli.source_retry_delay(error,1),2)
        error=cli.requests.HTTPError(response=SimpleNamespace(headers={'Retry-After':'7200'}))
        with self.assertRaises(Paused) as stopped:
            cli.source_retry_delay(error,1)
        self.assertEqual(stopped.exception.kind,'source')

    def test_integrity_database_and_quota_failures_are_not_source_retried(self):
        for error in (ValueError('synthetic bad checksum'),EOFError('synthetic truncation'),
                      CatalogueError('synthetic ambiguous write'),QuotaPaused('synthetic account stop')):
            calls=[]
            def reader(*args,**kwargs):
                calls.append(1)
                raise error
                yield
            result,sleep=self.execute(reader)
            self.assertIn(result,(1,75))
            self.assertEqual(calls,[1])
            sleep.assert_not_called()

    def test_expired_deadline_prevents_another_stream_open(self):
        reader=Mock()
        result,sleep=self.execute(reader,absolute_deadline=cli.time.monotonic()-1)
        self.assertEqual(result,75)
        reader.assert_not_called()
        sleep.assert_not_called()

    def test_failed_generator_is_closed_before_backoff(self):
        closed=[]
        def reader(*args,**kwargs):
            try:
                raise cli.requests.ConnectionError('synthetic')
                yield
            finally:
                closed.append(True)
        with (patch.dict(os.environ,ENV,clear=True),
              patch.object(cli.n,'resolve_snapshot',return_value=SimpleNamespace(manifest=lambda:MANIFEST)),
              patch.object(cli,'stream_dump',side_effect=reader),
              patch.object(cli.time,'sleep',side_effect=lambda seconds:self.assertTrue(closed)),
              contextlib.redirect_stdout(self.output)):
            self.assertEqual(cli.main(['ingest','--run-id','recovery','--target-works','6'],store=self.store),1)
        self.assertEqual(len(closed),3)


if __name__ == '__main__':
    unittest.main()
