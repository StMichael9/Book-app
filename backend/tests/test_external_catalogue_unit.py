"""No application DB, credentials, or network calls in these tests."""
import json
import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.external_catalogue import ExternalCatalogue, CatalogueUnavailable, match_query, public_work


@pytest.mark.parametrize('title,author,expected',[
    ('Harry Potter','','title_key : ("harry"* AND "potter"*)'),
    ('','Jane Austen','authors_key : ("jane"* AND "austen"*)'),
    ('Dune','Herbert','title_key : ("dune"*) AND authors_key : ("herbert"*)'),
    ('" OR * ; --','','title_key : ("or"*)'),
    ('','',''),('💜','',''),('ＦＯＯ','','title_key : ("foo"*)'),
])
def test_query(title,author,expected):
    assert match_query(title,author)==expected


def test_overlong_query():
    with pytest.raises(ValueError):
        match_query('word '*13)


def test_cover_is_fixed_host_and_missing_metadata_not_invented():
    row={'source_id':'/works/OL1W','title':'Book','cover_id':None,'snapshot':'pinned'}
    assert public_work(row)['author'] is None
    assert public_work(row)['cover_image_url'] is None
    row['cover_id']=123
    assert public_work(row)['cover_image_url']=='https://covers.openlibrary.org/b/id/123-M.jpg'
    row['source_id']='https://evil.example'
    with pytest.raises(CatalogueUnavailable):
        public_work(row)


def test_bounded_cache_copies_and_breaker():
    client=ExternalCatalogue()
    with patch.object(client,'_select',return_value=[{'x':1}]) as remote:
        client._query(('a',),'SELECT 1',(),'not-a-secret')[0]['x']=99
        assert client._query(('a',),'SELECT 1',(),'not-a-secret')==[{'x':1}]
        assert remote.call_count==1
        for n in range(300):
            client._query((n,),'SELECT 1',(),'not-a-secret')
        assert len(client.cache)==256
    with patch.object(client,'_select',side_effect=CatalogueUnavailable()) as remote:
        for _ in range(2):
            with pytest.raises(CatalogueUnavailable):
                client._query(('new',),'SELECT 1',(),'not-a-secret')
        assert remote.call_count==1


def test_real_sql_limits_to_indexed_ready_subset_and_aliases():
    db=sqlite3.connect(':memory:')
    db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE works(id INTEGER PRIMARY KEY, source_id TEXT,title TEXT,title_key TEXT,authors_key TEXT,cover_id INTEGER,snapshot TEXT,deleted INTEGER DEFAULT 0);
      CREATE TABLE authors(source_id TEXT,name TEXT); CREATE TABLE work_authors(work_id INTEGER,author_id TEXT);
      CREATE TABLE source_aliases(source_id TEXT,canonical_source_id TEXT);
      CREATE VIRTUAL TABLE works_search USING fts5(title_key,authors_key,content='works',content_rowid='id');''')
    for n in (1,2,3,100001):
        db.execute('INSERT INTO works VALUES(?,?,?,?,?,?,?,?)',(n,f'/works/OL{n}W','Dune','dune','herbert',123,'pinned',int(n==3)))
        if n!=2: db.execute("INSERT INTO works_search(rowid,title_key,authors_key) VALUES(?,'dune','herbert')",(n,))
    db.execute("INSERT INTO source_aliases VALUES('/works/OL9W','/works/OL1W')")
    client=ExternalCatalogue()
    client._select=lambda sql,params,token: [dict(row) for row in db.execute(sql,params)]
    assert [x['source_id'] for x in client.search('Dune','','test')]==['/works/OL1W']
    assert client.work('/works/OL9W','test')['source_id']=='/works/OL1W'
    assert client.work('/works/OL2W','test') is None
    assert client.work('/works/OL3W','test') is None
    assert client.work('/works/OL100001W','test') is None
    assert client.work('bad','test') is None
    assert client.search('💜','','test')==[]
    db.close()
