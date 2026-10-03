# Bookvane cloud catalogue runner

This repository runs the importer from `StMichael9/Book-app`'s `v2-codex`
branch on GitHub's computers and writes batches directly to Neon. It contains
only runner configuration. The application and importer implementation stay
in Book-app. No catalogue dump files are retained here or on your laptop.

## Resume the existing import

1. Stop any importer running on your laptop. Only one importer may run at a time.
2. Open **Actions → Import Bookvane catalogue → Run workflow**.
3. Leave operation **resume**, and use run ID `ol-20260930-2a5a6ccef5`.
4. Click **Run workflow**. You can close your laptop once the cloud job starts.

Resume reads the saved snapshot, target, weights, storage guard, and checkpoint
from Neon. Snapshot/target/weights form fields are ignored for resume. A missing
run ID fails rather than accidentally starting a new import.

## Start a later import

Choose operation **new**, set the desired total book target (default 50,000),
and select `auto` or a snapshot date. Optional category weights are percentages.
An unfinished existing run must be resolved before creating another run.

The workflow pins the current `v2-codex` commit at manual start. Continuations
reuse that exact commit and the stored run ID, even if the branch later changes.
Before the six-hour runner limit, the importer checkpoints and starts another
job automatically if committed progress was made. Database capacity pauses,
checksum failures, exhausted retries, or a job with no checkpoint progress stop
the run for review. Free runners are not a guarantee of import completion time.

## Configuration

- Repository secret `CATALOGUE_DATABASE_URL`: the **direct**, SSL-enabled Neon
  PostgreSQL connection. Transaction poolers cannot safely hold session locks.
- Repository variable `CATALOGUE_USER_AGENT`: identified importer and contact email.
- Standard GitHub runners in a public repository avoid private-runner minute charges.
- Do not add mandatory environment approval to each continuation if you want
  one manual start. The workflow has no schedule and does not run on code pushes.
- The database must already have the application's migrations. This runner
  never applies migrations or deploys the application.
- The existing run's 400 MiB guard stays in force. Do not override it without
  reviewing real provider capacity and import/table sizes.

## Recover a capacity pause

After measuring storage and verifying the provider allowance, choose **resume**,
enable **restart_paused**, and optionally enter a reviewed **max_database_mb**.
Only a saved capacity pause may change its guard. The importer records the old
and new guard, recounts already committed Book rows, clears the old merge cursor,
and replays selection from the same snapshot. Verified redirect/delete passes
and their persistent alias records are reused rather than rewritten. Automatic
continuations use the newly saved guard without requiring these inputs again.
Never change target, weights, or snapshot to work around a pause.

After the complete works scan, alias bookkeeping is compacted transactionally
to chains needed by existing Books and the retained shortlist. This releases
physical database space before author and edition staging. A wider shortlist or
a capacity replay after compaction restores the pinned alias dumps first.
No Book, Author, tag, Own/Want, or preference rows are removed by this operation.

**Verify cloud importer** runs only generated fixtures against a disposable
PostgreSQL service on GitHub. It does not receive the Neon connection secret.
Passing this check validates cloud execution and importer regression tests;
it does not claim a real 50K import or capacity measurement has completed.
After fixture tests pass, verification dispatches a separate harmless event to
prove the automatic continuation mechanism works with GitHub's workflow token.
That continuation probe has no database credentials and does not start an import.

The source for these runner files is maintained under
`.github/cloud-import-runner/` on Book-app's `v2-codex` branch. Publish `import.yml`
and `verify.yml` under this repository's `.github/workflows/`, and this README
at its root. There is no need to edit Book-app's `main` or `v2` branches.
