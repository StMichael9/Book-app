# Editorial personal reading workspace

Implementation candidate, 2026-10-19. Base: `origin/v3` at `b05bd690fe1d118c0c699be324d056bae0cd117f`. Feature: `codex/v3-reading-workspace-editorial`; proposed integration target: `v3`.

Michael approved the editorial workspace composition and then requested that unnecessary/confusing elements be dropped. The supplied image is a hierarchy reference, not an expanded feature/navigation specification. This candidate changes the personal workspace at `/my-books/:entryId`; Home remains the current-reading desk and My Books remains the searchable collection, as accepted before this work.

## Scope and intentional simplification

- Book identity, real catalogue cover or existing dignified fallback, independent Own/Want, synopsis, and actual reading progress are visible in the workspace.
- Update progress is prominent while reading; Resume is prominent while paused. Finish/Stop remain explicit commands. Missing progress says **Not tracking progress**; a recorded zero remains zero. Catalogue page counts never replace the saved reading's copy total.
- One synopsis, four noninteractive subject labels at most, publication year only when supplied, and a secondary catalogue-details link. No main-card ISBN, invented language/first-publication information or metadata editing.
- **My reading memory**, **Reading history** and **Manage this book** are native disclosures. They preserve their open state during workspace refreshes. Existing single-note/reaction and separate save-reason semantics remain. History fetches only after opening; individual private memory fetches only after explicit selection.
- The existing Home / Discover / My Books / You navigation is unchanged. No extra workspace tab row, sidebar, notification control, global search, stats, highlights, activity timeline or new menu destination.
- One optional **Next after this** Want preview. Expanding replaces the preview with the existing choice controls. A committed Finish promotes that same controller into the established Finish → Choose Next flow. No second recommendation module or automatic Start. Collapsing a catalogue exploration restores the default Want preview.
- Reread/reopen, historical records, copy selection and Forget remain available in Manage; no additional primary buttons competing with Finish → Choose Next.
- Existing warm ivory / charcoal, forest/sage/rust and typography tokens are reused. No new dependencies or design framework.

## Files and architecture

| File | Responsibility |
| --- | --- |
| `frontend/src/components/reading/ReadingBookContext.jsx` | Book identity, optional public synopsis/details, truthful reading progress presentation. |
| `frontend/src/styles/ui-v2/reading-workspace.css` | Scoped desktop grid/mobile order; existing tokens only. |
| `frontend/src/components/reading/ReadingPages.jsx` | Workspace composition and lazy history disclosure around existing captured-version forms/commands. Existing Home/Start/private-entry product logic is retained. |
| `frontend/src/components/reading/NextReadSection.jsx` | One shared preview/full/Finish controller; same session, command identity, request and existing server contract. Default Home usage is retained. |
| `frontend/src/api/books.js` | Bounded public book-details cache and in-flight deduplication. Existing list-cache contract unchanged. |

No changes to `frontend/src/main.jsx`, retained legacy `App.jsx`, auth/providers/hooks, backend, schema, imports, dependencies, environment/hosting or production. No external missing-book lookup or catalogue migration is included.

### Request budget and privacy

Cold catalogue workspace: existing private workspace GET + one public `/books/:id` GET + one existing `/me/next-read` request when that capability is enabled. No automatic history, individual memory or per-candidate detail fan-out. Private entries issue no public detail GET.

Successful public detail responses are whitelisted to existing public BookSchema fields, held in memory for 45 seconds, capped at 64 completed records and keyed by API origin/book ID. Concurrent consumers share one promise. Expired/failed/malformed responses refetch; errors never poison retry. Owner flags, entry identity, save reasons and reading notes/history do not enter this cache. Requests retain the client's existing timeout/wake-up policy.

Expanding preview reuses its current request/session/response; it does not make a second identical initial Want request. Explicit filters/source/rotation and library revisions can request fresh choices as before. Current-book exclusion uses the existing bounded exclusion contract. Metadata arrival/failure/retry cannot remount or clear a dirty private editor.

### State safety

Editors remain at a stable sibling position outside workspace loading branches, keyed by record identity rather than changing versions. They keep their captured expected version; successful Own/Want refetches do not silently rebase a draft. Existing failures/conflicts retain values. Route/account departure clears private work through existing guards. No blanket conflict retries, autosave or changes to native reading/authorization semantics.

Finish acknowledgement is independent of suggestions availability. Skip and collapse are guarded during explicit Start. Finish suggestions default back to Want and receive heading focus. Keyboard loading-to-identity focus follows the existing local containment pattern; deliberate focus moved to Back wins. The historical editor identity/focus and native removal dialog remain intact.

The quiet next preview follows secondary sections in DOM as well as phone layout. On Finish, that same keyed direct child moves before secondary tasks without remounting its controller; a request-session assertion verifies continuity. The scoped width override wins over the old narrow workspace rule, and the reading heading/state can wrap when text is enlarged.

Paused actions also use actual DOM ordering: Resume, Finish, Stop, then optional Update progress. No CSS-only reversal sends keyboard users back up the screen.

## Validation and attribution

All executions for this candidate use the isolated cloud checkout and wholly mocked browser API responses; native cache tests replace fetch. No Neon/production, real account, email, import or local database was contacted.

- Focused composition run r1: 5 passed / 4 failed. Four assertions omitted the `Published 2000` prefix from an otherwise correct metadata paragraph; corrected test expectations, not metadata Retry behavior. Evidence retained in `workspace-editorial-focused.log` outside the repository.
- Focused r2: **13/13 Chromium checks passed (2.7 minutes)**. Desktop/tablet/phone at 1440/768/390/320 in both themes; no horizontal overflow; no extra navigation; lazy history; private/no-metadata fallback; detail failure/retry; late metadata + dirty stale editor; truthful missing/zero/copy-specific progress; read-only view; delayed keyboard focus; account departure; preview request reuse/current exclusion/catalogue return; committed Finish/default Want/skip.
- Public cache: **6/6 native checks passed**, direct `node frontend/tests/book-details-cache.test.mjs`. Covers concurrent deduplication, TTL, failed retry, bounded size, public-field whitelist and malformed-response recovery. Earlier `node --test` invocations reported a file-level result only; those are not counted as six checks.
- Lint: passed with 12 existing warnings, no added warning. Production build passed in the focused run. Full-suite final disposition is recorded below when complete.
- Initial broad regression invocation was intentionally interrupted to update legacy test paths for collapsed memory and scope private-note selectors away from the new synopsis. It is not a completed run or a pass. No application behavior was changed for those test updates.
- The next broad invocation was interrupted after 20 passes, one initial landing loading timeout and one interrupted case, to correct a source-review finding: the quiet preview's DOM order did not match its mobile placement. Its trace shows catalogue requests still pending at the existing five-second landing assertion; retain this for unchanged retest, not silent omission.
- Focused r3: 13 passed / 2 failed (3.6 minutes). Keyboard ordering/controller continuity passed; new 200% workspace text overrides exposed horizontal overflow in both themes. The reading-heading row now wraps. A source/capture review also found that the old workspace-width rule won by stylesheet order; the new scoped selector now wins. Expanded checks include actual 1240px desktop width and 404/503 retry focus with deliberately moved versus retained focus.
- Focused r4: **19/19 passed** after the bounded ordering/wrapping/width corrections. This adds both-theme 320px long-title/doubled-workspace-text checks and four 404/503 pointer-retry focus cases. The eight width/theme captures are preserved outside the repo in `bookvane-workspace-implementation-2026-10-19`; these show isolated synthetic fixtures, not a live catalogue/account or a usability-study result.
- The first two-worker broad invocation passed 22 cases (including the previously timed-out landing check unchanged) before interruption for the final paused-action DOM-order correction; two cases were interrupted and 187 did not run. It is not a completed suite. The added paused-order acceptance then **passed 1/1 (17.3 seconds)** with no writes, and lint passed again with the existing warnings.
- Live API/Postgres journey test paths were updated for disclosures and new button labels but **not executed**. Earlier milestone QA remains attributed to its original SHAs; it does not certify this new layout.

## Review and independent QA handoff

This is an isolated UI feature branch and draft-review candidate, not a merge/deployment or release-readiness claim. The lead's latest observable work was in a separate catalogue repository. No mutual file-ownership acknowledgement or independent QA execution hold has been obtained for this candidate; this must be reconciled before integration. Stateful files `ReadingPages.jsx`, `NextReadSection.jsx` and shared `api/books.js` require explicit lead source review. No claim is made that a direct cross-chat message was delivered.

Freeze the published application SHA for independent QA. Do not overlap application edits/builds during that hold. Required review scenarios:

1. Desktop/phone both palettes, long title/author, actual covers and missing covers, 200% zoom/text, native disclosure keyboard behavior, visible focus and fixed bottom-navigation clearance.
2. Reading/paused/new/finished/stopped; saved zero/missing/pages/percent/100%-still-reading; private/copy-specific totals; explicit reread versus reopening; Own preserved and Want cleared on Start.
3. Dirty progress/memory across held metadata/flag/workspace responses, safe conflict/failure and captured identity/version; source and account departure; no late private results/focus in another account.
4. Cold/warm/expired/concurrent public details; zero detail reads for private books; opening/reopening history; no per-card/history request fan-out; preview/full response reuse.
5. Finish acknowledgement, one optional next module, empty/failed/short Want, explicit catalogue exploration, current exclusion, source changes, pending Start/collapse/skip and stale choices.
6. Independent live API/database compatibility only under the founder's existing environment/approval boundaries. Browser mocks are not a backend integration pass.

Physical iPhone Safari, hosted acceptance, current native-export acceptance and other documented public-release gates remain separate/open. This layout does not reopen the previously corrected Safari jump as an unfixed defect, and cloud Chromium is not Safari certification.

## Final candidate results

Application candidate: `285441d30dbb2d16097b534b77927ba858f96eae`, published in draft [PR #20](https://github.com/StMichael9/Book-app/pull/20) targeting `v3`. Later documentation-only commits do not change this application tree.

Completed focused verification: 19/19 composition/state checks at the preceding correction, plus 1/1 final paused-action keyboard check; six cache checks on the unchanged public-cache implementation. Production builds and final-candidate lint pass (12 existing warnings). Eight application fixture captures cover both themes and 320/390/768/1440px.

The final broad invocation at this application SHA was stopped after Michael prioritized immediate availability for local testing with limited usage remaining: **43 passed, 1 failed, 2 interrupted, 166 not run** of 212 selected cases (6.7 minutes, two workers). The failure was the existing 320px multi-route test exceeding its 60-second total budget during `/account` navigation; no overflow assertion failed. Its trace is retained. The promised unchanged serial rerun remains pending; do not silently call this a completed/green regression suite. Earlier interrupted/failing runs remain attributed above.

The candidate is available for Michael's local testing now. Independent QA should retest the exact source, including that responsive case and the remaining suite. Live integration, physical Safari/device, hosted and other public-release gates remain open. No merge/deployment/public GO is claimed. The UI-owned Playwright run/preview were stopped before handoff; no database process was started.
