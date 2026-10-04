# Driver License Check

Self-hosted driver license verification. Integrators create a session, send the user to a hosted capture page, and read the result. Processing is local OCR plus rule-based data consistency checks. A positive result means the document passed automated data consistency checks, not that it is genuine.

- Build spec: `SPEC.md`
- Integrator guide: `docs/integration.md`
- Changes per milestone: `CHANGELOG.md`
- Database schema and how to change it: `database/README.md`

## Quick start (local)

```sh
docker compose up -d mysql                # MySQL 8 on localhost:3307, schema from database/
npm install
npm run env:init                          # creates server/.env, generates any empty secrets
npm run migrate && npm run seed           # prints a test API key once
npm run build                             # hosted page, served by the API at /s/:token
npm run dev -w server                     # API on :3000
npm run dev:worker -w server              # worker (OCR, webhooks, expiry, retention)
```

Full stack in containers: `docker compose up --build` (uses `server/.env`).

Deploying on a free Oracle Cloud VM with HTTPS: see `docs/deploy.md`.

## Tests

```sh
npm test            # unit + integration (needs the mysql container), OCR accuracy, no-network, log redaction
npm run test:e2e    # Playwright against a fake camera
npm run lint && npm run typecheck && npm run audit:prod
```

## Before production

These items are not settled; see `SPEC.md` section 15 and `CHANGELOG.md`.

- Norway profile: the license number pattern, validity periods, minimum ages and category list are unverified and left `null`, so their checks are skipped. Confirm each value against official sources and record the source.
- The OCR layout and thresholds are tuned on synthetic cards only. Measure on real specimen images (where license terms permit) before relying on them.
- Production image storage, retention defaults, processing time target and the relationship to the `sharebox-weblink` driver license step are open questions.
- Legal and privacy review is required before processing real identity documents.
