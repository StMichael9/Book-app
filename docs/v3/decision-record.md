# V3 decision record and M0 contract

**Integration authorization, October 17, 2026:** Michael explicitly instructed merging M5 and M6 into `v3` now through their milestone PRs. Independent engineering correction checks have completed; M5 PR #16 merged at `79eb1473399d28e524e606c2a9f22fccb8bb2200`, and M6 proceeds through PR #17. Earlier unmerged/keep-draft statements below describe the prior QA freeze and are superseded for development integration only. Current native-export, physical-device and approved hosted-pilot acceptance remain public-release gates. This authorizes no `main` merge, production migration, V3 deployment or public enablement.

**Current authorization, October 16 — M6:** Michael explicitly said “You may proceed with m6.” Non-production release verification, narrowly scoped fixes coordinated with the UI lead, isolated testing coordinated with the test lead, release preparation and a consolidated closeout document are authorized. Fresh native Goodreads/StoryGraph acceptance may be scheduled during M6/manual testing; it is not waived or marked passed. Production migrations, hosted configuration changes, deployment and public enablement still require explicit approval.

M6 branch `codex/v3-m6-release-verification` starts at tested M5 candidate `525df5f962f62338e5e5517a680496882f09a673`, verified identical before edits. This is a **stacked development branch**, not an M5 merge or completion approval: `v3` remains at accepted M4 while M5 format acceptance is pending. Review M6-only changes against that M5 baseline; integrate milestones through normal reviewed PRs only after their respective gates. Do not commit implementation directly to `v3` or `main`, rewrite/delete branches, or bypass repository rules. Earlier authorization entries below are historical.

**Current authorization, October 16:** M4 independently passed and integrated via PR15 at `2d14fd9b0033b9986a4a94999390f797301ac77b`. Michael authorized implementing/testing M5 through attachment `7f51227d-8fb1-4d3b-85ba-0327b2e2dbf5/Pasted text.txt`, with Universal Library Import confined to My Books. Feature branch `codex/v3-m5-library-import` begins at that exact V3 merge. The refinement adds safe generic CSV/TSV and pasted-list adapters to the shared engine and excludes onboarding, catalogue backfill/public writes and unrelated redesign. Native Goodreads/StoryGraph export acceptance remains required; Michael deferred supplying test exports until near the end. Earlier no-M5 wording records prior boundaries. Production deployment/public enablement and M6 remain unauthorized.

Original implementation authorization covered M0/M1. Independent M1 QA subsequently issued GO after 136 backend checks, separate migration/restore and real integration verification. Michael then authorized M2 after that GO and requested feature branches targeting shared `v3`. M1 integrated through PR #12 at `5942faf15643475e1bd40577e49e2794d5d1c5ee`. After independent M2 GO, Michael explicitly authorized its integration and beginning M3. PR #13 merged into `v3` at `25da21d755bb41cae4ed93e738b94efe73d4b661`; M3 starts there on `codex/v3-m3-private-context`. No M4 or production rollout is authorized.

**Subsequent authorization, October 15:** M3 independently passed and integrated through PR14 at `2f0c5b94df57311d423c9a6ed05c0795ef04184e`. Michael then directly instructed “Begin with m4 then.” M4 now proceeds on `codex/v3-m4-next-read`, created at that exact accepted V3 commit. Earlier no-M4 wording above records the prior boundary, not the current authorization. M5 and production deployment/enablement remain unauthorized.

## Baseline and branch

- Working branch: `codex/v3-reading-home`, created from fetched `origin/main` at `100ab702faf8baa17289f93caa36c1bd41c4c34a`.
- The starting tree equals completed V2 (`67b6850bb8f59e97a1a4f595a880de5eae0ed179`). Neither main nor v2-codex is modified.
- V2 migration head: `d9b6e1f2a3c4`. The complete existing chain was executed successfully on a fresh local PostgreSQL 16 database.
- Primary references: [approved V3 architecture](Bookvane_V3_Architecture_and_Implementation_Plan_2026-10-14.md) and [library-import proposal](Bookvane_V3_Library_Import_Architecture_2026-10-14.md), archived alongside this record. This record fixes their implementation contracts; it does not replace the later milestone scope.

## Accepted product decisions

V3 is free: no payment infrastructure, subscriptions or premium tiers. Library importing is mandatory for public V3: Goodreads first, StoryGraph next, then the Bookvane CSV template through the same engine. Imports preserve existing data, preview uncertain matches, process through resumable browser requests, begin at 20 MiB/20,000 rows, stop future work on cancellation, and allow seven days to resume. Source ratings/reviews/labels stay private and separate from native reactions/taxonomy.

Own and Want are independent. Starting reading clears the then-current Want flag without changing ownership. Many different books may be read concurrently; one active/paused attempt per library entry. Reopening is a correction of the same attempt; rereading creates a new attempt. Unknown historical dates remain unknown. Optional save reason is limited to 500 characters; attempt note to 2,000; reactions are loved/liked/not_for_me. Private missing-book entries use title/author, with no cover upload or public catalogue mutation.

Home / Discover / My Books / You is the eventual navigation. Finish → Choose Next is central, always skippable. Next Read begins with the reader's Want books and factual explanations. Preserve the active V2 UI/design/accessibility, public catalogue APIs and authentication. No social system, extensive gamification, B2B scope, paid AI or additional hosted service.

## M1 boundary

Build the additive UserBook/ReadingAttempt schema, safe legacy compatibility, capability gating, independent flags, bounded library queries, visible-book lookup, pilot library UI and regression coverage. Attempt creation/transitions, private-book creation UI, Home, notes editor, export and importing remain M2–M5. M1 lays down their identity/constraint contracts without exposing unfinished flows.

## Fixed technical contracts

- `UserBook.id` remains the personal-entry identity; existing catalogue relationships and timestamps survive backfill.
- Canonical flags: `is_owned`, `is_wanted`; integer `version` starts at 1. Every effective reader mutation increments it. No-op ensure is idempotent. Updates require the expected version.
- Private identity fields and retry UUID/fingerprint are reserved now. Catalogue and private identities are mutually exclusive. Names are never unique private identities.
- Attempt UUIDs are stable retry identities; state/progress/date/note constraints and active uniqueness are established in M1. Edition deletion clears only the reference, preserving the context snapshot.
- Catalogue deletion is restricted while personal entries exist; account/explicit personal-entry deletion can cascade through private history.
- Capability response reports contract 1 and the implemented milestone. Server settings default V3 off; optional UUID allowlist narrows enablement. No paid flag provider. Disabled V3 routes cannot be used just by calling them directly.
- Accounts with richer existing data retain owner-only V3 reads after disabling writes; capabilities report writable=false. Their controls become read-only. This implements the approved recovery behavior without a new activation table. Initial pilot selection is isolated test accounts; real-account enablement belongs to a later explicitly approved deployment.
- Legacy reads project owned first, then want; exclude private/neither-flag records. Legacy writes are rejected for enabled accounts and any richer entry that cannot safely be represented by V2, including after disabling the pilot.
- A small migration compatibility trigger bridges old exclusive-shelf writes during backend rollout, synchronizing flags/projection/version. It does not authorize old binaries as a rollback after V3 reader activity.
- Library pages: 25 default/100 maximum; newest saved first using descending entry ID. Signed cursors bind owner, search/facet, initial upper bound and last ID, avoiding new insertions shifting later pages. Updating a flag does not move a record between ID positions.
- Search is server-side title/author search; facets are All/Want/Own plus history states available in the schema. Facet counts are search-scoped. Response summaries omit descriptions, full history and private notes.
- Lookup accepts at most 50 visible catalogue IDs and returns flags/version/state without notes. Provider storage is bounded and session-scoped; unknown state cannot enable a destructive toggle.
- Owner is derived from existing cookie auth. Other owners' entry IDs return 404. Private responses use no-store. PUT/PATCH preflights retain exact configured origins.
- Lock the parent entry before a write, check version, and commit the command once. Integrity constraints prevent duplicate user/work entries and active attempts.

## Test and recovery strategy

Fresh local cluster: PostgreSQL 16, loopback `127.0.0.1:55433`, non-superuser `bookvane_v3_test`. Dedicated fresh regression, migration and browser test databases have names containing test. No production connection or catalogue download is used. Local trust authentication is restricted to loopback; it is not a production configuration. Test settings are injected only into test processes, not the app's existing environment files.

M0 runs the existing backend suite, frontend build/lint and browser regressions before M1. Initial setup failures are recorded separately from successful corrected executions. M1 reruns those suites plus isolated migration preservation/rollback rehearsal, concurrency/isolation/large-shelf tests and browser pilot/legacy flows. Passing create_all alone is insufficient migration evidence.

Before any future approved production deployment: recheck actual schema head, rehearse against the then-current schema/data shape, verify capacity, create a fresh approved recovery point, and deploy the compatibility-aware backend/frontend with V3 disabled. The October 5 checkpoint is historical, not a backup of later reader activity. Use a direct migration connection, preserve the application's pooled traffic connection, and obtain explicit production authorization.

Before V3 reader writes, feature-off returns to V2. After richer data exists, keep the compatibility-aware backend; disable new features or forward-fix. Never drop attempt/source tables or restore an old database over legitimate new activity as a routine rollback. An actual restore/connection switch requires separate approval and reconciliation, including auth revocation/password state. Rehearse recovery on disposable fixtures; production recovery has not been performed here.

## M0 acceptance evidence

M0 complete: branch/contract fixed; test infrastructure verified; full V2 migration chain reached its head; corrected backend baseline **123 passed** in 318.26 seconds; frontend browser baseline **64 passed** in 2.0 minutes; frontend build succeeded as part of browser setup; lint exited successfully with 13 pre-existing warnings. Read-only production schema inspection confirmed `d9b6e1f2a3c4`, integer Book IDs and zero V3 flag/version columns. Existing recovery branch metadata was inspected; no new cloud branch or restore was performed.

Initial harness attempts did not count as passing tests: the missing Playwright binary prevented browser launch; the test isolation guard rejected setting application/test URLs to the same target. The corrected executions used installed Edge and the fixture's intended TEST_DATABASE_URL setup. M1 may now begin. No production migration or public feature enablement is authorized.
