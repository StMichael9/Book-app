"""SQLite test adapter and documented libSQL HTTP protocol; no local replica.

    Remote writes use one conditional transactional batch per request. A failed
    step cannot be followed by a successful partial COMMIT. Ambiguous network
    outcomes are surfaced to the checkpoint caller, never blindly retried here.
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class CatalogueError(RuntimeError):
    pass


class RejectRedirects(HTTPRedirectHandler):
    """The approved fixed database endpoint must never forward its Bearer token."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def encoded(value):
    if value is None:
        return {'type': 'null'}
    if isinstance(value, bool) or isinstance(value, int):
        return {'type': 'integer', 'value': str(int(value))}
    if isinstance(value, float):
        return {'type': 'float', 'value': value}
    if isinstance(value, str):
        return {'type': 'text', 'value': value}
    raise ValueError('Unsupported SQL parameter type')


def statement(sql, params=()):
    return {'sql': sql, 'args': [encoded(value) for value in params], 'want_rows': True}


def transactional_payload(statements):
    steps = [{'stmt': statement('BEGIN IMMEDIATE')}]
    for sql, args in statements:
        steps.append({'condition': {'type': 'ok', 'step': len(steps)-1}, 'stmt': statement(sql, args)})
    commit = len(steps)
    steps.append({'condition': {'type': 'ok', 'step': commit-1}, 'stmt': statement('COMMIT')})
    steps.append({'condition': {'type': 'and', 'conds': [
        {'type': 'ok', 'step': 0}, {'type': 'not', 'cond': {'type': 'ok', 'step': commit}}]},
        'stmt': statement('ROLLBACK')})
    return {'requests': [{'type': 'batch', 'batch': {'steps': steps}}, {'type': 'close'}]}


def payload_bytes(statements):
    payload=transactional_payload(statements)
    payload['requests'].insert(0,{'type':'execute','stmt':statement('PRAGMA foreign_keys=ON')})
    return len(json.dumps(payload,separators=(',',':')).encode())


class Store:
    def __init__(self, *, sqlite_path=None, url=None, token=None, timeout=40):
        if bool(sqlite_path) == bool(url):
            raise ValueError('Choose exactly one explicit catalogue target')
        self.connection = None
        self.url = None
        self.token = token
        self.timeout = timeout
        self.rows_read = self.rows_written = 0
        self.opener = None
        self.before_request = None
        if sqlite_path:
            if sqlite_path != ':memory:':
                raise ValueError('Local catalogue storage is test-only and in-memory; use the remote target for imports')
            self.connection = sqlite3.connect(':memory:')
            self.connection.row_factory = sqlite3.Row
            self.connection.execute('PRAGMA foreign_keys=ON')
        else:
            parsed = urlsplit(url)
            if (parsed.scheme not in ('libsql', 'https') or parsed.username or parsed.password
                    or parsed.path not in ('', '/') or parsed.query or parsed.fragment
                    or parsed.hostname != 'bookvane-catalogue-poc-stmichael9.aws-us-west-2.turso.io'
                    or parsed.port is not None or not token):
                raise ValueError('Only the dedicated approved Turso catalogue target is permitted')
            self.url = 'https://' + parsed.hostname + '/v2/pipeline'
            self.opener = build_opener(RejectRedirects())

    def close(self):
        if self.connection:
            self.connection.close()

    def _http(self, payload):
        if self.before_request:
            self.before_request()
        # Each HTTP pipeline opens a fresh connection. Enable constraints before
        # BEGIN, not inside a transaction (where SQLite ignores this PRAGMA).
        requests = [{'type': 'execute', 'stmt': statement('PRAGMA foreign_keys=ON')}, *payload['requests']]
        payload = {'requests': requests}
        body = json.dumps(payload, separators=(',', ':')).encode()
        if len(body) > 1_500_000:
            raise CatalogueError('Batch exceeds the bounded 1.5 MB request cap')
        request = Request(self.url, data=body, headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise CatalogueError('Catalogue response exceeded bounded response size')
            result = json.loads(raw)
        except HTTPError as exc:
            raise CatalogueError(f'Remote HTTP {exc.code}; reconcile the saved checkpoint before retrying') from None
        except URLError as exc:
            raise CatalogueError(f'Remote connection failed ({type(exc.reason).__name__}); reconcile the saved checkpoint') from None
        except (TimeoutError, OSError, ValueError) as exc:
            raise CatalogueError(f'Remote request failed ({type(exc).__name__}); reconcile the saved checkpoint') from None
        envelopes = result.get('results') if isinstance(result, dict) else None
        if not isinstance(envelopes, list) or len(envelopes) != len(requests):
            raise CatalogueError('Incomplete remote response; resume and reconcile the checkpoint')
        # Include all returned statement statistics, even setup/failed transactions.
        # They remain supplementary to the account-wide provider meter.
        for envelope in envelopes:
            response = envelope.get('response', {})
            if response.get('type') == 'batch':
                statistics = response.get('result', {}).get('step_results', [])
            else:
                statistics = [response.get('result')]
            for item in statistics:
                if isinstance(item, dict):
                    self.rows_read += item.get('rows_read', 0)
                    self.rows_written += item.get('rows_written', 0)
        outputs = []
        for index, envelope in enumerate(envelopes):
            if envelope.get('type') != 'ok':
                raise CatalogueError('Remote SQL operation failed; no credentials or raw query logged')
            response = envelope.get('response', {})
            if response.get('type') != requests[index]['type']:
                raise CatalogueError('Unexpected remote SQL response type')
            if index == 0:  # Connection setup is not a caller SQL result.
                continue
            if response.get('type') == 'batch':
                batch = response.get('result', {})
                results = batch.get('step_results', [])
                expected = len(requests[index]['batch']['steps'])
                if not isinstance(results, list) or len(results) != expected:
                    raise CatalogueError('Incomplete transaction response; reconcile the checkpoint')
                if any(batch.get('step_errors', [])):
                    raise CatalogueError('Catalogue transaction rolled back or failed; inspect the saved checkpoint')
                if not results or results[-2] is None:
                    raise CatalogueError('Transaction COMMIT was not acknowledged')
                outputs.extend(item for item in results[1:-2] if item is not None)
            elif response.get('type') == 'execute':
                outputs.append(response['result'])
        decoded = []
        for item in outputs:
            names = [column['name'] for column in item.get('cols', [])]
            rows = []
            for cells in item.get('rows', []):
                values = []
                for cell in cells:
                    kind, value = cell['type'], cell.get('value')
                    values.append(None if kind == 'null' else int(value) if kind == 'integer' else value)
                rows.append(dict(zip(names, values)))
            decoded.append(rows)
        return decoded

    def run(self, sql, params=()):
        if self.connection:
            return [dict(row) for row in self.connection.execute(sql, params)]
        result = self._http({'requests': [{'type': 'execute', 'stmt': statement(sql, params)}, {'type': 'close'}]})
        if len(result) != 1:
            raise CatalogueError('Unexpected response to catalogue query')
        return result[0]

    def transaction(self, statements):
        if not statements:
            return []
        if self.connection:
            try:
                self.connection.execute('BEGIN IMMEDIATE')
                result = [[dict(row) for row in self.connection.execute(sql, args)] for sql, args in statements]
                self.connection.commit()
                return result
            except Exception:
                self.connection.rollback()
                raise
        return self._http(transactional_payload(statements))

    def initialize(self):
        exists=self.run("SELECT name FROM sqlite_master WHERE type='table' AND name='catalogue_meta'")
        if exists:
            version=self.run("SELECT value FROM catalogue_meta WHERE key='schema_version'")
            if version==[{'value':'1'}]:
                self.transaction([
                    ('ALTER TABLE authors ADD COLUMN source_modified TEXT',()),
                    ('ALTER TABLE editions ADD COLUMN source_modified TEXT',()),
                    ('ALTER TABLE editions ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1))',()),
                    ("UPDATE catalogue_meta SET value='2' WHERE key='schema_version'",()),
                ])
            elif version!=[{'value':'2'}]:
                raise CatalogueError('Unsupported catalogue schema')
        source = Path(__file__).with_name('schema.sql').read_text(encoding='utf-8')
        buffer, statements = '', []
        for line in source.splitlines():
            buffer += line + '\n'
            if sqlite3.complete_statement(buffer):
                statements.append((buffer, ()))
                buffer = ''
        if buffer.strip():
            raise CatalogueError('Incomplete catalogue DDL')
        self.transaction(statements)
        if self.run("SELECT value FROM catalogue_meta WHERE key='schema_version'") != [{'value': '2'}]:
            raise CatalogueError('Unsupported catalogue schema')

    def size(self):
        # Includes indexes, FTS shadow tables, and allocated free pages.
        pages = next(iter(self.run('PRAGMA page_count')[0].values()))
        page_size = next(iter(self.run('PRAGMA page_size')[0].values()))
        return pages * page_size


def bulk(sql_prefix, columns, rows, suffix='', batch=50):
    """Bound SQL parameter/request sizes; all chunks remain one transaction."""
    statements = []
    for start in range(0, len(rows), batch):
        chunk = rows[start:start+batch]
        placeholders = ','.join('(' + ','.join('?' for _ in columns) + ')' for _ in chunk)
        statements.append((sql_prefix + '(' + ','.join(columns) + ') VALUES ' + placeholders + ' ' + suffix,
                           tuple(value for row in chunk for value in row)))
    return statements
