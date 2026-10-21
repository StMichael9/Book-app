"""Read-only public metadata lookup. No user data or browser credentials leave here."""
import json
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

HOST = 'bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io'
WORK = re.compile(r'^/works/OL[1-9][0-9]*W$')


class CatalogueUnavailable(Exception):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def match_query(title='', author=''):
    clauses = []
    for column, value in (('title_key', title), ('authors_key', author)):
        tokens = re.findall(r'[^\W_]+', unicodedata.normalize('NFKC', value).casefold())
        if len(tokens) > 12:
            raise ValueError('Use a shorter search')
        if tokens:
            clauses.append(column + ' : (' + ' AND '.join('"' + token + '"*' for token in tokens) + ')')
    return ' AND '.join(clauses)


def public_work(row):
    if not WORK.fullmatch(row['source_id']) or not row['title'].strip():
        raise CatalogueUnavailable()
    cover = row.get('cover_id')
    return {'source_id':row['source_id'], 'title':row['title'],
            'author':row.get('author_names') or None,
            'cover_image_url':f'https://covers.openlibrary.org/b/id/{cover}-M.jpg' if isinstance(cover,int) and cover > 0 else None,
            'snapshot':row['snapshot']}


class ExternalCatalogue:
    """Fixed endpoint, SELECT-only queries, 2s timeout, bounded cache and breaker.

    All lookups join the actual indexed subset, never the unfinished 500K stage.
    No retries, replicas, index builds, billing writes, or arbitrary remote SQL.
    """
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = OrderedDict()
        self.failed_until = 0

    def _select(self, sql, params, token):
        args = [{'type':'text', 'value':value} for value in params]
        payload = {'requests':[{'type':'execute', 'stmt':{'sql':sql,'args':args,'want_rows':True}}, {'type':'close'}]}
        request = Request('https://' + HOST + '/v2/pipeline', data=json.dumps(payload).encode(),
            headers={'Authorization':'Bearer ' + token, 'Content-Type':'application/json'})
        try:
            with build_opener(NoRedirects()).open(request, timeout=2) as response:
                raw = response.read(256001)
            if len(raw) > 256000:
                raise CatalogueUnavailable()
            envelopes = json.loads(raw)['results']
            if len(envelopes) != 2 or envelopes[0]['type'] != 'ok':
                raise CatalogueUnavailable()
            result = envelopes[0]['response']['result']
            if result.get('rows_written', 0) or len(result.get('rows', [])) > 31:
                raise CatalogueUnavailable()
            names = [c['name'] for c in result['cols']]
            return [dict(zip(names, [None if cell['type']=='null' else int(cell['value']) if cell['type']=='integer' else cell['value'] for cell in row], strict=True)) for row in result['rows']]
        except (HTTPError, URLError, OSError, ValueError, KeyError, TypeError, IndexError):
            raise CatalogueUnavailable() from None

    def _query(self, key, sql, params, token):
        now = time.monotonic()
        with self.lock:
            if self.failed_until > now:
                raise CatalogueUnavailable()
            found = self.cache.get(key)
            if found and found[0] > now:
                self.cache.move_to_end(key)
                return [dict(item) for item in found[1]]
        try:
            rows = self._select(sql, params, token)
        except CatalogueUnavailable:
            with self.lock:
                self.failed_until = time.monotonic() + 30
            raise
        with self.lock:
            self.cache[key] = (time.monotonic()+60, rows)
            self.cache.move_to_end(key)
            while len(self.cache)>256:
                self.cache.popitem(last=False)
        return [dict(item) for item in rows]

    # Author display uses actual identities, not the normalized FTS search key.
    fields = "w.source_id,w.title,w.cover_id,w.snapshot,(SELECT group_concat(a.name, ', ') FROM work_authors wa JOIN authors a ON a.source_id=wa.author_id WHERE wa.work_id=w.id) AS author_names"

    def search(self, title, author, token):
        query = match_query(title, author)
        if not query:
            return []
        sql = 'SELECT ' + self.fields + ' FROM works_search JOIN works w ON w.id=works_search.rowid JOIN works_search_docsize d ON d.id=w.id WHERE works_search MATCH ? AND w.deleted=0 AND w.id<=100000 AND NOT EXISTS(SELECT 1 FROM source_aliases a WHERE a.source_id=w.source_id) ORDER BY rank,w.id LIMIT 31'
        return [public_work(row) for row in self._query(('search', query),sql,(query,),token)]

    def work(self, source_id, token):
        if not WORK.fullmatch(source_id):
            return None
        # Resolve bounded redirects before enforcing actual indexed membership.
        sql = "WITH RECURSIVE identity(id,depth) AS (SELECT ?,0 UNION ALL SELECT a.canonical_source_id,i.depth+1 FROM source_aliases a JOIN identity i ON a.source_id=i.id WHERE i.depth<8) SELECT " + self.fields + " FROM identity i JOIN works w ON w.source_id=i.id JOIN works_search_docsize d ON d.id=w.id WHERE w.deleted=0 AND w.id<=100000 AND NOT EXISTS(SELECT 1 FROM source_aliases a WHERE a.source_id=w.source_id) LIMIT 1"
        rows = self._query(('work',source_id),sql,(source_id,),token)
        return public_work(rows[0]) if rows else None


catalogue = ExternalCatalogue()
