"""The weekly catalogue health check, run by GitHub Actions against the public API (T49).

    BOOKVANE_API=https://... ADMIN_API_KEY=... python -m data.catalogue_health [--limit N]

1. Searches our own public /books for every benchmark title (the way a reader would) and counts the ones found.
2. Sends the missing ones to the admin-only enqueue route, so the lookup worker fetches them before a reader asks.
3. Reads the catalogue block of /admin/metrics, prints a job summary of COUNTS ONLY (the repository is public: no titles of
   readers, no search text), and emails the support inbox only when a limit in the plan is crossed.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import time
import unicodedata
from pathlib import Path

import requests

BENCHMARK = Path(__file__).resolve().parent / "benchmark_titles.csv"
PAUSE = 2.2                       # the public search allows 30 a minute
LIMITS = {"coverage_min": 90.0, "empty_search_max": 15.0, "import_match_min": 70.0, "database_max_mb": 700.0}


def key(value: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", value or "") if not unicodedata.combining(c)).casefold()
    words = re.findall(r"[a-z0-9]+", text)
    if len(words) > 1 and words[0] in ("the", "a", "an"):
        words = words[1:]
    return " ".join(words)


def surname(name: str) -> str:
    words = re.findall(r"[a-z0-9]+", key(name))
    return words[-1] if words else ""


def overlap(a: str, b: str) -> float:
    x, y = set(key(a).split()), set(key(b).split())
    return len(x & y) / len(x | y) if x | y else 0.0


def found_in(item: dict, items: list[dict]) -> bool:
    """A result with the same title and an author of the same surname; or the first result by that author with a near title
    (the server folds number words, so "1984" meets "Nineteen Eighty-Four" where this plain comparison does not)."""
    want = surname(item["author"])
    for position, book in enumerate(items):
        if not any(surname(author["name"]) == want for author in book.get("authors", [])):
            continue
        if key(book["title"]) == key(item["title"]) or (position == 0 and overlap(book["title"], item["title"]) >= 0.5):
            return True
    return False


def benchmark() -> list[dict]:
    with open(BENCHMARK, encoding="utf-8", newline="") as handle:
        return [row for row in csv.DictReader(handle) if row.get("title") and row.get("author")]


def check(api: str, limit: int | None = None, session=None, pause: float = PAUSE) -> dict:
    session = session or requests.Session()
    items = benchmark()[:limit]
    missing = []
    for item in items:
        for attempt in range(3):
            response = session.get(f"{api}/books", params={"book": item["title"], "size": 5}, timeout=20)
            if response.status_code == 429:
                time.sleep(30)
                continue
            break
        results = response.json().get("items", []) if response.status_code == 200 else []
        if not found_in(item, results):
            missing.append({"title": item["title"], "author": item["author"]})
        time.sleep(pause)
    return {"checked": len(items), "found": len(items) - len(missing), "missing": missing}


def summary(result: dict, queued: dict | None, block: dict | None) -> tuple[str, list[str]]:
    """Counts-only Markdown for the job summary, and the sentences for any limit that was crossed."""
    percent = round(100.0 * result["found"] / result["checked"], 1) if result["checked"] else None
    lines = ["## Catalogue health (weekly)", "", f"- Benchmark: {result['found']} of {result['checked']} found"
             + (f" ({percent}%)" if percent is not None else ""), f"- Sent to the lookup queue: {queued['queued'] if queued else 0}"]
    alerts = []
    if percent is not None and percent < LIMITS["coverage_min"]:
        alerts.append(f"Benchmark coverage is {percent}% (limit {LIMITS['coverage_min']}%).")
    if block:
        searches, imports, books = block["searches"], block["imports"], block["books"]
        lines += [f"- Searches this week: {searches['runs']}, with no result: {searches['empty']}"
                  + (f" ({searches['empty_percent']}%)" if searches["empty_percent"] is not None else ""),
                  f"- Import rows matched: {imports['matched']} of {imports['rows']}"
                  + (f" ({imports['match_percent']}%)" if imports["match_percent"] is not None else ""),
                  f"- Books: {books['total']}; more than 3 authors {books['more_than_3_authors']}; no genre {books['no_genre']}; "
                  f"no cover {books['no_cover']}; low score {books['low_score']}; unscored {books['unscored']}",
                  f"- Lookups: {block['lookups']}", f"- Gate rejections: {block['gate_rejections']}",
                  f"- Database: {block['database_mb']} MB"]
        alerts += [a for a in block.get("alerts", []) if not a.startswith("Benchmark coverage")]
    lines += ["", "Alerts: " + (" ".join(alerts) if alerts else "none")]
    return "\n".join(lines), alerts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    api, admin_key = os.environ["BOOKVANE_API"].rstrip("/"), os.environ["ADMIN_API_KEY"]
    headers = {"X-Admin-Key": admin_key}
    session = requests.Session()
    result = check(api, args.limit, session)
    queued = None
    for start in range(0, len(result["missing"]), 200):
        response = session.post(f"{api}/admin/catalogue/enqueue", json={"items": result["missing"][start:start + 200]},
                                headers=headers, timeout=60)
        response.raise_for_status()
        part = response.json()
        queued = {"queued": (queued["queued"] if queued else 0) + part["queued"]}
    metrics = session.get(f"{api}/admin/metrics", params={"days": 7}, headers=headers, timeout=60)
    block = metrics.json().get("catalogue") if metrics.status_code == 200 else None
    text, alerts = summary(result, queued, block)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    if alerts:
        session.post(f"{api}/admin/catalogue/alert", json={"lines": alerts}, headers=headers, timeout=30).raise_for_status()


if __name__ == "__main__":
    main()
