# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

v1 milestones M1 to M7 from `SPEC.md` section 16 are implemented; see `CHANGELOG.md`. `SPEC.md` (v0.1 draft) remains the source of truth for behavior. Open questions in section 15 are still open.

In the spec, "Decision" sections are fixed for v1. "Open question" sections (collected in section 15) are not settled; use the stated default and do not invent an answer. When code lands, replace the "planned" notes below with the real commands.

## What it does

Integrators (for example sharebox-api) create a session over a server-to-server API, redirect the end user to a hosted Vue capture page, and the end user photographs the front and back of their license. A worker runs local OCR, parses fields against a document template plus a country profile, runs rule-based checks, and produces a decision (`approved` / `review` / `rejected`). The integrator polls `GET /v1/sessions/:id` or receives a minimal signed webhook (no personal data in it).

Hard constraints that shape everything:

- No external network calls during processing. OCR is `tesseract.js` with bundled `eng`/`nor` traineddata in `server/tessdata/`; it must never download language data. A test must prove no outbound requests happen.
- Never claim authenticity. API and docs say "passed automated data consistency checks", never "authentic" or "verified genuine".
- No document personal data in logs (log session ids, check codes, durations only). A redaction test enforces this.
- Images and extracted fields are encrypted at rest (AES-256-GCM, per-object data key wrapped by `ENCRYPTION_MASTER_KEY`, key id stored per object).

## Stack and layout

TypeScript `strict` everywhere, Node 22 LTS, npm workspaces monorepo:

- `shared/`: Zod schemas, DTOs, enums, check codes. Single source of the API contract; server and hosted page both import it.
- `server/`: Express 5 + Zod + Knex on MySQL 8.0 (`utf8mb4_unicode_ci`), run with `tsx`. `app.ts` is an app factory without `listen` (for supertest), `main.ts` is the API entry, `worker.ts` is the job worker entry. Feature code lives in `server/src/modules/<feature>/`.
- Dependency injection: awilix in PROXY mode, no decorators. `server/src/container.ts` is the only composition root and declares the `Cradle` type. Classes take `Pick<Cradle, ...>` in their constructor. Repositories (`*.repository.ts`) are the only code that touches the database; services hold logic; routes parse with Zod and call services. Multi-repository transactions go through `UnitOfWork.run()`. Tests override via `createContainer(config, overrides)` or `container.register()`.
- `hosted-page/`: Vue 3 Composition API with `<script setup>`, Vite, Pinia, vue-router 4, Tailwind, vue-i18n (`en`, `nb`). No third-party scripts, fonts, or analytics.

There is no Redis. The job queue is a MySQL `job` table polled with `SELECT ... FOR UPDATE SKIP LOCKED`, so multiple workers can run in parallel.

## Architecture rules (from the spec)

- Layering: routes only parse input with Zod and call a service; services hold business logic; repositories are the only code that touches the database.
- Checks (`modules/checks/`, one file per check) are pure functions `(extracted, context) => CheckResult` with no I/O. "Today" comes from an injected clock, never `new Date()` inside a check. Each check needs unit tests for pass, fail, and skipped paths.
- Session state transitions are enforced in one state machine module (`created -> in_progress -> submitted -> processing -> completed`, plus `failed`, `expired`, `cancelled`). Do not change status anywhere else.
- Decision rules live in one module (`modules/decision/`), are config-driven per integrator, and are tested with tables. Rule: any critical fail is `rejected`; any major fail, a critical check skipped for low confidence, or 2+ warns is `review`; otherwise `approved`.
- Templates (`eu-card-v1` first) and country profiles (`countries/no.ts` first) are pluggable. Country profiles are config, not code. Values in the spec example are placeholders: never invent a regulatory rule. Unknown values stay `null` so the related check is `skipped`, and confirmed values carry a source comment.
- Document dates are date-only values returned as `YYYY-MM-DD` and must not be shifted by timezone. Server runs in UTC.
- Fields below `FIELD_MIN_CONFIDENCE` (default 0.6) return `value: null` with `low_confidence: true`; dependent checks become `skipped`.
- Reuse detection (`DOCUMENT_NUMBER_REUSED`) compares HMACs with a server secret, never plaintext, so it survives PII purge.
- Webhook signature: `X-DLC-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>`. Secrets compared in constant time.
- Error responses use one shape: `{ "error": { "code", "message", "request_id" } }` with the codes listed in spec section 5.3.

## Commands

Run from the repo root unless noted. Local MySQL: `docker compose up -d mysql` (host port 3307; databases `dlc`, `dlc_test`, `dlc_e2e`). `npm run env:init` creates `server/.env` and fills empty secrets (never overwrites set ones).

- `npm run migrate`, `npm run seed` (prints a test API key once).
- `npm run dev -w server` (API, port 3000), `npm run dev:worker -w server` (worker), `npm run dev -w hosted-page` (Vite on 5173, proxies `/hosted/api`). `npm run build` builds the hosted page that the API serves at `/s/:token`.
- Admin CLI: `npm run cli -w server -- integrator:create|integrator:list|key:create|key:revoke|webhook:rotate`.
- Tests: `npm test` (shared + server: unit, integration against `dlc_test`, OCR accuracy, no-network, log redaction). `npm run test:coverage -w server` enforces 90% lines on checks, decision and the state machine. One file: `cd server && TZ=UTC npx vitest run test/unit/checks.test.ts`.
- E2E: `npm run test:e2e` (Playwright, fake camera, own API on port 3100 against `dlc_e2e`).
- `npm run lint`, `npm run format`, `npm run typecheck`, `npm run audit:prod` (audit gate with reviewed exceptions in `scripts/audit.mjs`).
- Fixtures: `npm run fixtures:generate -w server`; OCR baseline in `server/test/fixtures/ocr-baseline.json`. Debug one fixture: `cd server && npx tsx scripts/analyze-fixture.ts valid`. Load test: `npm run loadtest -w server -- 60 10 3`.
- Tessdata refresh: `server/scripts/fetch-tessdata.sh` (build time only).
- CI: GitHub Actions, `.github/workflows/ci.yml` (jobs `lint`, `test`, `e2e`, each with its own MySQL 8 service on port 3306). Validate edits with actionlint.

## Related Sharebox repos

Open question 5 in the spec: the first integrator may be `sharebox-api`, and `sharebox-weblink` already has a driver-license step in its check-in flow. Check with the product owner before assuming this service replaces or complements that step.
