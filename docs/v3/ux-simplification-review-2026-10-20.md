# Bookvane: final UX simplification review

Date: 20 October 2026. Status: implementation candidate, awaiting independent review and founder acceptance. This document describes the current frontend pass, not a production deployment or a new backend milestone.

## Scope and evidence

Michael explicitly assigned: **“UI owns the frontend for this pass.”** The separate catalogue importer remains outside this checkout and scope. No database, Neon branch, real account, email, schema, backend, infrastructure, reserved entry point, or production service is changed or exercised here.

Verified remote `v3`: `b05bd690fe1d118c0c699be324d056bae0cd117f`. PRs 18 and 19 are integrated there. PR 20 remains draft/unmerged at `808bb4e21a6b2a5a6670b63ce85a595073523b3b`; its last application change is `285441d30dbb2d16097b534b77927ba858f96eae`. This isolated branch, `codex/v3-ux-simplification`, starts from that exact PR 20 head, preserving an unchanged baseline in a separate worktree. It therefore includes the unmerged workspace work; it must not be described as a small diff against current `v3` or merged alongside PR 20 without reconciliation.

Evidence categories:

- **Observed source/interface facts:** route/component structure, controls and task sequences, synthetic browser journeys and screenshots.
- **Research:** published usability principles and official competitor help. These inform hypotheses; they are not Bookvane user research.
- **Design judgment:** the rubric below. Scores are provisional assessments, not participant satisfaction, conversion, retention, or accessibility certification.
- **Historical evidence:** earlier independent M1–M6 QA belongs to its recorded commits. It is not a new test result for this layout.

No representative users participated. No live competitor accounts were used. No completion-time, first-click-success or retention improvement is claimed.

## Research translated into decisions

| Evidence | Useful lesson | Application and boundary |
| --- | --- | --- |
| [NN/g: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Recognition, consistency, visible status, error recovery and user control support basic usability. | Retain explicit save, truthful state labels, version conflicts, error feedback and the existing four destinations. |
| [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Present common actions first and reveal secondary complexity on demand. | Configured progress shows one value and Save; copy/date/unit changes remain accessible. Reactions, save reasons and less-used library filters are secondary. |
| [NN/g: web form design](https://www.nngroup.com/articles/web-form-design/) | Unnecessary fields and uncertain requirements increase form work. | Optional dates do not precede a routine progress save. Explicitly label optional controls. Published results are not projected onto Bookvane. |
| [W3C: redundant entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) | Avoid asking for information already supplied in the same process. | Reuse the reader's saved progress format and copy total. Do not invent page totals or require re-entry during each save. This alone is not a WCAG conformance claim. |
| [StoryGraph: getting started](https://thestorygraph.freshdesk.com/support/solutions/articles/79000142013-getting-started-with-storygraph) | Routine progress and secondary note/date editing can have different depths. | Keep progress brief after initial configuration; keep historical correction available. Do not copy streaks or add social features. |
| [Goodreads: DNF shelf](https://www.goodreads.com/blog/show/3092-new-did-not-finish-shelf-is-on-its-way) | Clear stopped-reading terminology and retained history matter. | Preserve Bookvane's familiar Stopped label and independent attempts. Do not copy mutually exclusive shelf semantics: Own/Want remain independent of reading state. |
| [Fable: CSV import](https://help.fable.co/article/131-can-i-import-my-goodreads-data-from-a-csv-file) | Readers bring existing libraries; stage-specific feedback matters. Its help describes an initial completion message before books finish appearing. | Bookvane retains explicit preview, confirmation, acknowledged batches and results rather than presenting upload as completed import. The help page is a workflow reference, not a live Fable test. |
| [Fable: private notes](https://help.fable.co/article/44-can-members-of-my-book-club-see-my-notes) | A short privacy explanation can reassure readers at note entry. | Keep “Private to you” beside note input; do not introduce sharing controls. |
| [Hardcover: reader's journey request](https://roadmap.hardcover.app/feature-requests/posts/reader-s-journey) | Per-book context and progress are useful together. | Keep notes in the reading workspace rather than adding another primary destination. Roadmap requests are anecdotal, not evidence of population-wide demand. |

The current Hardcover October report was search-index accessible but opened as a login/footer shell. Goodreads' import-help URL returned 404. Neither is treated as an inspected current application. Published reader complaints about progress controls informed questions, not a claim that competitors universally have those problems.

### Competitor workflow coverage and observation limits

This is documentation-based comparison, not authenticated competitive usability testing. “Not verified” is intentional; current tap counts and conditional screens cannot be inferred from feature descriptions.

| Product | Find / save / organize | Progress / notes / finish | Choose next / import | Take or reject |
| --- | --- | --- | --- | --- |
| Goodreads | Official DNF announcement establishes named Want/Currently Reading/Read/Stopped-style shelf organization; authenticated search/save mechanics not newly observed. | Official DNF article preserves records when stopping. Older support discussions describe page/percentage progress and private notes under review options; those exact current paths are not verified. | Import help was unavailable; no current import click-count claim. Recommendations are documented in support discussions but not evaluated live. | Borrow familiar labels and retained history; reject reliance on a buried review editor for private reading notes. No claim that all current Goodreads clients use that path. |
| StoryGraph | [Official site](https://www.thestorygraph.com/) describes mood-based discovery; [getting started](https://thestorygraph.freshdesk.com/support/solutions/articles/79000142013-getting-started-with-storygraph) covers tracking and to-read organization. | Getting-started help separates routine progress from note/date actions and explains finish dates. | [Up Next](https://roadmap.thestorygraph.com/changelog/up-next-and-suggestions) describes to-read selection; [bulk template](https://thestorygraph.freshdesk.com/support/solutions/articles/79000146300-bulk-import-template) uses a Goodreads-format CSV. | Borrow short routine progress and an existing queue. Do not copy algorithmic personalization, surveys or wider tracker complexity. |
| Hardcover | [Official app listing](https://play.google.com/store/apps/details?id=hardcover.app) documents status, lists, reviews and import. Authenticated search/menu details are not verified. | [Official changelog](https://roadmap.hardcover.app/de/changelog) and October report describe journal/progress, paused states and notes. | Import from Goodreads/StoryGraph is documented; a current end-to-end next-read selection interaction was not verified. [Progress-access request](https://roadmap.hardcover.app/feature-requests/posts/faster-more-easily-accessible-progress-update-log) is anecdotal evidence that proximity matters. | Borrow per-book continuity. Do not infer a validated recommendation UX or replicate every journal/stat feature. |
| Fable | [Getting started](https://help.fable.co/article/11-what-is-fable) and [catalogue search](https://help.fable.co/article/20-webstore-books) describe discovery and reading lists. The latter is a purchase flow, not evidence about free tracking tap counts. | [Official app listing](https://apps.apple.com/us/app/fable-track-discuss-books/id1488170618) describes page/percentage progress; private-note help and [reread help](https://help.fable.co/article/178-are-rereads-counted-towards-my-stats) cover privacy and preserved finish dates. | Listing describes editorial/TBR suggestions; CSV help documents import and delayed availability. No live account import was attempted. | Borrow private context and bring-your-history continuity. Exclude Scout/AI, clubs, streaks, purchases and social feeds. |

Public issue/roadmap comments are self-selected anecdotes, including conflicting expectations. They motivate testing with Bookvane readers; they do not establish “common complaints” prevalence or prove any competitor inferior.

## Current architecture and intended journey

`frontend/src/main.jsx` already loads `ui-v2/BookvaneApp.jsx`; retained `App.jsx` is not the active experience. Neither entry point is edited here. Existing shared primitives, ReaderContext palette, AuthContext session generation, UserBooksContext capability/revision handling, reading commands, owner endpoints and request cancellation remain in use. There are no new packages or API payload fields.

| Destination | Reader's question | Primary role |
| --- | --- | --- |
| Home (`/home`) | What am I reading now? | Current reads and Continue; a small next-read area. No collection-management duplicate. |
| Discover (`/browse`, `/book/:id`) | What might interest me? | Catalogue search/details and explicit Own/Want/Start. |
| My Books (`/my-books`) | Where is a particular saved book? | Search, filters, bounded collection pages and import entry. |
| Reading workspace (`/my-books/:entryId`) | What do I want to do with this book? | State-specific reading action, progress and a private note; secondary history/manage. |
| Account | How do I manage my settings and data? | Preferences, import/data/privacy destinations using the existing account structure. |

Connected journey: discover → confirm/save → choose/start → continue or pause → optional progress/note → finish or stop → optional choose next. Import is a parallel entry into the same library/workspace, not a separate reading product. Concurrent reads, DNF, past records and rereads retain their existing contracts. No forced journal, progress, date, reaction or rating is introduced.

## Before/after UX scorecard

Rubric: each experience receives up to 2 points for **purpose/next action**, **routine effort**, **density/scanability**, **truthful state/recovery**, and **responsive/keyboard clarity**. Sum = 10. A 2 requires clear source/browser evidence for that category; gaps cap the relevant category. Half points represent mixed evidence. These are designer assessments, not validated user scores; no area earns full marks. Pending independent/device checks limit the after score.

| Experience | Before /10 | After /10 | Evidence and remaining qualification |
| --- | ---: | ---: | --- |
| Home | 8 | 8 | PR 19 already separated current reading from collection; remove one repeated top My Books link. Continue and empty-state routes remain. No large improvement claimed. |
| Discover | 8 | 8 | Established catalogue hierarchy retained; shorter introductory text only. Separate title/author backend semantics constrain further search consolidation. |
| My Books | 6.5 | 8 | Cards had cover/title/Open-reading/About links plus two flag buttons. They now have cover/title and state text. Default facets reduce from seven to three, with active secondary facet visible. Tradeoff: secondary filtering and flag changes require an extra reveal/workspace visit. |
| Reading-state actions | 8 | 8 | PR 20 already made Update/Resume primary and reordered paused actions correctly. Preserve that work; move independent ownership management away from routine reading controls. |
| Configured progress | 6 | 8 | Unit, value, copy total and date previously competed in one form. One value + Save now precedes optional settings. Same two button clicks; less scanning/decision work. First configuration and historical correction remain more detailed. |
| Private notes | 6.5 | 8 | A disclosure plus an editor trigger previously hid everyday note entry. Direct Add/Edit note now removes one reveal; reactions move after Save. The canonical owner read and captured-version checks remain. |
| History/manage/data controls | 8 | 8 | Scope-specific confirmations, captured record identity, lazy history and owner export retained. Flag controls now require Manage disclosure. Browser Back protection for dirty SPA drafts remains a limitation below. |
| Import | 7.5 | 7.5 | Shorter upload and privacy copy; existing preview/uncertainty/consent/resume/cancel flow remains necessary. No unsupported claim that a complex large import became a three-click task. Fresh native exports remain a release gate. |
| Login/recovery/preferences | 8 | 8 | No implementation changes in this pass; inherited M6 regressions must still pass. Hosted cookies/mail/reset and assistive-technology acceptance remain separate. |
| Mobile/keyboard across these screens | 7.5 | 8 | Existing four-item navigation retained; reduced controls and native disclosure targets. Browser evidence is Chromium, not physical iPhone or screen-reader certification. |

## Friction removed, retained and traded

### Routine progress

`ReadingPages.jsx: ProgressForm` keeps the configured unit and copy total. Routine active readers see their value and **Save progress**. **Format, copy & dates** remains below Save for changes. First-time format selection stays visible when no unit is set; terminal/read-only correction opens settings initially. Zero remains valid, missing totals remain unknown, and 100% is not Finish. Saves still send the original captured version and existing nullable fields. No automatic date, format, finish or autosave is added.

### Notes

`ReadingPages.jsx: ContextForm/workspace` exposes **My note** directly. Add/Edit loads the canonical owner record before creating the draft. **Save note** precedes the optional reaction disclosure. Existing saved reactions survive a note-only edit. **Why I saved this book** remains a distinct, quieter entry-level field; it is not silently combined with per-attempt memory. History still identifies the selected state and dates before correction.

### Library and Home

`ReadingCards.jsx` removes the third workspace link, per-card public-detail link and per-card flag mutations from the V3 collection. The title/cover open the same workspace; public details and independent Own/Want controls remain there. Older capability paths retain their existing safe card controls. Private entries never acquire a catalogue link.

`LibraryPage.jsx` shows All, Reading and Want. More filters contains Own, Paused, Finished and Stopped as supported; the selected secondary facet stays visible outside the disclosure. API facets, cursor reset, label filtering and later-empty-page recovery remain. Search stays visible. Import stays prominent; Add a missing book becomes a quiet footer path. Redundant Home/Find-more tools and sort prose are removed. Home's primary reading section remains independent of this collection.

### Other screens

`NextReadSection.jsx` removes duplicate “On your Want list” copy in its quiet preview, not factual selection reasons in the full chooser. Finish's committed status, optional skip and pending-command guards remain. `DiscoveryPages.jsx` changes introductory copy only. `LibraryImportPage.jsx` shortens upload explanations while retaining limits, private-entry consent, seven-day resume, cancellation and committed results.

## Comparative task report

Counts below are deterministic source/script walkthroughs using synthetic data, **not measured participant performance**. Count button/link/disclosure activations separately from text entry. Input focus, typing, scrolling and OS file picking vary and are not represented as saved clicks. Error recovery may add steps in either version.

| Persona/task | Before | After | Measurable change / tradeoff |
| --- | --- | --- | --- |
| New reader: discover → Want → account continuation | Existing search/detail/save/account sequence | Same | No new onboarding gate; preserve exactly-once continuation and visible failure/retry. No claim of fewer clicks. |
| Returning reader: Home → workspace | Continue reading (1 navigation activation) | Same | No reason to remove the useful primary Continue action merely because the title also opens the book. |
| Active reader: configured progress | Update + value entry + Save | Same 2 button clicks + 1 value entry | Required visible form decisions shrink; unit/copy/date fields are quiet. Initial configuration is explicitly excluded from this claim. |
| Active reader: short note | Memory disclosure + Add/Edit + text entry + Save | Add/Edit + text entry + Save | 3 → 2 control activations; 1 reveal removed. Optional reaction costs one reveal when wanted. |
| Active reader: Pause / Resume / Finish | 1 explicit action each | Same | Preserve clear state transitions and optional Finish → next-read rather than adding a workflow wizard. |
| Established reader: find library book | Search/filter then cover/title/workspace link | Search/filter then cover/title | Same direct opening count, fewer competing routes. Secondary facets cost 1 disclosure activation. |
| Established reader: change Own/Want from library | Card flag button | Open workspace + Manage + flag | Deliberate tradeoff: lower collection noise, more steps for management. Retain Discover/detail save actions. Review this tradeoff with founder/users. |
| Established reader: import history | Upload → mapping if needed → preview/review → explicit confirm → results | Same contract stages | Copy is shorter, but safety decisions remain. Conflicts/private-entry consent and partial cancellation are not removed to create a flattering click count. |

Three persona coverage paths are exercised through the existing auth/discovery, active lifecycle, and import regression fixtures. They do not simulate a human first impression or establish real-world task completion time. A moderated reader session remains necessary for that claim.

## Safety, interaction states and limitations

- Existing auth generations, owner scoping, command assertions and route unmount clear private drafts; no note/history/account ID enters public search or persistence added by this pass.
- Held metadata/workspace refresh and independent flag writes must retain the mounted draft and its original version. A 409 must preserve values and require explicit reload/reapply, not silently rebase.
- Dirty note/progress drafts now ask before ordinary same-window link departure, and native beforeunload guards reload/close. Cancel keeps the editor; accepted departure clears it. New-tab/download/modified-click actions do not destroy the current draft and are not blocked.
- **Known boundary:** same-document browser Back/Forward is not intercepted by this local click/beforeunload guard. The current BrowserRouter is not a data-router blocker. Do not claim universal unsaved-navigation protection; assess a scoped router blocker separately before promising that guarantee. Session-expiry/logout must still clear drafts without a confirmation barrier.
- Slow notices, skeletons, truthful errors/retries, read-only capability gates, missing metadata and private-book fallbacks stay in place. Do not treat empty/failed API responses as valid empty libraries.
- No single provider search button or provider-choice step is introduced. Automatic external lookup/private-enrichment versus shared persistence remains separately approved backend/product work; no bulk external import lookup is authorized here.
- Library import keeps the approved 20 MiB/20,000-row defaults, seven-day window, acknowledged batching, existing-data preservation and explicit partial cancellation semantics. Native Goodreads/StoryGraph/Bookvane exports require their existing acceptance, not these mocked fixtures alone.

## Figma and visual evidence

[Editable interaction review](https://www.figma.com/design/9cnsOq7BoGCwUzx6tD7v88?node-id=2-30): six source-derived progress/note views, phone and desktop editor widths, both themes, editable text/auto-layout, shared button variants and existing palette variables. They are **not a captured application or a new full design system**. Starter plan supports one variable mode, so explicit Light/Dark variable namespaces represent the existing palette. Font families remain Lora and Source Sans 3.

Live-page capture could not run: the environment proxy returned HTTP 403 for `https://mcp.figma.com/mcp/html-to-design/capture.js`. No network-policy workaround was attempted. Real application screenshots from Playwright are separate artifacts and the source of visual acceptance. Synthetic fixture titles/covers are labelled accordingly; generated book-cover artwork is not shipped.

## Engineering / QA handoff

Final candidate SHA, commands, exact results, screenshot index and outstanding decisions are recorded in the accompanying `ux-simplification-qa-2026-10-20.md` after verification. Implementation is restricted to reading/discovery/import frontend presentation and associated tests/CSS. No dependencies or API contracts change.

Before integration, independent QA should verify: common progress and note tasks at 320/390/768/1440 in both themes; enlarged text/long titles; initial unconfigured progress and historical dates; 0% and 100% without forced Finish; notes/reactions clearing; stale drafts and held flag refetch; account departure; library alternate facets and empty later pages; failed Finish versus quiet preview; finish chooser skip/start guards; import uncertainty, consent, resume and partial results. Native Back/Forward draft behavior must be explicitly classified rather than silently passed.

Physical iPhone/Safari, hosted production-build/cookie/mail/deep-link checks, fresh native import exports, support/retention/public-release decisions and real-reader usability remain separate. The founder previously identified the Safari jump as fixed but not deployed; do not report it newly unfixed based on an old deployment. This branch neither deploys nor recertifies that physical device behavior.

## Build / defer / exclude

**Built:** quick configured progress, direct note editor, quieter optional controls, cleaner collection cards, progressive facets, redundant-link removal, clearer import entry copy and local dirty-link guard.

**Deferred with an explicit boundary:** independent retest, native Back/Forward draft protection, physical-device/hosted/native-export acceptance, real-reader task timing and approval of the collection-management tradeoff. No public-release GO is implied.

**Excluded:** rebrand, palette reset, fifth primary destination, stats/streaks/social feed, forced journals, automatic reading transitions, provider selection, bulk external lookup, auth/router migration, new infrastructure or paid tools.
