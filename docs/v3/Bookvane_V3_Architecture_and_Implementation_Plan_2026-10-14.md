# Bookvane V3 — Your Personal Reading Home

Approved planning reference. Inspection statements below describe the planning review. See [the decision record](decision-record.md) and [M0/M1 report](m0-m1-report.md) for subsequent implementation and executed tests.

Architecture and implementation proposal · 14 October 2026 · For approval, not implementation

**Revision: library importing is required for the complete V3 public release.** Goodreads is the minimum widely used platform path; StoryGraph is also in the recommended V3 scope, implemented after the common import engine. This supersedes the earlier import deferral. Detailed contracts, evidence, safeguards, and acceptance tests are in the [V3 Library Import Architecture](Bookvane_V3_Library_Import_Architecture_2026-10-14.md), which forms part of this proposal.

## 1. Recommendation

Build a small, connected reading experience on V2—not a new application and not a broad reading-management platform.

The essential loop is:

**Find a book → save it, optionally with a reason → start reading → return to your place/context → finish or stop → choose what comes next.**

V3 should make that loop useful even when a person never writes a note, enters a page number, rates a book, or joins a challenge. Its value is continuity and easier decisions, not collecting the maximum amount of reader data.

My recommended first V3 release has seven capabilities:

1. A personal Home showing current reading and a small next-book shortlist.
2. A library that separates ownership, reading intentions, and reading history.
3. Reading attempts supporting concurrent books, pausing, DNF, and rereading.
4. Brief, optional private context—not a separate journaling product.
5. Explainable next-book guidance using the reader's shelf and existing catalogue data.
6. A private missing-book fallback, so catalogue coverage cannot prevent someone from using their reading home.
7. A previewed, resumable library import so readers can bring existing shelves and history instead of rebuilding them manually.

Keep progress entry lightweight. Defer goals and challenges until the core loop works and readers voluntarily return. Do not add paid AI, new hosting, a recommendation service, Redis, background workers, a search engine, or object storage.

**This is a proposed scope. The product decisions in section 16 need approval before implementation.**

## 2. What I actually inspected

### Scope and confidence

- Reviewed all 19 slides of `bookvane_v3_strategy.pptx`, including available notes and source links. The deck's features are recommendations, not implementation instructions.
- Inspected the active React entry point, UI-V2 routes/components/styles, auth and shelf providers, API client, search/discovery integration, backend models/schemas/routes/services, auth implementation, migration files, importer merge behavior, deployment configuration, and existing test code.
- Reviewed the earlier competitor/product-decision memo and relevant launch/recovery documentation as supporting context, not as proof of current runtime behavior.
- Inspected the existing desktop/mobile UI screenshots to preserve its visual language. These are saved implementation screenshots, not a new live-browser test.
- Checked the repository remotely without switching branches. Local `v2-codex` is at `67b6850bb8f59e97a1a4f595a880de5eae0ed179`. Remote `main` is `100ab702faf8baa17289f93caa36c1bd41c4c34a`; GitHub's comparison reports no file differences between that main tree and the inspected V2 commit. Main includes the V2 merge. This corrects older notes saying main had not received V2.
- Ran a narrowly scoped, explicitly read-only transaction against Neon for catalogue counts and tag coverage. No user emails, passwords, private notes, or account records were retrieved.

No application code, database schema, configuration, branches, deployment, or catalogue data was changed. No importer ran. Existing tests were inspected, **not executed anew**; this proposal does not claim a fresh passing test run or a new production audit.

### Current foundation and implications

| Area | Current implementation | V3 implication |
|---|---|---|
| Frontend | React/Vite/React Router; active `main.jsx` mounts `components/ui-v2/BookvaneApp.jsx` | Extend the active UI; do not accidentally build in the older, inactive `App.jsx` |
| Design | Existing typography, paper/green palette, dark theme, mobile navigation, native dialogs, error/empty states | Preserve these primitives and interaction quality |
| Backend | FastAPI, synchronous SQLAlchemy, PostgreSQL, Alembic | Add focused domain services inside this application |
| Authentication | Cookie-based access/refresh, rotation, reset/revocation, origin checks, session recovery | Reuse; no new identity provider or token architecture |
| Catalogue | Work-level Book, stable source IDs, authors, taxonomy, normalized editions/ISBNs | Keep Book IDs as the shared identity; reading history belongs to users, not the importer |
| Shelves | `UserBook.status` is either `owned` or `want`; one row per user/book | Cannot express an owned book that is also wanted, in progress, or finished |
| Shelf frontend | Fetches the entire nested shelf after authentication | Replace with bounded page queries and visible-book state lookup before adding history |
| Search | PostgreSQL substring search, filters, pagination; preference matching influences ordering | Reuse discovery/search; do not treat current ordering as a full recommendation engine |
| Preferences | User/tag links plus existing preference text | Preserve; do not reuse the global preference text as book-specific notes |
| Importer | Reconciles source-managed metadata/links and can delete stale edition rows | Reading context must survive edition replacement and changing page counts |
| CORS | Currently permits GET, POST, DELETE | New PUT/PATCH routes need corresponding allowed methods, without weakening origin restrictions |
| Deployment | Existing Render application/frontend and Neon; some README instructions still describe Vercel | Correct documentation during implementation; do not change hosting to match stale instructions |

### Measured catalogue support, 14 October

| Measurement | Result |
|---|---:|
| Books | 50,000 |
| Books with positive page count | 46,948 — 93.9% |
| Books with ISBN-13 | 48,012 — 96.0% |
| Books linked to a preferred edition | 49,720 — 99.4% |
| Books with nonblank description | 46,683 — 93.4% |
| Editions | 137,831 |
| Editions with positive page count | 109,164 |
| Database size returned by PostgreSQL | Approximately 172 MB |

Genre examples include fantasy 2,954, science fiction 2,204, mystery 2,482, and romance 2,290 books. Mood/theme coverage is uneven: Humorous 1,401; Suspenseful 776; Coming of age 81; Family 16; Friendship 24; Survival 26. There is no populated Cozy tag in the returned tag list. These are overlapping tag counts, not disjoint category allocations.

Consequences:

- A short/long preference can be useful, but a work's preferred-edition page count is only an approximation of the copy a person is reading.
- A large mood/theme onboarding questionnaire would promise more precision and coverage than the data supports.
- Start with broad supported interests, explicit shelf intent, ownership, and optional length. Offer narrower mood/theme choices only where the actual candidate set supports them.
- Database size is a point-in-time measurement, not a promise of available project quota. Other branches, future imports, indexes, and user data also matter.

## 3. Product judgment: build, defer, exclude

| Decision | Capability | Reason |
|---|---|---|
| Build | Reading Home | Gives returning readers a clear next action instead of another search page |
| Build | Independent Own and Want flags | Corrects the data model for real reading behavior while retaining familiar concepts |
| Build | Reading, paused, finished, DNF; reread history | Necessary for an honest reading lifecycle |
| Build | Optional latest progress | Useful resumption aid; no daily logging burden |
| Build | Optional save reason and one note per reading attempt | Preserves context without a journal subsystem |
| Build | Optional simple reaction on finish | Useful personal memory; not a public rating system |
| Build | Three explainable next-book choices, shelf-first | Reduces decision effort and works without a behavioral dataset |
| Build | Finish-and-continue flow, always skippable | Connects completion to the next decision without a forced funnel |
| Build | Private missing-book entry | A reader's current book cannot be an unsupported edge case |
| Build | Searchable, paginated personal library | Necessary for readers bringing substantial shelves |
| Build | Clear correction/removal controls and private-data export | Notes/history increase the responsibility to give users control |
| Defer | Annual reading goal | Small later enhancement, not a prerequisite for the reading home |
| Defer | Challenges, streaks, badges, advanced statistics | Different motivation model; adds dashboards and obligations before the loop is proven |
| Defer | Full journal, timestamped note entries, quotes/highlights, rich text | Expands storage/editor/privacy scope without proving added reader value |
| Build | Goodreads CSV import, then StoryGraph and Bookvane CSV adapters | Required adoption path; one shared preview/matching/apply engine, delivered after the reading foundation |
| Build | Private preservation of imported ratings, reviews, notes, and shelf labels | Migration must not erase meaningful source information or force it into unrelated native fields |
| Defer | Live Open Library missing-title lookup | Helpful later; private fallback avoids adding an upstream dependency to the critical flow |
| Defer | Series completion/order recommendations | Existing schema lacks dependable series/order metadata |
| Defer | Automatic taste learning from reactions | Begin with explicit preferences; a few reactions should not redefine a reader |
| Defer | Borrowing/due dates, copies, loan management | Reading a borrowed book works without building a lending product |
| Defer | Advanced ML, vectors, collaborative filtering, recommendation jobs | Unnecessary for the initial decision-support experience |
| Defer | Native apps, offline synchronization, push reminders | Separate platform and conflict-resolution scope; responsive web first |
| Exclude from V3 | Social feeds, followers, clubs, public reviews | Outside the chosen personal reading-home direction |
| Exclude from V3 | Paid LLMs, AI chat/journaling, generated book facts | Cost and trust risk; not needed for the core loop |
| Exclude from V3 | Marketplace, ebook reader, B2B platform, monetization-led navigation | Distracts from loyal reader usage |

I am deliberately combining “tracking,” “memory,” and “finish” into the same book workspace. Next Read is part of Home and finishing, not another independent application tab. Goals can fit later as a quiet optional Home card; they do not need an engine now.

## 4. Experience and navigation

### Primary destinations

- **Home:** signed-in default; current reads, saved context, next choices.
- **My Books:** the complete personal library, search, filters, and history.
- **Discover:** preserve existing browse/search and book pages.
- **You:** account, preferences, theme, privacy/export; keep this lightweight.

On mobile, use four compact bottom destinations: Home, Discover, My Books, You. On desktop, use Home/My Books/Discover with account controls in the existing header. No separate Notes, Stats, Challenges, or Recommendations tab.

Keep existing URLs working. Add `/home` and a private `/my-books/:entryId` workspace. Keep `/book/:bookId` as the public catalogue detail route. A public book detail can show a separately fetched “Your reading” section to its owner; private notes must not enter the public book payload.

The anonymous landing page remains discovery-led. After sign-in, honor an existing safe return path or pending save/start action first; otherwise open Home. Do not redirect readers away from an intentional search/book deep link.

### Home hierarchy

1. **Your current reading:** show up to three active reads; “See all” supports unlimited concurrent different books. Each card has title, optional last progress, and a link to the reader's workspace. No false “Read now” button suggesting Bookvane contains the ebook.
2. **What next?** Up to three choices, normally from Want. One truthful reason per book. A small optional intent control—such as shorter, an interest, or owned only—refines them.
3. **Recent finish:** a quiet reminder of a recent reaction/history entry when present, not a feed or an achievement wall.

Paused reads remain easy to find, but do not crowd active reading or get suggested as new books. Home must not become a dense dashboard of every supported field.

### Journey rules

| Situation | Proposed behavior |
|---|---|
| Brand-new account | Two optional entry actions: “Add what you're reading” or “Find something to read.” No mandatory taste survey |
| Arrives with an existing library | Prominent “Bring your books” option during setup and in My Books/You; preview and import, then go directly to populated Home |
| Existing V2 user | Own/Want already present. Explain once that ownership and reading are now separate. Do not label existing owned books finished |
| Saves a book | Save immediately; offer “Why did this catch your eye?” as an optional follow-up, never an interrupting required dialog |
| Starts reading | One action creates an attempt and removes the existing Want flag. Ownership stays unchanged. Progress/date/notes are optional |
| Reads multiple books | Each book has its own active attempt. Home previews a few; library shows all |
| Wants a reread | Want may be set on a previously finished/DNF book. History remains intact. Starting again creates another attempt |
| Pauses | Same attempt becomes paused; no forced end date or negative reaction |
| Resumes a pause | Resume the same attempt, preserving notes and progress |
| Stops/DNF | Explicit action closes the attempt. Reason and date are optional; no shame language, no automatic dislike |
| Returns after DNF | Offer “Resume that reading” or “Start again.” They have different history meanings |
| Finishes | Mark finished first. Reaction/context is optional; choosing the next book is also optional |
| Adds an already-read book | Create a finished historical attempt; unknown reading dates remain unknown, not “today” |
| Mistaken finish/DNF | Reopen/correct the same attempt if no conflicting active attempt exists; don't manufacture a reread |
| Does not track/journal | Save → start → finish still works. Nothing prompts repeatedly for missing progress or notes |
| Book not in catalogue | Create a clearly private title/author entry and continue the same lifecycle |
| Search returns nothing | Offer a useful retry and private-entry action; do not treat a network failure as an empty catalogue |
| No Want books | Offer discovery. Do not silently mix unfamiliar catalogue titles into a section labelled “From your shelf” |
| Recommendation has no match | Explain which filter is restrictive and offer to relax it; never silently violate “owned only” |
| Server is waking up | Preserve current session-recovery behavior and show a bounded waiting/retry state; no fake logged-out or empty shelf |

### Ownership, access, and effort

Recommendation: keep an **Own** flag, not a full access-management system. “Not marked owned” does not mean unavailable, unaffordable, or definitely not owned. Borrowed/library/audiobook readers can start any book without changing Own. An owned-only filter is optional, never the default eligibility gate.

Every important action should be doable without opening a complex form. Progress and notes use explicit Save, not a request on every keystroke. Start/finish do not require completing “setup.” Preserve the current typography, cover treatment, spacing, dark theme, keyboard support, and first-tap mobile navigation.

## 5. Domain model and state transitions

### Separate three concepts

| Concept | Stored where | Meaning |
|---|---|---|
| Catalogue work | Existing `Book` | Shared bibliographic identity, authors/tags/editions |
| Reader's relationship | Extended existing `UserBook` | Own, Want, save reason, private fallback, concurrency version |
| One reading attempt | New `ReadingAttempt` | One start/resume/finish/DNF cycle, optional context/progress/reaction |

```text
User ──< UserBook >── Book ──< Edition
             │                 (shared catalogue)
             └──< ReadingAttempt
                   └── optional Edition reference + durable context snapshot

UserBook may instead represent a private missing-book entry.
That private entry is never a public catalogue Book.
```

This is ordinary relational modeling, not event sourcing. The reading lifecycle adds one principal domain table and extends an existing relationship. Required library importing adds the separate run, staging, source-record, and read-link tables described in the import companion; they preserve provenance and retry safety rather than introducing another reading-state model. A new “current status” column on Book would be wrong because books have many readers; replacing Own/Want with one giant status enum would also be wrong because ownership and reading coexist.

### Proposed `UserBook` changes

Preserve existing integer IDs, user IDs, book links, and timestamps.

| Field | Proposed role |
|---|---|
| `is_owned` | Boolean; explicit ownership marker |
| `is_wanted` | Boolean; queued intention, including an intentional reread |
| `save_note` | Optional plain text, initially capped at 500 characters |
| `version` | Non-null integer incremented by every reader mutation on this entry or its attempts |
| `book_id` | Existing catalogue FK; nullable only for an explicit private entry |
| `private_title`, `private_author` | Private fallback text; title required for a private entry, author optional |
| `create_request_id`, `creation_fingerprint` | Optional UUID and immutable intent hash for retry-safe creation of a private entry |
| Existing `status` | Retained temporarily, made nullable for records with no legacy shelf; compatibility data, not the eventual V3 source of truth |

A constraint requires either a catalogue book or a private title, never both identities simultaneously. For catalogue-backed rows, private title/author fields remain empty. Do not create globally shared authors or tags from private text. Keep unique `(user_id, book_id)` for catalogue entries; private titles are not identities, so two same-named books are not silently merged. Warn about likely duplicates in that user's own library, but let the user decide.

The fallback lives on the existing user/work relationship because it has no shared catalogue lifecycle. A separate public “user-submitted Book” would contaminate catalogue identity and require moderation. A separate private-book table becomes worthwhile only if private entries later gain independently managed editions or multiple relationships beyond this reader's library.

Do not add cover uploads or user-provided external image URLs. Private entries use the existing attractive missing-cover treatment. Later linking to a catalogue work must be explicit and preserve the entry/attempt IDs; if another entry for that work exists, merging requires a designed reconciliation flow. Automatic title-based linking is excluded.

### New `ReadingAttempt`

| Field group | Proposed data |
|---|---|
| Identity | UUID primary key; `user_book_id` FK |
| State | `reading`, `paused`, `finished`, `dnf` |
| Dates | Optional `started_on`, `ended_on` as reader-entered dates; separate UTC creation/update timestamps |
| Progress | Optional unit `pages` or `percent`, integer value, optional saved total pages |
| Edition context | Optional `edition_id`; source key and selected format/page-total snapshot where applicable |
| Memory | Optional plain-text `note`, initially capped at 2,000 characters |
| Reaction | Optional `loved`, `liked`, `not_for_me`; unset is valid |
| Creation/retry | Immutable creation-intent fingerprint for repeat-safe creation with the same UUID |
| Attribution | Optional small `started_via` enum, e.g. library, discovery, next_read; never free-text analytics |

The attempt note is the same optional space during and after reading—“Where I left off / what I want to remember.” It is not an ever-growing stream of journal entries. Saving edits changes that note; rereading creates a separate attempt and therefore a separate note. The save reason stays at the library-entry level.

Imported source reviews/private notes and numeric ratings are preserved separately, with source labels and their own bounded limits. They do not overwrite the native 2,000-character note, become a new public review system, or get converted into loved/liked/not-for-me reactions. The reader can view/export them from the same book workspace.

One attempt may be active or paused per library entry; different books may be read simultaneously. Use a partial unique index on `user_book_id` for states reading/paused. PostgreSQL supports conditional uniqueness directly. [PostgreSQL partial-index documentation](https://www.postgresql.org/docs/current/indexes-partial.html)

### Transition contract

| From | Action | Result |
|---|---|---|
| No active attempt | Start | New reading attempt; clear existing Want; preserve Own/context/history |
| Reading | Pause | Same attempt, paused |
| Paused | Resume | Same attempt, reading |
| Reading/paused | Finish | Same attempt, finished; optional end date/reaction/note |
| Reading/paused | Stop | Same attempt, DNF; optional end date/reaction/note |
| Finished/DNF | Start again | New attempt; previous attempt remains unchanged |
| Finished/DNF | Correct/reopen | Same attempt restored to reading, if no other active attempt exists |
| No active attempt | Record past finish/DNF | New historical attempt with optional known dates |

Finishing or DNF does not change ownership. Starting clears the queue flag that existed at that time; later user changes to Want remain explicit and are not silently reset by finish. Removing Want does not erase history, notes, or ownership. Removing Own does not mark a book unread or unwanted.

Reopening a terminal attempt clears its end date and preserves its note/progress; a user can explicitly edit the reaction. If another attempt is already active, return a conflict rather than closing that other attempt automatically. One stable identity represents a correction; a new identity represents a genuine reread.

“All,” “Want,” and “Owned” are library facets, not mutually exclusive shelves. Reading/Paused/Finished/DNF views are derived from attempts; a reread can have historical finishes and an active attempt. Default library cards show active state first, otherwise the latest attempt, with history accessible. Do not store a second independently editable summary state that can drift from history.

### Progress and dates

- No progress value is required. No daily progress-event table in core V3.
- Pages require a positive integer total when displaying a percentage; unknown total supports a page number without a percentage. Percent accepts 0–100.
- Validate values in the API and database where practical. Allow corrections downward; a progress decrease is not necessarily an error.
- Reaching 100% does not silently finish the book. Finishing need not invent a last-page value; status and progress are distinct.
- A preferred-edition page total may prefill the form, clearly editable for the reader's copy. It is snapshotted, not continuously reread from Book.
- If an import removes the linked edition, `ON DELETE SET NULL` preserves the attempt and its snapshot. No reading history cascades from an edition deletion.
- Dates may be unknown. If both start and end exist, end cannot precede start. Current actions may offer the user's local date; historical entries do not default to a fabricated reading date. Creation time remains separately available.
- No reading-speed prediction, chapter detection, audiobook time conversion, or estimates of “days to finish” in this release.

### Removal and privacy semantics

Unchecking a flag is not deletion. A record with context/history remains accessible in All/history even if neither Own nor Want is set. Empty relationship rows can be removed only when neither flag, context, nor an attempt remains.

Provide an explicitly labelled “Delete this reading record” action for an attempt, and “Forget this book and its private history” for the entire library entry, with confirmation and impact explained. These operations never delete the shared catalogue Book. Account deletion procedures must include the new rows. Avoid unnecessary soft-deletion retention of private notes; explain that recovery backups may retain data for their configured retention period.

## 6. Recommendation design: useful without AI

### Start with decision support, not prediction

Next Read should say why a book is a reasonable option now, not claim to know whether someone will love it. No personalized satisfaction percentages, fabricated moods, inferred tropes, or reading-time claims.

Initial default source: the reader's Want queue. Exclude active/paused books. Previously finished or DNF books are eligible only when the reader explicitly put them back in Want; label them as revisits. A private queued book remains eligible on queue/ownership evidence even without catalogue tags.

When the queue is empty, offer a separately labelled “Explore something new” action using the catalogue. Do not pad a two-book queue with unrelated books merely to show three cards.

### Candidate and ranking flow

1. Apply explicit filters in SQL: shelf or catalogue mode, owned-only if chosen, supported interest, optional known page-count threshold.
2. Calculate inexpensive scores over eligible rows in SQL rather than downloading the entire personal library.
3. Return a bounded candidate set, initially up to 60 lightweight rows, hydrated in batches—not one query per candidate.
4. Select up to three with author diversity when alternatives exist. Use stable book identity as the final tie-breaker, not dump/import order or raw low IDs.
5. Return reason codes and their factual values; frontend renders approved wording.

Suggested initial ranking—not a learned or proven model:

- Explicit current interest match: strongest signal.
- Existing stated preferences: a smaller signal, capped so a heavily tagged book does not dominate.
- Marked owned: a modest convenience preference unless the reader explicitly enabled owned-only.
- Optional shorter choice: uses reported page count, not a claim about pace or emotional difficulty.
- Stable rotating tie-break among equally suitable candidates, held stable during one decision session.

Candidate generation must include the best matches across the eligible shelf, not merely its most recent 60 entries. For larger shelves, SQL does eligibility/scoring and limit; Python only diversifies the bounded result. No recommendation request loads every note or attempt.

Show fewer than three if necessary. “Show different choices” rotates within the eligible pool without changing preferences or implying rejection. Keep a small decision-session exclusion list; do not create an enduring behavioral profile from every skipped card. Avoid arbitrary global `ORDER BY random()` over the full catalogue.

### Honest explanations

Allowed examples:

- “On your Want list.”
- “You marked this as owned.”
- “Matches your fantasy preference.”
- “About 240 pages in our listed edition.”
- “You saved this because: [their exact private note].”

Disallowed without new evidence: “Fast paced,” “political intrigue,” “perfect for your mood,” “your friend recommended this,” “next in your series,” or “you can finish this tonight.” Free-text notes are displayed, not interpreted by an LLM or guessed keyword classifier.

Preserve the current `visible_in_v2` behavior in existing endpoints. A separate V3 recommendation-options response can expose a reviewed subset of existing hidden taxonomy with genuine candidate coverage. Do not globally turn every topic/mood/theme into a V2 chip.

The exact-subject taxonomy remains deterministic. The sparse mood/theme measurements argue for modest, coverage-aware options—not a classification project inside V3. If richer classification is later needed, it should be separately reviewed and provenance-aware.

## 7. Backend architecture and API contract

### Keep the existing application boundary

```text
React pages/components
    ↓ existing credentialed API client
FastAPI private routes + existing auth/origin/rate-limit protections
    ↓
Library / reading / next-read services
    ↓ existing SQLAlchemy session, transaction per command
Neon PostgreSQL

Catalogue importer remains a separate operational path.
It never owns reader notes, progress, reactions, or history.
```

Suggested responsibility boundaries, not a mandatory large file migration:

| Area | Responsibility |
|---|---|
| Existing `models.py` | Extend UserBook; add ReadingAttempt with constraints/indexes |
| `reading_schemas.py` | Private request/response contracts, state/progress validation; leave public BookSchema intact |
| `routes/library.py` | Authenticated library, entry lookup, private-entry creation/removal/export |
| `routes/reading.py` | Attempt creation, transitions, progress/context updates |
| `routes/reading_home.py` | Home and next-choice read endpoints |
| `services/library.py` | Owned/wanted changes, bounded queries, private identity and ownership checks |
| `services/reading.py` | State rules, snapshots, retries, concurrency, atomic transitions |
| `services/next_read.py` | Candidate SQL, deterministic ranking/diversity, factual reasons |
| Existing user-book service/routes | Temporary compatibility path; no second independent lifecycle implementation |
| `routes/library_imports.py`, `services/library_imports/` | Owner-only import runs, versioned format adapters, batch matching, preview, conflict resolution, and apply/checkpoint services; details in the companion |

No generic repository layer, plugin framework, event bus, service-per-feature deployment, or broad refactor of auth/importer is needed. Extract a shared query helper only when real duplication exists. Routes validate/authenticate; domain services enforce rules; one transaction surrounds the complete command. Helpers must not commit halfway through it.

### Proposed endpoints

Paths are a proposed contract to approve before coding. All `/me/...` endpoints require authentication and derive the owner from the session, never a supplied user ID.

| Method/path | Purpose and bounds |
|---|---|
| `GET /me/reading-capabilities` | Whether this account can use V3; supported contract version |
| `GET /me/home` | Bounded active-reading preview, counts, recent finish, up to three next choices |
| `GET /me/library` | Query, facets, stable cursor pagination; default 25, maximum 100 |
| `POST /me/library/lookup` | Read-only state lookup for at most 50 visible catalogue book IDs; no notes by default |
| `GET /me/library/{entry_id}` | Owner's detail, current attempt, brief context; history separately paginated |
| `PUT /me/library/books/{book_id}` | Ensure catalogue entry and set explicit Own/Want values; unique user/book prevents duplicates |
| `POST /me/library/private` | Create private title/author with a client request UUID; retry-safe |
| `PATCH /me/library/{entry_id}` | Explicit flags/save reason/private metadata, with expected version |
| `GET /me/library/{entry_id}/attempts` | Paginated reading history |
| `PUT /me/reading-attempts/{attempt_uuid}` | Create one attempt with a stable client UUID and initial intent; retries do not create rereads |
| `PATCH /me/reading-attempts/{attempt_uuid}` | Validated state/progress/note/reaction correction, with expected entry version |
| `DELETE /me/reading-attempts/{attempt_uuid}` | Explicit confirmed history removal, version checked |
| `DELETE /me/library/{entry_id}` | Explicit confirmed forget operation; never implied by unchecking Want |
| `GET /me/next-read` | Bounded choices plus reasons and applicable options; explicit source/intent |
| `GET /me/reading-export` | Owner-only bounded/streamed export of their entries and attempts, no server-side archive |
| `/me/library-imports/...` | Upload batches, preview, resolve, confirm, advance, resume/cancel, and owner-only results; separate from administrative catalogue ingestion |

Use specific DTOs: library summary does not include the full description, all editions, or all history; detail can fetch what its screen actually needs. Public `/books`, `/books/{id}`, and autocomplete retain existing public shapes. Existing search filters and public Own/Want counters need deliberate adaptation to the new independent flags, retaining the current small-count privacy threshold and ignoring private entries.

### Consistency, retries, and authorization

- Every operation resolves an entry through the authenticated owner's user ID. Another user's entry/attempt returns 404, including nested history, export, and mutation paths.
- Lock the parent UserBook row for state transitions; verify expected version; perform all changes and increment the version in one transaction.
- The partial unique active-attempt index is a database backstop against concurrent starts.
- Create requests reuse a stable client UUID on retry. Store/compare an immutable creation fingerprint. A repeated UUID with matching intent returns the existing result; a different intent returns conflict. Never return another user's resource on a UUID collision.
- Ensuring an existing catalogue entry without changes is idempotent. Changing its flags requires the expected version, just like PATCH; an upsert is not permission to overwrite a concurrent edit. Unspecified flags remain unchanged. Guest save continuation is an explicit ensure-Want/ensure-Own operation, never a toggle.
- A stale edit returns a structured 409 with safe refreshed state. Keep the user's unsaved draft visible and offer reload/reapply; do not silently overwrite another device's note.
- After a lost response, retry creation with the same identifier or re-read state. Never blindly repeat a “start again” action with a new UUID.
- Existing SQLAlchemy versioning does not automatically protect bulk update/delete paths. Implement explicit version predicates/row locks consistently in these services, including compatibility writers. [SQLAlchemy version-counter documentation](https://docs.sqlalchemy.org/en/20/orm/versioning.html)
- Retain cookie authentication, origin checks, refresh behavior, and rate limits. Add PUT/PATCH to the allowed CORS methods and verify actual preflights; do not use wildcard credentialed origins.
- Return understandable validation/conflict messages. Log operation/error codes and correlation IDs, not note bodies, private titles, passwords, or tokens.
- Private responses should use `Cache-Control: private, no-store`. Do not put personal state in public/CDN caches or public share images.

## 8. Frontend structure and state

Extend the working UI shell rather than forking a parallel UI framework. Keep existing CSS tokens, fonts, BookCover, buttons, dialogs, empty states, loading/retry patterns, and route-focus/mobile fixes.

Suggested additions:

```text
components/reading/
  ReadingHomePage.jsx       Home composition and bounded sections
  LibraryPage.jsx           Search, facets, pagination; replaces whole-shelf filtering
  ReaderBookPage.jsx        One reader/book workspace and attempt history
  ReadingControls.jsx      Start, pause, finish, DNF, correction dialogs
  ReadingContextForm.jsx   Optional note, reaction, progress controls
  NextReadSection.jsx      Shared by Home and finish flow
  PrivateBookForm.jsx      Missing-book fallback, no public catalogue writes
api/
  reading.js               Private endpoint wrappers using existing client
hooks/
  ReaderLibraryContext.jsx Visible-entry state, session scope, mutations/invalidation
```

These are responsibility groupings, not a requirement to create a file for every button. Keep public catalogue components separate from private reading details; share presentation primitives.

### Replace the whole-library dependency

Today, shelf buttons depend on loading every saved book. V3 must not attach every attempt/note to that startup request.

- Page queries fetch their own bounded results.
- A visible catalogue page sends one bounded lookup for its book IDs, not one request per card.
- The provider holds current visible/library state and mutation invalidation, not the complete account history.
- Unknown private state is distinct from “not saved”; controls wait or offer retry rather than overwrite an unverified entry.
- Scope private state/in-flight deduplication to a session generation, not merely an authenticated boolean. Clear it on logout, session expiry, or account switch. Late responses from the previous account must not populate the next account's UI.
- Mutations update the returned entry and invalidate affected Home/library/next-choice queries. Do not refetch the whole catalogue or all history.
- Preserve pending save/start intent through login, with explicit ensure semantics rather than a toggle that can accidentally undo a save on replay.
- Reuse the existing single-flight refresh and network-vs-expired-session distinction. No auth rewrite is required.

For this scale, ordinary hooks/context plus the existing client are sufficient. A server-state library is an alternative if implementation demonstrates repeated cache/invalidation bugs; do not add it preemptively alongside a second cache system.

Notes remain in component memory while editing. No persistent localStorage copy of private notes by default. Warn before leaving an unsaved edit, preserve the draft after a failed save, and provide explicit retry. Offline durable drafting/sync is a deferred feature, not an implicit guarantee.

Accessibility work includes textarea focus styles alongside existing button/input styles, labels, announced save/error states, non-color status indicators, dialog focus return, keyboard operation, adequate mobile touch targets, and no unsolicited focus/scroll jumps.

## 9. Migrations and V2 preservation

### Additive migration sequence

1. Before implementation deployment, confirm the then-current migration head and actual target schema; the inspected repository head is `d9b6e1f2a3c4`. Recheck rather than assuming this will remain unchanged. Upgrade the existing database from its recorded head; do not replay historical table-recreation migrations or use an unverified Alembic stamp to bypass differences.
2. Add new nullable/defaulted fields and the ReadingAttempt table without dropping old UserBook columns or rebuilding the catalogue.
3. Backfill existing `owned` to `is_owned=true, is_wanted=false`; existing `want` to the inverse. Preserve IDs and original timestamps. Do not infer reading state, completion dates, or previous notes.
4. Deploy compatibility-aware backend writes before enabling V3. While V2 is active, legacy changes keep the new flags synchronized with existing V2 exclusive-shelf behavior.
5. Add/validate appropriate constraints and indexes. Rehearse on a separately credentialed disposable database with representative existing data and full migration history—not only `create_all`.
6. Deploy the V3-capable frontend with the server capability flag off. Verify V2 flows still work.
7. Enable a small pilot, then expand after acceptance tests. Retain compatibility schema during stabilization; column removal is not part of the first V3 release.

### Stale clients and rollout

Old V2 mutations cannot express V3's independent ownership, queue, and reading history. In particular, today's DELETE shelf operation physically deletes UserBook. Allowing that path to cascade through reading attempts would be unacceptable.

Recommendation: once an account is V3-enabled, reject legacy shelf mutation routes with a controlled 409 explaining that the page needs refreshing. Continue legacy reads as a limited projection. New clients use V3 endpoints; V2-only accounts keep the old behavior until enabled. Do not silently reinterpret a stale client's destructive action.

A simple server capability flag and small pilot allowlist are sufficient; no feature-flag service is needed. The V3 frontend must support the disabled/legacy mode until rollout is complete. The precise flag/allowlist representation should remain small and operationally documented.

For legacy read projection, owned takes precedence when both flags are true; neither flag maps to null. Exclude private entries and entries with neither flag from the old `/me/books` response so its required public Book/status schema remains valid. This is explicitly lossy compatibility, never a source for reconstructing V3 state. Public ownership/want counts and search filtering must read canonical fields for migrated/enabled data, with tested transitional behavior.

### Referential integrity and indexes

- Retain unique user/catalogue-book relationship and stable Book IDs.
- Index library access by `(user_id, updated_at, id)` and applicable queue/ownership predicates if query plans justify them.
- Index attempts by `(user_book_id, created_at, id)`; add the partial unique active/paused constraint.
- Unique `(user_id, create_request_id)` prevents duplicate private entries on retries when a request ID exists.
- Enforce valid states/progress/date relationships and bounded text in the schema/API.
- Preserve user deletion cascades for private data. Change catalogue-book deletion behavior to restrict removal of referenced personal entries, rather than accidentally cascading away reading history. This requires both the database FK change and removal of the current `Book.user_books` ORM delete-orphan cascade; a database restriction alone would not stop the ORM deleting children first. The importer already retains deleted-source books; this reinforces the same preservation rule.
- Edition references use SET NULL, not cascading history deletion. Validate that a selected edition belongs to the entry's catalogue work within the write transaction.
- Existing catalogue IDs, author identity rules, edition ISBNs, preference IDs, taxonomy provenance, importer checkpoints, and source-managed field rules remain intact.

Do not add an index for every filter combination. Use EXPLAIN on actual library/Home queries before adding more. Preserve existing title/author trigram indexes and bounded import behavior.

### Rollback is not data erasure

Take an approved fresh recovery point before applying migrations; the old prelaunch checkpoint is not a backup of future V3 activity. Rehearse recovery and measure free-tier capacity before creating another retained database branch.

Before V3 writes, disabling the feature can return to V2. After readers create V3 history, an old application binary is not a safe rollback target: it can delete or misinterpret richer data. Keep the compatibility-aware backend and disable new writes or show a read-only library if necessary; prefer a forward fix. Do not downgrade away the new tables or restore an old database over new user activity as an ordinary rollback.

## 10. Cost, performance, and infrastructure

**Infrastructure added: none.** Keep the existing Render frontend/API, Neon database, Resend password delivery, and existing CI/testing tools. New tables/routes/components are application changes, not new hosted services.

This is not a promise of indefinitely free operation. The proposal minimizes new cost drivers:

- Short capped text, latest progress only, bounded read responses.
- No raw recommendation-event firehose or daily reading logs.
- No uploaded images, document attachments, embeddings, external ranking API, or background scoring jobs.
- No full-library hydration at startup, per-card status requests, or per-candidate database queries.
- Catalogue imports retain their own storage controls; user-data growth must be included in future import headroom.

The measured database is about 172 MB, but remaining project capacity must be checked at rollout. Estimate V3 capacity from measured table/index growth on realistic synthetic readers, not only empty-table sizes or Book counts. Record bytes per library entry, attempt, and populated note; multiply by plausible active-reader/shelf distributions and reserve room for migrations, indexes, backups/branches, and import staging.

Suggested test populations: 100-entry, 1,000-entry, and 10,000-entry individual shelves, with several attempts per reread book and realistic note sizes. These are test fixtures in isolated databases, never fake production catalogue data.

Initial engineering targets, to verify rather than promise:

- Warm Home/library requests: target p95 under 750 ms at modest pilot concurrency, reported with environment and data size.
- Home/library query count does not grow linearly with returned books; no N+1 author/tag/attempt queries.
- One Home aggregate request; one lookup per visible catalogue batch; no keystroke write loop.
- Pagination payload bounded by page size; notes/history omitted from summaries where unnecessary.
- Existing pool connections remain bounded; no connection held while waiting for an external book service.

Render cold starts are a separate observed experience constraint. Keep honest loading/retry states and test them; V3 cannot remove cold starts through schema design. Do not add unauthorized always-on upgrades or synthetic keepalive traffic.

## 11. Missing catalogue and required library importing

### Recommended now: private fallback

Advantages: immediate continuity, no external dependency, no shared catalogue pollution, no new paid storage. Tradeoff: missing metadata means weaker recommendations and possible duplicate private records. A private entry can still be owned, queued, read, finished, and remembered.

### Alternative: on-demand Open Library lookup

This could provide better bibliographic coverage, but needs server-side input validation, caching, stable source-ID deduplication, rate control, timeout/fallback, and careful integration with importer provenance. It should be triggered by an explicit human lookup, not automatic crawling or one request per existing book. Open Library distinguishes human-facing lookup from bulk access and asks clients to identify themselves and cache; bulk ingestion should remain dump-based. [Open Library API usage guidance](https://openlibrary.org/developers/api)

Recommendation: defer this enhancement, not the missing-book escape hatch. Do not start another import to solve the V3 interaction problem.

### Required adoption path

Server pagination solves browsing a large shelf; importing solves bringing it into Bookvane. Both are required for the selected audience. The public V3 release must include at least one tested widely used platform import. Recommend Goodreads first, StoryGraph second within the same milestone, plus a small versioned Bookvane CSV template for personal spreadsheets. StoryGraph remains planned V3 work; any source-specific deferral requires an explicit decision, not a silent scope reduction.

Use one owner-scoped, preview-first import engine with source adapters. A browser reads the user's selected CSV incrementally and submits bounded batches to the existing backend. PostgreSQL holds temporary normalized rows and durable progress. Matching is local and batched across edition ISBNs and work metadata. No external API lookup per imported book, no background worker, no raw-file object storage, and no production catalogue import are required.

Preview additions, duplicate skips, conflicts, private fallback records, and unsupported fields before confirmation. Exact ISBN matches must resolve to one work; title/author ambiguity is never guessed. Repeated uploads use persistent source identities and reading-event links, not filename or CSV row number alone. Existing native state wins by default; imports never delete an absent source row from Bookvane or replace preferences.

Preserve imported ratings/reviews/notes/custom shelf labels privately and separately from Bookvane's native reactions, notes, and shared taxonomy. A review must not be silently truncated to fit the short-note field. Dates absent from the export remain absent; an aggregate Read Count cannot manufacture dated rereads.

Importing runs late in V3, after M1–M4, but before public release. The full field matrix, matching hierarchy, schema additions, API contracts, constraints, limits, resume behavior, test cases, and remaining approval decisions are in the [V3 Library Import Architecture](Bookvane_V3_Library_Import_Architecture_2026-10-14.md). This companion is part of the implementation specification, not an optional future idea.

## 12. Test strategy

### Existing tests to retain

The inspected suites include auth/login/reset/refresh concurrency and revocation, user isolation, concurrent shelf creation, preference replacement, catalogue search/pagination/tag resolution, importer normalization/merge/resume/storage behavior, and browser tests for auth state, saves, navigation, and mobile interactions.

Those suites cover valuable V2 behavior but do not test V3 features that do not exist. Some browser suites use mocked API responses; real browser/API/database coverage must remain separate and explicit. Historical passing counts are not a substitute for a fresh milestone run.

The backend fixtures delete catalogue rows. Never run them against production or a recovery branch. Tests require a separately credentialed disposable database, the existing isolation guard, and verified target identity. A similarly named database is not sufficient proof of isolation.

The new deletion protections require isolated fixtures to clear test attempts/library relationships before deleting test books. Adjust cleanup order explicitly; do not weaken production constraints to keep an old fixture working.

### Required additions

| Area | Acceptance tests |
|---|---|
| Migration | Upgrade representative V2 data; unchanged Book/UserBook/preference IDs; exact Own/Want backfill; no invented history |
| Lifecycle | Every allowed and disallowed transition; concurrent different books; pause/resume; DNF/reopen/new attempt; rereads; unknown dates |
| Concurrency | Double tap, concurrent starts, start versus finish, stale note overwrite, network loss after commit, repeated UUID with different intent |
| Authorization | Two users attempt every private read/write/export using each other's entry and attempt IDs; all fail safely |
| Privacy | No notes/private titles in public book/search/share responses, caches, URLs, or logs; account switch cannot show stale private state |
| Progress | Missing totals, alternate edition, correction downward, invalid range, explicit finish without progress, edition replacement by importer |
| Library | Independent Own/Want, stable pagination, large shelves, filters with rereads, lookup limits, unknown versus absent state |
| Missing books | Unicode titles/authors, optional author, duplicate suggestions, retry-safe create, private isolation, no public catalogue writes |
| Recommendations | Whole eligible shelf considered; correct exclusions; explicit rereads; sparse tags; private entries; diversity; truthful reasons; empty pool |
| Context | Optional fields really optional; plain-text/XSS handling; length limits; failed-save draft retention; clear/delete/export |
| V2 compatibility | Flag off remains V2; synchronized backfill; stale V2 writes rejected after enable; legacy delete cannot erase attempts |
| API/browser | PUT/PATCH CORS preflight, secure cookies, refresh during mutations, reset revocation, logout, return-path/save intent |
| UI | Phone and desktop, dark/light, keyboard/screen reader, focus return, first tap, back navigation, slow network, empty/error states |
| Performance | Bounded queries/payloads on realistic large shelves, connection use, note/index storage, warm latency and separate cold-start behavior |
| Library importing | Native source fixtures, 1K/10K/20K rows, mixed/partial dates, ISBN collisions, wrong editions, duplicate/reordered/changed uploads, cross-source overlaps, preview staleness, interrupted batches, source-data privacy, cleanup and capacity guards |

Test Recommendation scoring as a pure deterministic unit and its SQL candidate selection as an integration test. Input-order independence and useful explanations matter more initially than building a sophisticated score.

## 13. Milestones and completion criteria

Each milestone should be reviewable and independently testable. Production rollout remains separately approved; a passing local test is not deployment completion. Work starts only after scope/architecture approval.

### M0 — Approve the contract and establish the baseline

**Scope:** resolve section 16, finalize lifecycle/UI wording and API schemas, inspect actual deployment/schema head, freeze V2 preservation checks, choose an isolated test target and safe recovery approach.

**Dependencies:** this proposal and product approval. Approve a V3 working branch before leaving the earlier V2 branch restriction; recommended new branch `codex/v3-reading-home` from the approved current main commit, without changing existing branches.

**Acceptance:** state table, private-book policy, note/progress limits, compatibility approach, pilot selection, and rollback approach are agreed. Existing suite is run safely and failures are recorded rather than attributed to V3 later.

**Complete when:** the approved decision record and reproducible baseline exist. No V3 migration reaches production as part of planning.

### M1 — Safe library foundation and bounded shelves

**Scope:** additive UserBook/attempt schema; backfill and compatibility writers; capability gating; bounded library/lookup APIs; independent Own/Want controls in the pilot UI; server-side library search/facets. Public catalogue/API behavior preserved.

**Dependencies:** M0.

**Acceptance:** all V2 records retain IDs and meaning; owned and wanted can coexist; no full-library startup download; pagination works on a 10K-entry test shelf; two-user isolation; stale V2 writes cannot delete future history; public counts/search use the intended fields.

**Complete when:** migration rehearsal and V2 regression tests pass, the new library works end-to-end behind the flag, and the code/data rollback constraints are documented. This is a foundation slice, not the complete V3 promise.

### M2 — Reading lifecycle, private fallback, and Home

**Scope:** start/pause/resume/finish/DNF/reread/correction, historical entries, concurrent different books, optional latest progress, edition snapshots, missing-book fallback, Home current-reading section, guest-to-account start intent.

**Dependencies:** M1.

**Acceptance:** a reader can use the full lifecycle without notes, progress, ratings, or dates; double taps do not duplicate attempts; an import removing an edition preserves progress/history; current reading is visible after reload/login; missing-title users can continue; old ownership remains unchanged.

**Complete when:** real browser/API/isolated-DB journeys and concurrent transition tests pass on mobile/desktop. Empty/error/cold-start states have been inspected, not just happy paths.

### M3 — Private context and trustworthy data control

**Scope:** optional save reason, one note and simple reaction per attempt, context integrated into the workspace/finish flow, correction/removal controls, owner-only export, privacy copy and deletion procedure updates.

**Dependencies:** M2.

**Acceptance:** every prompt is skippable; drafts survive failed saves in the current page; stale edits do not overwrite silently; rereads retain distinct prior notes; export contains only the requesting user's data; deleting private context does not change shared books/preferences.

**Complete when:** privacy, account-switch, XSS, removal, export, and failed-save tests pass, and the interface remains usable by a non-journaling reader.

### M4 — Next Read and finish-to-next connection

**Scope:** deterministic shelf-first shortlist, coverage-aware intent controls, factual explanations, limited diversity/rotation, explicit catalogue fallback, shared Home/finish component.

**Dependencies:** M2/M3; measured catalogue coverage and library APIs.

**Acceptance:** works with zero reading history; all candidate rules hold; a private queued book can appear; sparse metadata produces honest fallbacks; no paid/external inference; finish does not force a recommendation or auto-start a book; candidate queries remain bounded in result size.

**Complete when:** ranking/integration tests pass and representative readers can explain why options appeared and select one without assistance. Algorithm sophistication is not the completion criterion.

### M5 — Bring your library: previewed, resumable importing

**Scope:** shared upload/staging/preview/apply engine; Goodreads adapter first; StoryGraph adapter second; documented Bookvane CSV template; conservative catalogue matching; private fallbacks; persistent source/read identities; preserved source ratings/reviews/labels; conflict UI; resumability, limits, and owner-only reports. No account synchronization or OAuth.

**Dependencies:** M1 library identity/version APIs, M2 historical attempts/private entries, M3 privacy/export, M4 populated-Home/next-read integration. Reserve these integration contracts early, but do not delay M1–M4 to implement the importer.

**Acceptance:** a representative Goodreads export migrates shelves and representable history without manual rebuilding; repeat/reordered uploads add no duplicate records; existing state/notes/preferences survive; wrong/ambiguous matches require resolution; missing books become private entries only with preview approval; interrupted work resumes without replaying writes; importing thousands of books does not make Home or the API unusable. Both source adapters must pass their fixture contract before being advertised as supported.

**Complete when:** the detailed companion acceptance matrix passes, an end-to-end consented test export from at least Goodreads is verified, and source support/limitations are documented. Goodreads plus Bookvane CSV is the non-negotiable minimum public-release path; delivering only that minimum rather than the recommended Goodreads + StoryGraph scope requires explicitly agreeing the StoryGraph decision first. A synthetic template alone does not satisfy the widely used platform requirement.

### M6 — Release verification and small-reader pilot

**Scope:** complete V2/V3 regression run, production-like cookie/CORS tests, migration rehearsal, realistic shelf/storage/performance measurements, visual/accessibility review, documentation correction, approved staged deployment and smoke checks.

**Dependencies:** M1–M5; deployment approval and verified recovery/capacity checks. Internal tests of earlier milestones may happen earlier; the complete V3 public release cannot bypass M5.

**Acceptance:** no data-isolation/loss/auth regressions; deployed frontend/backend contracts match; critical flows verified on phone and desktop; no destructive stale-client path; private-data controls work; latency/storage measurements and operational instructions recorded. Include import-to-Home activation with real-shaped large libraries, repeat-upload safety, and honest distinction between source-history dates and new Bookvane activity.

**Complete when:** the coherent V3 loop is deployed to the approved pilot with no unresolved critical defects and a defined feedback/support path. This establishes technical release readiness, not product-market fit.

### Optional post-pilot slices — not prerequisites for core V3

- Annual goal if readers request it: a small user/year/target record with uniqueness on user/year, progress derived from dated finished attempts, and no stored duplicate completion counter. Recommend counting completed rereads as reading, excluding unknown completion dates, and never counting DNF as a finish—but obtain approval of these rules first. Keep one quiet optional Home card; no streaks or challenge engine.
- Explicit Open Library lookup if private missing entries are common.
- Better recommendation metadata if observed misses justify the work.

Do not begin these in parallel merely because they appear in the deck. Use pilot evidence to choose the next slice.

## 14. Risks and alternatives

| Risk | Evidence / consequence | Recommended response |
|---|---|---|
| V3 becomes a tracking chore | Deck explicitly rejects mandatory logging | Status-only journey is a release acceptance case |
| Wrong relationship model | Current Own/Want is exclusive; rereads need history | Separate flags from attempts; keep work identity stable |
| Import destroys personal context | Current merge prunes stale editions and refreshes metadata | Snapshot reader context; nullable edition FK; integration test with importer |
| Stale client removes history | Current DELETE removes UserBook | Capability-aware compatibility backend and explicit stale-client rejection |
| Library gets slow | Current provider loads every saved book | Bounded server queries and visible-book lookup before adding history |
| Mood matching feels fake | Actual theme coverage is sparse | Use supported options and truthful explanations, not inferred traits |
| Library gaps stop use | 50K curated works is not a complete catalogue | Private fallback now; lookup enhancement later |
| Loyal readers resist switching | Existing meaningful shelves elsewhere | Required platform import before public V3; test migration-to-Home with substantial libraries |
| Imports misidentify books or duplicate rereads | ISBNs can collide; exports omit stable reading-event IDs | Conservative work matching, persistent provenance, conflict preview, no invented history |
| Private notes leak | New sensitive data travels through previously public book UI | Separate DTOs, owner checks, no-store, cache/session tests, no notes in sharing |
| Overwriting across devices | More editable state, possible simultaneous reads | Parent version checks, atomic transitions, conflict UI |
| Free infrastructure feels slow | Existing Render cold starts | Preserve recovery UX; measure, communicate, don't promise instant availability |
| Context storage consumes headroom | Text/history now grows with users rather than catalogue only | Text caps, no log stream, measure realistic row/index size and project usage |
| V3 adds too many destinations | Deck's five capabilities can become five products | Four primary destinations, context and Next Read embedded in the journey |

Alternatives rejected for the first release: a single `reading_status` on UserBook (loses reread history), event sourcing (unnecessary replay/operational complexity), new auth provider (regression risk without product value), a generalized challenge platform (scope growth), AI-generated mood/summary classification (cost and truthfulness), and a separate recommendation microservice (unnecessary operational burden).

## 15. How to judge whether V3 is helping

Technical completion means the lifecycle works safely and predictably. Product success means readers choose to return because it helps—not because a streak nags them.

Recruit a small group matching the intended audience: readers with a meaningful Want list, including some fantasy/science-fiction readers, but not restricted to those genres. Observe first setup, one real next-book choice, and a return to current reading. Include people who refuse to journal and people whose current title is missing.

Start with existing domain outcomes and voluntary interviews: could they import without rebuilding their shelves, did they start from a shortlist, return to their context, finish or intentionally stop, and independently return on another occasion? Imported historical completions are not new Bookvane engagement events, and importing cannot manufacture a recent-finish celebration. Store only a small origin enum for starts if approved. Do not collect note contents into analytics or install session replay.

An illustrative pilot is 8–12 readers over about four weeks, adjusted for their reading pace. A handful of independent repeat uses would justify continued iteration; lack of finishes in four weeks is not automatically failure for slow/long-book readers. Agree the decision rule before recruiting. These are practical learning thresholds, not statistical proof of retention or market fit.

If users repeatedly ignore notes, simplify their prominence. If suggestions are unhelpful, inspect actual candidate/reason quality before adding ML. If people return primarily for current reading rather than discovery, let Home reflect that. If nobody returns without reminders, do not solve that by adding challenges.

## 16. Decisions requiring your approval

These are proposals, not silent product changes.

| Decision | Recommendation | Alternative / tradeoff |
|---|---|---|
| Minimum V3 boundary | M1–M6 including required library importing; defer goals/challenges | Importing is now a decided adoption requirement, not an optional enhancement |
| Ownership/access | Independent Own + Want; borrowed reading allowed without a special access field | An explicit borrowed/access enum adds state and controls; useful only if readers need it |
| Attempt rules | Many different books concurrently; one active/paused attempt per book; explicit rereads | Simultaneous separate formats of the same work require more selection/UI complexity |
| Queue behavior | Start clears existing Want; owned/history unchanged; explicit Want enables a reread | Keep Want while reading would require explaining why current reads still occupy the queue |
| Memory/reactions | Optional 500-character save reason, one 2,000-character note per attempt, optional loved/liked/not-for-me | Full journal or star ratings are valid but materially larger products |
| Missing books | Private title/author entry, no image upload, no shared catalogue change | Live lookup first provides metadata but adds external-service/provenance complexity |
| Next Read | Shelf-first, three choices, transparent rules, no automatic reaction-based taste learning initially | Catalogue-first discovery risks neglecting the existing TBR; strong inferred personalization needs more evidence |
| Navigation | Home / Discover / My Books / You; Next Read and context embedded | Extra standalone sections increase navigation and fragment the journey |
| Privacy/control | Explicit delete/correction/export; no note analytics or session replay; existing account-deletion procedure extended | Self-service account deletion can be a separate feature if current supported deletion is sufficient for the pilot |
| Rollout safety | Capability-gated pilot; reject stale V2 mutations after enable; additive migrations | Silent legacy translations risk unexpected state changes; an all-at-once cutover is simpler but less forgiving |
| Import source sequence | Goodreads first, StoryGraph second, Bookvane CSV through the same engine | StoryGraph has more ambiguous identity/date/encoding cases; any release deferral must be agreed explicitly |
| Import conflict defaults | Preserve native data; preview uncertain matches; retain source-only information privately | Overwrite-by-default is quicker but risks user trust and data loss |
| Import operation | Browser-driven short batches, durable database checkpoints, safe resume after closing the tab | Guaranteed tab-independent completion would require separately approved durable execution infrastructure |
| Import limits/retention | Proposed limits and expiry in the companion, benchmarked before release | Higher limits or raw-file retention add cost, privacy, and operational obligations |
| Branch | Approve a dedicated V3 branch from reviewed main; preserve V2 and existing branches | Continue all work on v2-codex, as the earlier session restriction required |

These decisions should be captured together before M0 completes. No feature implementation has started.

## 17. Evidence map and source notes

Repository paths below are relative to the inspected `_book_app_review` checkout. They are evidence anchors and proposed touchpoints, not a list of files already modified.

| Evidence | Files |
|---|---|
| Shared and private schema | `backend/models.py`, `backend/schemas.py` |
| Current shelf semantics | `backend/routes/user_books.py`, `backend/services/user_books.py` |
| Auth and production protection | `backend/auth/auth.py`, `backend/auth/dependencies.py`, `backend/database.py`, `backend/main.py` |
| Preferences and search | `backend/services/user_preferences.py`, `backend/services/search.py`, `backend/routes/books.py`, `backend/services/autocomplete.py` |
| Import compatibility | `backend/data/merge.py`, `backend/data/taxonomy.py`, `backend/tests/data/test_load.py` |
| Migration lineage | `backend/alembic/versions/`, especially shelf, editions, and `d9b6e1f2a3c4` snapshot migration |
| Active UI and routing | `frontend/src/main.jsx`, `frontend/src/components/ui-v2/BookvaneApp.jsx`, `DiscoveryPages.jsx`, `AccountPages.jsx` |
| UI actions and design | `frontend/src/components/ui-v2/primitives.jsx`, `ReaderContext.jsx`, `SaveContinuation.jsx`, `frontend/src/styles/ui-v2/bookvane.css` |
| Client state/auth | `frontend/src/hooks/UserBooksContext.jsx`, `AuthContext.jsx`, `frontend/src/api/client.js`, `books.js` |
| Test safety and coverage | `backend/tests/conftest.py`, `backend/tests/auth/`, `backend/tests/application/`, `frontend/tests/` |
| Deployment/documentation | `render.yaml`, `README.md`, existing launch/deployment/recovery reports |

Strategic source: the complete supplied V3 strategy deck, with earlier competitor research used only as context. The deck's survey/market claims were not independently re-audited; this proposal does not rely on those percentages to establish demand.

Technical references were consulted for limited implementation choices: PostgreSQL conditional uniqueness, SQLAlchemy versioning limitations, and Open Library's current human-facing API/bulk-access distinction. The architecture recommendations, scope choices, ranking proposal, and acceptance targets are engineering judgments based on the inspected application—not claims that those sources prescribe this product.

The library-import revision additionally inspects official StoryGraph export/template statements, pinned open-source Goodreads/StoryGraph fixture headers, CSV parser documentation, and CSV-injection guidance. See the companion's source register for verified facts versus fixture-dependent formats. No real user export or library import was processed during this planning revision.

The presentation skill guided complete deck inspection; the Neon PostgreSQL skill guided retaining the existing stack and using read-only database inspection. No infrastructure was provisioned.
