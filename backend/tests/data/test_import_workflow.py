"""T63: the import workflow hands a continuation the previous segment's artifacts, and fails loudly when it cannot (no database)."""
from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "catalogue-import.yml"


def load():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def step(workflow, name_part):
    steps = workflow["jobs"]["import"]["steps"]
    return next(item for item in steps if name_part in (item.get("name") or ""))


def test_the_restore_steps_read_the_previous_run_and_are_not_allowed_to_fail_silently():
    workflow = load()
    for name in ("Restore the popularity file", "Restore the staging tables from the previous segment"):
        item = step(workflow, name)
        assert item["uses"].startswith("actions/download-artifact@v4")
        assert item.get("continue-on-error") in (None, False), name            # a continuation without its state must stop
        assert item["with"]["github-token"] == "${{ github.token }}"
        assert "steps.previous.outputs" in item["with"]["run-id"]
        assert item["if"] == "${{ steps.source.outputs.run_id != '' }}"
    assert step(workflow, "Load the restored staging tables").get("continue-on-error") in (None, False)


def test_the_job_may_read_artifacts_and_looks_them_up_with_a_clear_error():
    workflow = load()
    assert workflow["jobs"]["import"]["permissions"] == {"contents": "read", "actions": "read"}
    find = step(workflow, "Find the previous segment's artifacts")
    assert find["id"] == "previous" and find["env"]["GH_TOKEN"] == "${{ github.token }}"
    script = find["run"]
    assert "INPUT_SOURCE_RUN_ID" in script and "actions/artifacts?name=" in script       # payload first, then the newest unexpired one
    assert "::error::Cannot continue import run" in script and "exit 1" in script
    assert workflow["jobs"]["import"]["env"]["INPUT_SOURCE_RUN_ID"] == "${{ github.event.client_payload.source_run_id }}"


def test_the_dispatch_for_the_next_segment_carries_this_runs_id():
    workflow = load()
    job = workflow["jobs"]["continue"]
    assert job["env"]["THIS_RUN_ID"] == "${{ github.run_id }}"
    script = job["steps"][0]["run"]
    assert "source_run_id:$source_run_id" in script and '--arg source_run_id "$THIS_RUN_ID"' in script


def test_the_nightly_schedule_is_off_unless_the_variable_is_on_and_adds_5000_by_default():
    workflow = load()
    on = workflow.get("on") or workflow[True]
    assert on["schedule"] == [{"cron": "0 10 * * *"}]
    job = workflow["jobs"]["import"]
    assert job["if"] == "${{ github.event_name != 'schedule' || vars.CATALOGUE_NIGHTLY == 'on' }}"
    assert "catalogue-production" in job["environment"]                           # a schedule has no inputs: production is the default
    add = job["env"]["INPUT_ADD_BOOKS"]
    assert "vars.CATALOGUE_NIGHTLY_ADD_BOOKS" in add and "'5000'" in add         # never falls back to the 150000 total on a schedule


def test_a_scheduled_new_run_has_a_750_guard_and_a_continuation_keeps_its_own():
    workflow = load()
    job = workflow["jobs"]["import"]
    assert job["env"]["INPUT_MAX_DB_MB"] == "${{ github.event_name == 'schedule' && '750' || '800' }}"
    script = step(workflow, "Run or resume the checkpointed import")["run"]
    head, tail = script.split('if [[ -n "$RESUME_ID" ]]; then', 1)
    resume, new = tail.split("else", 1)
    assert "--max-database-mb" not in head and "--max-database-mb" not in resume    # resuming never changes the guard
    assert '--max-database-mb "$INPUT_MAX_DB_MB"' in new
