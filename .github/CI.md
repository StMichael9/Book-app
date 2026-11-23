# CI

Every pull request into `v3` or `main` (and every push to `v3`) runs these checks. Nothing here uses secrets; the database passwords and the secret key are throwaway test values.

| Job (workflow) | What it checks |
|---|---|
| `backend` (CI) | The full backend suite (`pytest -q`) against a throwaway Postgres 16. Two databases are migrated to Alembic head first: the test one and a separate "application" one, because some test modules import the app at collection time. |
| `migration-check` (CI) | Exactly one Alembic head; a fresh database upgrades to head; `alembic check` (models match the migrations); the newest migration downgrades one step and upgrades again. |
| `frontend-lint` (CI) | `npm run lint`. |
| `frontend (1)` to `frontend (4)` (CI) | The mocked-API Playwright suite in Chromium, split into 4 shards. The report and traces upload as an artifact when a shard fails. The live-backend specs and the timing-sensitive speed baseline are not run in CI. |
| `analyze` (CodeQL) | Security analysis of the JavaScript and Python code, on pull requests and weekly. |

Dependabot opens up to 5 weekly update PRs per ecosystem (pip in `backend`, npm in `frontend`, GitHub Actions), into `v3`, with minor and patch updates grouped.

## Rerunning

- In GitHub: open the pull request, click the failed check's *Details*, then *Re-run failed jobs* (or *Re-run all jobs*).
- With the CLI: `gh run list --branch <branch>`, then `gh run rerun <run-id> --failed`.
- A run for the same pull request is cancelled when you push again.

## Running the same checks locally

- Backend: `.\.local-dev\run-backend-tests.ps1 tests/<file>.py` (see `.local-dev/ENVIRONMENT-HANDOFF.md`).
- Frontend: `cd frontend; npm run lint; npx playwright test`.
