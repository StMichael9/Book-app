# Bookvane V3 — Bring Your Library

Approved planning reference for the later M5 milestone. Import implementation has not begun. See [the decision record](decision-record.md) and [M0/M1 report](m0-m1-report.md) for current work.

Required adoption capability · Architecture proposal · 14 October 2026 · Not implemented

This document is part of the [V3 architecture and implementation plan](Bookvane_V3_Architecture_and_Implementation_Plan_2026-10-14.md). It replaces the earlier recommendation to defer library importing. The rest of the reading-home direction remains intact.

## 1. Decision and release promise

**A reader must be able to bring an existing library into Bookvane without manually rebuilding it.** The complete public V3 release requires a reliable import from a widely used platform. A generic spreadsheet template alone does not meet that requirement.

Recommended sequence within V3:

1. Shared import engine plus **Goodreads CSV**: mandatory minimum platform path.
2. **StoryGraph CSV**: included in recommended V3 scope, using the same engine with a second format adapter.
3. **Bookvane CSV v1**: a documented, small format for spreadsheets and round-tripping supported Bookvane fields.

Both platform adapters appear practical. The difficult work—matching, preservation, preview, concurrency, and repeat safety—is shared. StoryGraph's additional cost is principally parsing/validating reading-date lists, its mixed ISBN/internal-ID field, and export variations. It does not justify a separate importer architecture.

Goodreads should ship through testing first. Do not silently drop StoryGraph if its fixture validation takes longer: report the specific unsupported format and obtain a scope decision. At least Goodreads must pass before public V3. Earlier internal lifecycle/Home testing may proceed before importing is finished.

Not included: platform login, passwords, OAuth, scraping, direct account synchronization, two-way synchronization, arbitrary Excel workbooks, or automatic external API lookup for every row.

## 2. What the source investigation establishes

### Evidence quality

I checked first-party StoryGraph help/roadmap statements, a Goodreads moderator-directed export discussion, and actual CSV fixture files maintained by the open-source BookWyrm project. The fixture files were inspected at commit `137ca7d89020aae9a99b2a142f6b4de6dc507743`, not assumed from a blog description. BookWyrm is evidence of concrete supported file examples, not an authoritative promise that every current platform export has the same schema.

**No fresh, owner-provided Goodreads or StoryGraph export was supplied or tested in this planning revision.** The fixture StoryGraph rows have empty Dates Read cells, so they establish the header but not every date-list grammar. Capture consented, de-identified current export examples before declaring an adapter production-supported. Do not guess that grammar or advertise complete journal/reread recovery without evidence.

StoryGraph's official bulk-import template documents a Goodreads-shaped input; it is **not** documentation of StoryGraph's native export format. Its official roadmap separately confirms that exporting exists through Manage Account. [StoryGraph export statement](https://roadmap.thestorygraph.com/requests-ideas/posts/export-csv), [official bulk-import template](https://thestorygraph.freshdesk.com/support/solutions/articles/79000146300-bulk-import-template)

### Initial format support

| Format | Observed fields / recommended coverage | Important limitations |
|---|---|---|
| Goodreads native CSV | Book Id; Title; Author; Additional Authors; ISBN/ISBN13; Exclusive Shelf; Date Added/Date Read; Read Count; My Rating/My Review; Private Notes; Bookshelves/positions; Owned Copies; bibliographic/context fields | Formula-wrapped ISBN strings occur. Read Count is not a list of dated attempts. Start dates and complete reread history must not be assumed |
| StoryGraph native CSV | Title; Authors/Contributors; ISBN/UID; Format; Read Status; Date Added; Last Date Read; Dates Read; Read Count; Star Rating; Review; Tags; Owned?; mood/pace/character/content-warning fields when present | ISBN/UID is not always an ISBN. Dates Read grammar needs fixture validation. No assumption of page count, edition year, publisher, or reading-journal export |
| Bookvane CSV v1 | Stable record/attempt identifiers, title/author, optional ISBN/work key, explicit status/ownership, known dates, numeric rating, review/note, labels | Controlled contract, not automatic understanding of any spreadsheet. Users can map their own columns once into the template |

Observed native headers: [Goodreads fixture](https://github.com/bookwyrm-social/bookwyrm/blob/137ca7d89020aae9a99b2a142f6b4de6dc507743/bookwyrm/tests/data/goodreads.csv), [StoryGraph fixture](https://github.com/bookwyrm-social/bookwyrm/blob/137ca7d89020aae9a99b2a142f6b4de6dc507743/bookwyrm/tests/data/storygraph.csv).

Preserve source names/values separately from normalized values. Adapter versions define recognized aliases, delimiter/date syntax, and status mappings. Reordered columns and extra columns must not break a supported format; ambiguous duplicate headers must be rejected rather than silently renamed. Missing optional columns remain missing. Unknown formats receive a helpful explanation and the Bookvane template, not a best-guess import.

StoryGraph currently has an acknowledged non-ASCII export issue. Preview must show representative names/text, offer an explicit encoding selection where useful, and flag suspicious corruption without silently rewriting it. Source corruption cannot always be repaired faithfully. [StoryGraph export encoding report](https://roadmap.thestorygraph.com/bugs/posts/export-mangles-non-ascii-characters)

### Bookvane CSV v1 contract

Provide a simple downloadable template and a documented advanced form, not a free-form mapping product.

- Required header/value: `title`.
- Recommended: `record_id`, `author`, `isbn13` or `isbn10`, `status`.
- Optional: `work_source_id`, `owned`, `wanted`, `date_added`, `started_on`, `finished_on`, `attempt_id`, `rating`, `review`, `private_note`, `labels`, `format`, `page_count`.
- Status vocabulary: `want`, `reading`, `paused`, `finished`, `dnf`, or blank/unclassified. Ownership is separate. Blank does not mean finished or wanted.
- Dates: ISO `YYYY-MM-DD`; no ambiguous locale inference. Partial dates remain source context unless explicitly supported in a later version.
- Rating: explicit decimal on a five-point scale; blank is unrated. Never reinterpret it as a Bookvane reaction.
- Labels: documented escaped list syntax; preserve each label as private organization. Do not split titles or personal notes on commas.
- One row normally represents one reader/book record and optionally one reading attempt. Multiple rows for the same `record_id` with distinct `attempt_id` values represent rereads; repeated library fields must agree or be resolved in preview.
- Omitted IDs are permitted for simple sheets, but increase uncertain repeat/history cases. Bookvane exports always include stable IDs so their own re-imports are reliable.

The CSV is a portability format for supported fields, not a complete database backup. Preserve richer source-only context in a separate private JSON export, not a misleadingly lossless CSV claim. Both outputs must be bounded and owner-only. A user importing their own spreadsheet should not need to manufacture missing dates or ratings to satisfy a template.

## 3. Data mapping and information preservation

### Native behavior mapping

| Source information | Bookvane destination / rule |
|---|---|
| To-read | Want on a new entry; no ReadingAttempt |
| Currently reading | One reading attempt; preserve supplied dates, leave missing start date empty |
| Read/finished | Finished historical attempt, with only genuinely available dates |
| DNF | DNF attempt where an explicit supported status or user-approved shelf mapping establishes it |
| Custom exclusive status | Ask the user to map it once or preserve as unclassified/private label; never infer state from an arbitrary label |
| Goodreads Bookshelves / StoryGraph Tags | Private imported labels, visible/filterable within My Books; never shared Tag records or preference changes |
| Positive Owned Copies / explicit Owned? yes | Own on a new entry; retain reported count separately without creating duplicate work entries |
| Blank/zero/no ownership | Does not clear an existing Own flag. Blank is unknown; explicit source zero/no is preserved as source information |
| Date Added | Private source-added date, not reading start, account creation, or a newly performed reading action |
| Read date(s) | Historical end dates or explicitly supported start/end spans; do not derive starts from Date Added |
| Numeric rating | Exact validated decimal plus source/scale, stored privately; Goodreads zero is unrated under that adapter's semantics |
| Review | Separate imported review, private even if public on the source platform; never overwrite native notes |
| Private Notes | Separate imported private context; never rewrite save reason or global preferences |
| Read Count | Preserve reported total and identify how many attempts the file actually describes; do not invent missing attempts/dates |
| Publisher, binding, source page count/edition year | Source edition context; only known/reliable values may seed an imported attempt snapshot, never update the shared Book |
| Moods, pace, character responses, content warnings | Private, labelled source context when present; not Bookvane catalogue facts, filters, or recommendation evidence |
| Recommended by/for, purchase details, condition, unsupported columns | Field-disposition preview; allowlisted useful context can be retained, sensitive purchase/location fields excluded by default; no silent promise to preserve everything |
| Average rating / public aggregates | Not the reader's rating; omit from their rating and identify as ignored |

For StoryGraph ratings, accept only the numeric domain verified by the adapter fixtures, preserving decimal precision. Do not carry Goodreads' zero-means-unrated rule across sources without evidence. Invalid numbers or unfamiliar conventions are review items, not silently rounded values.

The reviewed Goodreads fixture already demonstrates Read Count greater than one without corresponding dates. Therefore “imported all rows” must not be equated with “reconstructed every historical reading.” Preserve the count as a source-reported summary, show the limitation, and allow later correction. The two platforms' counts are never added together as if they describe separate histories.

### Dates, rereads, and source scope

- Support each adapter's verified date forms. Strictly parse full dates; blanks remain null. Ambiguous `03/04/2025` is not automatically assigned a locale.
- If a native Dates Read cell has validated individual spans, create those attempts. Use Last Date Read only as a fallback or consistency check, not an additional duplicate attempt.
- Preserve partial dates and unparsed date-list text in source context with a warning. A reader can import the book without inventing January 1 or a start date.
- If an explicit finished status exists but no usable dates, one undated finished attempt may represent that status. A reported count of five does not create five invented attempt records.
- Different editions of one work still share one UserBook. Edition rows alone do not prove multiple readings. Clearly distinct source reading events may create separate attempts; uncertain overlap requires a decision.
- Reviews and ratings often apply to the source book record, not a particular reread. Keep them on the imported source record unless a genuine source event linkage exists. Do not copy the same review onto every attempt.

### Preserve without clutter

The book workspace gains a collapsed **Imported from Goodreads/StoryGraph** section showing source rating, review/private context, shelf labels, and any source-history limitation. Native notes/reactions stay unchanged. Imported labels can filter My Books, but this does not introduce public taxonomy, a customizable challenge system, or a general list-building product.

Keep imported text as inert text. Preserve line breaks and meaningful source content within approved limits; do not silently truncate a long review to fit the native 2,000-character note. Oversized fields are flagged before confirmation and require an explicit omit/skip decision or a supported larger limit. Export preserved context with its source attribution.

Imported history is distinguishable from native activity through `origin=import` and the source links. Historical finishes must not trigger “you just finished,” retention metrics, or a chain of Finish-and-Continue dialogs. Existing preferences are never modified. Once complete, current reads and Want entries immediately populate Home and Next Read.

## 4. Catalogue matching: work first, edition second

Use the existing indexed `edition_isbns.isbn13`, `books.isbn13`, Book work source ID, authors, and edition relationships. ISBNs are intentionally not globally unique in the catalogue. Keep that property; do not add a uniqueness constraint to make matching easier.

### Matching hierarchy

1. **Previously accepted owner/source link.** Reuse the user's confirmed mapping unless the incoming identifiers conflict or the linked record was removed. This is private import provenance, not a public Goodreads-to-Open-Library mapping.
2. **Validated explicit Open Library work key**, if supplied in the Bookvane format, resolved locally including known aliases. Conflicting ISBN/work evidence goes to review.
3. **Validated ISBN-13 or checksum-valid ISBN-10 converted to ISBN-13.** Batch-query edition ISBNs and legacy work ISBNs; gather all distinct candidate work IDs. Automatically propose a confident match only when evidence resolves to one work and supplied title/author information is not materially contradictory.
4. **Exact normalized title + author candidates.** Preserve Unicode, use conservative whitespace/case normalization, and require an unambiguous candidate. Treat this as a lower-confidence proposed match for explicit preview approval, not proof of edition identity. Same-name authors, omnibus/abridged titles, translations, and contradictory ISBNs remain uncertain.
5. **Fuzzy candidates**, at most a few using existing search capabilities, only for review. Never auto-merge because a title is similar.
6. **Private fallback or skip.** Unmatched books can become private entries in a clearly counted, explicitly approved group. Do not create or modify shared catalogue Books/Authors/Tags/editions.

Do not strip series/volume/abridged/omnibus qualifiers indiscriminately to force a match. Preserve the supplied author string; native author/contributor conventions may not support splitting every comma safely. ISBN scientific notation or truncated digits cannot be reliably reconstructed: report the invalid identifier and use another matching route.

Goodreads' `="..."` ISBN text is a narrowly recognized wrapper to unwrap in ISBN fields before checksum validation, **not a formula to evaluate**. StoryGraph's ISBN/UID value is an ISBN only if it validates; otherwise retain it as an opaque source identifier, not an Open Library ID.

### Work and edition confidence differ

A unique work match does not establish which physical/digital edition the reader used. If the exact ISBN maps to several editions of that same work, the work may be selected while `edition_id` stays unset. Preserve imported ISBN/format/page-total context rather than assigning the preferred edition arbitrarily. Never replace a reader's imported page total with a different edition's total merely because it is populated.

An ISBN matching multiple works, an ISBN disagreeing with an explicit work key, or strong title/author contradiction requires review. If the source appears wrong, keep the original source information and the user's explicit mapping decision for reproducibility.

### Batched implementation

For each bounded group, load candidate ISBN/work matches, current user entries, source links, and relevant attempts with set-based queries. Normalize comparison values once. Use a VALUES/join or equivalent batch query for exact title/author candidate matching; benchmark before adding a narrowly justified expression index. Do not scan/download the entire catalogue into browser memory or query the database separately for every row.

Reuse the existing pure ISBN validators in `backend/data/clean.py` if they remain import-safe. Do not invoke `data.load`, its production configuration, or catalogue merge logic. If sharing requires a small domain utility extraction, keep compatibility exports/tests and limit it to that real responsibility boundary; no importer refactor is otherwise necessary.

## 5. Identity, deduplication, and conflict rules

### Four identities, not one filename

- **Upload session:** one owner-scoped import run; transport chunk sequence/digests make retries safe.
- **Source book record:** owner + source + source-library scope + stable source key. Goodreads Book Id is useful here; it is not an Open Library work ID. StoryGraph uses verified ISBN/UID evidence or a documented weaker fallback.
- **Library identity:** existing `(user_id, book_id)` for a catalogue work, or a confirmed private entry. Multiple source records can refer to the same library entry.
- **Reading event:** source event identity or conservative canonical date-span fingerprint, linked to a ReadingAttempt. It is independent of the current rating, review, CSV row order, and file name.

Default one source-library scope per provider per reader; offer a labelled separate scope for genuinely separate accounts/datasets. Scope does not bypass work-level duplicate checks. A fingerprint is evidence for replay detection, not permission to guess two different books are the same.

### Repeat and overlap behavior

| Situation | Default outcome |
|---|---|
| Same upload/chunk retried | Return acknowledged result; do not insert again |
| Same export uploaded with another name or row order | Source links and semantic fingerprints identify already imported content |
| New export includes new books | Preview/import only new records; no deletion of books absent from the new file |
| Same source record has changed rating/review/status | Show source change and existing data; no silent replay as a new book/read |
| A previously imported book was edited in Bookvane | Native changes win; incoming conflicting fields need explicit approval |
| Goodreads and StoryGraph describe the same work | One library entry; preserve separate source context, not duplicate public books |
| Cross-source attempts look like the same read | Review/link to existing attempt unless identity is already confirmed; don't count both automatically |
| Different clear reading spans | May add historical attempts after preview; preserve current active attempt and prior history |
| Two unknown-date reads / changed dates / indistinguishable events | Do not guess a reread; ask link-existing, keep-as-source-context, or explicitly add a separate attempt |
| Same title/author private records without identifiers | Possible duplicate review; do not collapse by name or automatically create another on a weak changed fingerprint |
| User deliberately removed imported history | Minimal removal marker prevents automatic resurrection; restore requires explicit choice |

Exact duplicate source rows collapse only when all relevant semantics agree. Conflicting duplicate rows become one resolution group. Group rows by target library entry before application so competing statuses from the same file cannot depend on row order.

### Safe merge defaults

For a **new** entry, apply the previewed source flags/history. For an **existing** entry:

- Keep native Own/Want, notes, reactions, progress, dates, and active reading state by default.
- Add unambiguous new historical attempts only when the preview identifies them as additions; do not replace an existing attempt to satisfy an incoming status.
- Preserve imported reviews/ratings/labels in their own source records. Native notes are never an append-only dumping ground for imported text.
- Source absence, blank fields, zero ownership, or a missing row never clears existing data.
- A source-to-read record and an existing finish are not mutually exclusive: offer explicit “also queue for rereading” rather than rewriting the finish.
- An incoming current-read attempt conflicting with an active/paused attempt cannot create a second active attempt for the same work. Offer preserve/link/correct choices with an exact preview.
- Do not interpret a rating as a reaction, a shelf as a preference, or a DNF as dislike.

Users may choose a specific incoming value over a specific existing value in preview; the proposed before/after and expected entry version are stored. There is no unrestricted “overwrite everything” default. Changing a source decision invalidates that portion of the preview and its confirmation revision.

## 6. Architecture: bounded requests, durable state, no paid worker

```text
Selected local CSV
  → incremental browser parser
  → bounded authenticated row batches
  → temporary PostgreSQL import rows
  → server normalization + batched local matching
  → paginated preview + explicit decisions
  → confirmed, short transactional apply batches
  → UserBook / ReadingAttempt + private source records
  → populated Home + reconciled results
```

This is distinct from Open Library catalogue ingestion. No monthly dumps, no source catalogue download, no GitHub Actions handling personal CSV files, and no bulk external book API calls.

### CSV handling and dependency choice

Recommend one small, maintained CSV parser dependency such as Papa Parse on the frontend. Correct quoted commas, embedded newlines, BOM handling, and escapes justify it; a handwritten `split(',')` parser does not. Pin/review its version and keep business normalization on the server. Papa documents local-file streaming and parser pause/resume. Its built-in worker mode does not support the same pause/resume path, so begin with asynchronous bounded chunks and backpressure rather than assuming `worker:true` solves bounded uploads. [Papa Parse documentation](https://www.papaparse.com/docs)

The user-facing action is “Upload CSV”; implementation sends parsed, losslessly represented cell strings/header data in batches rather than retaining a raw file on Render. Leave dynamic type conversion off so ISBNs and source IDs remain strings. Both browser and server enforce limits. The server treats every submitted field, row count, match decision, and owner reference as untrusted; client parsing is not a security boundary.

### Execution and recovery

Use a small durable state machine:

`uploading → analyzing → preview_ready → applying → completed / completed_with_issues`

With explicit paused, needs_review, cancelled, expired, and failed states. Version the parser, mapping policy, and plan per run.

- Upload accepts a bounded ordinal batch with a server-verified digest. Same ordinal/same content is a no-op; same ordinal/different content is rejected. Finalization checks contiguous acknowledged batches and an explicit end-of-file manifest.
- Before finalization, no reader library writes occur. A malformed file can leave temporary staging, but cannot create half a library without confirmation.
- During analysis, each short request resolves another bounded group and checkpoints results. GET status never mutates the library.
- Confirmation binds the exact preview revision, selected groups, policy, and payload digest. Changed decisions require a new preview/confirmation.
- Application rechecks owner, target identity, and expected versions. If native data or matching catalogue evidence changed since preview, mark that group for review rather than applying stale instructions.
- One transaction contains a group/batch's domain writes, provenance links, result statuses, and checkpoint. A crash commits all of that batch or none. Group writes use a stable lock order.
- A second tab cannot process the same run concurrently. Use database-enforced ownership/run locking; do not rely solely on a frontend disabled button.
- If the connection is lost after commit, replay reads the stored result. Do not generate new attempt IDs on retry.
- Cancel prevents future batches. Already committed additions remain and are reported; cancellation is not an undocumented full rollback.

The browser automatically advances short requests while the import screen is active. **Closing the tab pauses execution; returning resumes committed work.** Before all rows are staged, the user may need to reselect the same file; acknowledged digests verify the resumed prefix. After upload finalization, resumption needs no file and may occur on another authenticated device until expiry.

This is appropriate for bounded personal libraries, not multi-day catalogue jobs. We must measure the actual duration. If “finish even when every browser is closed” becomes a requirement, revisit durable execution explicitly; do not pretend a FastAPI fire-and-forget background task survives Render restarts or sleep. No paid worker or new queue is included in this proposal.

### Schema additions

| Table | Lifetime and responsibility |
|---|---|
| `LibraryImportRun` | Owner, source/scope, adapter version, normalized header/manifest, phase/cursors, preview revision, limits, counters, timestamps/expiry, compact result summary |
| `LibraryImportRow` | Temporary normalized source values, row ordinal, hashes, bounded candidate IDs/reasons, decision and planned changes, expected versions, disposition/error; unique run/ordinal |
| `ImportedLibraryRecord` | Durable source identity → UserBook association; accepted content fingerprint; source rating/review/private context/labels/dates/count; match provenance; minimal removal markers |
| `ImportedReadLink` | Durable source-record/event key → ReadingAttempt association, event fingerprint/disposition; several source links may reference one confirmed existing attempt |

The durable source tables are not a copy of every raw upload or an event-sourcing ledger. Keep a bounded allowlist of useful accepted source fields and compact fingerprints, not unlimited raw JSON, every rejected row, or every historical upload revision. A changed accepted source record is an explicit source update, not automatic synchronization. Unaccepted conflicting incoming data remains in the user's original export and temporary report until expiry.

All tables are owner-scoped. Use composite owner/FK constraints or equivalent enforceable relational ownership to prevent linking one reader's source record to another reader's UserBook/attempt; require the same checks in services. Index user/run/ordinal, user/source/scope/key, linked UserBook, and source-event keys. A unique source key cannot be based solely on ISBN when the adapter permits multiple source records for that identifier; unresolved collisions go to review.

Deleting an imported attempt does not silently remove its replay-protection marker. Deleting a book's private history clears preserved text/context and retains only the disclosed minimal source/event removal hashes needed to prevent resurrection. Account deletion clears all import data. Provide a deliberate “forget import history” option with the warning that future uploads may require renewed duplicate review.

`ReadingAttempt` needs an origin discriminator so imported records do not masquerade as fresh native activity. No new editable numeric rating system is required: source ratings belong to ImportedLibraryRecord. Private labels can remain bounded structured fields on those records and be joined/filterable within the owner's library; do not expand shared taxonomy.

### Migration and rollout boundaries

Add the four import tables after the M1/M2 library migrations, with ownership constraints, replay uniqueness, and bounded payload validation established before enabling upload routes. Existing V2 books, shelves, preferences, and attempts need no import backfill. If the origin discriminator is added at M5 rather than M1, backfill existing attempts as native, never infer an external source. Retained removal markers need nullable target links rather than cascading away the only replay protection; explicit account deletion must still remove them.

Rehearse upgrading a populated isolated V3 database, including native/private entries and attempts, then verify unchanged IDs and field values. Deploy with the import capability disabled until backend/schema and frontend contracts match. Disabling import should stop new runs without removing committed library data. Once readers have imported, rolling application code back must not drop source/history tables or destroy imported context; a destructive downgrade is not an operational rollback procedure.

## 7. API and frontend changes

### Proposed authenticated API

| Endpoint | Responsibility |
|---|---|
| `POST /me/library-imports` | Create/return an idempotent run; pin source, scope, adapter, header and limits |
| `PUT /me/library-imports/{id}/batches/{ordinal}` | Validate/store one bounded raw-cell batch, hash-checked and replay-safe |
| `POST /me/library-imports/{id}/finalize-upload` | Seal contiguous upload manifest; reject truncation/mismatched sequence |
| `POST /me/library-imports/{id}/advance` | Perform one bounded analysis or authorized apply step; return checkpoint/progress |
| `GET /me/library-imports/{id}` | Owner-only status, totals, next action, expiry |
| `GET /me/library-imports/{id}/rows` | Paginated preview/results with filters such as uncertain, conflict, invalid |
| `PATCH /me/library-imports/{id}/decisions` | Bounded row/group decisions or an explicit reviewed bulk policy; increment preview revision |
| `POST /me/library-imports/{id}/confirm` | Confirm the current immutable preview revision and selected changes |
| `POST /me/library-imports/{id}/cancel` | Stop further processing; report already committed groups |
| `DELETE /me/library-imports/{id}` | Purge temporary upload data, not imported library/history |
| `GET /me/library-imports/{id}/report` | Safe owner-only result download, bounded/streamed |

Use existing session cookies, refresh recovery, exact origin checks, method restrictions, and authentication dependencies. New routes receive their own measured rate/concurrency budgets rather than globally loosening V2 rate limits. A 401 pauses and requests login; a 429 obeys Retry-After; a timeout rechecks the stored checkpoint before retrying.

Suggested implementation boundaries: `services/library_imports/formats.py` for versioned adapters/validation; `matching.py` for batch candidates; `workflow.py` for staging/preview/checkpoint/apply. Keep transactions and shared reading invariants reusable from M1/M2, not an HTTP call to the app's own per-book API for every row. Add `routes/library_imports.py` and import DTOs without modifying auth or administrative catalogue endpoints.

### Reader workflow

1. **Choose source and file.** Show concise official export instructions and supported versions/limits. No credentials. Explain that uploads are private.
2. **Check the file.** Show encoding samples and file validation progress. Clearly distinguish upload, analysis, and application.
3. **Preview.** Counts for source rows, distinct books, new entries, existing entries retained, new historical reads, duplicate skips, unmatched private entries, unresolved matches, and fields not imported. These are different counts, not one misleading “books imported” number.
4. **Review exceptions.** Default to a small queue of uncertain cases with source/candidate title, author, ISBN and edition evidence. Choices: link, private entry, keep existing, apply a specific field, or skip. Safe groups may be approved together; do not require thousands of individual clicks.
5. **Confirm.** State the exact selected impact and that existing data will not be deleted. Unresolved rows are explicitly excluded or converted to private entries through an approved policy, never guessed. Changes from another device force a refreshed decision for affected groups.
6. **Apply and resume.** Automatic bounded progress, retry/pause controls, honest elapsed/processed counts; no invented ETA until throughput is measured.
7. **Results → Home.** Show added/linked/unchanged/skipped/conflicted/failed groups and a report. “Continue to your reading home” immediately opens the imported current reads and Want choices.

Use a dedicated `/settings/import` or equivalent route reached from My Books and You, plus onboarding's Bring your books action. No new primary navigation tab. Tables/lists are paginated, with mobile-friendly exception cards, keyboard access, clear focus, and announced progress. No persistent browser storage of CSV reviews/notes. A non-sensitive run ID may be kept for resumption; server authorization is still mandatory.

## 8. Performance, safety, and operational limits

### Proposed initial limits, subject to isolated measurement

| Limit | Initial proposal |
|---|---|
| Selected CSV | 20 MiB uncompressed; CSV only, no archives/macros/Excel parsing |
| Rows per run | 20,000, covering substantial personal libraries |
| Derived reading events | 50,000 per run, at most 100 per source row or atomic target-entry group; reject/review larger groups, never silently truncate |
| Request batch | At most 100 rows and 512 KiB serialized, whichever comes first |
| Preserved individual text field | At most 64 KiB UTF-8; no silent truncation |
| Structured row limits | At most 256 KiB serialized per row, 128 columns, and 100 labels of at most 120 characters each; oversized content is disclosed before confirmation |
| Normalized staged data | 32 MiB per run; aggregate staging reservation initially 128 MiB, subject to actual database headroom |
| Concurrency | One active import per user; begin with a small global processing budget, e.g. two active batch requests |
| Request work | Target a few seconds warm; shrink batch size if measurements exceed the request budget |
| Inactive staging | Seven-day resume window; disclose expiry before starting |

Row count and byte limits both matter. A short CSV with enormous review fields or nested date lists must not bypass protection. Enforce payload/body/field/list/header limits server-side before allocating unbounded structures. Reject unexpected binary/NUL content and malformed quoting. UTF-8/BOM is the default; allow explicitly selected supported encodings without silently changing text.

A small client-side selected file is not the earlier multi-gigabyte Open Library download problem. No catalogue is downloaded. The original export remains on the user's device; the server retains bounded parsed content temporarily and the accepted library information durably.

### Database operations

- Fetch/match by batches. Bulk-create entries/attempts/provenance and update versions in set-based operations where safe. One transaction per bounded batch/group; no per-book commit or external request loop.
- Lock affected parent entries in a stable order; do not hold a database transaction while waiting for the next browser request or a reader's decision.
- Prevalidate groups. Expected conflicts become review results. Unexpected database failures roll back the current batch and pause/report; they must not be swallowed as success.
- Protect ordinary reading traffic using bounded request concurrency, short statement/lock timeouts, and capped retries for transient failures.
- Enforce processing reservations transactionally in PostgreSQL so concurrent tabs/processes cannot exceed the budget; do not rely on an in-memory global counter. Bound each target-entry group as well as each HTTP batch. A pathological single-book history must not create an unbounded transaction merely because it occupies one CSV row.
- Reserve staging/persistent-write headroom, monitor actual database size, and stop accepting/advancing imports before the existing database guard would be exceeded. Do not consume headroom reserved for existing users or catalogue operations. Existing catalogue guard/settings are not raised by this feature.
- Measure 1K/10K/20K-row imports, query counts, incremental storage including indexes/provenance, and ordinary Home latency during import. Do not promise seconds-long imports or unlimited free user growth before measurement.

### Privacy and cleanup

All previews, source records, conflicts, progress, downloads, and match decisions are private to the authenticated owner. Opaque run IDs are not access control. No upload contents go to logs, error-monitoring breadcrumbs, analytics, GitHub Actions, external LLMs, or public caches. Do not follow uploaded URLs or fetch images: this also avoids SSRF and private-data leakage.

Imported reviews are displayed as escaped text, not executed HTML/Markdown. Result CSVs and human-readable CSV exports must defend against formula injection; JSON preserves original text without spreadsheet execution semantics. Do not strip prefixes from arbitrary fields under the guise of ISBN normalization. Include quote/newline and formula-prefix round-trip tests. [OWASP CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection)

On completion/cancellation, release bulky staging after producing the compact result; retain only row ordinals, disposition/error codes, and permitted target references for the report window, not rejected review text or normalized payloads. This keeps per-row accounting downloadable without retaining full uploads. Failures remain resumable within the declared window. Expired upload payloads immediately stop being accessible/resumable; compact owner-only reports have their separate retention period. Physical cleanup runs in bounded maintenance during import activity and application startup; with no always-running worker, do not promise deletion at an exact seven-day wall-clock instant. Record expired-but-not-yet-purged storage and clear it before accepting new imports. If a strict timed physical-erasure guarantee is desired, that needs a separately approved scheduled maintenance mechanism.

Keep source context that the user chose to import for as long as the associated library record exists, with explicit deletion/export controls. Compact run summaries may be retained for 30 days; durable replay protection follows the imported records, not that report retention. Document backup retention separately. File size limits are not an excuse to discard existing data on capacity failure.

### Deliberate transactional tradeoff

The entire file is not one long transaction. Completed batches may be visible if the run pauses. The confirmation screen states this. Resume finishes outstanding work; cancellation stops future work, it does not erase completed additions.

Do not offer a misleading unconditional “Undo import” that can remove books someone subsequently read or edited. Provenance enables future selective reversal, but an automatic all-or-nothing rollback UI is not required for initial V3. Native deletion/correction remains available, and the report identifies what changed. This tradeoff requires approval.

## 9. Testing and acceptance matrix

Tests use separately credentialed disposable databases and synthetic/de-identified fixtures only. No production import, account data extraction, or destructive test against a recovery branch is authorized by this plan.

### Format validation

- Consented current Goodreads/StoryGraph fixtures with header variants; optional columns absent; source columns reordered/added; duplicate header rejection.
- Unicode names, emoji/non-Latin titles, BOM, CRLF/LF, quoted commas, embedded newlines, escaped quotes, blank rows, empty/malformed files, wrong encoding, very long fields, truncated upload, unexpected binary content.
- Goodreads formula-wrapped and empty ISBNs; ISBN-10 conversion; invalid checksums; scientific notation; StoryGraph non-ISBN UID.
- Native source rating precision and blank/zero semantics; malformed/partial/ambiguous dates; unrecognized StoryGraph date-list grammar must never fabricate history.

### Matching and preservation

- Exact ISBN maps one work/one edition; one work/multiple editions; multiple works; contradicting work key/title/author.
- Same-name authors, same-title different books, series volumes, translations, abridged and omnibus editions, missing author/ISBN, private fallback.
- Existing private record later appears in catalogue: no automatic replacement or history loss; explicit resolution preserves IDs.
- Imported ownership independent of status; custom shelves not public tags/preferences; retained reviews/private notes longer than native note limit; no rating-to-reaction conversion.
- Read Count exceeds dated events; currently-reading after a prior finish; DNF and unknown dates; two editions with overlapping dates; explicit rereads preserved.
- Before/after assertions on pre-existing Book IDs, UserBook IDs, notes, attempts, preferences, ownership, and progress; shared catalogue untouched.

### Replay, concurrency, and interruption

- Duplicate rows; same file renamed/reordered; changed file with new rows; same source ID changed text/status; missing rows never delete; same books from both platforms.
- Weak/no source IDs, repeated unknown-date reads, changed reading dates, removed imported attempts, forgotten source links.
- Disconnect before/after each batch commit, browser close during upload/analysis/apply, service restart, lost HTTP response after commit, concurrent tabs/duplicate advance, two concurrent imports, token expiry, 429/backoff, transient database errors.
- Reader edits a note/state after preview; catalogue matching evidence changes before apply; owner mismatch and other users' run/row/attempt IDs rejected at every endpoint.
- Cancellation and storage pause preserve committed groups, do not claim completion, and produce reconciled counts. Retry never creates a second native attempt for an already applied source event.

### Scale and UX

- Run 1K, 10K, and 20K-row fixtures, including a large private-fallback share, a review-heavy byte-limit case, and multiple reading events per row.
- Measure peak browser/backend memory, request duration, SQL count, database/index/staging growth, connection use, and normal Home/search responsiveness during import.
- Verify hard limits and TTL cleanup independently from happy paths; no unbounded pending request queue or full-file DataFrame.
- Real browser flow on phone/desktop: export instructions → upload → uncertain-match resolution → confirmation → interrupt/resume → results → populated Home.
- Review/decide many rows through safe group actions, without requiring thousands of clicks. Every source row ends in a clearly reconciled disposition; source rows, works, and reading attempts have separate totals.

## 10. Milestone M5: implementation slices and definition of done

**Dependencies:** stable M1 UserBook identity/versions/library APIs, M2 historical attempts/private fallback and edition snapshots, M3 privacy/export, M4 Home/Next Read. Import design informs those contracts now; importer construction waits until the core loop is stable.

1. **M5a — Shared engine + Goodreads.** Capture fixture contracts; build bounded upload/analysis, preview, safe matching, source identities, apply/resume, private context and labels. Complete the full Goodreads path before adding another adapter.
2. **M5b — StoryGraph + Bookvane CSV.** Reuse the engine. Validate current date-list/identity/encoding variants; add template and round-trip tests. Unsupported variants fail clearly or retain unparsed source context without inventing events.
3. **M5c — Migration confidence.** Large-library/performance/privacy testing, cross-source duplicate tests, interruption/capacity tests, user-facing export instructions and limitations, import-to-Home usability checks.

Completion requires:

- A supported Goodreads export, not just a hand-authored generic CSV, passes an end-to-end isolated import and verification.
- StoryGraph's supported adapter variants are fixture-backed and tested before the source is advertised. If a specific blocker remains, agree its scope/release consequence explicitly.
- Repeating the same import adds zero duplicate entries/attempts and does not overwrite native edits.
- The user can understand and approve the plan before library writes; uncertain matches and unsupported data are disclosed.
- Large libraries complete within measured memory/request/storage budgets and can resume after interruption.
- Imported shelves/current reading/history become useful immediately in Home/My Books; private labels and source context remain accessible.
- No shared catalogue writes, cross-user exposure, preference changes, paid service, or requirement to manually reconstruct the library.

**M6 is the public-release verification milestone. It cannot waive the required platform import.** Internal testing/pilot feedback on M1–M4 may start earlier without calling the complete V3 public release finished.

## 11. Decisions for approval

Library importing itself is already decided. The remaining choices concern its behavior:

| Decision | Recommendation | Tradeoff |
|---|---|---|
| Supported source sequence | Goodreads, then StoryGraph, plus Bookvane CSV in M5 | Both are practical; StoryGraph needs additional fixture validation, not a second engine |
| Unmatched rows | Explicitly approve a group of private entries or review/skip | Preserves adoption flow; private entries may lack covers and rich recommendations |
| Existing-data policy | Native data wins; selected changes require preview approval | More conflict handling than overwriting, much safer for established readers |
| Imported information | Preserve exact source ratings, reviews, private notes, and labels in a collapsed private section; imported labels filter My Books | Adds bounded provenance storage/UI, avoids distorting the new reaction/journal model |
| Continuation | Browser-driven short requests; safe pause/resume when closed | No new worker cost, but no promise of unattended completion with all tabs closed |
| Limits | Start at 20 MiB / 20K rows with specified field/event/staging limits and measured adjustment | Very large or review-heavy libraries may need an explained split or revised limit |
| Expiry | Seven-day staging resume window; immediate logical expiry and bounded opportunistic physical cleanup | Exact timed physical deletion would need scheduled maintenance |
| Cancel/undo | Cancel stops future batches; no unconditional whole-import undo | Avoids a new destructive rollback mechanism; all changes remain reported and correctable |
| Removal markers | Keep minimal private replay-prevention markers after deleting imported history; allow explicit forgetting | Prevents deleted history silently returning, but retention must be disclosed |

No new product feature is implied by preserving source information: imported star ratings do not create public ratings, shelf labels do not create a social/list platform, and retained review text does not create a full journal editor.

## 12. Sources and implementation confidence

- [StoryGraph Export CSV roadmap statement](https://roadmap.thestorygraph.com/requests-ideas/posts/export-csv): first-party confirmation of export availability; not a fixed versioned schema.
- [StoryGraph official bulk-import template](https://thestorygraph.freshdesk.com/support/solutions/articles/79000146300-bulk-import-template): Goodreads-shaped input meanings, not StoryGraph native export specification.
- [Goodreads moderator-directed export help discussion](https://help.goodreads.com/s/question/0D5ar00000XtvJ3CAJ/how-do-i-download-my-library-as-a-csv-file): export entry point. The linked standalone help article was not retrievable in this investigation; no unseen contents are relied upon.
- [Pinned Goodreads fixture](https://github.com/bookwyrm-social/bookwyrm/blob/137ca7d89020aae9a99b2a142f6b4de6dc507743/bookwyrm/tests/data/goodreads.csv) and [pinned StoryGraph fixture](https://github.com/bookwyrm-social/bookwyrm/blob/137ca7d89020aae9a99b2a142f6b4de6dc507743/bookwyrm/tests/data/storygraph.csv): concrete headers/representative values; these are interoperability examples, not a claim of current exhaustive coverage.
- [StoryGraph reading-journal export request](https://roadmap.thestorygraph.com/requests-ideas/posts/pdf-export-for-reading-journal): journal export is a separate capability; do not promise that a library CSV carries all journal entries.
- [StoryGraph encoding issue](https://roadmap.thestorygraph.com/bugs/posts/export-mangles-non-ascii-characters): preserve/preview Unicode and make encoding uncertainty visible.
- [Papa Parse documentation](https://www.papaparse.com/docs): streaming parser and pause/worker constraints; one justified frontend dependency proposed, none installed.
- [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection): spreadsheet formula execution risk on generated exports/reports.

Repository reinspection confirmed existing edition ISBN indexes, ISBN validation helpers, work-level relationships, and the unchanged V2 branch. No real user file was uploaded, no database was queried or modified for this revision, no import was run, and no implementation tests are claimed. Only these planning documents were edited/created.
