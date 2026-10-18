"""Strict byte-bounded public dump stream; reuse the shared hashing/resolver core.

Unlike the application's compatibility reader, this external-catalogue adapter
checks the TSV wrapper, preserves its provenance and rejects damaged UTF-8.
No compressed/decompressed catalogue file or complete response is retained.
"""
import gzip
import json
import re
from urllib.parse import urlsplit

import requests
from .normalize import DumpRow, _HashingReader

MAX_RECORD_BYTES = 4_000_000


def parse_line(raw):
    fields = raw.decode('utf-8',errors='strict').rstrip('\r\n').split('\t',4)
    if len(fields) != 5:
        raise ValueError('expected five TSV fields')
    kind,key,revision,modified,body = fields
    if not re.fullmatch(r'/type/[a-z_]+',kind) or not key.startswith(('/works/','/authors/','/books/')):
        raise ValueError('unsupported source wrapper')
    if not re.fullmatch(r'[0-9]{1,18}',revision) or not modified or len(modified)>80:
        raise ValueError('invalid wrapper provenance')
    record = json.loads(body)
    if not isinstance(record,dict) or record.get('key') != key:
        raise ValueError('source wrapper/key mismatch')
    if 'revision' in record and (type(record['revision']) is not int or record['revision'] != int(revision)):
        raise ValueError('source revision mismatch')
    record_type = record.get('type')
    if isinstance(record_type,dict) and record_type.get('key') != kind:
        raise ValueError('source record type mismatch')
    # The outer dump revision/time are authoritative even if absent in JSON.
    record['revision'] = int(revision)
    record['_dump_modified'] = modified
    record['_dump_type'] = kind
    return record


def stream_dump(url, *, start_line=0,user_agent,expected_size,expected_md5,
                progress_callback=None,timeout=120,metrics=None):
    parsed=urlsplit(url)
    if (parsed.scheme!='https' or parsed.username or parsed.password or parsed.port
            or parsed.hostname!='archive.org' or parsed.query or parsed.fragment
            or not re.fullmatch(r'/download/ol_dump_(\d{4}-\d{2}-\d{2})/ol_dump_(works|authors|editions|redirects|deletes)_\1\.txt\.gz',parsed.path)):
        raise ValueError('Only exact pinned official Internet Archive dump URLs are accepted')
    if type(expected_size) is not int or expected_size<1 or not re.fullmatch(r'[a-fA-F0-9]{32}',expected_md5 or ''):
        raise ValueError('Published size and checksum are required')
    measured=metrics if metrics is not None else {}
    measured.update(compressed_bytes=0,decompressed_bytes=0,scanned_lines=0,checksum_verified=False)
    with requests.get(url,headers={'User-Agent':user_agent},stream=True,timeout=(20,timeout)) as response:
        response.raise_for_status()
        response.raw.decode_content=False
        reader=_HashingReader(response.raw)
        try:
            with gzip.GzipFile(fileobj=reader) as lines:
                number=0
                while True:
                    if progress_callback:
                        progress_callback()
                    raw=lines.readline(MAX_RECORD_BYTES+1)
                    if not raw:
                        break
                    number+=1
                    byte_size=len(raw)
                    oversized=len(raw)>MAX_RECORD_BYTES
                    if oversized and not raw.endswith(b'\n'):
                        while raw and not raw.endswith(b'\n'):
                            raw=lines.readline(MAX_RECORD_BYTES+1)
                            byte_size+=len(raw)
                            if progress_callback:
                                progress_callback()
                    measured['decompressed_bytes']+=byte_size
                    measured['scanned_lines']=number
                    measured['compressed_bytes']=reader.count
                    if number<=start_line:
                        continue
                    if oversized:
                        yield DumpRow(number,None,'record exceeds four million UTF-8 bytes',byte_size)
                        continue
                    try:
                        yield DumpRow(number,parse_line(raw),byte_size=byte_size)
                    except (ValueError,UnicodeError):
                        # Never retain raw damaged metadata or unbounded errors.
                        yield DumpRow(number,None,'invalid UTF-8, JSON or source wrapper',byte_size)
            while reader.read(1_048_576):
                if progress_callback:
                    progress_callback()
            if reader.count!=expected_size or reader.digest.hexdigest()!=expected_md5.lower():
                raise ValueError('Compressed dump integrity mismatch; source phase remains incomplete')
            measured['checksum_verified']=True
        finally:
            measured['compressed_bytes']=reader.count
