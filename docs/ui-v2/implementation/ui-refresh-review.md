# Bookvane V2 UI refresh — change record and review

## Scope and status

This document records what the UI refresh changed, why those choices were made, what was simplified after review, and the remaining direction agreed with the product owner.

The implemented refresh is commit **d6748c0**, following the browser-design prototype in **c793e47**, on **codex-ui**. Its engineering reference was the audited V2 implementation at **39ca688**. The implementation was pushed to GitHub; the owner subsequently reported merging it into **v2-codex** and pulling it locally.

The original review checked the then-current GitHub versions of **primitives.jsx**, **DiscoveryPages.jsx**, **BookvaneApp.jsx**, and **main.jsx** on **v2-codex**, alongside the local implementation. Those integration observations are historical. The current October 8 launch-fix pass uses **67b6850**, where the standard entry already loads BookvaneApp. I cannot inspect the owner's VS Code working copy or determine whether it contains additional local changes.

**Current status:** simplification and charcoal dark mode are implemented. Light mode remains unchanged; the logo has not been redesigned. The October 8 pass fixes confirmed recovery navigation/continuation, stale shelf-filter results, delayed preference navigation, loading-heading focus, fallback branding and startup theme mismatch. It preserves the first-tap Safari guard already present in **67b6850**. See the [launch-fix handoff](launch-fixes-2026-10-08.md) for current verification, limitations and release instructions.

### Completed simplification pass

- Removed visible ISBN metadata, repeated landing slogans and the introduction strip, detail/discovery promotional banners, the landing updates form, redundant browse/preferences links and instructional filler. ISBN data and existing Bookshop URL behavior remain intact.
- Kept one main anonymous landing action, the useful library explanation, real covers, search/filter controls and contextual Own/Want prompts. Returning signed-in readers retain their library link.
- Reduced the footer to the brand and made the filter heading simply **Filters**. Shortened hero cover spacing to suit the reduced copy on desktop and phones.
- Suppressed repeated header account links on authentication forms. Successful password recovery has one return-to-sign-in action. Detail pages offer **View My Books** when a saved shelf state is known.
- Hid page-navigation controls when results occupy one page; result ranges, multi-page browsing and out-of-range recovery remain.
- My Books now owns its library-load error and retry. Save continuation now lives beside the detail shelf controls in **SaveContinuation.jsx**, with one failure message and retry. Choosing a shelf manually after a failed continuation consumes the pending intent after a successful save, retaining the discovery return context.
- Added meaningful regression checks for one library failure/retry and manually changing the pending shelf after a failed post-login save. All 22 checks passed together. No API/provider/dependency or reserved entry files were changed.

The table below retains the original rationale and recommendations as a historical record; its removals and clarity changes are now completed. Newsletter signup remains absent from this landing page; its existing backend capability was not removed.

## Product purpose and design principles

The journey remains:

**Discover books → find an interesting book → create/sign into an account → choose Own/Want → build a personal library → return to discover more.**

The refresh aimed to make that journey understandable and visually appealing through warm paper surfaces, editorial typography, authentic covers, clear controls, and reliable saving. The owner's latest direction places more emphasis on feeling comfortable and at home in a personal library.

The research reference is [research-and-direction.md](../redesign/research-and-direction.md). It links USWDS and GOV.UK guidance on purposeful cards, visible search, understandable actions, short authentication flows, useful errors and continuity. WCAG guidance informed contrast, reflow, focus and authentication choices. Those principles support design decisions; they do not establish that this palette or interface has increased retention. No prospective-reader testing or retention measurement was completed.

## ISBN: what was added, and why it should change

**ISBN was added to the expanded book-detail page, not to the discovery or library cards.** In the inspected implementation:

- **BookCard** renders the cover, title, author, Own/Want controls, and an optional configured Bookshop link.
- **BookPage** initially conditionally rendered Published, Pages and ISBN above the shelf actions; the cleanup removes the visible ISBN.
- The original **BookDetailPage.jsx** displayed publication year and page count; the refresh added visible ISBN metadata to the replacement detail page.

I surfaced the existing API field **isbn13** for bibliographic context: an ISBN can help identify a published edition. That is a weak reason to place a long number in Bookvane's main reading hierarchy. Most visitors are deciding whether a book interests them, not matching a particular edition. The data being available does not automatically make it useful to display.

There is an additional mismatch: Own/Want is saved against the book ID, while an ISBN identifies an edition. The current UI provides no edition chooser or edition-specific ownership. Prominent ISBN metadata can imply more precise edition tracking than the product provides.

**Recommendation:** remove ISBN from the visible primary detail layout. Preserve the backend field and its existing uses, including eligible Bookshop URLs. Do not add a new metadata drawer solely to justify keeping it on screen. If edition matching becomes a real user task later, reconsider where that information belongs. Keep useful publication/page information subordinate and avoid implying it describes the reader's particular copy.

Size: small UI change. Priority: P1, before launch. No backend or card redesign is needed.

## Original redundancy review and rationale

These are the highest-value simplifications found in the inspected refresh. Actual duplication is distinguished from a separate task that is simply too prominent. There is no evidence that any individual item has caused users to leave; the recommendations follow the task hierarchy and visible implementation.

| Element and location | Why I included it | What is weak or redundant | Recommended change | Size / launch priority |
| --- | --- | --- | --- | --- |
| **ISBN in the main book-detail metadata** | To expose available bibliographic context and help identify an edition. | Adds a technical identifier before the central Own/Want actions, despite there being no edition-selection journey. | Remove its visible row; keep the data and existing URL-generation behavior. | Small; P1 before launch. |
| **Multiple slogans around the landing hero and in the persistent footer** — “A little curiosity. A whole new world.”, “Something familiar. Something unexpected.”, “Discover → save → make it yours”, and the footer taglines | To establish an inviting editorial voice and explain discovery plus saving. | Several lines express the same general promise. Repeated on phones, they add scrolling without helping a reader choose a book. | Keep the main proposition, one useful explanation and the no-account reassurance. Reduce decorative slogans; keep a compact footer identity. Preserve the cover display. | Small; P1 before launch. |
| **Anonymous discovery-page account banner** — “Found something you love?” / “Make it your library” | To explain why registration becomes useful after browsing. | The header already offers joining, and tapping Own/Want provides a more relevant explanation tied to the chosen book. The banner is repeated marketing below a functional results page. | Remove this banner from discovery. Keep the contextual save prompt, header access and the landing library explanation. | Small; P1 before launch. |
| **Two library-load warnings on My Books** | The global warning protects shelf changes across screens; the page-specific error protects against treating a failed library read as an empty collection. | On My Books, the global warning and local error can both report the same failure with separate “Try again” buttons. | Let My Books own its error state and retry. Keep the global warning on other screens where shelf actions depend on the failed read. Do not re-enable writes before hydration succeeds. | Small; P1 before launch. |
| **Two save-failure messages after signing in** | The continuation banner explains that sign-in succeeded but saving failed; the shared shelf controls expose mutation errors consistently. | One failed save can produce both the continuation error and an inline book error. Repetition makes a single recoverable issue feel larger. | Present one visible message at the shelf controls, with the explicit retry and the useful account-success context. Preserve the one-time continuation and failure handling. | Small–medium; P1 before launch. |
| **Global Sign in / Join free links while already on their corresponding account forms** | To keep the header predictable across routes. | Joining from the registration header or signing in from the login header repeats the page's main action. Those generic links can also discard the pending-book query parameters. | Keep the brand and a route back to discovery. Keep one clear switch to the other account form near the form; suppress the redundant header account links on auth screens. | Small; P1 before launch. |
| **Previous / Page 1 of 1 / Next when results fit on one page** | To make pagination placement and result position consistent. | Both navigation buttons are disabled, so the control group provides no action. It is especially bulky on phones. | Show the result range, and render page navigation only when there is more than one page. Keep the existing out-of-range recovery state. | Small; P2; easy cleanup, not a launch blocker. |
| **Product-updates email form on the landing page** | To preserve the existing signup capability and offer visitors a way to hear about the product without creating an account. | It is a distinct task, not a duplicate account form, but adds another email-related action to a page focused on books and the library. Its value depends on actually sending useful updates. | Defer this landing section unless an updates plan exists. Keep the existing API; retain explicit consent wherever the form is eventually shown. | Small; P2 / product decision. |

The filter dialog heading “A little more specific.” is also less direct than “Filters.” It was intended to sound conversational, but functional headings should be immediately recognizable. A plain heading is a small clarity improvement, rather than a duplicate feature.

## Repetition I would preserve

- **Own/Want on cards and details:** supports saving at the moment a book becomes interesting. Shared state keeps these controls consistent.
- **Clickable covers and titles:** both are natural places to select a book. Their accessible names and keyboard order should remain clear.
- **Subject chips and the filter dialog:** chips provide quick single-subject browsing; the dialog handles combined subjects and shelf constraints. Their roles differ.
- **A discovery link in navigation and a return link on details:** one moves to general discovery; the other preserves the exact search/filter context.
- **Desktop theme control and account appearance control:** quick access on desktop and a discoverable setting on mobile. The phone header hides the desktop theme control.
- **Shelf status plus a brief success confirmation:** the status persists; the confirmation acknowledges that a request succeeded. Do not replace actual state with a toast alone.
- **Loading, empty and failed states:** they communicate different conditions. Simplification must not turn a failed load into an apparently empty library.
- **Password guidance, consent and affiliate disclosure where relevant:** these explain meaningful choices and should not be removed as decorative copy.

## What changed across the refresh

### Visual foundations

I introduced scoped UI tokens and reusable styles for paper backgrounds, panels, text, muted text, controls, selected shelves, focus, errors and both themes. The new styles live in **frontend/src/styles/ui-v2/bookvane.css** and are scoped to the new application root, with a body-margin adjustment when that root is present.

Lora provides editorial headings; Source Sans 3 provides body text, navigation and controls. WOFF2 fonts and OFL licenses are bundled locally. Body text is generally 17px on desktop and 16px on phones, with larger introductory copy. Spacing groups related tasks and bounds reading columns. Icons use the existing Lucide library. Cards use cover imagery rather than decorative frames.

The rationale was a reader-oriented identity with familiar controls. The original dark palette carried green into its large surfaces; feedback has identified that as too broad. The existing Bookvane mark was reused, not redesigned. New application-facing copy uses Bookvane; legacy files were not rewritten to remove every historical reference across the repository.

### Landing page

I added a clear discovery proposition, one prominent Explore books action, reassurance that browsing does not require an account, and a library link for returning readers. The hero uses up to three books from the API, favoring items with cover URLs. Subject links use real supported genres. A five-book section makes exploration possible without going immediately to another page.

Catalogue totals come from the API. Covers come from each book's **cover_image_url**. Missing data produces an honest fallback. The initial refresh retained the library explanation and an updates form. The cleanup keeps the library explanation and removes the form and repeated surrounding slogans.

These books are drawn from the API response, not a manually curated recommendation collection. The UI adds no new recommendation engine, ratings or fabricated reader activity.

### Header, footer and navigation

Desktop navigation provides Discover, My Books and signed-in Preferences, alongside account and theme controls. Phones use a persistent Discover / My Books / You navigation bar with space reserved beneath page content. Signed-out readers can reach login and registration. Account startup has a visible checking state.

The initial footer paired the brand with multiple slogans. The cleanup keeps only the brand. Responsive navigation was designed to keep the main tasks reachable, rather than shrinking the desktop header into a phone layout.

### Discovery, search and filters

I connected visible Title/Author search to the existing separate API search parameters. Subject chips offer quick browsing. A native filter dialog supports multiple subjects, hide-owned and Own/Want scope for signed-in readers. It explains that multiple subjects use AND, matching the backend.

Search, filters and page position live in the URL, so browser history and return links preserve context. Filtering resets the page; submitting errors retains the search. Applied-filter summaries explain what is affecting results. Pagination uses server totals and finite Previous/Next controls.

The dialog uses a 15-subject shortlist; it is not a new full-taxonomy browser. Book subject links can still route to their canonical subjects. The refreshed search does not include the old autocomplete suggestion interface; it offers direct title/author submission through the same backend search contract. No unsupported mood search or sorting options were added.

### Book cards and details

Cards show genuine cover imagery, wrapping titles, authors and both shelf actions. Covers preserve their proportions and use title/author artwork when images are absent or fail. Titles remain readable instead of being silently truncated.

Details show available title, subtitle, authors, subjects, conditional metadata, description, Own/Want controls, the existing share-image action and library/discovery links. Missing descriptions are explicitly acknowledged instead of invented. The original share functionality was reused, not rebuilt into a social-sharing system. The cleanup removes the initially added ISBN row and return-to-discovery promotional block. The simple context-preserving return link remains.

### Own/Want and saving through authentication

The UI retains the existing mutually exclusive **want** and **owned** statuses. Choosing the other shelf moves the book; choosing its selected shelf again removes it. The shared UserBooksProvider remains the source of truth.

Buttons wait for account startup and the initial library load, preventing a saved book from briefly appearing unsaved or being overwritten while its state is unknown. Duplicate requests are blocked per book. Selected state and success confirmations follow successful API writes. Failures retain the prior known state.

For an anonymous reader, tapping a shelf action opens an explanation tied to the chosen book. Its book ID, intended status and safe return route carry through login/registration. Saving resumes once after the authenticated library is ready. Failed continuation exposes a retry without repeating account creation. Discovery context is retained. An unfinished save notice does not follow the reader onto an unrelated book.

This reduces friction between finding a book and creating something worth returning to. It is a retention hypothesis, not a measured retention improvement.

### My Books

I provided Want/Own tabs with counts from the complete shared saved-book map, keyboard tab navigation and URLs preserving the selected shelf. Counts remain unknown while loading or after failure. Cards and detail controls share mutations, so shelf moves and removal update the visible collection.

Empty shelves explain how to start and offer discovery. Failed loads give retry without suggesting saved books were lost. Existing Bookshop links appear only when configuration and valid ISBN data permit them, with affiliate disclosure. They remain secondary to the library task.

### Preferences

Preferences must load successfully and pass response validation before they can be edited. The 15 suggested subjects resolve to actual tag IDs through the existing autocomplete API; existing saved subjects are merged into the choices. Failed initial loads cannot become a writable blank form.

Saving preserves selected IDs and the first existing **source_text** value, matching the prior UI behavior. This is not a new editable notes interface or a guarantee that differently valued per-tag notes are preserved individually. Failed saves retain current edits. Saving invalidates the authenticated browse view through a version key so the backend's preference ordering can appear.

Preferences are optional. The new onboarding route leads to preferences, but account creation for a pending save does not force that questionnaire before the book can be saved.

### Login, registration, account and recovery

I reused the existing AuthProvider and API clients. Forms use labeled email/password fields, show/hide password, password-manager support and permitted paste. Registration/reset guidance reflects the existing 8–128-character requirement. Switching between login and registration retains a valid pending-book intent.

The account page collects library, subject, appearance and sign-out access, giving mobile readers a clear home for settings. External or unsuitable return URLs are rejected.

Password recovery uses neutral account-existence messaging. Reset tokens are captured from the URL fragment into memory and removed from the address bar. Expired links offer a new link; recoverable failures retain the form. A second reset link can start a new attempt instead of inheriting a previous success screen. No mail provider, social login or new authentication method was added.

### Empty, loading, error and accessibility behavior

I added reusable honest empty/error states, stable loading skeletons, inline save errors, retry controls and success announcements. Old async responses cannot replace newer request state. Status-dependent controls remain blocked when the underlying library is unknown.

The UI includes labels, visible focus, a skip link, route-heading focus, active shelf states, keyboard shelf tabs and generally 44–48px action targets. Dialogs use native modal semantics plus focus cycling, Escape, trigger restoration and scroll locking. Mobile focus handling accounts for persistent navigation. Phone navigation hides while text fields are focused; selecting a checkbox does not trigger that behavior.

These are implemented accessibility provisions, not a complete accessibility certification. Contrast checks cover primary and muted text, enabled primary/saved actions, hover, form/filter boundaries, errors and focus in representative dark views, not every possible color pairing in every state.

### Motion

Controls use 140ms color transitions. Dialogs use a 180ms fade with a 6px entrance. Reduced-motion disables both. Skeletons do not shimmer. There are no animated book carousels, page-transition effects, gradients/glassmorphism treatment, or animation-library dependencies.

The motion acknowledges interaction and opening a dialog without competing with reading.

## Implemented charcoal palette and logo follow-up

**Light mode stays as implemented.** The Gemini reference is useful for visual direction, but does not replace the current light-mode hex values automatically.

| Dark-theme role | Implemented direction |
| --- | --- |
| Page | Warm charcoal **#1E1D1B** |
| Panels | Slightly lighter charcoal **#262523** |
| Primary text | Soft ivory **#EBE8E1** |
| Actions | Muted sage **#8FA89B** |
| Restrained accents | Softer rust **#D9826C** |

Charcoal now dominates the page, panels, cover surrounds and landing library banner. Sage belongs in purposeful actions, links and selected states; filled sage buttons use dark charcoal text. Light-mode styles remain unchanged.

Supporting dark colors are **#B6B1A9** for secondary text, **#8C867D** for control boundaries, **#4B4741** for decorative separators, **#2E2C29** for neutral hover/wash surfaces, **#2B2926** for cover surrounds, **#30332F** for subtly sage selected surfaces and **#F0A39E** for errors. Modal backdrops are neutral **#10100ECC**. Native controls use **color-scheme: dark**. Existing disabled opacity and control transitions remain.

The ivory/page pairing has approximately **13.8:1** contrast; sage/dark button text has **6.6:1**. Decorative separators are deliberately quieter than interactive boundaries. Browser checks cover rendered text, muted copy, saved/primary buttons, hover, input and filter-tile boundaries, error text and keyboard focus. This is targeted contrast verification, not a complete accessibility certification.

The logo's visual weight and color relationship also need review. The current dark-mode implementation puts the existing mark on a pale square; it is not a dedicated dark-mode logo. The recommendation is to explore refining the recognizable book/B mark and its theme treatment after the palette settles. No replacement logo has been approved or generated as part of this review.

## Deliverables and file map

| Deliverable | Files and purpose |
| --- | --- |
| Research and browser design | **docs/ui-v2/redesign/research-and-direction.md**, **README.md**, **index.html**, **gallery.html**, assets and export tooling: research, visual direction and an interactive design reference. |
| Figma preparation | **docs/ui-v2/redesign/figma-import/**: offline scene data and import helper. A Figma file was created, but the Starter MCP quota prevented populating it. The helper was not verified inside Figma; no finished native component library is claimed. |
| New application shell | **frontend/src/components/ui-v2/BookvaneApp.jsx**: routes, navigation, prompts and status announcements. **SaveContinuation.jsx** handles the pending shelf save beside the detail controls. |
| Page components | **DiscoveryPages.jsx**: landing, search/filters and details. **AccountPages.jsx**: auth, library, preferences, recovery and account. |
| Shared UI/state | **primitives.jsx**, **ReaderContext.jsx**, **readerState.js**, **data.js**, **recoveryIntent.js**: controls, cards, dialogs, theme and save coordination, request handling, API adapters and validated temporary recovery context. |
| Visual foundations | **frontend/src/styles/ui-v2/bookvane.css**, **ui-v2/assets/**: scoped styles, WOFF2 fonts and licenses. |
| Independent preview | **ui-v2/preview.html**, **preview.jsx**, **vite.config.js**: run the new UI without editing reserved entry files. It includes the existing global CSS and provider order. |
| Verification | **ui-v2/tests/reader-flows.spec.js**, **playwright.config.js**, **regression.config.js**, **launch-fixes.config.js**, **.gitignore**: UI browser checks, existing-regression adaptation, standard-entry desktop/mobile/WebKit launch tests and ignored generated outputs. |
| Review captures and handoff | [gallery.html](gallery.html), **screenshots/** and [README.md](README.md): 24 actual React captures and integration/run instructions. |
| This review | **ui-refresh-review.md**: complete change record, redundancy rationale and agreed follow-up direction. |

All filenames in the implementation rows are relative to **frontend/src/components/ui-v2/** unless a different directory is stated. Earlier local experiments under **docs/ui-v2/designs/** remain separate, untracked artifacts; they are not the implemented application or the pushed implementation commit.

Production reads actual API covers and data. The review screenshots use five real-title reference fixtures and publisher cover artwork; their count of five and sample descriptions are test data. Those fixtures are not imported into the application bundle.

## Engineering boundaries and integration

The UI work used existing React, React Router, Lucide and API/provider code. Native dialog replaced the initially proposed Radix dependency to keep shared manifests untouched. No backend, database schema, API client, provider, package manifest, lockfile or deployment configuration was edited by the refresh.

The user reserved **frontend/src/main.jsx**, **frontend/src/App.jsx** and **backend/main.py**. The refresh therefore shipped as separate components. The earlier activation concern applied to the remote **2176d16** integration state. It is resolved in the current base **67b6850**: the owner has already switched the standard App import to **./components/ui-v2/BookvaneApp.jsx**, retaining the providers and global CSS.

This launch pass leaves the reserved files and shared API/provider code unchanged relative to that base. Its only shared UI shell edit is **frontend/index.html**: Bookvane fallback title, **bookvane-theme** startup setting, OS fallback and matching page background/color scheme. The separate preview receives the same bootstrap. No merge, deployment or database writes occur as part of this UI pass.

No new analytics, notifications, streaks, reading-progress tracking, reviews, recommendation engine or community features were added. Existing subject ordering, sharing and affiliate links were reused or given new presentation. The initial landing updates form was removed in the simplification pass; its API remains unchanged.

## Verification completed

The [October 8 launch-fix handoff](launch-fixes-2026-10-08.md) contains the current production-entry and desktop/mobile results. The original 23 distinct charcoal UI checks and 23 legacy default-entry checks are retained as historical verification, rather than evidence of the current deployed site. The current standard suite also covers inherited auth/cookie ordering, startup retry, reset-token handling, preference integrity and first-tap navigation checks.

Responsive routes have checks at 320, 390, 768 and 1440px with long titles. The 24 review captures remain unchanged by this behavior-focused pass. Optional recovery storage holds only validated book ID, shelf, local return path and expiry for 30 minutes in the same tab; it never holds tokens, passwords or email. Failed writes keep pending intent for retry, and successful saves clear it even when made manually.

Tests intercept API operations and create no real accounts or shelf records. Live email delivery, hosted cookies/CORS, the owner's local setup, physical Safari/iOS devices and a native mobile package remain outside this verification. WebKit installation was attempted but blocked by the execution environment's network policy; matching tests remain available for independent QA.

## Recommended next pass

1. Revisit the logo against the settled themes; the current mark has not been redesigned.
2. Test the core journey with prospective readers on desktop and phones.

The remaining typography, real-cover cards, search context, simple shelves, optional preferences and reliable save flow form a useful foundation. Refinement should make that foundation quieter and more personal without expanding the feature set.
