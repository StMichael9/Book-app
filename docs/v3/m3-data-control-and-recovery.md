# M3 data control and recovery

## Contract

- Optional save reason belongs to the personal book; note and reaction belong to one reading. Finishing requires none of them. Summaries, public catalogue and provider caches omit private context.
- `DELETE /me/reading-attempts/{uuid}` removes one reading only. `DELETE /me/library/{id}` forgets the personal entry and all its readings. Both require `{expected_version, confirmed:true}`, owner cookie authentication, enabled writes and existing origin/rate-limit protections. Parent locking serializes writes. Stale version409 never automatically retries; foreign/missing404 reveals no ownership.
- A lost success response is reconciled by an owner-only read on retry. The UI does not hide records optimistically. Repeated removal of an absent row returns404, not a false success write. Clearing flags is not deletion. Removing a pagination anchor requires returning to the first page; the existing recovery button remains available.
- `GET /me/reading-export` is an owner-only JSON Lines attachment, limited to three requests/minute, also available to richer read-only libraries. Format1 has metadata, entry, reading, preference and complete records. All rows come from one read-only repeatable-read snapshot. Three server cursors fetch100 rows at a time, with a120-second generator deadline,15-second statement timeout and60-second idle-transaction timeout. Cancellation/failure closes the snapshot; only a completed stream has its final marker.
- Export includes personal flags/context/history and preference source text, with minimal catalogue identity and edition snapshots. It excludes credentials, token hashes, request fingerprints, other users and raw import data. No file/archive is written on the server. The browser holds the completed download and validates its footer before initiating a save; browser memory can grow with the exported file. JSONL is not an automatic restore/import contract. File privacy on the reader's device is their responsibility.
- No migration, new table, hosting change, cloud resource, paid service or dependency is needed. Schema head remains `ef41a83d9012`. M1 already established the deletion cascades and private fields. M4/import milestones remain separate.

## Supported account-deletion procedure (operator assisted)

This is a procedure, not permission to delete any live account. There is no new self-service deletion endpoint. A public-release support contact must be confirmed before inviting readers who do not already have an operator/support channel.

1. Receive an explicit request and verify ownership using an authenticated support interaction or the verified account email. Do not accept a supplied numeric/UUID identifier alone as authorization. Never request a password/reset token in chat.
2. Obtain approval for the exact environment and account UUID. Inspect the account and dependent row counts read-only; confirm no shared catalogue rows are in scope. Offer a reading export first if requested. Explain that deletion is irreversible in live data and does not erase downloaded files or immediately purge retained backups.
3. With the existing approved database administration path, delete exactly that verified User row in one transaction with an exact UUID predicate and one-row affected-count assertion. Existing foreign keys cascade refresh tokens, reset tokens, preferences, UserBooks and ReadingAttempts. Check resulting dependent counts before committing; roll back any mismatch. Do not delete Books, Editions, Authors, Tags, other users or catalogue-import state.
4. Product-update email signup is a separate explicit opt-in, not a User foreign key. If the request includes opt-out/full erasure, remove the exact verified email from that list separately in the same approved transaction; do not infer new consent from registration or recreate it on restore.
5. Existing token authentication checks the live User row, so a deleted account cannot keep accessing data with an old cookie. Verify that behavior, record only minimal operation evidence (approval, time, scoped ID and counts), then confirm completion without retaining notes/export content in logs.

## Recovery and deployment boundaries

- No production migration/deployment/recovery is performed by M3. Keep V3 off until separately approved; richer existing data remains readable if new writes are disabled. Do not roll back to an incompatible V2 binary or drop the M1 tables after real V3 activity.
- Before any separately approved deployment, refresh the recovery point and inspect actual schema/head and retention settings. Historical test restores do not prove current production recoverability.
- Recovery from corruption/outage uses an approved isolated restore first. Validate catalogue IDs, reader relationships, auth/password state and the deletion/opt-out operation record before switching traffic. Reapply verified deletions/opt-outs after any point-in-time restore that predates them; do not resurrect erased readers silently. Account for valid activity after the recovery point rather than overwriting it without reconciliation.
- Backup expiration is controlled by actual configured retention; no immediate backup-erasure guarantee is made. Any incident restore, credential change, connection switch or production deletion needs its own explicit approval.

## Verification

M3 tests cover cross-owner rejection, strict confirmation, stale versions, concurrent update/removal, retained flags/context/other readings, personal-entry/account cascades, export ownership/Unicode/no credentials/read-only access, snapshot consistency, early-close connection release and a10,001-entry fixed-query export. Browser tests cover cancel/failure/retry, precise removal scope, stale confirmations, complete/truncated/failed downloads, read-only access and departed-session suppression. Actual executed results and independent QA disposition are recorded in `m3-progress.md`; this checklist alone is not evidence of a passing run.
