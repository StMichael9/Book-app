"""Neon compute guard for the nightly import (stdlib only; the workflow runs it before the import job).

    python -m data.compute_guard          # reads NEON_API_KEY, NEON_PROJECT_ID, NEON_COMPUTE_STOP_CUH, GITHUB_EVENT_NAME

Reads `project.compute_time_seconds` (CU-seconds for the current consumption period) from the Neon API and compares it with the
stop line (default 80 CU-h of the free 100). At or above it the import does not start: a ::warning:: is printed and the job output
`proceed` is false. The key is read from the environment and is never printed or logged.

Fail safe: on a SCHEDULED run a missing key, a missing project id, an API error or an unreadable answer all skip the import.
A manual run (or a continuation) in the same situation proceeds, with a warning.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

API = "https://console.neon.tech/api/v2/projects/{project}"
DEFAULT_STOP_CUH = 80.0
TIMEOUT = 20


def parse_compute_seconds(payload) -> float | None:
    """`project.compute_time_seconds` from the API answer, or None when it is absent or not a non-negative number."""
    project = payload.get("project") if isinstance(payload, dict) else None
    value = project.get("compute_time_seconds") if isinstance(project, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return float(value)


def stop_cuh(raw) -> float:
    """The stop line in CU-h from the repository variable: a positive number, else the default 80."""
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_STOP_CUH
    return value if 0 < value <= 1000 else DEFAULT_STOP_CUH


def decide(seconds: float | None, stop: float, *, scheduled: bool, have_key: bool = True, error: str | None = None) -> tuple[bool, str]:
    """(proceed, message). Counts only: no key, no project id, no raw API text ever goes into the message."""
    if not have_key:
        return (not scheduled), "NEON_API_KEY is not set, so the compute guard cannot check usage" + (
            "; a scheduled run is skipped" if scheduled else "; this manual run proceeds")
    if seconds is None:
        reason = error or "the answer had no compute_time_seconds"
        return (not scheduled), f"Could not read Neon compute usage ({reason})" + (
            "; a scheduled run is skipped" if scheduled else "; this run proceeds")
    used = seconds / 3600
    if seconds >= stop * 3600:
        return False, f"Neon compute is at {used:.1f} CU-h, at or above the stop line of {stop:g} CU-h: the import does not start"
    return True, f"Neon compute is at {used:.1f} CU-h, under the stop line of {stop:g} CU-h"


def fetch_compute_seconds(project: str, key: str, opener=urllib.request.urlopen) -> tuple[float | None, str | None]:
    """(seconds, error). The error names the kind of failure only, never the key or the response body."""
    request = urllib.request.Request(API.format(project=project), headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with opener(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, "the Neon API could not be reached"
    except ValueError:
        return None, "the answer was not JSON"
    return parse_compute_seconds(payload), None


def main() -> int:
    scheduled = os.getenv("GITHUB_EVENT_NAME") == "schedule"
    key, project = os.getenv("NEON_API_KEY", ""), os.getenv("NEON_PROJECT_ID", "").strip()
    stop = stop_cuh(os.getenv("NEON_COMPUTE_STOP_CUH"))
    seconds, error = None, None
    if key and project:
        seconds, error = fetch_compute_seconds(project, key)
    elif key:
        error = "NEON_PROJECT_ID is not set"
    proceed, message = decide(seconds, stop, scheduled=scheduled, have_key=bool(key), error=error)
    print(message if proceed and seconds is not None else f"::warning::{message}")
    output = os.getenv("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"proceed={'true' if proceed else 'false'}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
