# Bookvane V2

V3 uses separate milestone feature branches and reviewed PRs into `v3`. Current M6 preparation is on `codex/v3-m6-release-verification`, stacked on tested M5 while real-export acceptance is pending. See [the V3 decision record](docs/v3/decision-record.md) and [current release-readiness record](docs/v3/m6-release-readiness.md). V3 is disabled by default; production migration, deployment and public enablement require separate approval.

Bookvane is a React/Vite book-discovery app backed by FastAPI and PostgreSQL. The frontend and API are hosted on Render, and the database on Neon. V3 development adds no hosted service or payment infrastructure.

## Current features

- Title, author, and subject search; autocomplete; curated discovery shelves; preference-aware results.
- Account registration, login, rotating refresh cookies, logout, and password recovery.
- Private Own/Want shelves and reading preferences.
- Explicit, separate opt-in for occasional product updates; a registered email is **not** an opt-in.
- Client-generated, single-book share image. An optional Bookshop link appears on a Want card only if a valid ISBN-13 and `VITE_BOOKSHOP_AFFILIATE_ID` are both present.

## Local setup

Use Python 3.11+ (local verification uses 3.12) and Node.js 20.19+ or 22.12+, as required by the installed Vite version. Copy `backend/.env.example` to `backend/.env`, fill local values, and use a PostgreSQL database you control. From `backend`, install `requirements.txt`, run `python -m alembic upgrade head` **only against that local/development target**, then start `uvicorn main:app --reload`. From `frontend`, run `npm ci` and `npm run dev`. The development frontend defaults to `http://localhost:8000` for the API; set `VITE_API_BASE_URL` if using another port. Use **localhost for both frontend and API** in development so cookies have the same site.

The reset-link URL is sent through Resend. Verify `shelfbound.dev` as a sender before configuring `PASSWORD_RESET_FROM`; no secret or verified sender is bundled here. Reset links expire after 30 minutes, are stored only as hashes, and can be used once. A successful reset invalidates existing access and refresh tokens.

## Production configuration and release order

1. Rotate the Neon test credential previously committed in `backend/.env.test` if it is still active. The file is no longer tracked on this branch, but removing it does **not** erase Git history. Do not reuse that credential. Configure a separate disposable database and user for tests.
2. The V2 schema head is `d9b6e1f2a3c4`. V3 adds library migration `ef41a83d9012` and private-import migration `f5c12a608de3` (current head). Apply them only to isolated development/test databases until production approval and a fresh recovery point exist. Use a direct, non-pooled database connection for the approved migration/backup session; keep the application's pooled connection separate. Web startup does not automatically migrate. The historical UUID-to-integer migration rejects populated UUID catalogues rather than deleting them.
3. Set `DATABASE_URL`, a random 32-byte-or-longer `SECRET_KEY`, `IS_DEV=false`, `CORS_ORIGINS` (the exact deployed HTTPS frontend origin, without a trailing slash or path), `FRONTEND_BASE_URL`, `RESEND_API_KEY`, and `PASSWORD_RESET_FROM` on Render. Production startup now rejects missing, wildcard, HTTP or path-bearing CORS origins. Multiple exact origins can be comma-separated. The blueprint leaves secrets and live origins for you to supply. Use `COOKIE_DOMAIN` only if deliberately sharing cookies across API subdomains; leave it unset for a Render host. Production cookies default to `Secure; HttpOnly; SameSite=None`. If frontend and API move under the same site, `COOKIE_SAMESITE=lax` can be set explicitly.
4. Set `VITE_API_BASE_URL` to the deployed API URL for the frontend build. Keep `VITE_BOOKSHOP_AFFILIATE_ID` unset until you have a real affiliate ID, a valid ISBN import, and a compliant hosting decision. This is a public build variable, not a secret.
5. Check registration, login persistence, refresh, logout, reset email, preferences, Own/Want, discovery, and sharing in a deployed browser. Cross-site cookies can be blocked by browser privacy settings even with `SameSite=None`; a same-site frontend/API domain is the durable fix, and it is not configured by this branch.

V3 is additionally controlled by server settings `READING_V3_ENABLED=false`, optional comma-separated `READING_V3_USER_IDS`, and the separate `LIBRARY_IMPORT_ENABLED=false`. Capabilities are negotiated through the API; there is no frontend-only bypass. For an approved pilot, set the exact permitted account IDs rather than enabling everyone unintentionally. Import capacity is capped by `LIBRARY_IMPORT_MAX_DATABASE_MB` (default/maximum 800 MiB) and cannot raise the saved catalogue guard. No flag or hosted setting is changed by these instructions.

The checked-in Blueprint describes the existing free backend only; it is not an instruction to recreate it or provision a database. The existing Render static frontend needs its own matching reviewed branch/build, `VITE_API_BASE_URL` at build time, `dist` publish directory under `frontend`, and SPA rewrite to `index.html` for deep links. Confirm actual Dashboard settings separately before an approved deploy. Existing `env: python` is legacy Blueprint syntax; no infrastructure rewrite is performed for M6.

Render free cold starts and Neon's shared free allowances remain limits to measure against real usage. M1 adds no hosting service, domain purchase, affiliate enrollment or catalogue import.

## Local M6 HTTPS verification

`playwright.m6-https.config.js` reuses the existing loopback HTTPS harness with `IS_DEV=false`, `Secure`/`HttpOnly` cookies, explicit `SameSite=Lax`, exact credentialed origins and V3 enabled **only in the local test process**. Supply a fresh migrated database ending `browser_test` at `127.0.0.1:55433`, owned by the restricted `bookvane_v3_test` role; `BOOKVANE_TEST_DB_ISOLATED=yes`; a synthetic signing key at least 32 bytes long; and `BOOKVANE_TEST_CERT`/`BOOKVANE_TEST_KEY` paths to a local self-signed certificate. Put the backend virtualenv on PATH, set `PLAYWRIGHT_CHANNEL=msedge` if desired, then run `playwright test --config playwright.m6-https.config.js` from `frontend`. It builds the standard frontend and starts only the guarded test harness. Do not overlap other builds using `dist` or reuse a populated database.

Only delivery is captured in test-process memory: no real reset email is sent and no raw token is printed. This verifies browser → actual API → disposable PostgreSQL over HTTPS, not live Render/Neon, unrelated-domain third-party-cookie behavior or physical iPhone Safari. Existing V2 HTTPS configuration remains available separately.

## Safe tests and scale checks

Backend tests are deliberately skipped unless `TEST_DATABASE_URL` points to a separately credentialed disposable PostgreSQL database whose name contains `test`, and `BOOKVANE_TEST_DB_ISOLATED=yes` is set. The fixture deletes and rebuilds test data. Never set these variables for a production or shared database. Run `python -m pytest tests -q` from `backend`; run `npm run build` and `npm run lint` from `frontend`.

`npm test` builds the standard frontend entry and runs the activated UI, critical-flow and auth/data regressions with intercepted API traffic. It does not contact Neon or send emails. Set `PLAYWRIGHT_CHANNEL=msedge` to use installed Edge instead of downloading Chromium. The visual-export test is excluded from this normal run so tests do not overwrite the design gallery.

`npm run test:mobile` runs the Discover touch-navigation and keyboard regressions in both WebKit and Chromium at a phone viewport. Install WebKit once with `npx playwright install webkit`; the Chromium project also honors `PLAYWRIGHT_CHANNEL` and `PLAYWRIGHT_EXECUTABLE_PATH`. The cases cover single-tap cover/title navigation, first/lower cards, real/missing covers, delayed details, the skip link and controls above the fixed mobile navigation. These same six cases run in the normal `npm test` browser. APIs are intercepted locally; WebKit phone simulation does not replace a hosted check on an actual iPhone/Safari.

The separate real-API browser check uses `backend/tests/browser_server.py` and `frontend/playwright.integration.config.js`. It is deliberately **not** part of normal application startup or deployment. It requires a fresh migrated database named with `browser_test`, owned by the non-superuser `bookvane_test` at `127.0.0.1:55432`, plus `BOOKVANE_TEST_DB_ISOLATED=yes`. It refuses another target or a database containing books. Apply Alembic from the backend directory to that disposable database first. Configure `IS_DEV=false`, a test-only `SECRET_KEY`, `CORS_ORIGINS=https://127.0.0.1:5192`, `FRONTEND_BASE_URL=https://127.0.0.1:5192`, and `BOOKVANE_TEST_CERT`/`BOOKVANE_TEST_KEY` pointing to a local test TLS certificate/key. Build the frontend with `VITE_API_BASE_URL=https://127.0.0.1:8009`, then run `python tests/browser_server.py` from backend and `npx playwright test --config playwright.integration.config.js` from frontend. The harness captures email in memory, seeds only local fixtures and exercises real PostgreSQL, token rotation and Secure/HttpOnly cookies. Use a fresh database when restarting the harness; do not point it at the populated catalogue. Its self-signed-certificate exception is local-only and proves neither hosted TLS nor unrelated-domain/Safari cookie behavior.

Deploy the matching frontend/backend pair: preferences now resolves its bounded set of exact tag names through one `/autocomplete/tags/batch` call rather than 15 individual requests. Existing autocomplete routes, visible tag IDs, preference notes and rate limits are unchanged. This change requires no migration.

The search migration adds GIN trigram indexes for title and author substring searches. A local disposable benchmark with 100,000 short-description books, 1,000 authors, and 100 tags used about 41 MB and returned a deep 50-book page in about 50–60 ms after the page-ID optimization (first request and preference ordering were slower). This is **not** a Neon capacity guarantee: real descriptions, indexes, user data, storage overhead, cold starts, and network latency differ. Measure storage and representative queries after your own import before claiming 100K capacity.

An observed local discovery load issued five book GETs (plus two development-mode session checks); removing an unnecessary JSON header eliminated five CORS preflights. Do not raise rate limits based solely on the reported 429—check production browser Network and Render logs first.
