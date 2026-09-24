# Bookvane V2

Bookvane is a React/Vite book-discovery app backed by FastAPI and PostgreSQL. The frontend is currently hosted on Vercel, the API on Render, and the database on Neon. This repository does not include a live data import or paid service.

## Current features

- Title, author, and subject search; autocomplete; curated discovery shelves; preference-aware results.
- Account registration, login, rotating refresh cookies, logout, and password recovery.
- Private Own/Want shelves and reading preferences.
- Explicit, separate opt-in for occasional product updates; a registered email is **not** an opt-in.
- Client-generated, single-book share image. An optional Bookshop link appears on a Want card only if a valid ISBN-13 and `VITE_BOOKSHOP_AFFILIATE_ID` are both present.

## Local setup

Use Python 3.11+ and Node.js 20+. Copy `backend/.env.example` to `backend/.env`, fill local values, and use a PostgreSQL database you control. From `backend`, install `requirements.txt`, run `python -m alembic upgrade head`, then start `uvicorn main:app --reload`. From `frontend`, run `npm ci` and `npm run dev`. The development frontend defaults to `http://localhost:8000` for the API; set `VITE_API_BASE_URL` if using another port. Use **localhost for both frontend and API** in development so cookies have the same site.

The reset-link URL is sent through Resend. Verify `shelfbound.dev` as a sender before configuring `PASSWORD_RESET_FROM`; no secret or verified sender is bundled here. Reset links expire after 30 minutes, are stored only as hashes, and can be used once. A successful reset invalidates existing access and refresh tokens.

## Production configuration and release order

1. Rotate the Neon test credential previously committed in `backend/.env.test` if it is still active. The file is no longer tracked on this branch, but removing it does **not** erase Git history. Do not reuse that credential. Configure a separate disposable database and user for tests.
2. Back up the database and apply `python -m alembic upgrade head` before deploying V2 code. The older UUID-to-integer catalogue migration now fails safely if a populated UUID catalogue is present; that case needs an explicit data migration, not an automatic drop.
3. Set `DATABASE_URL`, a random 32-byte-or-longer `SECRET_KEY`, `IS_DEV=false`, `CORS_ORIGINS` (the exact deployed frontend origin), `FRONTEND_BASE_URL`, `RESEND_API_KEY`, and `PASSWORD_RESET_FROM` on Render. The blueprint leaves secrets and live origins for you to supply. Never use `*` for credentialed CORS. Use `COOKIE_DOMAIN` only if deliberately sharing cookies across API subdomains; leave it unset for a Render host. Production cookies default to `Secure; HttpOnly; SameSite=None`. If frontend and API move under the same site, `COOKIE_SAMESITE=lax` can be set explicitly.
4. Set `VITE_API_BASE_URL` to the deployed API URL for the frontend build. Keep `VITE_BOOKSHOP_AFFILIATE_ID` unset until you have a real affiliate ID, a valid ISBN import, and a compliant hosting decision. This is a public build variable, not a secret.
5. Check registration, login persistence, refresh, logout, reset email, preferences, Own/Want, discovery, and sharing in a deployed browser. Cross-site cookies can be blocked by browser privacy settings even with `SameSite=None`; a same-site frontend/API domain is the durable fix, and it is not configured by this branch.

Vercel Hobby's non-commercial rule is still a user-owned gate for affiliate-enabled public use. No hosting migration, new domain purchase, affiliate enrollment, or catalogue import is included here. Render free cold starts and Neon's free storage cap remain limits to measure against real usage.

## Safe tests and scale checks

Backend tests are deliberately skipped unless `TEST_DATABASE_URL` points to a separately credentialed disposable PostgreSQL database whose name contains `test`, and `BOOKVANE_TEST_DB_ISOLATED=yes` is set. The fixture deletes and rebuilds test data. Never set these variables for a production or shared database. Run `python -m pytest tests -q` from `backend`; run `npm run build` and `npm run lint` from `frontend`.

The search migration adds GIN trigram indexes for title and author substring searches. A local disposable benchmark with 100,000 short-description books, 1,000 authors, and 100 tags used about 41 MB and returned a deep 50-book page in about 50–60 ms after the page-ID optimization (first request and preference ordering were slower). This is **not** a Neon capacity guarantee: real descriptions, indexes, user data, storage overhead, cold starts, and network latency differ. Measure storage and representative queries after your own import before claiming 100K capacity.

An observed local discovery load issued five book GETs (plus two development-mode session checks); removing an unnecessary JSON header eliminated five CORS preflights. Do not raise rate limits based solely on the reported 429—check production browser Network and Render logs first.
