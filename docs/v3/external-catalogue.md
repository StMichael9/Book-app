# Bookvane Catalogue — bounded lookup release

## What this delivers

- Extends authenticated V3 title/author search automatically after the existing
  Neon results. No separate Open Library search button or browser API token.
- Existing Neon matches win by exact work identity. Names are not identities;
  similarly named editions/works are not silently merged.
- Review → confirm → private Want entry, with source work ID, snapshot and an
  available cover preserved. Repeat selections open the existing entry without
  changing flags, notes, preferences or reading history. Concurrent selections
  serialize per owner; a unique database index also protects external identity.
- Public promotion, import matching, recommendations, existing filters, auth,
  private manual entry and the 50K shared catalogue are not replaced.
- External results deliberately do not participate in subject, ownership or
  personal-shelf filters: the external source lacks those classifications.

## Measured catalogue, not a larger completion claim

Read-only production public-ID assessment on 21 October 2026:

| Measure | Result |
| --- | ---: |
| Existing Neon books | 50,000 |
| Neon books with distinct source work IDs | 49,897 |
| Existing active indexed Turso works | 100,000 |
| Shared canonical identities | 179 |
| Combined distinct identified works | **149,718** |
| Shortfall from exactly 150,000 | 282 |

The remaining 103 Neon rows have no source ID, so they are not blindly counted
as additional unique works. No extra ingestion/index writes were made merely
to round the headline to 150K. The staged 500K import is still incomplete and
is excluded from lookup using both FTS membership and `works.id <= 100000`.
No full 500K completion or popular-book coverage is claimed.

Within the indexed 100K: zero blank titles; 6,973 lack an author identity;
72,651 lack covers; 10,410 lack active edition records. Unknown metadata remains
unknown. Representative live adapter searches took 156–609 ms (four uncached
samples, not a latency guarantee). Provider dashboard after checks: 511.26 MB,
7,811,369 writes, 20,460,523 reads, zero sync; Free plan. Writes did not increase.

## Operational design

- No new service, SDK or paid dependency. Render backend uses the documented
  libSQL HTTP pipeline against one fixed HTTPS endpoint.
- Only static SELECT queries. Work and search lookups exclude deleted,
  unindexed and out-of-subset records. Redirect traversal is bounded to eight
  steps; cycles/unresolved identities return no match.
- Parameterized FTS title/author prefixes; max 200 input characters per field,
  twelve tokens per field, 31 remote candidates and 30 visible results.
- Two-second transport timeout, no retries, 256 KB response ceiling, 256-entry
  public-metadata cache (60 seconds), 30-second failure circuit breaker.
- Existing authenticated account/rate/origin controls apply. Queries use `/me/`
  so existing access-log redaction and private/no-store headers apply. No user
  identifier, cookie, shelf, note or CSV is sent to Turso.
- Shared metadata searches can have incomplete coverage. A readable outage
  message and manual-private fallback keep Neon and saved reading usable.
- The temporary broad usage token is **not** an application credential. On
  21 October the owner explicitly deferred its revocation and GitHub-secret
  removal until deployment review. Do not silently revoke or reuse it for app
  lookup. The old monitor is deleted; no importer was restarted.

## Schema and rollback

`a17d09c25ef1` follows `f5c12a608de3`:

- Adds nullable `user_books.private_catalogue` JSONB (SQL NULL for ordinary
  entries, not JSON null), with no backfill or changes to existing identities.
- Partial unique `(user_id, private_catalogue->>'work_id')` index for populated
  metadata; ordinary private/imported entries are unaffected.
- Library, workspace, Next Read and reading export retain the metadata/cover.
- Downgrade refuses to drop populated provenance. After use, disable lookup or
  forward-fix; do not roll back by destroying new private data.
- This compatibility-aware backend requires the new migration before deployment,
  even while the feature flag is off. Old schema + new ORM is not supported.

## Enablement checklist — approval required

Local verification on 22 October passed the real browser/API/provider/private-save
journey; see `external-catalogue-report.md`. The integration and UI are already
merged into `v3` at `64abc8f`. This does not activate hosted lookup. The
replacement local credential expires 21 November 2026 at 18:24:43 UTC; all older
database tokens were invalidated with owner approval. Do not revive old importer
credentials or use the owner-deferred organization token in this application.

1. Review/merge the feature PR into `v3`; no direct production push.
2. Rehearse on the intended isolated development target and complete QA review.
3. Verify current Free/overages-disabled account settings and lookup read budget.
4. Obtain explicit permission for a fresh production recovery point, migration
   and matching backend/frontend deployment. None was performed by this work.
5. Put a database-scoped **read-only** Turso token directly in backend
   `EXTERNAL_CATALOGUE_TOKEN`; never in a Vite variable, repository or chat.
6. Migrate, deploy compatibly with `EXTERNAL_CATALOGUE_ENABLED=false`, smoke
   existing V2/V3 flows, then enable the pilot explicitly. Capability gating hides
   the UI and prevents lookup requests when disabled.
7. Hosted account-owner test: search → review/cancel → confirm → reload/private
   cover → reading lifecycle → repeated selection → outage fallback. Local tests
   are not a claim that hosted cookies, secrets or deployment were verified.
8. At deployment review, follow the owner's decision about temporary organization
   token revocation and removing only `TURSO_CATALOGUE_USAGE_TOKEN`.

## Not included

No production deployment/migration, exact-150K top-up, 500K completion, public
promotion, automatic enrichment of existing private/imported entries, ISBN UI,
new recommendation algorithm, live Open Library API fallback, popularity
selection or paid infrastructure. The safest showcase remains the existing
site until the separate release checklist is approved and executed.

## Verification record

See the associated implementation report for exact executed results and failed
attempts. Tests use synthetic local databases only. Source work-ID counts and
live adapter smoke checks are the only hosted reads; no reader data was queried.
