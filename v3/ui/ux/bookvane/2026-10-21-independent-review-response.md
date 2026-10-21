# V3 independent review — bounded follow-up

Michael supplied the October 21 review of application `915bee78c6b4def6ec7b62d86eda336cfb5018f3`. Its 7.7/10 overall and 6.5/10 My Books ratings are the reviewer's heuristics, not user-study results. This document separates reproduced friction, changes, hypotheses and release limitations. New work remains on `codex/v3-ux-simplification`, draft PR #22; no merge/deployment. Functional/navigation source: `ce4744dae35ed941cab0227c28ae2932488c22b9`. Final reviewable application: `3b6ad22068420b68ea3f1aae636400d2e57d24c4`; its subsequent changes are confined to enlarged-text layout, measured navigation clearance and corresponding tests.

## Observations and response

| Review finding | Evidence and decision |
| --- | --- |
| Mobile library pushes books too far down | Reproduced at 390px with import enabled: first card starts at 629.39px. Removed the redundant eyebrow/description, tightened only collection spacing and aligned the four primary filters without reducing touch targets below 44px. Search and import remain visible. The corrected fixture starts books at 375.39px, a 254px reduction; this is a layout measurement, not a usability or conversion result. |
| My Books resembles Discover | A design hypothesis. Retain the cover grid in this pass. Compare it against a compact-row prototype with readers before replacing the collection layout. No permanent list toggle or experimental preference is added. |
| Filter comprehension | Unvalidated hypothesis. Keep All/Reading/Want/Finished, secondary Own/Paused/Stopped and independent Own/Want semantics. Existing server counts/history inclusion remain authoritative. Do not invent exclusive categories or more explanatory clutter. |
| Large-library navigation | Reproduced a concrete loss of context: a searched/filtered page-two title opens its workspace, but Back to My Books drops query/filter/label/cursor. Retain that route context for title/cover navigation, including older-history pagination, plus explicit known previous-page targets. Previous must not be implemented as an arbitrary browser Back that could return to the workspace. An additional reproduction found paging from the bottom leaves the new page out of view: explicit page commands now focus the existing collection heading and reveal the top immediately. No late response moves focus or scroll. |
| Direct/refreshed later-page Previous | The backend returns signed, owner/query/facet-scoped forward cursors, not a previous cursor. Browser history state normally survives refresh, so state loss is not automatically established by the review. Never decode/manufacture cursors or scan the library. Fresh documents/direct links retain the current query/facet/label and offer Return to first page; Previous is shown only for a known visited page in this session. A universal direct-link Previous requires a separately reviewed pagination contract. |
| Missing covers repeat title/author | Confirmed in current cards. Library fallback artwork now shows the book icon and Cover unavailable; the visible title/author remains below it. The accessible fallback image label retains the book identity. Covers, Discover and metadata remain unchanged. Verify absent and broken images and private entries. |
| Discovery search mechanics | Keep truthful title/author search; unified search remains a separate API/product decision. No provider step or fake unified placeholder. |
| Import complexity | No change to safety, mapping, consent, recovery or cancellation. Target a separate observed-reader session before hiding meaningful decisions. |
| Global polish | Limit this patch to collection controls, pagination wrapping and fallback covers; preserve the accepted identity and prior editor/focus behavior. |

## Navigation and privacy boundaries

The UI retains at most 64 visited library-view metadata records in memory: route/search and a previous-view reference. It retains no book records, notes, reading history or imported rows. Opaque keys enter browser navigation state; actual cached metadata clears when authentication generation/authenticated state changes or the document refreshes. Expired/evicted/missing keys fall back to the normal library or first-page recovery. This is bounded navigation support, not a library cache or persistent preference.

A workspace opened from a library card returns to that collection route. A workspace opened directly or from Home retains the usual My Books destination. Previous navigates to an explicit known collection route; browser Back/Forward remains the browser's actual visit history. This deliberately replaces the old assumption that Previous is synonymous with browser Back. No whole-library fetch or backend/authorization change.

## Comparative reader testing — not executed here

Use two equivalent, synthetic personal collections with mixed known/missing covers, Own+Want overlaps, several current reads, paused/stopped books and rereads. Compare the retained grid against a disposable compact-row prototype; counterbalance presentation order across readers. Suggested tasks:

1. Find a named saved book, open it and return to the same view.
2. Find a paused book and predict which filter contains an owned-and-wanted book.
3. Find a finished book that has since been started again; explain why the visible current state differs from Finished membership.
4. Search within a substantial imported library, move to a later page and recover after a book is removed.

Record unassisted completion, wrong destinations, need for guidance and task time, plus the reader's wording. Compare performance and comprehension rather than visual preference alone. Do not infer a conversion/retention gain or select permanent rows/categories from developer opinion. Import tests should separately observe mapping/uncertainty/consent/resume/cancel comprehension without real private files.

## Verification

These are developer-run reproductions of the supplied independent review, not a new independent QA certification. API traffic uses in-memory browser fixtures; no real backend, database, email, account or catalogue was contacted. Earlier reports retain their original commit attribution.

| Run | Result and scope |
| --- | --- |
| Baseline on `915bee7` | Two failed checks reproduced excessive mobile header height and lost workspace return context. |
| Initial correction r1 | Two passed, 34.8 seconds; development snapshot. |
| Library r2 | 49 passed / 2 failed, 5.9 minutes. A pre-existing V2 request-start wait timed out; it later passed unchanged, specific cause unestablished. The new account-navigation test incorrectly sought a Sign in link after the protected route had already redirected to its form; corrected the test setup without leaving the SPA. |
| Navigation r3 | Two passed / two failed, 1.0 minute. Confirmed footer-position and older-history context gaps, then corrected them. |
| Navigation correction r4 | 20 passed, 2.1 minutes. Includes explicit previous-page destinations, browser history, first-page recovery, session boundaries and all requested widths/themes. |
| Responsive correction r5 | Nine passed, 50.9 seconds. Source subsequently frozen as `ce4744d`; enlarged controls and a synthetic 20,000-entry collection are included. This is not a real import or backend-scale test. |
| Full frozen `ce4744d` suite | **250 passed / 3 failed, 30.3 minutes**, all 253 executed. One multi-route responsive case reached its 60-second test limit during navigation; a collection case and paused-reading case exceeded five-second initial-readiness waits. Preserved traces show loading state. Not a green complete run. |
| Exact unchanged three-case retest | **Three passed, 48.3 seconds**, same `ce4744d` code, isolated one-worker run. This resolves the isolated acceptance checks without deleting or relabelling the full-run failures; it does not establish the precise timing cause. |
| Enlarged-text layout attempt r6 | 14 passed / 4 failed, 2.4 minutes. Screenshot review had exposed split navigation words and a cramped search field. The first reflow attempt needed more bottom clearance: the new checks measured 88px reserved for 145px navigation. This attempt was not published. |
| Final reflow correction r7 | **18 passed, 2.5 minutes**, final working tree subsequently committed as `3b6ad22`. Measured navigation clearance, intact words, wider search, native touch/keyboard, both themes and requested widths. |
| Final frozen route/focus boundary checks | **Nine passed, 2.0 minutes**, on `3b6ad22`: four responsive-route/theme cases, two delayed book-focus cases, paused-reading keyboard order, guest phone account access and registration/onboarding/logout. |

A production-entry build passes with each executed browser run. Frozen `ce4744d` lint exited 0 with 12 existing warnings, and six native cache checks passed. Final `3b6ad22` lint also exits 0 with the same 12 existing warnings; its six cache checks pass. Its production-entry build passed for the final focused browser run.

The layout-only follow-up preserves the `ce4744d` API/data/navigation logic. It lets search/navigation reflow at enlarged text, observes actual navigation height using native ResizeObserver, and keeps that clearance while the keyboard hides navigation. No forced scrolling, focus action, new destination, dependency or animation is added by this follow-up. After final affected-layout checks pass, a further complete functional suite is not represented as executed on the layout follow-up.

## Visual evidence and source boundaries

All captures use synthetic fixtures. Manifests record source commits and SHA-256 hashes. Native-size images are viewport captures; enlarged images double each descendant computed font size once rather than claiming physical-device accessibility certification.

- [Original 390px collection, import enabled](evidence/2026-10-21-library-review/before-library-390-0.png): first book at 629.39px on `915bee7`.
- [Final 390px collection](assets/library-review-3b6ad22/library-review-light-390.png): first book at 375.39px; same normal-size geometry as `ce4744d`.
- [Before enlarged 320px text reflow](assets/library-review-ce4744d/library-review-light-320-enlarged.png) / [after](assets/library-review-3b6ad22/library-review-light-320-enlarged.png).
- [Final dark 390px](assets/library-review-3b6ad22/library-review-dark-390.png) / [enlarged](assets/library-review-3b6ad22/library-review-dark-390-enlarged.png).
- [Final image/source manifest](assets/library-review-3b6ad22/manifest.json) includes 16 light/dark, 320/390/768/1440 and enlarged captures. No prior report/image is relabelled as a new result.

Committed evidence includes logs and failure snapshots. Eleven raw failure traces are retained in `/workspace/deliverables/bookvane-ui-review-2026-10-21/raw-traces/`; their [manifest](evidence/2026-10-21-library-review/raw-trace-manifest.json) records local locations and hashes. They are not added as large binary archives to Git.

`LibraryPage.jsx` owns collection presentation and explicit page commands; `LibraryNavigationProvider.jsx` / `libraryNavigationState.js` own bounded session metadata. `ReadingCards.jsx` records return context when a card opens, and `ReadingPages.jsx` retains it through reading-history query changes. `BookvaneApp.jsx` supplies that provider and measures mobile chrome with native ResizeObserver; `refinement.css` owns the scoped layout. No reserved main.jsx, auth context, data/version APIs, backend/schema, dependencies, hosting or catalogue importer changes.

Coordination is recorded in [issue #21](https://github.com/StMichael9/Book-app/issues/21). PR #22 remains draft and includes PR #20's unmerged baseline; do not merge both independently.

## Remaining limits and handoff

Physical iPhone Safari remains a current-build manual acceptance check; its historical fix is preserved, not declared broken again. Automated Firefox/WebKit remain unavailable because browser downloads were blocked in this environment. Hosted authentication/cookies/recovery/wake-up, fresh native exports, independent reader studies and public-release gates remain separate. Previously executed backend/milestone QA is not recertified by these cloud UI fixtures.

The grid/list comparison, filter comprehension, import cognitive load and conversion/retention effects remain hypotheses for reader observation. No public-release GO, merge or deployment is claimed.
