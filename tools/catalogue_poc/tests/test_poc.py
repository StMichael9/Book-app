"""Synthetic, in-memory contract tests. Not cloud or real-dump capacity evidence."""
import json
import sqlite3
import sys
import time
import unittest
from unittest.mock import patch
from urllib.request import Request

from tools.catalogue_poc import normalize as n
from tools.catalogue_poc.ingest import Paused, build_index, checkpoint, consume, phase_statements, start
from tools.catalogue_poc.query import by_isbn, by_work, search
from tools.catalogue_poc.storage import CatalogueError, RejectRedirects, Store, transactional_payload
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
        self.assertEqual(replay,[])

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
