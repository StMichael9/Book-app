# V3 minimalist refinement — implementation and verification

**Completed local implementation and regression verification.** Note/progress Close is local and non-destructive, drafts survive internal navigation, the reading desk and collection have distinct roles, and the existing Bookvane identity is preserved. Ready for founder/independent manual review; not a production-release certification.

Branch: `codex/v3-ux-simplification`. Review: [draft PR #22](https://github.com/StMichael9/Book-app/pull/22), targeting v3. Frozen application commit: `915bee78c6b4def6ec7b62d86eda336cfb5018f3` (earlier candidates `4eed832`, `5016ea5` and `2e36feb`). Final verification completed October 21, 2026. Target v3 was independently rechecked at `b05bd690fe1d118c0c699be324d056bae0cd117f`. The feature branch includes unmerged PR #20 and the prior manual-test build `426667e`; do not merge #20 and #22 independently.

## What changed

- Replaced routine Close/refetch/discard prompts with account-scoped in-memory drafts. Note, progress and save-reason drafts retain their original version across internal navigation. Reload, logout and account switching clear them. No browser storage or autosave.
- Put progress editing inside My reading and note editing inside My note. Kept historical identity and version-safe corrections. Close restores focus locally; background Own/Want refetches retain mounted editors and inputs. Pending saves disable Close. Conflicts retain values and offer an explicit Load saved version recovery with replacement wording.
- Made Own/Want directly available in the workspace, retained clean collection cards, and exposed Finished beside All/Reading/Want. Home prioritizes current reads and discloses full next choices on request. Finish still commits independently of suggestions, and pending Start still blocks Not now.
- Refreshed the guest landing's V3 promise while keeping real covers and the existing identity. Returning V3 readers still go directly Home, with no public-marketing flash during session/capability checks. Simplified guest landing chrome and retained subject access as compact links rather than a large card section; saving still requires an account after browsing.
- Reduced repeated chooser instructions/reset controls, shortened note/progress language and import cancellation labels, and reduced import's stage indicator to four human stages. Underlying contracts are unchanged.
- Refined shared wrapping, controls, focus, textarea styling, subtle shadows, hover/pressed feedback and native disclosure opacity. Preserved both palettes and fonts. Reduced-motion disables new transitions/animations. No height animation, scroll animation, new dependency or focus-changing motion.
- Clear only the affected session drafts after confirmed book/reading removal; failures retain them, and deleting one reading keeps the separate book-level save-reason draft. Confirmation names this consequence. Server-acknowledged saves announce success even while a refresh is slow; account departure clears UI announcements.
- Matched the mobile detail loading cover to the final cover size. A new landing-tap diagnostic found the oversized old placeholder induced a small loading-time scroll adjustment; this was corrected without changing the established focus-intent logic.

## Verification ledger

All browser fixtures intercept API requests and reject unexpected external traffic. No real backend, account, email or database is used. Resized Chromium/touch emulation does not certify physical Safari.

- Development core r1: 13 passed, 1.5 minutes. Pre-freeze working snapshot; not the final application certification.
- Development target r2: 14 passed, 2 failed, 1.4 minutes. Both failed an incorrectly compounded text-enlargement setup. Corrected to double each element's original computed font size; added wrap resilience in chrome.
- Development target r3: 9 passed, 1 failed, 1.3 minutes. New landing-tap assertion assumed a title above 220px, despite the book cover preceding it. Replaced that arbitrary layout assertion with viewport visibility; retained a separate scroll assertion.
- Development target r4: 5 passed, 1 failed, 1.5 minutes. That retained scroll assertion observed 195px, tracing to the taller loading placeholder. Corrected placeholder sizing rather than relaxing the scroll threshold. Enlarged-text checks passed in both themes.
- Development touch/focus r5: 9 passed, 49.5 seconds after the placeholder correction. Includes original first-touch scenarios, landing first tap, delayed book/workspace focus and deliberately moved focus. Not a WebKit run.
- Initial sandbox attempt could not start the local test server; the successful runs used the supported local-network execution permission. This setup failure is not an application test result.
- First broad diagnostic on `4eed832`: **137 passed, 3 failed, 1 interrupted, 91 did not run**, 13.6 minutes; stopped cleanly to apply bounded corrections and the newly identified draft/removal boundary. The failures were one `page.goto` timeout at 1440px, the removed landing subject-link expectation and the old guest You-navigation path. It is **not** a completed suite. Compact subject links were retained, and the guest navigation test now exercises the approved direct sign-in/registration access rather than a removed toolbar.
- Correction r6: **6 passed, 40.9 seconds** on the correction working tree. Includes the unchanged 1440px test (13.5 seconds), subject/tag routing, direct phone registration, success feedback during held refetch, failed/confirmed forget and selective per-reading draft deletion. The earlier navigation timeout was not reproduced; its specific cause was not established. This is not substituted for a final broad run.
- Completed broad run on `5016ea5`: **231 passed, 3 failed, 20.4 minutes; no interrupted/unrun cases**. Two failures were unaligned older expectations: direct Own/Want controls now precede reading actions in keyboard order, and internal back navigation must retain a draft. The third was a genuine focus race: an editor-close callback could move focus after Finish. This candidate was not published as verified.
- Focus correction r7: **9 passed, 1.4 minutes** on the correction working tree. Expanded the keyboard assertion rather than hiding direct controls; updated only the explicitly superseded route-retention expectation. Added deterministic delayed-frame Finish coverage and deliberate focus movement during a pending save. The correction restores focus only when a real editor closes, and an older callback cannot override a newer focus target. Explicit saved-version recovery follows the same focus rule.
- Completed pre-spacing full Chromium suite on `2e36feb`: **236 passed, 17.4 minutes; zero failures, interruptions or skipped cases**. Command: `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --workers=2`. This includes all standard mocked regressions, not a selected subset. Files have isolated browser/API state; no database or rate-limited external service is involved. Browser: system Chromium 151.0.7922.173 on Debian 13. The standard production-entry build completed successfully as part of the suite.
- Screenshot review identified excessive desktop whitespace when progress opened. A bounded grid correction keeps My note near the book identity and moves the next suggestion below reading controls. Targeted spacing r8: **7 passed, 48.1 seconds**, including responsive geometry and retained draft/focus behavior.
- **Final full Chromium suite on `915bee7`: 236 passed, 18.0 minutes; zero failures, interruptions or skipped cases.** Same standard production-entry build and mocked suite, with two workers. This is the final application result.
- Native cache checks on `915bee7`: **6/6 passed**, via `node tests/book-details-cache.test.mjs` with replaced fetch. Final lint exited 0 with **12 existing warnings**, no new warnings. Temporary capture fixtures were removed before final lint.
- Supplemental capture-only export on `915bee7`: two capture cases completed in 27.6 seconds. These export screenshots; they are not additional functional coverage beyond the 236 tests.

## Coverage and remaining gates

The standard suite exercises reading lifecycle, failure/conflict preservation, independent flags, rereads, owner/session boundaries, preferences, recovery, import safeguards, pagination, responsive routes, keyboard/focus and mobile touch. New checks cover no-request/no-dialog Close, internal navigation, draft-field/book isolation, actual refresh, account departure and a different login, stale restored versions, pending Save, root auth/capability loading, fallback landing, and all four requested widths in both themes with reduced motion and enlarged text.

Firefox and WebKit were not installed. Official Playwright browser downloads were attempted, but network policy returned 403 Domain forbidden from the distribution hosts. Those engines are **unexecuted**, not passing. `frontend/playwright.ui-cross-browser.config.js` is provided to run the same suite with installed Chromium/Firefox/WebKit. Firefox excludes the mobile file that uses unsupported isMobile emulation; its viewport checks remain. Run with `npx playwright test --config playwright.ui-cross-browser.config.js`; set PLAYWRIGHT_EXECUTABLE_PATH only for a system Chromium if needed.

Physical iPhone Safari, hosted/public cookies/recovery/wake-up, fresh native Goodreads/StoryGraph acceptance and broader release/support gates remain separate and open. The refreshed landing assumes the intended V3 capabilities will be available in its eventual release; this work does not enable those capabilities on the public V2 deployment. The opt-in real-API lifecycle test selectors were updated for the new labels and explicit saved-version recovery, but those tests were not executed here. No new user study, conversion improvement, retention uplift or public-release GO is claimed.

## Screenshots

Before screenshots under `assets/before-426667e/` are historical synthetic captures from the published manual-test build; their manifest records source SHA and hashes. After captures come from the final frozen application. See the [before/after comparison](2026-10-20-before-after.md) and `assets/after-915bee7/manifest.json` for file hashes and source attribution. Full-page phone screenshots can place fixed navigation at the capture viewport boundary; that capture artifact is not an extra toolbar in the product.

## Unchanged behavior and known tradeoffs

- Discovery still distinguishes title and author, accurately reflecting current API support. External matching and persistence need a separate approved contract.
- Import still requires meaningful decisions for uncertainty and consent; it is not an automatic upload-and-done flow. No bulk external lookups were added.
- Session drafts are deliberately ephemeral. Actual refresh/exit may lose them after the native warning is accepted. Nothing is sent to the server until Save.
- Old route-departure tests were intentionally revised to the newly approved retention contract. Historical identity, original versions, read-only and session safeguards were retained rather than weakened to make the UI smaller.
- No merge or deployment has occurred. Prior reports and screenshots outside this directory were not relocated or silently republished.

## Component and contract boundaries

`ReadingDraftProvider.jsx` / `readingDraftState.js` own ephemeral draft scope; `ReadingEditors.jsx` owns form commands and captured values; `ReadingPages.jsx` places forms and retains the last workspace snapshot only within its current account/entry boundary. `ReadingDataControls.jsx` clears relevant drafts only after its existing owner-scoped removal/absence check succeeds. `ReaderContext.jsx` clears UI announcements at account departure. These are UI-owned changes, not changes to AuthContext, cookies or authorization.

`BookvaneApp.jsx` owns the auth/capability-aware root route and existing shell. `DiscoveryPages.jsx` refines the introduction and the detail placeholder. Shared primitives have a presentation-only preview mode for landing cards; Discover and details retain Own/Want. No package or reserved main.jsx changes are required.

Existing import, reading-attempt, page-count, idempotency, session-isolation and expected-version APIs remain the authority. No new API/schema or provider behavior is inferred from this interface pass.
