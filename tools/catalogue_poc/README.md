# External catalogue proof of concept — isolated, not an app integration

Initial setup evidence, 18 October 2026: schema initialized in the separate
**bookvane-catalogue-poc** Turso/libSQL database, initially with zero entities.
The first cloud sample subsequently committed 1,000 real works. Enrichment and
full source verification were still running at that check; this is not a
completed/indexed sample or a capacity claim. See the saved stage report.
No application files, Neon databases or Render settings were changed. The database
is not exposed to Bookvane users. This is experimental tooling, not a completed
million-book service.

## Boundaries and structure

| File | Responsibility |
|---|---|
| `schema.sql` | Public source identities, works, authors, editions, ISBN associations, aliases, import checkpoints and external-content FTS5 |
| `normalize.py` | Adapts Bookvane's pure validators; no app settings, models or database connections |
| `dumps.py` | Strict UTF-8/byte-bounded TSV wrapper validation, provenance and same-pass compressed checksum verification |
| `storage.py` | Parameterized libSQL HTTP transactions, explicit destination allowlist, remote FK enforcement; in-memory SQLite tests only |
| `ingest.py` | Bounded batches, source-key prefilters, source-owned relationships, transactional checkpoints, delayed search indexing |
| `query.py` | Bounded title/author prefix candidates, exact work ID and validated ISBN lookup; preserves ambiguity |
| `cli.py` | Explicit configuration, cloud-only ingestion gate, pinned-run resume and lookup readiness checks |
| `quota.py` | Approved read-only account meter; Free/overages verification, tenth-percent events and 80% ceiling with reserve |
| `grow.py` | Cloud-only 1K/100K/500K orchestration, shared job deadline and pinned-manifest expansion |
| `remote_smoke.py` | Small, explicitly invoked cloud schema/FK/rollback check; never imports catalogue or app records |
| `tests/` | Synthetic in-memory correctness tests, not capacity evidence |

The existing `backend/data/clean.py` and `backend/data/sources.py` remain unchanged.
Shared text, cover, ISBN, page count, author and edition validators are reused.
The public catalogue's curated genre/required-author gate is deliberately not used:
an external reference catalogue must be broader. Author names are not identities.
No cover image files, private CSVs, accounts or reading data belong here. The
external reader reuses the shared hashing core and resolver, but does not inherit
the application's replacement UTF-8 decoding or discarded TSV provenance.
Schema version 2 adds author/edition modified timestamps and an active-edition
marker. Its isolated version-1 upgrade is transactional and tested with preserved
synthetic metadata. This is not a Neon/application migration.

The transport uses the documented libSQL HTTP/Hrana conditional-batch protocol.
No new SDK dependency or local database replica was introduced. The existing
dump resolver depends on the project's already-used `requests` package.

## Credentials and safety

Only `CATALOGUE_TURSO_URL` and `CATALOGUE_TURSO_TOKEN` are accepted. The exact
approved POC hostname is allowlisted; PostgreSQL/Neon URLs are rejected.
`.secrets.env` is Git-ignored, contains a seven-day database-scoped token, and is
**not loaded automatically**. Do not print it, commit it, copy it into an app
environment, or upload it as an artifact. It expires approximately 25 October;
expiry follows the server's creation time. Replacement requires authorization.

Neither environment-variable runner guards nor local write counters are a
security boundary or proof of organization-wide remaining quota. Before import,
verify actual plan, overages disabled, shared usage and reset date. Successful
statement counters do not necessarily include failed/rolled-back billed writes.
Never raise quotas, enable overages or upgrade a service automatically. On
18 October the official subscription API confirmed Starter, monthly,
**overages=false**; no change was necessary. Usage:93 reads,42 writes,126976 bytes,
one database,zero syncs. The separately approved temporary organization token was
immediately revoked and its local copy removed. Only the database-scoped token
remains; no organization credential is retained or supplied to the runner.

## Developer commands

From repository root, without production environment loading:

```text
python -m unittest tools.catalogue_poc.tests.test_poc -v
```

With the explicitly approved Turso credentials supplied privately:

```text
python -m tools.catalogue_poc.cli init
python -m tools.catalogue_poc.remote_smoke
python -m tools.catalogue_poc.cli status
```

These are not instructions to run a real import locally. `ingest` refuses ordinary
workstation execution. The cloud workflow setup is separately approved; real
ingestion remains gated until sample-entry and account safeguards are verified.

## Approved remote execution setup (sample execution still gated)

The user approved adding a **separate Turso workflow** to the existing public
`StMichael9/bookvane-catalogue-imports` runner repository. Do not change its Neon
workflow or the application's default/release branches. Use a standard free Linux
runner, a reviewed immutable application feature-branch commit, minimal read-only
repository permissions, explicit Turso-only secret injection, single-job
concurrency and no dump artifacts. Test code runs before secrets are injected.
The pure HTTP dependency subset in this directory is pinned to the existing
project's versions, avoiding unversioned installation and unrelated app packages.
The seven-day token is stored as the encrypted `TURSO_CATALOGUE_POC_TOKEN` Actions
secret in that runner repository; its existing Neon secret was not read or changed.

Proposed first stage: up to **1,000 accepted public works**, conservative 100,000
session-write guard and 250,000,000-byte sample storage guard; one bounded runner session
before any continuation decision. A run ID pins the complete dated manifest once.
There is no automatic target growth, automatic spending or app integration.
Later 100K/500K/1M stages require measured fanout/storage/read/write projections
and current organization allowance, including failed writes, indexing and retries.

Important operational limitation: collecting only 1,000 works does not make a full
checksum-verified five-dump run small. Each gzip source must reach EOF; the other
records are discarded. Resume replays the compressed prefix, not a local file.
If a phase cannot reach its checkpoint/EOF within a runner session, stop and review
execution rather than dispatching an endless replay loop. The draft CLI supports
deadline exit 75, but remote orchestration/automatic continuation is **not built**.

## Evidence actually obtained

- Current local synthetic tests: **56/56 passed**, exit 0, 1.125s on the developer's rerun.
  Independent QA passed the original 27 and identified two additional findings:
  redirect credential forwarding and index reset before budget guards. The revised
  client rejects all redirects and index guards precede reset; two negative tests
  now cover these; independent QA passed the corrected29-test candidate. The
  expanded51-test candidate also passed independent QA, which found two bounded
  sample-entry issues. Catalogue type/namespace validation and minimal identity
  projections now address those; the corrected56-test candidate awaits recheck.
  These tests do not establish real-source or cloud matching quality.
- Actual remote engine reports SQLite **3.47.0**. Schema/FTS5 creation succeeded.
- Remote FK enforcement and failed-batch rollback passed. A temporary metadata
  marker did not persist; no synthetic bibliographic rows were committed.
- Remote empty-catalogue allocation: **126,976 bytes** (124 KiB), including schema
  and indexes. Works/authors/editions/import runs all zero. This is not an estimate
  of per-book storage. No title-search latency benchmark is claimed from an empty DB.
- No sample, 100K, 500K or 1M import, catalogue refresh or real-source throughput
  benchmark has run. Independent QA acceptance remains pending.
- Prior cloud verification run39150590125 passed29 tests plus actual Turso
  schema/FK/rollback checks. It did not run the newer51-test candidate or ingest
  books. Earlier evidence is not relabeled as current-candidate evidence.
- Account subscription/usage API verified Starter with overages OFF; details above.

## Known limits before accepting a real catalogue stage

- First-N selection is an operational prefix sample, not representative, popularity
  ranked, balanced or an unbiased test of metadata/edition fanout.
- The isolated adapter now rejects damaged UTF-8, validates wrapper key/type/
  revision consistency, preserves outer revision/modified values and counts actual
  bytes. Wrong hashes, truncation, oversized records and prefix replay are tested.
  Rejection diagnostics are bounded; detailed field-omission quality analysis is
  still part of the real sample review.
- Only work/author/edition types with their matching source namespaces, and
  catalogue-key redirects/deletes, are accepted. A missing JSON type uses the
  validated outer type; a present malformed/mismatched JSON type is rejected.
  Identity queries return IDs, fingerprints and revision/active flags only,
  never full descriptions. A32-wide-description test covers the old8MB response
  failure path without network access.
- Useful edition changes reconcile source-owned relationships; an edition becoming
  unusable is deactivated and its stale ISBN links removed. A later same-snapshot
  expansion attaches new selected-work links without rewriting unchanged metadata.
  Older known revisions cannot replace newer ones. A **new dated snapshot refresh
  is deliberately refused** pending complete disappearance/redirect reconciliation;
  current staging experiments expand the exact same pinned manifest.
- Redirects are retained when either endpoint is selected. Multi-hop chains whose
  intermediate IDs are outside the selected set can be incomplete. Deletes are
  tombstones; they do not delete user data (none exists here) or merge works.
- Oversized multi-record transactions are subdivided with per-sub-batch atomic
  checkpoints; interruption/resume is tested. A single record too large for the
  1.5 MB HTTP cap still fails closed for review rather than being silently dropped.
- Once the target is reached, a bounded source-ID prefilter avoids a database
  query per later work batch while the source continues to EOF/checksum. A10K-row
  test proves no per-batch catalogue lookups for an unrelated source suffix.
  Temporary source-network errors have at most3 attempts with2/4-second backoff;
  database writes are not blindly retried after ambiguous network outcomes.
- Search is token-prefix FTS5, not arbitrary substring, typo correction, semantic
  matching or reliable CJK word segmentation. ISBN collisions remain multiple
  candidates. An automatic-match confidence policy is not part of this experiment.
- An incomplete initial run or refresh is unavailable through the CLI lookup gate.
  There is no last-good-generation serving layer yet. Do not integrate this draft
  into application traffic.
- Full-text rebuild, edition fanout and failed transactions can consume material
  write quota. No upload path is assumed to bypass billing.

## Capacity and future integration

Current published Free allowances: 5 GB storage, 500M rows read/month, 10M rows
written/month. Account overages OFF is verified; fresh shared usage must still be
checked before each larger stage. Neither changing provider terms nor a third
party later changing account settings can be guaranteed by this experiment.
References: [pricing](https://turso.tech/pricing),
[usage accounting](https://docs.turso.tech/help/usage-and-billing),
[libSQL HTTP](https://docs.turso.tech/sdk/http/reference),
[official monthly dumps](https://openlibrary.org/developers/dumps).

There are no defensible measured 500K/1M/multi-million capacity projections yet.
For each completed stage, measure total indexed bytes, accepted unique works,
authors/links/editions/ISBNs, source coverage, account read/write deltas, peak memory,
full-scan/replay duration and realistic cold/warm query plans/latencies. Project
next-stage storage from measured bytes/work and quota from all measured row writes,
with recovery headroom and an explicit uncertainty range. Storage and write quota
are separate gates; a dataset can fit in GB but exhaust monthly writes.

The smallest future private enrichment integration would be a backend-only
read-only catalogue adapter with bounded timeouts/cache and exact-ID/ISBN/FTS
candidates, followed by the user's match confirmation. Persist selected public
metadata and source IDs into existing private-entry provenance without moving
reading/user data into Turso. No such adapter is implemented here.

Later public promotion could reuse work-level source IDs, editions and the existing
Neon upsert/reconciliation foundation. It still needs a separately approved
transaction, collision/legacy matching policy and catalogue-capacity guard; it is
not simply an unrestricted cross-database insert. No app model changes are made.

## Approved 80% guarded continuation (supersedes the initial sample-only gate)

The user authorized continued growth toward500K, tenth-percent alerts and a stop
at80% of Free resources. A separately approved temporary organization API token
is stored only as the encrypted runner secret `TURSO_CATALOGUE_USAGE_TOKEN`.
It has broad organization permissions, but this client permits only GET
subscription/plans/usage and rejects redirects. It must be revoked when importing
stops. The earlier one-off billing token remains revoked. The database token
scope and expiry are unchanged; no app credential or private data is involved.

`CATALOGUE_ACCOUNT_GUARD=required` attaches the guard before remote SQL. Imports
beyond the1K sample require this guard, including resuming a saved larger target.
The live plan must still be zero-cost, monthly, and overages explicitlyfalse.
Missing/expired credentials, incomplete usage, unavailable API or unexpected plan
pause without a write retry. Usage is checked every30seconds and plan every5min,
also before the first request; successful HTTP statement counters cover meter lag
within the job, including returned failed-batch statistics. An80% ceiling applies
to storage, monthly rows read/written and sync allowance, capped at the previously
verified Free allowances even if a plan advertises more. Existing per-batch
allocation/payload reserves remain. A pre-request reserve can stop earlier than80%.

Provider metering is not instantaneous; this is a conservative operational guard,
not a mathematical guarantee about an unseen concurrent account writer or future
provider changes. Paid overages OFF is the provider's independent hard backstop.
No other writer or admin should change this isolated account during ingestion.

Thresholds10..80 emit structured `quota_threshold` log events; missing intermediate
thresholds are not skipped. A `quota_stop`/`quota_stop:true` result is a latched
operational stop for the monitor: do not resume after a reset or increase limits
without user direction. Reporting must distinguish actual provider usage from the
more conservative job high-water estimate. Chat alerts come from the scheduled
monitor, not directly from Python logs, and can arrive after the batch threshold.

The guarded workflow may use one standard public-repo runner for up to330minutes;
the importer has a shared290-minute processing budget. This replaces the20-minute
sample budget, which cannot finish the whole works gzip. No raw files, cache or
artifact retention is introduced. `grow` resumes the existing1K run first, then
100K and finally500K using `--from-run` to inherit the exact stored snapshot URLs,
sizes and hashes; no new snapshot discovery occurs for expansion. It stops on any
failure or pause, never increases the500K goal, and never auto-pays. A later time
continuation must show progress and remain within the same approved guards; quota
stops, repeated non-progress replay and source failures require review.

Stage completion must pass both stored counters/zero shortfall and an actual works
count before growth advances or reports the500K goal reached. Final output includes
the achieved count, not only the configured target. One absolute job deadline
passes through CLI preflight and is checked before SQL/source processing; setup
latency cannot create a fresh budget. Pauses expose `pause_kind` and
`resume_allowed`; only `time` may permit a later continuation. Capacity, quota and
unknown safety pauses stop for review even when a checkpoint was saved.

Run all isolated tests with `python -m unittest discover -s tools/catalogue_poc/tests -v`.
The original56 tests remain part of this command; quota/growth tests are additional.
