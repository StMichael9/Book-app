"""The Neon compute guard: parsing, the 80 CU-h threshold, fail-safe rules and the workflow wiring (no network, no key)."""
from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path

import yaml

from data import compute_guard as guard

WORKFLOW = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "catalogue-import.yml"


def test_the_compute_seconds_are_read_from_the_project_and_bad_answers_give_none():
    assert guard.parse_compute_seconds({"project": {"compute_time_seconds": 241721}}) == 241721.0
    assert guard.parse_compute_seconds({"project": {"compute_time_seconds": 0}}) == 0.0
    for bad in (None, [], {}, {"project": {}}, {"project": {"compute_time_seconds": "9"}}, {"project": {"compute_time_seconds": -1}},
                {"project": {"compute_time_seconds": True}}, {"project": []}):
        assert guard.parse_compute_seconds(bad) is None


def test_the_stop_line_comes_from_the_variable_with_80_as_the_default():
    assert guard.stop_cuh(None) == 80.0 and guard.stop_cuh("") == 80.0 and guard.stop_cuh("abc") == 80.0
    assert guard.stop_cuh("70") == 70.0 and guard.stop_cuh(" 75.5 ") == 75.5
    assert guard.stop_cuh("0") == 80.0 and guard.stop_cuh("-5") == 80.0 and guard.stop_cuh("5000") == 80.0


def test_under_the_line_proceeds_and_at_or_above_it_stops():
    line = 80 * 3600
    ok, message = guard.decide(241721, 80, scheduled=True)
    assert ok and "67.1 CU-h" in message
    assert guard.decide(line - 1, 80, scheduled=True)[0] is True
    stopped, message = guard.decide(line, 80, scheduled=True)
    assert stopped is False and "does not start" in message and "80 CU-h" in message
    assert guard.decide(line + 5000, 80, scheduled=False)[0] is False       # a manual run is stopped by the line too
    assert guard.decide(line, 90, scheduled=True)[0] is True                 # a higher stop line from the variable


def test_missing_key_or_unreadable_answer_skips_a_scheduled_run_and_lets_a_manual_one_proceed():
    for scheduled, expected in ((True, False), (False, True)):
        assert guard.decide(None, 80, scheduled=scheduled, have_key=False)[0] is expected
        assert guard.decide(None, 80, scheduled=scheduled, error="HTTP 500")[0] is expected
        assert guard.decide(None, 80, scheduled=scheduled)[0] is expected
    assert "skipped" in guard.decide(None, 80, scheduled=True, have_key=False)[1]
    assert "proceeds" in guard.decide(None, 80, scheduled=False, have_key=False)[1]


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_fetching_never_leaks_the_key_and_names_only_the_kind_of_failure():
    seen = {}

    def good(request, timeout):
        seen["url"], seen["auth"] = request.full_url, request.get_header("Authorization")
        return Reply(json.dumps({"project": {"compute_time_seconds": 100}}).encode())

    assert guard.fetch_compute_seconds("proj-1", "secret-key", good) == (100.0, None)
    assert seen["url"] == "https://console.neon.tech/api/v2/projects/proj-1" and seen["auth"] == "Bearer secret-key"
    failures = {"http": urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b"secret-key echoed")),
                "net": urllib.error.URLError("secret-key host"), "json": None}
    for name, error in failures.items():
        def broken(request, timeout, error=error, name=name):
            if name == "json":
                return Reply(b"<html>secret-key</html>")
            raise error
        seconds, message = guard.fetch_compute_seconds("proj-1", "secret-key", broken)
        assert seconds is None and "secret-key" not in message


def test_main_prints_a_warning_and_writes_the_output_without_the_key(monkeypatch, tmp_path, capsys):
    output = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
    monkeypatch.setenv("NEON_API_KEY", "super-secret")
    monkeypatch.setenv("NEON_PROJECT_ID", "proj-9")
    monkeypatch.delenv("NEON_COMPUTE_STOP_CUH", raising=False)
    monkeypatch.setattr(guard, "fetch_compute_seconds", lambda project, key: (90 * 3600.0, None))
    assert guard.main() == 0
    assert "proceed=false" in output.read_text() and "::warning::" in capsys.readouterr().out
    output.write_text("")
    monkeypatch.setattr(guard, "fetch_compute_seconds", lambda project, key: (10 * 3600.0, None))
    guard.main()
    printed = capsys.readouterr().out
    assert "proceed=true" in output.read_text() and "::warning::" not in printed and "super-secret" not in printed
    monkeypatch.delenv("NEON_API_KEY")
    output.write_text("")
    guard.main()
    assert "proceed=false" in output.read_text() and "super-secret" not in capsys.readouterr().out         # scheduled and no key: skipped
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    output.write_text("")
    guard.main()
    assert "proceed=true" in output.read_text() and "::warning::" in capsys.readouterr().out               # manual and no key: warns, proceeds


def test_the_import_job_waits_for_the_guard_and_never_runs_without_a_true_answer():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    guard_job, job = workflow["jobs"]["guard"], workflow["jobs"]["import"]
    assert job["needs"] == "guard" and "needs.guard.outputs.proceed == " in job["if"]
    assert guard_job["outputs"]["proceed"] == "${{ steps.compute.outputs.proceed }}"
    run = next(step for step in guard_job["steps"] if step.get("id") == "compute")
    assert run["env"]["NEON_API_KEY"] == "${{ secrets.NEON_API_KEY }}" and run["env"]["NEON_PROJECT_ID"] == "${{ vars.NEON_PROJECT_ID }}"
    assert run["env"]["NEON_COMPUTE_STOP_CUH"] == "${{ vars.NEON_COMPUTE_STOP_CUH }}"
    assert "echo" not in run["run"] and "NEON_API_KEY" not in run["run"]          # the key is only in the environment
    assert "vars.CATALOGUE_NIGHTLY" in guard_job["if"]                            # a switched-off nightly never calls Neon
