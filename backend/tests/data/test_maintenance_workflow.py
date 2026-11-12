"""The maintenance workflow opts in to production only for the two data.load tasks (no database needed)."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "catalogue-maintenance.yml"
OPT_IN = "CATALOGUE_IMPORT_PRODUCTION"


def _load():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _branches(script: str) -> dict[str, str]:
    """Split the `case "$TASK" in` script into {task: body}."""
    body = script.split(" in\n", 1)[1].rsplit("esac", 1)[0]
    parts = re.split(r"^\s*([a-z_]+|\*)\)\s*$|^\s*([a-z_]+|\*)\)\s", body, flags=re.M)
    branches, current = {}, None
    for chunk in parts:
        if chunk is None:
            continue
        if re.fullmatch(r"[a-z_]+|\*", chunk.strip()) and chunk.strip() != "":
            current = chunk.strip()
            branches[current] = ""
        elif current:
            branches[current] += chunk
    return branches


def _task_script(workflow) -> str:
    steps = workflow["jobs"]["maintain"]["steps"]
    return next(step["run"] for step in steps if step.get("name") == "Run the task")


def test_the_opt_in_is_not_a_blanket_environment_setting():
    workflow = _load()
    job = workflow["jobs"]["maintain"]
    assert OPT_IN not in (job.get("env") or {})
    assert OPT_IN not in (workflow.get("env") or {})
    for step in job["steps"]:
        assert OPT_IN not in (step.get("env") or {})


def test_only_the_popularity_and_genre_tasks_opt_in_to_production():
    branches = _branches(_task_script(_load()))
    assert {"backfill_popularity", "remap_genres", "clean_dry_run", "clean_apply"} <= set(branches)
    opted_in = {task for task, body in branches.items() if f"{OPT_IN}=yes" in body}
    assert opted_in == {"backfill_popularity", "remap_genres"}
    for task in ("backfill_popularity", "remap_genres"):
        assert re.search(rf"{OPT_IN}=yes python -m data\.load\b", branches[task]), task
    for task in ("clean_dry_run", "clean_apply"):
        assert OPT_IN not in branches[task]


def test_remap_still_defaults_to_a_dry_run():
    inputs = _load()[True]["workflow_dispatch"]["inputs"]  # PyYAML reads the bare key `on` as True
    assert inputs["dry_run"]["default"] is True
    assert inputs["target_env"]["default"] == "catalogue-rehearsal"
    assert '--dry-run' in _task_script(_load())
