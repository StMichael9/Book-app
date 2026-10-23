"""Extract English edition titles for known works from an Open Library editions dump. No network access.

python -m data.extract_title_aliases --editions-dump ol_dump_editions.txt.gz --works-file works.txt --output aliases.jsonl

--works-file has one /works/OL...W key per line, optionally followed by a tab and the work's own title
(titles equal to it are skipped). Output is JSONL: {"work": ..., "title": ..., "language": "eng" | null}.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

from data import clean

MAX_PER_WORK = 3
MAX_TITLE_CHARS = 500


def _read_works(path: Path) -> dict[str, str | None]:
    works: dict[str, str | None] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, _, title = line.partition("\t")
        key = clean.work_key(key.strip())
        if key:
            works[key] = " ".join(title.split()).lower() or None
    return works


def _edition(line: str) -> tuple[str, str, bool] | None:
    """Return (work key, normalised title, english) for a usable dump line, else None."""
    fields = line.rstrip("\n").split("\t")
    if len(fields) < 5:
        return None
    try:
        data = json.loads(fields[-1])
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("title"), str):
        return None
    works = data.get("works")
    key = clean.work_key(works[0].get("key")) if isinstance(works, list) and works and isinstance(works[0], dict) else None
    title = " ".join(data["title"].split())
    if not key or not title or len(title) > MAX_TITLE_CHARS:
        return None
    languages = data.get("languages")
    codes = {item.get("key") for item in languages if isinstance(item, dict)} if isinstance(languages, list) else set()
    if "/languages/eng" in codes:
        return key, title, True
    if not codes and title.isascii():
        return key, title, False
    return None


def extract(editions_dump: Path, works_file: Path):
    works = _read_works(works_file)
    found: dict[str, dict[str, dict]] = {}
    with gzip.open(editions_dump, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            edition = _edition(line)
            if edition is None or edition[0] not in works:
                continue
            key, title, english = edition
            lowered = title.lower()
            if lowered == works[key]:
                continue
            seen = found.setdefault(key, {})
            entry = seen.setdefault(lowered, {"title": title, "english": False, "count": 0})
            entry["count"] += 1
            entry["english"] = entry["english"] or english
    for key in sorted(found):
        # dicts keep first-seen order and sort is stable, so ties go to the earliest edition
        ranked = sorted(found[key].values(), key=lambda item: -item["count"])[:MAX_PER_WORK]
        for item in ranked:
            yield {"work": key, "title": item["title"], "language": "eng" if item["english"] else None}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--editions-dump", type=Path, required=True)
    parser.add_argument("--works-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, help="JSONL file to write; defaults to standard output")
    args = parser.parse_args(argv)
    output = args.output.open("w", encoding="utf-8", newline="\n") if args.output else sys.stdout
    try:
        for row in extract(args.editions_dump, args.works_file):
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    finally:
        if args.output:
            output.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
