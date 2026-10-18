# External catalogue proof of concept — isolated, not an app integration

Status, 18 October 2026: schema initialized in the separate **bookvane-catalogue-poc**
Turso/libSQL database. **Zero actual works, authors or editions imported.**
No application files, Neon databases or Render settings were changed. The database
is not exposed to Bookvane users. This is experimental tooling, not a completed
million-book service.

## Boundaries and structure

| File | Responsibility |
|---|---|
| `schema.sql` | Public source identities, works, authors, editions, ISBN associations, aliases, import checkpoints and external-content FTS5 |
| `normalize.py` | Adapts Bookvane's pure validators; no app settings, models or database connections |
| `storage.py` | Parameterized libSQL HTTP transactions, explicit destination allowlist, remote FK enforcement; in-memory SQLite tests only |
| `ingest.py` | Bounded batches, source-key prefilters, source-owned relationships, transactional checkpoints, delayed search indexing |
| `query.py` | Bounded title/author prefix candidates, exact work ID and validated ISBN lookup; preserves ambiguity |
| `cli.py` | Explicit configuration, cloud-only ingestion gate, pinned-run resume and lookup readiness checks |
| `remote_smoke.py` | Small, explicitly invoked cloud schema/FK/rollback check; never imports catalogue or app records |
| `tests/` | Synthetic in-memory correctness tests, not capacity evidence |

The existing `backend/data/clean.py` and `backend/data/sources.py` remain unchanged.
Shared text, cover, ISBN, page count, author and edition validators are reused.
The public catalogue's curated genre/required-author gate is deliberately not used:
an external reference catalogue must be broader. Author names are not identities.
No cover image files, private CSVs, accounts or reading data belong here.

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
Never raise quotas, enable overages or upgrade a service automatically.

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
session-write guard and 4,000,000,000-byte storage guard; one bounded runner session
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

- Local synthetic tests: **29/29 passed**, exit 0, 0.464s on the developer's rerun.
  Independent QA passed the original 27 and identified two additional findings:
  redirect credential forwarding and index reset before budget guards. The revised
  client rejects all redirects and index guards precede reset; two negative tests
  now cover these. Corrected-candidate QA re-verification remains pending.
  These tests do not establish real-source or cloud matching quality.
- Actual remote engine reports SQLite **3.47.0**. Schema/FTS5 creation succeeded.
- Remote FK enforcement and failed-batch rollback passed. A temporary metadata
  marker did not persist; no synthetic bibliographic rows were committed.
- Remote empty-catalogue allocation: **126,976 bytes** (124 KiB), including schema
  and indexes. Works/authors/editions/import runs all zero. This is not an estimate
  of per-book storage. No title-search latency benchmark is claimed from an empty DB.
- No sample, 100K, 500K or 1M import, catalogue refresh or real-source throughput
  benchmark has run. Independent QA acceptance remains pending.
- Account overview observed 57 reads, 40 writes, 126.98 KB storage, one database,
  zero syncs against 500M/10M/5GB/100/3GB allowances. Billing is Free with no payment
  method. Delayed dashboard observations are not proof of overages OFF.

## Known limits before accepting a real catalogue stage

- First-N selection is an operational prefix sample, not representative, popularity
  ranked, balanced or an unbiased test of metadata/edition fanout.
- The shared dump decoder replaces invalid UTF-8, bounds lines in characters and
  discards outer TSV revision/modified fields. Its `byte_size` is not actual UTF-8
  byte accounting. Strict wrapper consistency/provenance checks and per-reason
  omission/source-byte metrics need work before source-integrity acceptance.
- Unchanged editions avoid relationship rewrites. Changed useful editions replace
  source-owned links/ISBNs. A now-unusable edition is not yet reconciled away;
  refresh acceptance, out-of-order revisions and redirect chains need more tests.
- Redirects are retained when either endpoint is selected. Multi-hop chains whose
  intermediate IDs are outside the selected set can be incomplete. Deletes are
  tombstones; they do not delete user data (none exists here) or merge works.
- Raw batch size and HTTP payload are bounded; a batch exceeding the 1.5 MB payload
  cap fails closed. Adaptive subdivision for large description/fanout outliers
  remains to be verified/implemented before unattended large runs.
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
written/month. Actual account usage/overages must be verified independently.
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
