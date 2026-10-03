# Changelog

All notable changes. Milestones follow SPEC.md section 16.

## Deployment (2026-10-03)

- `deploy/`: single-VM production stack (Caddy with automatic HTTPS, API, worker, MySQL 8 on an internal network, `/metrics` blocked at the proxy, log rotation), `init-env.sh` secret generator that never overwrites set values, and `backup.sh` (MySQL dump plus image volume, 7 days).
- `docs/deploy.md`: Oracle Cloud Always Free ARM VM walkthrough.
- `npm run env:init` for local `server/.env` setup.
- Fix: the Docker image now creates `server/var/images` owned by `node`, so a fresh images volume is writable (uploads failed with a root-owned volume).

## M7 Hardening (2026-10-03)

- Security headers on every response (nosniff, no-referrer, COOP/CORP, HSTS when enabled), `Cache-Control: no-store` on all API responses, nonce-based CSP on the hosted page with `frame-ancestors 'none'` by default and `Permissions-Policy: camera=(self)`.
- Upload hardening: magic-byte validation, 10 MB limit, pixel limit (decompression bomb guard), decode and re-encode with sharp.
- Log redaction test: a full processing run at debug level produces no names, dates, license numbers, tokens, API keys or webhook secrets in the logs.
- CI (GitHub Actions, `.github/workflows/ci.yml`): lint, format check, typecheck, dependency audit, tests against a MySQL 8 service with the coverage gate, and Playwright e2e. Runs on pushes to `main` and on pull requests.
- Dependency audit gate (`npm run audit:prod`): fails on high or critical production advisories. One reviewed, time-boxed exception (GHSA-vfj7-8cjw-p6xm in `braces`, reached only through `awilix.loadModules`, which is not used; expires 2027-01-31).
- sharp upgraded to 0.35.5 (fixes libvips and libheif advisories).
- Pipeline load test (`npm run loadtest -w server -- 60 10 3`): 60 sessions, 10 in flight, 3 OCR workers. p50 0.79 s, p95 1.24 s, max 1.71 s. Measured on an Apple M4 Pro (12 cores), not on the 4 vCPU reference server from SPEC 13, and covering the image and OCR stages (the CPU-bound part) but not database writes. Re-measure on the target hardware before confirming the target.

## M6 Webhooks, retention, audit, metrics (2026-10-03)

- Signed webhooks (`X-DLC-Signature: t=...,v1=...`, `X-DLC-Event-Id`) on completed, failed and expired; minimal body with no personal data; retries at 1m, 5m, 30m, 2h, 6h; every attempt recorded in `webhook_delivery`; secrets rotatable via CLI.
- Hourly retention purge: images and encrypted fields after the integrator's retention days, uploads of expired and cancelled sessions, and HMACs plus check results at the hard cutoff (default 365 days). Tested with an injected clock.
- Audit log for session creation, result reads, image downloads, deletes and all end-user actions. IPs are stored as keyed hashes.
- Prometheus metrics: API `/metrics` (sessions by status, decisions, check fail/warn counts, queue depth, computed from the database) and worker `/metrics` on `WORKER_METRICS_PORT` (processing and step duration histograms, OCR confidence histogram, job outcomes).
- `docs/integration.md`: flow, auth, endpoints, errors, webhook verification example in Node, limitations from SPEC 9.

## M5 OCR and EU template (2026-10-03)

- Tesseract worker pool (tesseract.js 7) with bundled `eng` and `nor` traineddata (tessdata_fast 4.1.0, checksums in `server/tessdata/SHA256SUMS`). Cache disabled, local language path only.
- No-network test: the OCR pipeline runs in a child process where sockets, DNS, http(s) and fetch throw in the main thread and in the worker threads.
- Card detection (sharp trim plus ID-1 aspect check, portrait to landscape), 0/180 orientation by OCR confidence, label-driven `eu-card-v1` parser with zone re-reads for missing fields, back category table parsing, country detection.
- Country profile `NO`: only values with a stated source are set. The SPEC 6.4 example values (license number pattern, validity periods, minimum ages, category list) are unverified placeholders, so they are `null` and the dependent checks are `skipped` with reason `rule_unknown`. Tests use the SPEC example values through an injected test profile.
- Synthetic fixture generator (`npm run fixtures:generate -w server`): 15 cards with known values, including blur, glare, darkness, rotation and every defect from SPEC 17. Field-level accuracy test with a baseline of 0.97; current result 100% (101/101).

## M4 Processing pipeline without OCR (2026-10-03)

- MySQL job queue with `SELECT ... FOR UPDATE SKIP LOCKED`, worker process with bounded concurrency, stale job recovery, 2 retries for system errors, 60 s job timeout.
- Preprocessing (EXIF orientation, metadata strip, 2000 px cap) and image quality metrics (Laplacian variance, glare ratio, mean luminance, DCT perceptual hash).
- All checks from SPEC 7 as pure functions, one file each, with table-driven tests for pass, fail and skipped paths. "Today" comes from the injected clock.
- Config-driven decision module per integrator (severity overrides, warn threshold, review mapping).

## M3 Hosted page and uploads (2026-10-03)

- Hosted API: token exchange to an HttpOnly `SameSite=Strict` cookie, single-use link (reopen only with the cookie or when the integrator allows it), consent with version, upload, submit, status.
- Encrypted image store (AES-256-GCM envelope encryption, per-object data key, key id stored per object, rotation supported) behind an `ImageStore` interface with a filesystem implementation.
- Vue 3 hosted page: intro and consent, camera capture with ID-1 framing guide and file fallback, client-side review checks, upload progress, submit, done with redirect, error screens, desktop to phone QR handoff behind a flag, `en` and `nb`.
- Playwright e2e with a fake camera stream (11 tests), including a CSP violation guard.

## M2 Integrator API and state machine (2026-10-03)

- API key auth (HMAC-SHA256 with pepper, prefix lookup, constant-time compare), per-key rate limit with `Retry-After`.
- `POST/GET/LIST/DELETE /v1/sessions`, Zod schemas in `shared/`, return and webhook URL host allowlist, HTTPS required outside development.
- Session state machine in one module with conditional status writes; expiry job.

## M1 Skeleton (2026-10-03)

- npm workspaces monorepo (`shared`, `server`, `hosted-page`), TypeScript strict, ESLint and Prettier, Vitest.
- Env config validated at startup (process exits on invalid config), pino JSON logs with request ids, uniform error shape, health and readiness endpoints.
- Knex migration for all SPEC 11 tables; seed creates a test integrator and prints its test API key.
- Dependency injection with awilix (PROXY mode, no decorators): repositories, then services, then routes; `UnitOfWork` for transactions.
- docker-compose with `api`, `worker` and `mysql`.
