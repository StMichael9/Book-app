"""Extract description, first publish year, page count and cover id for known works from Open Library dumps.

python -m data.extract_catalogue_backfill --works-file works.txt [--works-dump ol_dump_works.txt.gz]
    [--editions-dump ol_dump_editions.txt.gz] --output backfill.jsonl [--aliases-output aliases.jsonl]

No network access: you supply downloaded dumps. --works-file has one /works/OL...W key per line (optionally
followed by a tab and the work's title). Output is JSONL, one row per work that has at least one usable field:
{"work": ..., "description"?, "first_publish_year"?, "page_count"?, "cover_id"?}
--aliases-output writes the title aliases from the same editions pass, so one download serves both tools.
"""
from __future__ import annotations

import argparse
import gzip
import html
import json
import math
import re
import statistics
import sys
import unicodedata
from datetime import date
from pathlib import Path

from data import clean
from data.extract_title_aliases import AliasCollector, _read_works, parse_dump_line

MAX_DESCRIPTION_CHARS = 5000
MIN_YEAR = 1400
MAX_PAGES = 100000
ENGLISH = "/languages/eng"

_TAG = re.compile(r"<[^>]*>")
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_REFERENCE_DEFINITION = re.compile(r"(?m)^[ \t]*\[[^\]]+\]:[ \t]*\S.*$")
_REFERENCE_CITATION = re.compile(r"\(\[[^\]]*\]\[\d*\]\)")
_REFERENCE_LINK = re.compile(r"\[([^\]]+)\]\[\d*\]")
_EMPHASIS = re.compile(r"\*\*|__")


def clean_description(value: object) -> str | None:
    """Plain text from an Open Library description (string or {"value": ...}); markup removed, capped at 5,000 characters."""
    raw = value.get("value") if isinstance(value, dict) else value
    # clean.description() would flatten paragraph breaks, which markup removal and display both need.
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 262144:
        return None
    text = html.unescape(unicodedata.normalize("NFKC", raw).replace("\r\n", "\n").replace("\r", "\n"))
    for pattern, replacement in ((_TAG, ""), (_IMAGE, ""), (_LINK, r"\1"), (_REFERENCE_DEFINITION, ""),
                                 (_REFERENCE_CITATION, ""), (_REFERENCE_LINK, r"\1"), (_EMPHASIS, "")):
        text = pattern.sub(replacement, text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return None
    if len(text) > MAX_DESCRIPTION_CHARS:
        text = text[:MAX_DESCRIPTION_CHARS - 1].rsplit(None, 1)[0].rstrip() + "…"
    return text


def _year(data: dict) -> int | None:
    for field in ("first_publish_year", "first_publish_date"):
        year = clean.year(data.get(field))
        if year is not None:
            return year if MIN_YEAR <= year <= date.today().year else None
    return None


def _work_fields(data: dict) -> dict:
    fields = {}
    description = clean_description(data.get("description"))
    if description:
        fields["description"] = description
    year = _year(data)
    if year:
        fields["first_publish_year"] = year
    return fields


def _edition_fields(data: dict) -> tuple[bool, int | None, int | None]:
    """(english, page count, first usable cover id) of one edition record."""
    languages = data.get("languages")
    english = isinstance(languages, list) and any(isinstance(item, dict) and item.get("key") == ENGLISH for item in languages)
    pages = data.get("number_of_pages")
    pages = pages if isinstance(pages, int) and not isinstance(pages, bool) and 0 < pages <= MAX_PAGES else None
    covers = data.get("covers")
    cover = next((item for item in covers if isinstance(item, int) and not isinstance(item, bool) and item > 0), None) \
        if isinstance(covers, list) else None
    return english, pages, cover


def _edition_work(data: dict) -> str | None:
    works = data.get("works")
    return clean.work_key(works[0].get("key")) if isinstance(works, list) and works and isinstance(works[0], dict) else None


def _lines(path: Path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            yield parse_dump_line(line)


def extract(works_file: Path, *, works_dump: Path | None = None, editions_dump: Path | None = None,
            collector: AliasCollector | None = None):
    """Yield one backfill row per requested work. When a collector is given it sees every edition in the same pass."""
    requested = _read_works(works_file)
    rows: dict[str, dict] = {key: {} for key in requested}
    if works_dump is not None:
        for data in _lines(works_dump):
            key = clean.work_key(data.get("key")) if data else None
            if key in rows:
                rows[key].update(_work_fields(data))
                if isinstance(data.get("title"), str) and requested[key] is None:
                    requested[key] = " ".join(data["title"].split()).lower() or None
    if editions_dump is not None:
        if collector is not None:
            collector.work_titles.update(requested)
        editions: dict[str, list] = {}
        for data in _lines(editions_dump):
            if collector is not None:
                collector.add(data)
            key = _edition_work(data) if data else None
            if key in rows:
                editions.setdefault(key, []).append(_edition_fields(data))
        for key, found in editions.items():
            pool = [pages for english, pages, _ in found if english and pages] or [pages for _, pages, _ in found if pages]
            if pool:
                rows[key]["page_count"] = math.floor(statistics.median(pool) + 0.5)
            cover = next((cover for english, _, cover in found if english and cover), None) or \
                next((cover for _, _, cover in found if cover), None)
            if cover:
                rows[key]["cover_id"] = cover
    for key in sorted(rows):
        if rows[key]:
            yield {"work": key, **rows[key]}


def _write(path: Path | None, rows) -> None:
    output = path.open("w", encoding="utf-8", newline="\n") if path else sys.stdout
    try:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    finally:
        if path:
            output.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--works-file", type=Path, required=True)
    parser.add_argument("--works-dump", type=Path, help="Open Library works dump (.txt.gz): description, first publish year")
    parser.add_argument("--editions-dump", type=Path, help="Open Library editions dump (.txt.gz): page count, cover")
    parser.add_argument("--output", type=Path, help="JSONL file to write; defaults to standard output")
    parser.add_argument("--aliases-output", type=Path, help="Also write title aliases (JSONL) from the same editions pass")
    args = parser.parse_args(argv)
    if not (args.works_dump or args.editions_dump):
        parser.error("give --works-dump, --editions-dump or both")
    if args.aliases_output and not args.editions_dump:
        parser.error("--aliases-output needs --editions-dump")
    collector = AliasCollector({}) if args.aliases_output else None
    rows = list(extract(args.works_file, works_dump=args.works_dump, editions_dump=args.editions_dump, collector=collector))
    _write(args.output, rows)
    if collector is not None:
        _write(args.aliases_output, collector.rows())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
