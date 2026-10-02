"""Resolve one immutable Open Library dump item and stream verified gzip TSVs.

Discovery reads Internet Archive metadata only. Catalogue bodies are never saved
locally; the compressed bytes are counted and hashed as they are decompressed.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
import time
from dataclasses import dataclass
from typing import Iterator
from urllib.parse import urlparse

import requests

KINDS = ("works", "authors", "editions", "redirects", "deletes")
SEARCH_URL = "https://archive.org/advancedsearch.php"
METADATA_URL = "https://archive.org/metadata/"
MIN_COMPRESSED_BYTES = {
    "works": 100_000_000,
    "authors": 10_000_000,
    "editions": 100_000_000,
    "redirects": 1_000_000,
    "deletes": 1_000_000,
}


@dataclass(frozen=True)
class DumpRow:
    line_number: int
    record: dict | None
    error: str | None = None
    byte_size: int = 0


@dataclass(frozen=True)
class Snapshot:
    identifier: str
    date: str
    files: dict[str, dict]

    def url(self, kind: str) -> str:
        return self.files[kind]["url"]

    def manifest(self) -> dict:
        return {"identifier": self.identifier, "date": self.date, "files": self.files}


def _get_json(url: str, *, params: dict | None, user_agent: str) -> dict:
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, headers={"User-Agent": user_agent}, timeout=(20, 45))
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("Internet Archive returned invalid metadata")
            return result
        except (requests.Timeout, requests.ConnectionError) as exc:
            if attempt == 2:
                raise RuntimeError("Snapshot metadata unavailable after bounded retries") from exc
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if attempt == 2 or status not in (429, 500, 502, 503, 504):
                raise
        time.sleep(min(8, 2 ** attempt))
    raise AssertionError("unreachable")


def _snapshot_from_metadata(identifier: str, metadata: dict) -> Snapshot:
    match = re.fullmatch(r"ol_dump_(\d{4}-\d{2}-\d{2})", identifier)
    if not match or (metadata.get("metadata") or {}).get("identifier") != identifier:
        raise ValueError(f"Missing or mismatched Open Library item {identifier}")
    date = match.group(1)
    entries = metadata.get("files")
    if not isinstance(entries, list):
        raise ValueError(f"Incomplete Open Library item {identifier}: no files")
    files: dict[str, dict] = {}
    for kind in KINDS:
        filename = f"ol_dump_{kind}_{date}.txt.gz"
        matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("name") == filename]
        if len(matches) != 1:
            raise ValueError(f"Incomplete Open Library item {identifier}: {filename}")
        entry = matches[0]
        try:
            size = int(entry["size"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid size for {filename}") from exc
        md5 = entry.get("md5")
        if size < MIN_COMPRESSED_BYTES[kind] or not isinstance(md5, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", md5):
            raise ValueError(f"Incomplete or implausible Open Library dump {filename}")
        files[kind] = {
            "url": f"https://archive.org/download/{identifier}/{filename}",
            "size": size,
            "md5": md5.lower(),
        }
    return Snapshot(identifier, date, files)


def resolve_snapshot(requested: str, *, user_agent: str) -> Snapshot:
    """Select the newest complete dated item, or inspect one explicit date.

    The archive collection is searched rather than guessing that every month
    exists. An explicit date fails closed instead of choosing another month.
    """
    if requested != "auto" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", requested):
        raise ValueError("Snapshot must be 'auto' or YYYY-MM-DD")
    if requested == "auto":
        listing = _get_json(SEARCH_URL, params={
            "q": "collection:ol_exports AND identifier:ol_dump_*",
            "fl[]": "identifier", "sort[]": "identifier desc", "rows": 24,
            "page": 1, "output": "json",
        }, user_agent=user_agent)
        docs = (listing.get("response") or {}).get("docs") or []
        identifiers = [item.get("identifier") for item in docs if isinstance(item, dict)]
    else:
        identifiers = [f"ol_dump_{requested}"]
    failures = []
    for identifier in identifiers:
        if not isinstance(identifier, str) or not re.fullmatch(r"ol_dump_\d{4}-\d{2}-\d{2}", identifier):
            continue
        metadata = _get_json(METADATA_URL + identifier, params=None, user_agent=user_agent)
        try:
            return _snapshot_from_metadata(identifier, metadata)
        except ValueError as exc:
            failures.append(str(exc))
    raise ValueError("No complete, consistent Open Library snapshot found: " + "; ".join(failures[:4]))


class _HashingReader:
    """Pass through compressed bytes without buffering the complete response."""

    def __init__(self, raw):
        self.raw = raw
        self.digest = hashlib.md5()  # Internet Archive's published file integrity hash.
        self.count = 0

    def read(self, size=-1):
        chunk = self.raw.read(size)
        if chunk:
            self.digest.update(chunk)
            self.count += len(chunk)
        return chunk


def stream_dump(
    url: str, *, start_line: int = 0, user_agent: str, timeout: int = 120,
    expected_size: int | None = None, expected_md5: str | None = None,
) -> Iterator[DumpRow]:
    """Decode a pinned TSV gzip stream and verify compressed bytes at EOF.

    On checkpoint resume, the gzip prefix is re-read as before. The same bytes
    are hashed during that normal read; there is no extra verification fetch.
    A partial pass cannot claim checksum verification.
    """
    parsed = urlparse(url)
    if (parsed.scheme != "https" or "latest" in url.casefold()
            or parsed.hostname not in ("openlibrary.org", "archive.org")
            and not (parsed.hostname or "").endswith(".archive.org")):
        raise ValueError("Use a pinned HTTPS dump URL, never a changing 'latest' URL")
    with requests.get(url, headers={"User-Agent": user_agent}, stream=True, timeout=(20, timeout)) as response:
        response.raise_for_status()
        response.raw.decode_content = False
        reader = _HashingReader(response.raw)
        with gzip.GzipFile(fileobj=reader) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", errors="replace") as lines:
                number = 0
                while True:
                    line = lines.readline(4_000_001)
                    if not line:
                        break
                    number += 1
                    if len(line) > 4_000_000 and not line.endswith("\n"):
                        while line and not line.endswith("\n"):
                            line = lines.readline(4_000_001)
                        if number > start_line:
                            yield DumpRow(number, None, "record exceeds four million characters", 4_000_001)
                        continue
                    if number <= start_line:
                        continue
                    try:
                        fields = line.rstrip("\n").split("\t", 4)
                        if len(fields) != 5:
                            raise ValueError("expected five TSV fields")
                        record = json.loads(fields[4])
                        if not isinstance(record, dict):
                            raise ValueError("JSON record is not an object")
                        yield DumpRow(number, record, byte_size=len(line))
                    except ValueError as exc:
                        yield DumpRow(number, None, str(exc)[:200], len(line))
        # A gzip member can end before the HTTP body. Include any trailing bytes
        # in the published-file checksum rather than silently accepting them.
        while reader.read(1_048_576):
            pass
        if expected_size is not None and reader.count != expected_size:
            raise ValueError(f"Compressed dump size mismatch: expected {expected_size}, got {reader.count}")
        if expected_md5 is not None and reader.digest.hexdigest() != expected_md5.lower():
            raise ValueError("Compressed dump checksum mismatch; phase remains incomplete")
