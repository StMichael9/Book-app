"""Synthetic, in-memory contract tests. Not cloud or real-dump capacity evidence."""
import json
import gzip
import hashlib
import io
import contextlib
import os
from types import SimpleNamespace
import sqlite3
import sys
import time
import unittest
from unittest.mock import patch
from urllib.request import Request

from tools.catalogue_poc import normalize as n
from tools.catalogue_poc import dumps
from tools.catalogue_poc.ingest import Paused, build_index, checkpoint, consume, phase_statements, selected, start
from tools.catalogue_poc.query import by_isbn, by_work, search
from tools.catalogue_poc.storage import CatalogueError, RejectRedirects, Store, bulk, transactional_payload
from data.sources import DumpRow

MANIFEST = {'identifier': 'fixture', 'date': '2026-09-30', 'files': {}}


def work(key=1, title='Synthetic Étoile', author=1):
    return {'key': f'/works/OL{key}W', 'title': title,
            'authors': [{'author': {'key': f'/authors/OL{author}A'}}]}


def rows(values, offset=0):
    return (DumpRow(index, row) for index, row in enumerate(values, offset+1))


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(sqlite_path=':memory:')
        self.store.initialize()
        self.run = start(self.store, 'fixture', MANIFEST, 3)

    def tearDown(self):
        self.store.close()

    def seed(self):
        consume(self.store, self.run, rows([work(),work(2,author=2),work(3,'Another synthetic title')]), eof_verified=True)
        consume(self.store, self.run, rows([
            {'key':'/authors/OL1A','name':'Alex Reader'}, {'key':'/authors/OL2A','name':'Alex Reader'}]), eof_verified=True)
        edition = {'key':'/books/OL1M','title':'Synthetic edition', 'number_of_pages':250,
            'isbn_13':['9780306406157','bad'], 'isbn_10':['0306406152'],
            'works':[{'key':'/works/OL1W'},{'key':'/works/OL2W'}]}
        consume(self.store, self.run, rows([edition]), eof_verified=True)
        consume(self.store, self.run, rows([{'key':'/works/OL9W','location':'/works/OL1W'}]), eof_verified=True)
        consume(self.store, self.run, rows([]), eof_verified=True)
        build_index(self.store, self.run)

    def test_no_app_settings_import(self):
        self.assertNotIn('database', sys.modules)
        self.assertNotIn('models', sys.modules)

    def test_unicode_and_no_category_gate(self):
        value = n.work(work(title='  星の王子さま  '))
        self.assertEqual(value['title'], '星の王子さま')
        self.assertEqual(value['author_ids'], ['/authors/OL1A'])

    def test_missing_author_is_not_invented(self):
        self.assertEqual(n.work({'key':'/works/OL2W','title':'Private-free public metadata'})['author_ids'], [])

    def test_malformed_and_missing_title(self):
        self.assertIsNone(n.work({'key':'/works/OL2W','title':None}))
        self.assertIsNone(n.work({'key':'https://evil.test','title':'x'}))
        consume(self.store, self.run, [DumpRow(1,None,'bad JSON')])
        self.assertEqual(json.loads(self.run['counters'])['invalid'],1)

    def test_names_not_identity(self):
        self.seed()
        self.assertEqual(self.store.run("SELECT count(*) n FROM authors WHERE name='Alex Reader'")[0]['n'],2)

    def test_work_and_isbn_ambiguity_preserved(self):
        self.seed()
        self.assertEqual(len(by_isbn(self.store,'0306406152')),2)
        self.assertEqual(by_work(self.store,'/works/OL9W')[0]['source_id'],'/works/OL1W')

    def test_fts_title_and_author(self):
        self.seed()
        self.assertEqual(len(search(self.store,'Étoile')),2)
        self.assertEqual(len(search(self.store,'Alex Reader')),3)

    def test_search_syntax_not_executable(self):
        self.seed()
        self.assertIsInstance(search(self.store,'" OR - NEAR(*)'),list)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],3)

    def test_request_replay_does_not_duplicate(self):
        consume(self.store,self.run,rows([work(),work()]))
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],1)
        self.assertEqual(self.store.run('SELECT count(*) n FROM work_authors')[0]['n'],1)
        self.assertEqual(json.loads(self.run['counters'])['works'],1)

    def test_transaction_and_checkpoint_rollback(self):
        stale = dict(self.run)
        checkpoint(self.store,self.run,[],1,json.loads(self.run['counters']))
        with self.assertRaises(sqlite3.IntegrityError):
            checkpoint(self.store,stale,[('INSERT INTO catalogue_meta VALUES(?,?)',('should-not-exist','x'))],2,{'works':0})
        self.assertEqual(self.store.run("SELECT * FROM catalogue_meta WHERE key='should-not-exist'"),[])
        self.assertEqual(self.store.run('SELECT checkpoint FROM import_runs')[0]['checkpoint'],1)

    def test_interrupted_batch_resume(self):
        consume(self.store,self.run,rows([work()]))
        resumed = start(self.store,'fixture',MANIFEST,3)
        self.assertEqual(resumed['checkpoint'],1)
        consume(self.store,resumed,rows([work(2)],offset=1),eof_verified=True)
        self.assertEqual(json.loads(resumed['counters'])['works'],2)

    def test_pin_and_target_cannot_silently_change(self):
        with self.assertRaises(ValueError):
            start(self.store,'fixture',{**MANIFEST,'date':'2026-10-31'},3)
        with self.assertRaises(ValueError):
            start(self.store,'fixture',MANIFEST,4)

    def test_partial_stream_is_not_checksum_verified(self):
        consume(self.store,self.run,rows([work()]))
        self.assertEqual(self.run['phase'],'works')
        self.assertEqual(json.loads(self.run['verified_phases']),[])

    def test_capacity_pause_leaves_checkpoint(self):
        with self.assertRaises(Paused):
            consume(self.store,self.run,rows([work()]),max_bytes=1)
        self.assertEqual(self.run['checkpoint'],0)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],0)

    def test_index_needs_every_verified_phase(self):
        self.run['phase']='index'
        with self.assertRaises(ValueError):
            build_index(self.store,self.run)

    def test_snapshot_reuse_after_completion(self):
        self.seed()
        again = start(self.store,'fixture',MANIFEST,3)
        self.assertEqual(again['phase'],'complete')

    def test_changed_work_reconciles_authors_and_restores_tombstone(self):
        consume(self.store,self.run,rows([work()]))
        self.store.transaction([('UPDATE works SET deleted=1',())])
        consume(self.store,self.run,rows([work(author=2)],offset=1))
        links = self.store.run('SELECT author_id FROM work_authors')
        self.assertEqual(links,[{'author_id':'/authors/OL2A'}])
        self.assertEqual(self.store.run('SELECT deleted FROM works'),[{'deleted':0}])

    def test_unchanged_work_can_restore_tombstone(self):
        consume(self.store,self.run,rows([work()]))
        self.store.transaction([('UPDATE works SET deleted=1',())])
        consume(self.store,self.run,rows([work()],offset=1))
        self.assertEqual(self.store.run('SELECT deleted FROM works'),[{'deleted':0}])

    def test_edition_fingerprint_independent_of_related_work(self):
        values = n.editions({'key':'/books/OL1M','number_of_pages':100,
                            'works':[{'key':'/works/OL1W'},{'key':'/works/OL2W'}]})
        self.assertEqual(len(values),2)
        self.assertEqual(values[0]['fingerprint'],values[1]['fingerprint'])

    def test_changed_edition_reconciles_isbns_and_work_links(self):
        consume(self.store,self.run,rows([work(),work(2)]))
        first = {'key':'/books/OL1M','isbn_13':['9780306406157'],
                 'works':[{'key':'/works/OL1W'},{'key':'/works/OL2W'}]}
        statements,_ = phase_statements(self.store,'editions',[first],'2026-09-30',0)
        self.store.transaction(statements)
        changed = {'key':'/books/OL1M','number_of_pages':120,'works':[{'key':'/works/OL2W'}]}
        statements,_ = phase_statements(self.store,'editions',[changed],'2026-10-31',0)
        self.store.transaction(statements)
        self.assertEqual(self.store.run('SELECT * FROM edition_isbns'),[])
        self.assertEqual(self.store.run('SELECT w.source_id FROM edition_works e JOIN works w ON w.id=e.work_id'),
                         [{'source_id':'/works/OL2W'}])

    def test_edition_link_change_with_same_metadata_is_detected(self):
        first = n.editions({'key':'/books/OL1M','number_of_pages':100,
                            'works':[{'key':'/works/OL1W'},{'key':'/works/OL2W'}]})
        changed = n.editions({'key':'/books/OL1M','number_of_pages':100,
                             'works':[{'key':'/works/OL1W'}]})
        self.assertNotEqual(first[0]['fingerprint'],changed[0]['fingerprint'])

    def test_unchanged_edition_replay_has_no_relationship_writes(self):
        consume(self.store,self.run,rows([work()]))
        edition = {'key':'/books/OL1M','number_of_pages':100,'works':[{'key':'/works/OL1W'}]}
        statements,_ = phase_statements(self.store,'editions',[edition],'2026-09-30',0)
        self.store.transaction(statements)
        replay,_ = phase_statements(self.store,'editions',[edition],'2026-09-30',0)
        before=self.store.connection.total_changes
        self.store.transaction(replay)
        self.assertEqual(self.store.connection.total_changes,before)

    def test_index_deadline_retains_resumable_phase(self):
        self.run['phase']='index'
        self.run['verified_phases']=json.dumps(['works','authors','editions','redirects','deletes'])
        # Persist this fixture state so optimistic guards test the real path.
        self.store.transaction([('UPDATE import_runs SET phase=?,verified_phases=?',
                                ('index',self.run['verified_phases']))])
        with self.assertRaises(Paused):
            build_index(self.store,self.run,deadline=time.monotonic()-1)
        self.assertEqual(self.run['phase'],'index')
        self.assertEqual(self.run['checkpoint'],0)

    def test_foreign_key_failure_rolls_back_entire_batch(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.transaction([('INSERT INTO catalogue_meta VALUES(?,?)',('rollback-marker','x')),
                                    ('INSERT INTO work_authors VALUES(?,?)',(999,'/authors/OL999A'))])
        self.assertEqual(self.store.run("SELECT * FROM catalogue_meta WHERE key='rollback-marker'"),[])

    def test_missing_remote_response_is_not_success(self):
        remote = Store(url='libsql://bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io',token='synthetic')
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,limit): return b'{"results":[]}'
        with patch.object(remote.opener,'open',return_value=Response()):
            with self.assertRaises(CatalogueError):
                remote.run('SELECT 1')

    def test_database_redirects_never_forward_bearer_token(self):
        request = Request('https://bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io/v2/pipeline',
                          data=b'{}',headers={'Authorization':'Bearer synthetic'})
        for status in (301,302,303,307,308):
            for target in ('https://unexpected.example/db','http://unexpected.example/db',
                           'https://bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io/other'):
                self.assertIsNone(RejectRedirects().redirect_request(request,None,status,'redirect',{},target))

    def test_index_capacity_guard_precedes_mutation(self):
        self.run['phase']='index'
        self.run['verified_phases']=json.dumps(['works','authors','editions','redirects','deletes'])
        self.store.transaction([('UPDATE import_runs SET phase=?,verified_phases=?',
                                ('index',self.run['verified_phases']))])
        with self.assertRaises(Paused):
            build_index(self.store,self.run,max_bytes=1)
        self.assertEqual(self.run['checkpoint'],0)
        self.assertEqual(self.store.run('SELECT checkpoint FROM import_runs'),[{'checkpoint':0}])

    def test_payload_subdivision_preserves_all_rows(self):
        self.run['target']=10
        self.store.transaction([('UPDATE import_runs SET target=10',())])
        values=[{**work(key=index),'description':'z'*262100} for index in range(1,9)]
        consume(self.store,self.run,rows(values),batch_size=10)
        self.assertEqual(self.run['checkpoint'],8)
        self.assertEqual(json.loads(self.run['counters'])['works'],8)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],8)

    def test_interrupted_subdivision_resumes_without_loss(self):
        self.run['target']=10
        self.store.transaction([('UPDATE import_runs SET target=10',())])
        values=[{**work(key=index),'description':'z'*262100} for index in range(1,9)]
        original=self.store.transaction
        calls=0
        def interrupted(statements):
            nonlocal calls
            calls+=1
            if calls==2:
                raise CatalogueError('Synthetic interruption before second sub-batch')
            return original(statements)
        with patch.object(self.store,'transaction',side_effect=interrupted):
            with self.assertRaises(CatalogueError):
                consume(self.store,self.run,rows(values),batch_size=10)
        self.assertEqual(self.run['checkpoint'],4)
        resumed=start(self.store,'fixture',MANIFEST,10)
        consume(self.store,resumed,rows(values[4:],offset=4),batch_size=10)
        self.assertEqual(json.loads(resumed['counters'])['works'],8)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],8)

    def test_next_batch_reserve_prevents_write(self):
        with self.assertRaises(Paused):
            consume(self.store,self.run,rows([work()]),max_rows_written=32)
        self.assertEqual(self.run['checkpoint'],0)
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],0)

    def test_full_source_scan_after_target_avoids_per_batch_lookups(self):
        consume(self.store,self.run,rows([work(1),work(2),work(3)]))
        original=self.store.run
        queries=[]
        def measured(sql,params=()):
            queries.append(sql)
            return original(sql,params)
        with patch.object(self.store,'run',side_effect=measured):
            consume(self.store,self.run,rows((work(key=index) for index in range(10,10010)),offset=3))
        self.assertLess(len(queries),20)
        self.assertFalse(any('source_id IN (' in query for query in queries))
        self.assertEqual(json.loads(self.run['counters'])['works'],3)

    def test_zero_valid_works_cannot_advance_source_phase(self):
        with self.assertRaises(CatalogueError):
            consume(self.store,self.run,rows([{'key':'/works/OL1W','title':None}]),eof_verified=True)
        self.assertEqual(self.run['phase'],'works')

    def test_partial_target_is_reported_explicitly(self):
        consume(self.store,self.run,rows([work()]),eof_verified=True)
        self.assertEqual(json.loads(self.run['counters'])['target_shortfall'],2)

    def test_failed_stream_integrity_never_publishes_committed_prefix(self):
        fixture=DumpTests()
        stream=fixture.stream(gzip.compress(fixture.line()),expected_md5='0'*32)
        with self.assertRaises(ValueError):
            consume(self.store,self.run,stream,batch_size=1,eof_verified=True)
        self.assertEqual(self.run['phase'],'works')
        self.assertEqual(json.loads(self.run['verified_phases']),[])
        self.assertEqual(self.store.run('SELECT count(*) n FROM works')[0]['n'],1)

    def test_source_network_retries_are_bounded_without_db_credentials(self):
        from tools.catalogue_poc import cli
        isolated=Store(sqlite_path=':memory:')
        isolated.initialize()
        manifest={**MANIFEST,'files':{'works':{'url':DumpTests.url,'size':1,'md5':'0'*32}}}
        calls=[]
        def failed_source(*args,**kwargs):
            calls.append(kwargs['start_line'])
            raise cli.requests.ConnectionError('synthetic network fault')
            yield  # generator interface, never a real HTTP request
        environment={'GITHUB_ACTIONS':'true','CATALOGUE_POC_REMOTE_JOB_APPROVED':'yes',
                     'OPEN_LIBRARY_USER_AGENT':'fixture@example.invalid'}
        with (patch.dict(os.environ,environment),patch.object(cli,'Store',return_value=isolated),
              patch.object(cli.n,'resolve_snapshot',return_value=SimpleNamespace(manifest=lambda:manifest)),
              patch.object(cli,'stream_dump',side_effect=failed_source),patch.object(cli.time,'sleep') as backoff,
              contextlib.redirect_stdout(io.StringIO())):
            result=cli.main(['ingest','--run-id','network-fixture','--target-works','1'])
        self.assertEqual(result,1)
        self.assertEqual(calls,[0,0,0])
        self.assertEqual([call.args[0] for call in backoff.call_args_list],[2,4])

    def test_new_snapshot_refresh_is_not_silently_permitted(self):
        self.seed()
        with self.assertRaises(ValueError):
            start(self.store,'new-snapshot',{**MANIFEST,'date':'2026-10-31'},10)

    def test_identity_projection_does_not_fetch_wide_metadata(self):
        description='z'*262100
        values=[(f'/works/OL{index}W','Synthetic title','synthetic title',description,'fixture','fingerprint')
                for index in range(1,33)]
        self.assertGreater(32*len(description.encode()),8_000_000)
        self.store.transaction(bulk('INSERT INTO works',
            ('source_id','title','title_key','description','snapshot','fingerprint'),values))
        found=selected(self.store,'works',[row[0] for row in values])
        self.assertEqual(len(found),32)
        self.assertLess(len(json.dumps(found).encode()),20000)
        self.assertEqual(set(next(iter(found.values()))),{'id','source_id','fingerprint','source_revision','deleted'})

    def test_identity_projection_table_names_are_allowlisted(self):
        with self.assertRaises(ValueError):
            selected(self.store,'works; DROP TABLE works',['/works/OL1W'])

    def test_older_work_revision_cannot_replace_authors(self):
        consume(self.store,self.run,rows([{**work(),'revision':3}]))
        consume(self.store,self.run,rows([{**work(author=2),'revision':2}],offset=1))
        self.assertEqual(self.store.run('SELECT author_id FROM work_authors'),[{'author_id':'/authors/OL1A'}])

    def test_edition_expansion_attaches_new_selected_work(self):
        consume(self.store,self.run,rows([work()]))
        edition={'key':'/books/OL1M','number_of_pages':100,
                 'works':[{'key':'/works/OL1W'},{'key':'/works/OL2W'}]}
        statements,_=phase_statements(self.store,'editions',[edition],'2026-09-30',0)
        self.store.transaction(statements)
        consume(self.store,self.run,rows([work(2)],offset=1))
        statements,_=phase_statements(self.store,'editions',[edition],'2026-09-30',0)
        self.store.transaction(statements)
        self.assertEqual(self.store.run('SELECT count(*) n FROM edition_works')[0]['n'],2)

    def test_unusable_edition_deactivates_stale_isbn(self):
        self.seed()
        record={'key':'/books/OL1M','works':[{'key':'/works/OL1W'}]}
        statements,_=phase_statements(self.store,'editions',[record],'2026-10-31',0)
        self.store.transaction(statements)
        self.assertEqual(self.store.run('SELECT active FROM editions'),[{'active':0}])
        self.assertEqual(by_isbn(self.store,'0306406152'),[])

    def test_isolated_v1_schema_upgrade_preserves_rows(self):
        legacy=Store(sqlite_path=':memory:')
        try:
            legacy.connection.executescript("""
                CREATE TABLE catalogue_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                INSERT INTO catalogue_meta VALUES('schema_version','1');
                CREATE TABLE authors(source_id TEXT PRIMARY KEY,name TEXT,name_key TEXT,snapshot TEXT NOT NULL,
                    source_revision INTEGER,fingerprint TEXT);
                INSERT INTO authors VALUES('/authors/OL1A','Synthetic legacy','synthetic legacy','fixture',1,'fingerprint');
                CREATE TABLE editions(source_id TEXT PRIMARY KEY,title TEXT,page_count INTEGER,cover_id INTEGER,
                    languages TEXT NOT NULL,publication_date TEXT,publishers TEXT NOT NULL,physical_format TEXT,
                    snapshot TEXT NOT NULL,source_revision INTEGER,fingerprint TEXT NOT NULL);
                INSERT INTO editions VALUES('/books/OL1M','Synthetic legacy edition',100,NULL,'[]',NULL,'[]',NULL,'fixture',1,'fingerprint');
            """)
            legacy.initialize()
            legacy.initialize()
            self.assertEqual(legacy.run('SELECT name,source_modified FROM authors'),
                             [{'name':'Synthetic legacy','source_modified':None}])
            self.assertEqual(legacy.run('SELECT title,active FROM editions'),
                             [{'title':'Synthetic legacy edition','active':1}])
        finally:
            legacy.close()


class DumpTests(unittest.TestCase):
    url='https://archive.org/download/ol_dump_2026-09-30/ol_dump_works_2026-09-30.txt.gz'

    def line(self,record=None,revision=1,kind='/type/work'):
        value=record or work(title='星の王子さま')
        return (f'{kind}\t{value["key"]}\t{revision}\t2026-09-30T00:00:00\t'+
                json.dumps(value,ensure_ascii=False)+'\n').encode()

    def stream(self,body,metrics=None,**kwargs):
        class Response:
            def __init__(self): self.raw=io.BytesIO(body)
            def __enter__(self): return self
            def __exit__(self,*args): self.raw.close()
            def raise_for_status(self): pass
        with patch.object(dumps.requests,'get',return_value=Response()):
            yield from dumps.stream_dump(self.url,user_agent='test-fixture@example.invalid',
                expected_size=len(body),expected_md5=kwargs.pop('expected_md5',hashlib.md5(body).hexdigest()),metrics=metrics,**kwargs)

    def test_strict_wrapper_provenance_and_real_byte_counts(self):
        raw=self.line()
        metrics={}
        found=list(self.stream(gzip.compress(raw),metrics))
        self.assertEqual(found[0].record['revision'],1)
        self.assertEqual(found[0].record['_dump_modified'],'2026-09-30T00:00:00')
        self.assertEqual(found[0].byte_size,len(raw))
        self.assertEqual(metrics['decompressed_bytes'],len(raw))
        self.assertTrue(metrics['checksum_verified'])

    def test_invalid_utf8_is_rejected_not_replaced(self):
        raw=self.line().replace('星'.encode(),b'\xff')
        found=list(self.stream(gzip.compress(raw)))
        self.assertIsNone(found[0].record)

    def test_mismatched_key_and_revision_rejected(self):
        with self.assertRaises(ValueError):
            dumps.parse_line(self.line().replace(b'/type/work\t/works/OL1W',b'/type/work\t/works/OL2W'))
        with self.assertRaises(ValueError):
            dumps.parse_line(self.line({**work(),'revision':2},revision=1))

    def test_non_catalogue_and_cross_namespace_types_rejected(self):
        for kind,key in (('/type/user','/works/OL1W'),('/type/work','/authors/OL1A'),
                         ('/type/author','/books/OL1M'),('/type/edition','/works/OL1W')):
            with self.subTest(kind=kind,key=key),self.assertRaises(ValueError):
                dumps.parse_line(self.line({'key':key,'title':'Synthetic'},kind=kind))

    def test_present_json_type_must_be_a_matching_object(self):
        for kind in (None,'/type/work',[],True,{}, {'key':'/type/user'}):
            with self.subTest(kind=kind),self.assertRaises(ValueError):
                dumps.parse_line(self.line({**work(),'type':kind}))

    def test_missing_json_type_uses_validated_outer_catalogue_type(self):
        for kind,key in (('/type/work','/works/OL1W'),('/type/author','/authors/OL1A'),
                         ('/type/edition','/books/OL1M'),('/type/redirect','/works/OL1W'),
                         ('/type/delete','/books/OL1M')):
            value=dumps.parse_line(self.line({'key':key,'title':'Synthetic'},kind=kind))
            self.assertEqual(value['_dump_type'],kind)

    def test_prefix_replay_hashes_complete_source(self):
        raw=self.line()+self.line(work(key=2))
        metrics={}
        found=list(self.stream(gzip.compress(raw),metrics,start_line=1))
        self.assertEqual([row.line_number for row in found],[2])
        self.assertEqual(metrics['scanned_lines'],2)
        self.assertTrue(metrics['checksum_verified'])

    def test_partial_stream_never_claims_checksum(self):
        metrics={}
        iterator=self.stream(gzip.compress(self.line()+self.line(work(key=2))),metrics)
        next(iterator)
        iterator.close()
        self.assertFalse(metrics['checksum_verified'])

    def test_truncated_gzip_fails(self):
        with self.assertRaises((EOFError,OSError)):
            list(self.stream(gzip.compress(self.line())[:-5]))

    def test_wrong_published_checksum_is_not_verified(self):
        metrics={}
        with self.assertRaises(ValueError):
            list(self.stream(gzip.compress(self.line()),metrics,expected_md5='0'*32))
        self.assertFalse(metrics['checksum_verified'])

    def test_byte_bound_drains_oversized_record_without_desync(self):
        first=self.line({**work(),'description':'z'*500})
        second=self.line(work(key=2))
        with patch.object(dumps,'MAX_RECORD_BYTES',300):
            found=list(self.stream(gzip.compress(first+second)))
        self.assertIsNone(found[0].record)
        self.assertEqual(found[1].record['key'],'/works/OL2W')

    def test_changing_or_nonofficial_sources_refused_before_network(self):
        with patch.object(dumps.requests,'get') as network:
            with self.assertRaises(ValueError):
                list(dumps.stream_dump('https://example.invalid/latest.gz',user_agent='fixture',
                                       expected_size=1,expected_md5='0'*32))
            network.assert_not_called()

    def test_local_file_and_production_targets_refused(self):
        for target in ('catalogue.db','postgresql://example.test/db','file:test.db'):
            with self.assertRaises(ValueError):
                Store(sqlite_path=target)
        with self.assertRaises(ValueError):
            Store(url='https://production.example.test',token='synthetic')

    def test_conditional_transaction_never_commits_after_error(self):
        request = transactional_payload([('SELECT 1',()),('SELECT 2',())])
        steps = request['requests'][0]['batch']['steps']
        self.assertEqual(steps[2]['condition'],{'type':'ok','step':1})
        self.assertEqual(steps[3]['stmt']['sql'],'COMMIT')
        self.assertEqual(steps[3]['condition'],{'type':'ok','step':2})
        self.assertEqual(steps[4]['stmt']['sql'],'ROLLBACK')


if __name__ == '__main__':
    unittest.main()
