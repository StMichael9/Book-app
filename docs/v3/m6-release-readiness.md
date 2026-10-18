# V3 release readiness — M6 implementation, verification and release gates

October 17, 2026. **Local engineering corrections independently accepted; hosted pilot and public-release acceptance remain incomplete.**
This is the consolidated implementation/testing/deferral report Michael requested. The final application candidate is `c5d43d7b56eada0615ab7fb1cc53a9f9711500c0`; subsequent closeout edits are documentation only. All confirmed M6 local preference, theme and focus findings are closed within their tested scope. This is not a guarantee of zero bugs or a public-release certificate. No production database, hosted service, real email or catalogue import was part of M6 verification.

## Branch and ownership

M6 `codex/v3-m6-release-verification` starts exactly at tested M5 `525df5f962f62338e5e5517a680496882f09a673` (runtime `ded5f88`). M5 remains unmerged; M6 is stacked on it to test the complete code without silently accepting its native-format gate. `v3` at branch creation is accepted M4 `2d14fd9b0033b9986a4a94999390f797301ac77b`; `main` is released V2 `100ab702faf8baa17289f93caa36c1bd41c4c34a`. No direct integration-branch implementation commits, force pushes or branch deletion.

[Draft PR #17](https://github.com/StMichael9/Book-app/pull/17) targets `v3` and is stacked on M5 PR #16. It remains draft/unmerged; its cumulative diff includes M5. Review M6-only changes from `525df5f`. Neither PR nor this report authorizes deployment or waives native-export acceptance.

Lead owns source/configuration/recovery preparation. **Coordinate v2 UI/UX work** reviews UI scope and design; **Run Bookvane QA and release testing** independently verifies frozen candidates. Local database/build execution is transferred explicitly, never run concurrently against shared fixtures or `dist`. Michael/consenting volunteers own native-export and physical-device acceptance; Michael approves any hosted rollout.

## Completed foundation and valid inherited evidence

| Area | Implemented foundation | Verified evidence / limits |
|---|---|---|
| V2 | Registration/login/rotating refresh/logout/reset, Own/Want, preferences, discovery/search/sharing | Existing regression evidence plus M5 broad auth/application tests; not a new hosted V3 sign-off |
| M0/M1 | Decision/testing/recovery baseline; additive work-level personal library, ownership/version constraints and compatibility gates | Accepted milestone reports and independent migration/recovery evidence |
| M2 | Reading attempts, concurrent reading, progress, finish/DNF/reread, private fallback and Home | Accepted lifecycle tests and real browser/API/database journeys |
| M3 | Private context, removal controls, owner-only data export and operator-assisted account deletion procedure | Accepted privacy/removal/export tests; public monitored support contact still needed |
| M4 | Shelf-first Home and optional Finish → Choose Next, deterministic guidance | Accepted ranking/integration and browser tests; no paid AI or recommendation service |
| M5 | Previewed/resumable private CSV/TSV/paste imports, local matching, provenance/replay/removal protection, private context and portability | Corrected candidate independently passed 217 backend, 145 client, 21 extra acceptance/safety, 8 real integration and 16 WebKit cases. Counts overlap. All three initial P2 defects closed. Current native-format acceptance remains open |
| Import scale | Generated 50K public catalogue with 1K/10K/20K personal imports and cleanup | One independent full run passed, 1230.16s. 20K import 754.522s; max step 3.722s; logical staging 13.230 MiB; staging/index allocation 47.875 MiB; database allocation 134.247 MiB; immediate Home .011s / library .080s. Local measurements, not Neon/Render capacity promises |
| Real export workaround | Permission-compatible historical 2024 Goodreads export | 323 books / 246 reads / 323 source records; reversed replay unchanged. Not fresh 2026 Goodreads/StoryGraph format coverage |

Primary evidence: milestone documents in this folder and independent reports in the parent workspace's `deliverables/`, especially `Bookvane_V3_M5_Correction_QA_2026-10-16.md` and `Bookvane_M6_QA_Handoff_2026-10-16.md`. Do not relabel inherited tests as executed on a later M6 commit.

## M6 changes and new verification

Implemented on the M6 working candidate:

- **Frontend state/presentation:** canonical Bookvane startup title/theme, retaining valid legacy saved preferences even when persistence is blocked; same-book pending Own/Want writes settle before Start; genuine conflicts keep explicit idempotent retry and use truthful error copy. No automatic conflict overwrite or new navigation destination.
- **Older UI findings:** reset/forgot modes remount independently; recovery preserves only validated return/save context, not arbitrary outer token parameters; departed preference-save responses cannot redirect the active page; loaded book headings retain keyboard intent without stealing focus moved elsewhere; legacy shelf/exclude-owned discovery reacts to completed writes.
- **Test harness/configuration:** reuse the loopback HTTPS server with restricted V3 test role, exact schema-head/fresh-database checks, production security settings and in-memory reset delivery. No app endpoint or test-only route is added to production startup. Added first-paint and regression cases to the ordinary suite, and a separate local HTTPS configuration.
- **Documentation:** corrected V3 branch/migration/release instructions and made pending public gates explicit. No new production service, backend domain model, dependency or migration. No auth algorithm, catalogue importer or user-data schema change.

### Developer verification on October 17

Initial implementation/test-harness candidate: **`b3d2a873d90e5a8bf9ba9b2a38c0627a99bfa8ad`**, based on `525df5f`. The 164-case full client and six WebKit cases ran against that identical application source; the first handoff `483b2ea` changed HTTPS test expectations and documentation only. At that handoff, corrected HTTPS execution was pending; independent QA subsequently completed it below. Later corrective candidates have separately attributed focused results, not another claimed full 164-case run. Environment: Windows, Node 24.12.0 / npm 11.6.2, installed Edge; local PostgreSQL 16.9 for separate HTTPS checks. No production connection or real email was used.

| Check | Actual result / scope |
|---|---|
| Initial M6 full browser regression, `playwright test --reporter=line` | **164 passed, 8.4m.** Standard production build, local intercepted APIs. Covers V2 compatibility, auth/session races, private-data UI, reading lifecycle, next-read, imports/resume, mobile/keyboard and all 19 initial M6 cases. Not a full-suite rerun on the final corrective commit, backend or hosted evidence |
| Earlier targeted M6 checks | 19 passed, 41.7s; included in the later full suite, not additional unique coverage |
| Earlier full M6 run before the final recovery/navigation/focus/filter changes | 156 passed, 6.3m; superseded for current client coverage by the 164-case run |
| Focused changed-component lint | Exit 0, three existing effect/fast-refresh warnings; not a claim that the entire repository is warning-free |
| Whitespace check | `git diff --check` passed; line-ending notices only |
| WebKit phone navigation/keyboard regressions | **6 passed, 26.7s.** Single-tap cover/title navigation and keyboard controls against local intercepted APIs; not physical iPhone acceptance |
| Harness/config syntax | Python harness compilation and Node syntax checks for HTTPS config/test passed |
| Initial local HTTPS/browser/API/PostgreSQL attempts | Two stopped attempts exposed V2-only test assumptions: default `/my-books` instead of V3 `/home`, then legacy-write 404 instead of the deliberate V3 stale-writer 409. Corrected the fixture, not application behavior. Partial cookie/shelf observations were not a complete pass. Subsequent independent full HTTPS results are recorded below |

Before correction, a direct build probe reproduced QA-004: `/forgot-password`, zero email forms, expired heading still present after Send a new link. The repaired invalid/rejected-link cases passed in the initial full client suite. Independent closure followed for QA-002/003/004/006/007/008; QA-005's retry boundary needed the final correction below. QA-001's earlier mobile fix is retained, with physical/hosted acceptance separate.

At the first frozen handoff, root stopped execution for independent QA: no listeners on 5189/5192/5193/8005/8009, zero other PostgreSQL client connections, clean `pg_ctl` shutdown of the exact local test cluster. Neither populated root HTTPS database is a valid fresh QA fixture. QA must use new disposable databases and record the actual tested SHA. No review, CI result, integration or deployment approval is inferred from a handoff.

### Independent first pass and bounded corrections

QA tested frozen `483b2ea` and returned execution after verified cleanup. Report: `deliverables/Bookvane_V3_M6_Independent_QA_2026-10-17.md` in the parent workspace.

- Targeted Edge/WebKit run: **111 passed / 3 failed of 114, 4.4m**. All three failures passed unchanged narrow WebKit reruns. Retain the originals: one synchronous request-count assertion and two sign-in readiness failures with no login request, not evidence of a cross-account leak. Correct the waits, not app semantics or blanket retries.
- Independent residual acceptance: **8 failed**, confirming three issues in both engines: M6-QA-009 late preference acknowledgement does not refresh already loaded discovery (P2); M6-QA-010 failed book-load retry steals deliberately moved focus (P2); M6-QA-011 root/document runtime theme mismatch (P3).
- Real local HTTPS journeys: **2 passed, 39.5s**, covering secure/HttpOnly/Lax cookies, refresh/replay, reset invalidation, rejected origin, persistence/isolation and genuine delayed Want → Start. Pending Want produced zero start writes; after acknowledgement exactly one attempt was created, Own stayed true and Want became false. This completes the corrected harness on `483b2ea`, not actual hosted verification or a later-code pass.
- UI lead reviewed the exact diff and agreed the narrow correction scope: session-guarded provider invalidation separate from page navigation; focus transfer consumed on loading success/error/retry; HTML/canvas theme synchronization using the existing palette. No new API, database model or infrastructure. The subsequent independent correction results are recorded below.

The first developer correction run had **47 passed / 2 failed of 49, 2.6m**. The new 404/503 error-heading checks exposed React reusing the loading/error wrapper before focus transfer; distinct state keys were then added. Failed traces are retained in ignored `.v3-test-runtime/m6-correction-first-attempt`. Theme canvas styles use the existing compiled stylesheet rather than requiring a new inline-style permission. The corrected focused run then had **49 passed, 2.3m**, with error-heading/retry focus, exact computed first-paint/toggled backgrounds, late preference acknowledgement in the same/departed account, original M6 cases, V2/V3 account-switch boundaries and phone/keyboard regressions. Changed-component lint and whitespace checks passed. Independent retesting of this `d8672e4` candidate follows.

Recovery limitation: QA-007 is repaired for **Forgot password → Back to sign in in the same navigation flow**. Delivered reset emails contain a fragment token, not pending book intent; completing that emailed flow returns to ordinary sign-in/Home/My Books. Cross-tab/device restoration of the earlier book action is not implemented or advertised as verified. No reset token is added to navigation context to bridge this limitation.

### Independent correction pass on `d8672e4`

Report: `deliverables/Bookvane_V3_M6_Correction_QA_2026-10-17.md`. **67 passed / 2 failed of 69, 3.8m**. All eight original independent residual cases, six independent first-paint samples and the three earlier WebKit failure boundaries passed. QA closed M6-QA-009 and M6-QA-011 locally. Original focus theft is repaired, but M6-QA-010/QA-005 remained partially open: WebKit pointer Retry leaves focus on MAIN during loading and success; the two stronger acceptance checks failed. Eight separate diagnostic observations passed in 42s but merely established the keyboard/pointer difference; they do not cancel failed acceptance tests.

Two **new genuine local HTTPS cases passed, 35.7s**, on fresh r2 fixtures: rapid Want → Start remained single-attempt/Own-preserving, same-session late preference acknowledgement refreshed discovery, and a late acknowledgement after a real account switch caused zero extra successor-account catalogue reads or preference changes. Original-account subjects persisted, successor preferences stayed empty, and there were zero page errors. The earlier full auth/reset HTTPS evidence remains separately attributed to `483b2ea`; it was not rerun or relabeled. QA verified cleanup and returned execution.

UI lead accepted the narrow explicit Retry-intent direction: record the reader's Retry action, consume it at the next loading mount, then let actual subsequently moved focus determine completion behavior. No backend/scale/HTTPS rerun was required for this isolated focus change; its independent runtime acceptance follows.

Developer implemented the explicit Retry marker and preserved it across error-node removal, while retaining the loading-node completion containment check. Expanded the acceptance matrix to initial 404/503 × keyboard/pointer × successful/failed retry × focus retained/moved. **24 focused Edge cases passed, 1.2m**, including all 16 matrix combinations, two normal delayed-focus cases and six phone/keyboard regressions. Lint and whitespace checks passed.

### Final independent acceptance on `c5d43d7`

Report: `deliverables/Bookvane_V3_M6_Focus_Correction_QA_2026-10-17.md`. **64 passed, zero failures, 3.4m**, in Edge and WebKit:

| Scope | Cases across both engines |
|---|---:|
| 404/503 × pointer/keyboard Retry × success/failure × focus retained/moved | 32 |
| Normal delayed success with focus retained/moved | 4 |
| Phone first-touch and keyboard skip/shelf controls | 12 |
| Original independent retry/moved-focus reproduction, unchanged fixture | 4 |
| Positive pointer/keyboard loading/result-heading focus observations | 8 |
| Leave during pending Retry; late response cannot navigate/refocus departed page | 4 |

QA closed M6-QA-010 / QA-005 within local tested scope. All eight positive observations recorded H1 during loading and H1 at the result, including WebKit pointer Retry. Deliberate Back focus and departure still win. No assertion was weakened, and earlier failures remain in the evidence. UI/UX lead reviewed the exact `d8672e4` → `c5d43d7` source diff and had no source/design objections; that review is distinct from runtime QA.

M6-QA-009 preference invalidation and M6-QA-011 document theme remain closed by the prior independent pass. The final focus-only run did not rerun database, auth/reset HTTPS, import scale or backend suites; relevant unchanged-boundary evidence remains attributed to its original revisions. These results overlap earlier tests and must not be added into a fabricated unique-test total.

QA returned execution explicitly in the written report. Lead verified the final log and cleanup record: no app-source edits, clean tracked/staged worktree, preview exited successfully, local PostgreSQL stopped, zero remaining listeners on 5189/5192/5193/8005/8009/55433. This final run never contacted a database. No confirmed critical defect remains open in the executed local scope; untested hosted/manual boundaries are not declared passed.

## Mandatory before public release — not silently deferred past it

| ID | Required outcome | Owner / acceptance | Status |
|---|---|---|---|
| R1 | Current native Goodreads and StoryGraph export acceptance | Michael/volunteer supplies consented original-format CSV; QA checks preview/result fields, nonempty date lists, rereads, Unicode, repeat/reorder/deletion safety. Unsupported history remains disclosed context, never guessed | Deferred into M6/manual testing; untested |
| R2 | Independent final-candidate UI/security/data-flow verification | Exact-SHA changed-boundary checks, inherited unchanged-boundary evidence and old bug register reconciled | Local verification complete: final focus candidate `c5d43d7`; provider/HTTPS correction `d8672e4`; full auth/reset HTTPS `483b2ea`. Hosted/manual gates remain separate |
| R3 | Approved deployment with matching frontend/backend/schema/flags | Lead + Michael record immutable revisions, API build URL, actual schema and selected pilot allowlist; staged enablement only after explicit approval | Not authorized or executed |
| R4 | Actual intended HTTPS/origin auth behavior | QA + Michael verify hosted login/reload/refresh/logout/reset invalidation, allowed/rejected origins, Secure/HttpOnly/SameSite/domain/path and stale-session isolation. Local HTTPS is supporting evidence, not closure | Pending approved deployment/manual check |
| R5 | Current production recovery point, schema relevance and storage headroom | Lead verifies separately authorized live state; use direct connection for migration/backup, preserve IDs/user data, retain rollback/forward-fix instructions. Reuse unchanged-schema isolated restore evidence where relevant | Live operations not authorized; isolated evidence available |
| R6 | Physical phone and complete reader-loop acceptance | Michael/tester verifies actual iPhone Safari first-tap, deep-link reloads, file selection/resume and import → Home → read → finish → choose next; desktop/keyboard counterpart | Pending manual acceptance |
| R7 | Reachable monitored privacy/account-deletion contact | Michael chooses an inbox/contact page; lead displays approved channel and QA verifies it. No personal address inferred from reset testing; no paid helpdesk required | Deferred by Michael; does not block development/testing. A monitored ordinary inbox suffices before public release; branded domain email is optional |
| R8 | No unresolved critical security, isolation, data-loss or core-flow defect | Lead fixes, QA independently retests any confirmed critical issue; truthful documentation of supported behavior and limits | No confirmed P0/P1 remains open within executed local scope; confirmed M6 local findings closed. Continue checking approved hosted/manual flows; not a guarantee about untested behavior |

## Deferrable limitations — require honest disclosure, not fabricated closure

- Deliberately contradictory 5K/20K cyclic identity graphs hit controlled timeouts without forward progress. Scope/checkpoints remain intact, cancellation succeeds, no personal-library writes occur. Ordinary 20K imports passed. Actionable splitting/rejection guidance may be post-release debt if explicitly accepted; do not describe these graphs as reconciled.
- Same-session pending Want → Start is now sequenced and independently verified against the genuine API: exactly one reading attempt, Own preserved, Want cleared. A real concurrent change from another device can still require explicit version-safe retry; automatic overwrite is intentionally not introduced.
- Same-tab Forgot password → Back preserves validated pending book context. Token-only emailed reset links do not restore prior book intent across tabs/devices; ordinary sign-in remains available. This is a continuity limitation, not evidence of broken reset authentication, and must not be advertised as implemented.
- Physical infrastructure capacity beyond measured targets, richer matching/edition metadata, fully automatic background processing, sync/OAuth, advanced recommendations, challenges and cosmetic redesign are not release prerequisites or authorized new features.
- CSV portability is not a full database backup; private JSON export and operator backup/recovery have different purposes. Operator-assisted account deletion remains the approved model, not an unimplemented self-service promise.

## Failures and verification limits retained

The first independent M5 concurrent full-scale attempt timed out during 10K analysis at the unchanged eight-second database-size statement limit. The fresh full run passed; no root cause or application timeout fix was proven. Earlier developer failed/incomplete attempts remain in M5 progress. Do not raise storage/time limits to obtain a pass. WebKit is not a physical iPhone, mocked API tests are not real backend journeys, and local PostgreSQL measurements are not hosted SLOs.

M6 retained both local HTTPS attempt traces in ignored `.v3-test-runtime` evidence. The first target was `bookvane_v3_m6_tls_browser_test`, the second `bookvane_v3_m6_tls2_browser_test`; neither may be reused as a fresh harness target. A local static-server connection-aborted traceback occurred during second-attempt page navigation; it was not the assertion failure. The local cluster also needed automatic crash recovery after the machine interruption; it reached ready state and the first target was verified empty/migrated before the harness. No data files were deleted, guards weakened or PostgreSQL durability settings changed. Do not infer an application fix or complete HTTPS pass from these fixture corrections.

## Safe rollout/recovery sequence — instructions, not permission to execute

1. Complete native-format/final QA gates and review exact candidate; keep changes on reviewed feature branches. Obtain separate production approval.
2. Record the actual production schema head, recovery point/retention and database/table/index/free-space measurements; never infer them from local fixtures. Rehearse any changed migration on an isolated target first.
3. Keep production V3/import flags off while the approved additive migration and matching compatibility-aware backend/frontend are deployed. Use a direct database URL only in the approved migration/backup session, not a tracked file. No automatic migration is added to web startup.
4. Verify V2 compatibility and hosted HTTPS/cookie/origin behavior, then enable the approved small V3 pilot with `READING_V3_USER_IDS`. `LIBRARY_IMPORT_ENABLED` remains a separate gate; unsupported platform variants are not advertised as verified.
5. Verify the full reader loop and privacy controls; establish monitored feedback/support. Expand only after acceptance, not automatically.
6. If trouble occurs after real V3 writes, pause new V3 writes and retain compatible read access. Do not deploy a destructive V2-only writer, drop retained import/library tables or restore an old database as routine feature rollback. A database restore can lose new reads, password resets and user deletions: require explicit approval and reconcile all subsequent activity/deletions. Prefer a bounded forward fix.

## Engineering closeout and remaining M6 scope

**Local engineering candidate ready for founder/manual QA; complete M6 and public V3 release are not yet finished.** Final independently tested application SHA: `c5d43d7b56eada0615ab7fb1cc53a9f9711500c0`. Later engineering-closeout commits change documentation only. No M6 deployed SHA exists. M5/M6 remain review branches, draft PR #17 remains stacked on #16, and `v3`/`main` were not merged or deployed by this work.

Next required inputs/actions are consented current native exports, physical-phone/full reader-loop acceptance, a monitored contact chosen by Michael, and separately approved matching deployment/recovery/HTTPS verification followed by the documented pilot. Support branding is not a development blocker. Existing minor limitations and optional future features do not justify another unapproved refactor.

No payment infrastructure, paid AI, object storage, worker, production service, new dependency, application schema migration or hosting change was added by M6. No production import, real email or production database test was run. This report records completed implementation and actual evidence without converting local acceptance into deployment permission.
