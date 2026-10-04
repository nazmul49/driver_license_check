# Driver License Check: Requirements Specification

Version 0.1 (draft), 2026-10-03

This document is the build spec for a self-hosted driver license verification service. It is written to be handed to a coding agent as the starting brief. Sections marked "Decision" are fixed for v1. Sections marked "Open question" need an answer from the product owner before or during implementation; until answered, use the stated default.

---

## 1. Purpose and scope

Build a service that lets third-party applications ("integrators") verify a person's driver license by:

1. Creating a verification session through a server-to-server API.
2. Redirecting the end user to a hosted capture page.
3. The end user photographing the front and back of their license with their phone or webcam.
4. The service running OCR locally, extracting fields, and running rule-based consistency checks.
5. The integrator pulling the result through the API (and optionally receiving a webhook).

### 1.1 In scope (v1)

- Local OCR only. No calls to any external API or cloud service for OCR, verification, or data lookup.
- Extraction of: full name (surname, given names), date of birth, place of birth (if present), issue date, expiry date, issuing authority, license number, license categories with per-category dates (if present), issuing country.
- Rule-based checks on the extracted data (dates, formats, cross-field consistency, front/back consistency, image quality).
- Hosted capture page (Vue) that works on mobile browsers.
- Integrator API with API key auth, result polling, optional signed webhooks.
- Data retention and deletion controls.

### 1.2 Out of scope (v1)

- Proving the document is genuine. OCR plus logic can detect inconsistent or malformed data and obvious tampering, but it cannot detect a well-made forgery. Results must never be labeled as "authentic"; the API uses "passed checks" language. See section 9.
- Checking against government registries.
- Face matching / selfie liveness. (Listed as a possible v2 item, section 14.)
- Passports and national ID cards. (Architecture should allow adding document types later.)
- Native mobile SDKs.

### 1.3 Supported documents (v1)

Decision: support templates in a pluggable way. Ship v1 with:

- EU/EEA standard card format (Directive 2006/126/EC, ISO/IEC 18013-1 layout). Fields on the front are numbered 1 to 9: 1 surname, 2 given names, 3 date and place of birth, 4a issue date, 4b expiry date, 4c issuing authority, 4d personal number (optional), 5 license number, 7 signature, 8 address (some countries), 9 categories. The back has a category table with columns 9 (category), 10 (first issue date per category), 11 (expiry per category), 12 (restriction codes).
- First country profile: Norway (NO). Additional EU country profiles are added as configuration (section 6.4).

Open question: are US/Canadian licenses needed? If yes, they carry a PDF417 barcode on the back with AAMVA-encoded data, which is a strong local cross-check source. Default: design the template interface so an AAMVA template can be added, but do not build it in v1.

---

## 2. Actors and terms

- Integrator: a client application (for example Sharebox API, or a partner) that creates sessions and reads results. Authenticated with an API key.
- End user: the person whose license is being checked. Uses the hosted page. Not authenticated; access is through a single-use, short-lived session token in the URL.
- Admin: an operator of this service. Manages integrators and API keys (CLI or minimal admin endpoints in v1; no admin UI required).
- Session: one verification attempt for one end user.
- Template: the parsing rules for one document layout (for example `eu-card-v1`).
- Country profile: country-specific rules applied on top of a template (license number regex, validity periods, date format, minimum ages).

---

## 3. End-to-end flow

```
Integrator backend            DL Check API               Hosted page (Vue)          End user
      |  POST /v1/sessions        |                            |                      |
      |-------------------------->|  create session, token     |                      |
      |  { id, hosted_url }       |                            |                      |
      |<--------------------------|                            |                      |
      |  redirect user to hosted_url ----------------------------------------------->|
      |                           |   GET /hosted/api/session  |<---------------------|
      |                           |<---------------------------|  capture front/back  |
      |                           |   POST images              |                      |
      |                           |<---------------------------|                      |
      |                           |   POST submit              |                      |
      |                           |<---------------------------|                      |
      |                           |  enqueue processing job    |                      |
      |                           |                            |  redirect to         |
      |                           |                            |  return_url          |
      |  webhook (optional)       |                            |--------------------->|
      |<--------------------------|                            |                      |
      |  GET /v1/sessions/:id     |                            |                      |
      |-------------------------->|                            |                      |
      |  { status, decision, ... }|                            |                      |
      |<--------------------------|                            |                      |
```

Session states:

```
created -> in_progress -> submitted -> processing -> completed
   |            |                          |
   |            |                          +-> failed     (internal error, retries exhausted)
   +------------+-> expired   (no submit before expires_at)
   +-> cancelled (integrator DELETE before submit)
```

- `created`: session made, hosted page not yet opened.
- `in_progress`: hosted page opened (token exchanged).
- `submitted`: end user submitted both images; job queued.
- `processing`: worker picked up the job.
- `completed`: result available (decision may be approved, rejected, or review).
- `failed`: system error. Distinct from a rejected decision.
- `expired`: end user did not finish in time.

Transitions must be enforced in one place (a state machine module) and covered by unit tests.

---

## 4. Tech stack

Decision:

- Language: TypeScript everywhere, `strict: true`.
- Runtime: Node.js 22 LTS (or 24 if the team standard requires it).
- Backend: Express 4 (or 5), Zod for request validation, `envalid` or Zod for env config, winston or pino for structured JSON logs.
- Database: MySQL 8.0, `utf8mb4` / `utf8mb4_unicode_ci`. Query layer: Knex (with Knex migrations) or Kysely. Pick one and use it consistently; default Knex because it gives migrations out of the box.
- Hosted page: Vue 3 (Composition API, `<script setup>`), Vite, Pinia, vue-router 4, Tailwind CSS. i18n via `vue-i18n` (English and Norwegian in v1).
- OCR: `tesseract.js` running in Node worker threads, with `eng` and `nor` traineddata files bundled in the repo or image. The worker must not download language data at runtime (no external calls).
- Image processing: `sharp` for decode, EXIF orientation, resize, grayscale, contrast, crop, rotate.
- Document edge detection and perspective correction: OpenCV via `@techstark/opencv-js` (WASM), or a simpler fallback of client-side framing guide plus server-side auto-crop. Default: start with client framing guide plus `sharp` trim/rotate, add OpenCV in the image-quality milestone.
- Dates: `date-fns`.
- Tests: Vitest for unit and integration, supertest for HTTP, Playwright for the hosted page e2e.
- Lint/format: ESLint + Prettier.
- Packaging: Docker, `docker-compose.yml` with `api`, `worker`, `mysql`.

Job processing: no Redis in the stack, so use a MySQL-backed job table (`job`) with `SELECT ... FOR UPDATE SKIP LOCKED` polling (MySQL 8.0 supports it). The worker runs as a separate process from the same codebase.

### 4.1 Repository layout

npm workspaces monorepo:

```
driver_license_check/
  package.json                  # workspaces: shared, server, hosted-page
  docker-compose.yml
  shared/                       # Zod schemas, DTO types, enums, check codes
    src/
  server/
    src/
      app.ts                    # express app factory (no listen), for tests
      main.ts                   # api entry
      worker.ts                 # job worker entry
      config/                   # env parsing
      db/                       # knex instance, seeds/ (schema lives in database/)
      modules/
        sessions/               # routes, controller, service, repository, state machine
        hosted/                 # hosted page API (token auth)
        images/                 # upload, storage, encryption
        processing/             # pipeline orchestration
        ocr/                    # tesseract worker pool
        preprocess/             # sharp / opencv steps, quality metrics
        templates/              # eu-card-v1, later aamva
        countries/              # country profiles (NO, ...)
        checks/                 # one file per check, pure functions
        decision/               # aggregate checks to decision
        webhooks/               # signing, delivery, retries
        integrators/            # api clients, keys
        retention/              # purge job
        audit/
      middleware/               # auth, error handler, request id, rate limit
    tessdata/                   # bundled eng/nor traineddata
    test/
      fixtures/                 # specimen and synthetic images + expected JSON
  hosted-page/
    src/
      pages/ components/ store/ router/ i18n/
```

### 4.2 Layering rules

- Routes only parse input (Zod) and call a service.
- Services hold business logic and call repositories.
- Repositories are the only code that touches the database.
- Checks are pure functions: `(extracted, context) => CheckResult`. No I/O. This makes them trivial to unit test.
- `shared/` is the single source of the API contract. The hosted page and server both import from it.

---

## 5. Integrator API

Base path `/v1`. JSON only. All timestamps ISO 8601 UTC. All dates on the document returned as `YYYY-MM-DD`.

### 5.1 Authentication

- Header: `Authorization: Bearer <api_key>`.
- API keys are random 32+ bytes, shown once on creation, stored as a hash (SHA-256 with a server-side pepper is fine for high-entropy keys; bcrypt is not required).
- Key has a prefix for identification, for example `dlc_live_xxxx` / `dlc_test_xxxx`.
- Each key belongs to one integrator. Integrators only see their own sessions.
- Rate limit per key (default 60 req/min), returns 429 with `Retry-After`.

### 5.2 Endpoints

`POST /v1/sessions`

Request:

```json
{
  "reference": "booking-12345",
  "return_url": "https://integrator.example.com/after-check?ref=booking-12345",
  "webhook_url": "https://integrator.example.com/hooks/dlc",
  "country_hint": "NO",
  "locale": "nb",
  "expires_in_seconds": 1800,
  "requirements": {
    "min_age": 18,
    "required_categories": ["B"],
    "min_remaining_validity_days": 0,
    "min_years_held": 0
  }
}
```

- `reference`: integrator's own id, max 128 chars, stored and echoed back.
- `return_url`: required. Must be HTTPS (HTTP allowed only when `NODE_ENV=development`). Host must match the integrator's allowlist of return hosts.
- `webhook_url`: optional. Same HTTPS and allowlist rule.
- `country_hint`: optional ISO 3166-1 alpha-2. Used to pick the country profile when detection is ambiguous.
- `expires_in_seconds`: default 1800, min 300, max 86400.
- `requirements`: optional; defaults come from integrator config.

Response `201`:

```json
{
  "id": "ses_01J9Z3...",
  "status": "created",
  "hosted_url": "https://dlc.example.com/s/3f9c...token",
  "expires_at": "2026-10-03T20:00:00Z"
}
```

- `id`: ULID with `ses_` prefix. Not guessable enough to be a secret; access control is by API key.
- `hosted_url` contains a separate random token (32 bytes, base64url). Only its hash is stored.

`GET /v1/sessions/:id`

Returns the session and, when `status = completed`, the full result.

```json
{
  "id": "ses_01J9Z3...",
  "reference": "booking-12345",
  "status": "completed",
  "created_at": "...",
  "submitted_at": "...",
  "completed_at": "...",
  "result": {
    "decision": "approved",
    "decision_reasons": [],
    "document": {
      "type": "driver_license",
      "template": "eu-card-v1",
      "country": "NO",
      "fields": {
        "surname":          { "value": "NORDMANN", "confidence": 0.94 },
        "given_names":      { "value": "OLA",      "confidence": 0.96 },
        "date_of_birth":    { "value": "1990-04-12", "confidence": 0.91 },
        "place_of_birth":   { "value": "OSLO",     "confidence": 0.80 },
        "issue_date":       { "value": "2021-06-01", "confidence": 0.92 },
        "expiry_date":      { "value": "2036-06-01", "confidence": 0.93 },
        "issuing_authority":{ "value": "STATENS VEGVESEN", "confidence": 0.88 },
        "license_number":   { "value": "12345678901", "confidence": 0.95 },
        "categories": [
          { "code": "B", "issue_date": "2008-05-10", "expiry_date": "2036-06-01", "restrictions": [] }
        ]
      }
    },
    "checks": [
      { "code": "EXPIRY_NOT_PASSED", "status": "pass", "severity": "critical", "message": "Document is not expired." },
      { "code": "IMAGE_GLARE",       "status": "warn", "severity": "minor",    "message": "Glare detected on front image.", "details": { "side": "front" } }
    ],
    "summary": { "passed": 18, "warned": 1, "failed": 0, "skipped": 2 }
  }
}
```

`GET /v1/sessions?reference=...&status=...&limit=50&cursor=...`

List sessions for the integrator, cursor paginated.

`GET /v1/sessions/:id/images/:side`

Optional, controlled by integrator config flag `allow_image_download` (default false). Returns the processed image. Every access is audit-logged.

`DELETE /v1/sessions/:id`

- Before submit: sets `cancelled`.
- After submit: deletes images and extracted personal data immediately, keeps a minimal tombstone (id, integrator, timestamps, decision, `deleted_at`). Returns 204.

`GET /v1/health`

Liveness. `GET /v1/ready` checks DB and that the tessdata files are present.

### 5.3 Errors

Uniform shape:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "Session not found.", "request_id": "req_..." } }
```

Codes at minimum: `VALIDATION_ERROR` (400, with `details` from Zod), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `SESSION_NOT_FOUND` (404), `INVALID_STATE` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

### 5.4 Webhooks

- Sent on transitions to `completed`, `failed`, `expired`.
- Body is minimal on purpose (no personal data): `{ "event": "session.completed", "session_id": "...", "reference": "...", "status": "completed", "decision": "review", "occurred_at": "..." }`. The integrator then calls `GET /v1/sessions/:id` for details.
- Headers: `X-DLC-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>`, `X-DLC-Event-Id`.
- Per-integrator webhook secret, rotatable.
- Retries with exponential backoff (1m, 5m, 30m, 2h, 6h), then mark failed. 2xx is success. 10 second timeout.
- Deliveries recorded in `webhook_delivery`.
- Document the signature verification in a short integrator guide (`docs/integration.md`) with a Node example.

---

## 6. Processing pipeline

Runs in the worker for each submitted session.

### 6.1 Steps

1. Load and decrypt images.
2. Normalize: apply EXIF orientation, strip EXIF/metadata, convert to PNG/JPEG at fixed max dimension (for example 2000 px long edge).
3. Image quality metrics per side (section 7.1). If a critical quality check fails, stop and complete with `decision = rejected` and reason `IMAGE_QUALITY`.
4. Document detection and crop: find card boundaries, perspective-correct to ISO/IEC 7810 ID-1 aspect ratio (85.60 x 53.98 mm, ratio about 1.586). If no card found, fail check `DOCUMENT_NOT_DETECTED`.
5. Orientation: try 0/90/180/270 if OCR confidence on step 6 is low; keep the best.
6. OCR: full-card OCR for template detection, then zone OCR using template regions (relative coordinates). Use per-zone Tesseract parameters (whitelists for digits/dates, `psm` per zone).
7. Template detection: score each template by anchor keywords and layout (for EU card: presence of "1.", "2.", "4a.", "4b.", "5." labels, EU flag area, country code in the blue band). Pick the best above threshold, else `TEMPLATE_NOT_RECOGNIZED`.
8. Country detection: from distinguishing sign in the blue band (for example "N" for Norway), issuing authority text, and `country_hint`. Conflict between detected and hint is a warn check.
9. Field parsing: template parser maps zone text to typed fields. Date parsing uses the country profile date format (`DD.MM.YYYY` for NO). Normalize names to uppercase, remove OCR noise characters.
10. Back side parsing: category table rows.
11. Run checks (section 7).
12. Decide (section 8).
13. Persist extraction and check results, transition to `completed`, enqueue webhook.

Each step logs duration. The whole job has a timeout (default 60 s) and up to 2 retries for system errors only (not for bad images).

### 6.2 OCR worker pool

- Fixed pool of Tesseract workers (size from env, default = CPU count - 1, min 1), created at worker start with local `langPath`.
- Confirm in a test that no network request is made during OCR (for example by running the OCR test with network blocked or with a mocked `fetch`/`http` that throws).

### 6.3 Field confidence

Each field carries a confidence 0..1, derived from Tesseract word confidence and parse success. Fields below `FIELD_MIN_CONFIDENCE` (default 0.6) are returned with `value: null` and a `low_confidence: true` flag, and dependent checks become `skipped`.

### 6.4 Country profile (config, not code)

Example `countries/no.ts`:

```ts
export const NO: CountryProfile = {
  code: 'NO',
  distinguishingSign: 'N',
  dateFormat: 'dd.MM.yyyy',
  licenseNumberPattern: /^\d{11}$/,          // verify against real specimens before relying on it
  personalNumberPattern: null,
  issuingAuthorityPatterns: [/STATENS\s+VEGVESEN/i],
  maxValidityYears: { default: 15, over: [{ age: 75, years: 5 }] }, // verify rules
  minAgeByCategory: { AM: 16, A1: 16, A2: 18, A: 24, B: 18, BE: 18, C1: 18, C: 21, D: 24 },
  validCategories: ['AM','A1','A2','A','B','BE','C1','C1E','C','CE','D1','D1E','D','DE','T','S'],
};
```

The numbers and patterns above are placeholders. Before going live, each value must be confirmed against official specimen documents and regulations for that country, and the source recorded in a comment. Do not invent rules; where a rule is unknown, leave it `null` and the related check is `skipped`.

---

## 7. Checks

Each check has: `code`, `status` (`pass` | `warn` | `fail` | `skipped`), `severity` (`critical` | `major` | `minor`), `message`, optional `details`. All checks are pure functions with unit tests covering pass, fail, and skipped paths. "Today" is injected (clock interface), never read with `new Date()` inside a check.

### 7.1 Image quality

| Code | Rule | Severity |
| --- | --- | --- |
| `IMAGE_RESOLUTION` | Cropped card at least 1000 px on long edge | critical |
| `IMAGE_BLUR` | Variance of Laplacian above threshold | critical |
| `IMAGE_GLARE` | Share of near-white saturated pixels in card area below threshold | major (warn) |
| `IMAGE_TOO_DARK` / `IMAGE_TOO_BRIGHT` | Mean luminance within range | major |
| `DOCUMENT_NOT_DETECTED` | Card boundary found with expected aspect ratio (tolerance 5%) | critical |
| `FRONT_BACK_SAME_IMAGE` | Perceptual hash of front and back differ | critical |
| `DUPLICATE_IMAGE` | Perceptual hash not equal to an image in another session within retention window | major (warn) |
| `SCREEN_CAPTURE_SUSPECTED` | Moire pattern heuristic (FFT peak) | minor (warn), v1.1 |

Thresholds are config values, tuned with the fixture set.

### 7.2 Data presence and format

| Code | Rule | Severity |
| --- | --- | --- |
| `TEMPLATE_RECOGNIZED` | A template matched | critical |
| `REQUIRED_FIELDS_PRESENT` | surname, given names, date of birth, issue date, expiry date, license number all extracted with sufficient confidence | critical |
| `LICENSE_NUMBER_FORMAT` | Matches country pattern | major |
| `DATES_PARSEABLE` | All extracted dates are real calendar dates in the country format | critical |
| `CATEGORIES_VALID` | Every category code is in the country's valid list | major |
| `ISSUING_AUTHORITY_KNOWN` | Matches country authority patterns | minor |
| `COUNTRY_MATCHES_HINT` | Detected country equals `country_hint` if given | major (warn) |

### 7.3 Date logic

| Code | Rule | Severity |
| --- | --- | --- |
| `EXPIRY_NOT_PASSED` | `expiry_date >= today` | critical |
| `MIN_REMAINING_VALIDITY` | `expiry_date - today >= requirements.min_remaining_validity_days` | major |
| `ISSUE_DATE_NOT_FUTURE` | `issue_date <= today` | critical |
| `ISSUE_BEFORE_EXPIRY` | `issue_date < expiry_date` | critical |
| `VALIDITY_PERIOD_PLAUSIBLE` | `expiry_date - issue_date` not more than country max validity (+ small tolerance), considering age rules | major |
| `DOB_PLAUSIBLE` | DOB in past, age between 14 and 110 | critical |
| `DOB_BEFORE_ISSUE` | `date_of_birth < issue_date` | critical |
| `AGE_AT_ISSUE_PLAUSIBLE` | Age at `issue_date` at least the minimum age for the lowest held category | major |
| `CATEGORY_DATES_CONSISTENT` | For each category: category first-issue date not after card issue date... (see note), category issue date after DOB + min age for that category, category expiry not after card expiry | major |
| `MIN_AGE` | Age today >= `requirements.min_age` | critical (when requirement set) |
| `REQUIRED_CATEGORIES_HELD` | All `requirements.required_categories` present and not expired | critical (when set) |
| `MIN_YEARS_HELD` | Earliest valid issue date of required category at least N years ago | major (when set) |

Note on category dates: on EU cards, column 10 is the date the category was first obtained, which is usually earlier than the card issue date (4a) because cards get renewed. So the rule is "category first-issue date <= card issue date", not the reverse.

### 7.4 Cross-consistency

| Code | Rule | Severity |
| --- | --- | --- |
| `FRONT_BACK_CONSISTENT` | If the back repeats the license number or name, they match the front (normalized, Levenshtein distance <= 1) | major |
| `DOCUMENT_NUMBER_REUSED` | Same license number hash seen in another session with a different DOB or name hash within retention window | major (warn) |
| `TEXT_FONT_CONSISTENCY` | v2, out of scope v1 | - |

`DOCUMENT_NUMBER_REUSED` compares keyed hashes (HMAC with a server secret), not plaintext, so the comparison survives image/PII purge without keeping raw numbers.

---

## 8. Decision

- `rejected`: any `critical` check is `fail`.
- `review`: no critical fail, but any `major` fail, or any `critical` check `skipped` because of low confidence, or 2+ `warn`.
- `approved`: everything else.

`decision_reasons` lists the codes that caused a non-approved decision. Rules live in one module, are config-driven per integrator (an integrator may map `review` to stricter or looser behavior), and are unit tested with tables.

The result must never claim authenticity. Wording in API and docs: "the document passed automated data consistency checks".

---

## 9. Limitations to state in integrator docs

The integration guide must clearly say:

- Verification is based on OCR and rule-based consistency checks only. It does not contact issuing authorities and does not confirm the license is genuine, currently valid in a registry, or not revoked/suspended.
- A high-quality forgery with internally consistent data can pass.
- The service does not check that the person holding the phone is the license holder (no face match in v1).
- OCR accuracy depends on image quality; `review` outcomes should go to a human.

---

## 10. Hosted page (Vue)

### 10.1 Routing and access

- URL: `/s/:token`. On load the page calls `POST /hosted/api/session/open` with the token. Server checks hash, state, and expiry, moves the session to `in_progress`, and returns a short-lived session-scoped JWT or an HttpOnly, `SameSite=Strict`, `Secure` cookie (default: cookie). The token in the URL then cannot be reused from another device after first open, unless the integrator enables `allow_reopen` (useful for "continue on phone" via QR, see 10.3).
- All later hosted calls use the cookie.

### 10.2 Screens

1. Intro: integrator display name and logo (from integrator config), what will happen, privacy notice link, consent checkbox ("I agree that my license images are processed to verify my license"). Consent text versioned and stored with the session.
2. Capture front: live camera via `getUserMedia` (rear camera preferred, `facingMode: environment`), overlay frame with ID-1 aspect ratio, tips (flat surface, no glare, all corners visible). Capture button. Fallback: file input with `accept="image/*" capture="environment"` when camera API is unavailable or denied.
3. Review front: show photo, simple client-side checks (resolution, brightness, blur estimate on a downscaled canvas), retake or continue.
4. Capture back + review back.
5. Submitting: upload progress, then submit.
6. Done: "Thanks, you can return to <integrator>", automatic redirect to `return_url` after 3 s with `?session_id=...&status=submitted` appended. The page does not show the verification result to the end user (integrator decides what to show).
7. Error screens: expired link, already used, camera denied (with fallback), upload failed (retry).

### 10.3 Desktop handoff

If opened on desktop without a usable rear camera, show a QR code pointing to the same hosted URL so the user can continue on their phone (requires `allow_reopen` or a dedicated handoff token). Desktop page polls status and shows "continue on your phone", then follows the redirect when the phone finishes. Default: build in v1 but behind a config flag.

### 10.4 Requirements

- Mobile first. Works on current iOS Safari, Android Chrome, desktop Chrome/Firefox/Safari/Edge.
- Accessible: keyboard operable, labels on all controls, sufficient contrast, status messages announced (`aria-live`).
- i18n: `en`, `nb`. Locale from session `locale`, then browser.
- Images captured at highest available resolution up to 3000 px long edge, sent as JPEG quality 0.92.
- No third-party scripts, fonts, or analytics. Everything served from the same origin.
- Basic theming per integrator: primary color and logo.

### 10.5 Hosted API (server side)

- `POST /hosted/api/session/open` body `{ token }`.
- `GET /hosted/api/session` returns display info, locale, theme, which sides are uploaded, expiry.
- `POST /hosted/api/session/images/:side` (`front` | `back`), `multipart/form-data`, single file, max 10 MB, JPEG/PNG/HEIC only (validate magic bytes, not just mime type). Re-upload replaces.
- `POST /hosted/api/session/submit` requires both sides; transitions to `submitted`, enqueues job.
- `GET /hosted/api/session/status` for the desktop handoff poll.

---

## 11. Data model (MySQL)

All tables `utf8mb4_unicode_ci`, InnoDB. `id` columns are `CHAR(26)` ULIDs unless noted. Timestamps `DATETIME(3)` in UTC.

`integrator`
- `id`, `name`, `display_name`, `logo_url` (served by us), `theme_json`, `return_url_hosts_json`, `webhook_secret_enc`, `default_requirements_json`, `decision_policy_json`, `allow_image_download` bool, `allow_reopen` bool, `retention_days` int, `created_at`, `updated_at`, `disabled_at`.

`api_key`
- `id`, `integrator_id` FK, `prefix` (first 8 chars, indexed), `key_hash`, `mode` (`live`|`test`), `last_used_at`, `created_at`, `revoked_at`.

`verification_session`
- `id`, `integrator_id` FK, `reference`, `status` enum, `token_hash` unique, `return_url`, `webhook_url`, `country_hint`, `locale`, `requirements_json`, `consent_version`, `consent_at`, `opened_at`, `submitted_at`, `completed_at`, `expires_at`, `decision` enum nullable, `decision_reasons_json`, `template`, `country`, `deleted_at`, `created_at`, `updated_at`.
- Indexes: `(integrator_id, created_at)`, `(integrator_id, reference)`, `(status, expires_at)`.

`session_image`
- `id`, `session_id` FK, `side` enum(`front`,`back`), `kind` enum(`original`,`processed`), `storage_key`, `mime`, `width`, `height`, `bytes`, `sha256`, `phash`, `enc_key_id`, `created_at`, `deleted_at`.
- Unique `(session_id, side, kind)`.

`extraction_result`
- `session_id` PK/FK, `fields_enc` (encrypted JSON of extracted fields), `raw_ocr_enc` (encrypted, kept only if `KEEP_RAW_OCR=true`, for tuning), `license_number_hmac`, `identity_hmac` (HMAC of normalized name + DOB), `ocr_engine_version`, `template_version`, `processing_ms`, `created_at`.

`check_result`
- `id`, `session_id` FK, `code`, `status`, `severity`, `message`, `details_json`, `created_at`.

`job`
- `id` BIGINT auto, `type`, `payload_json`, `status` (`queued`,`running`,`done`,`failed`), `attempts`, `run_after`, `locked_by`, `locked_at`, `last_error`, `created_at`, `updated_at`. Index `(status, run_after)`.

`webhook_delivery`
- `id`, `session_id`, `integrator_id`, `event`, `url`, `attempt`, `response_status`, `response_ms`, `error`, `next_attempt_at`, `delivered_at`, `created_at`.

`audit_log`
- `id` BIGINT, `actor_type` (`integrator`,`end_user`,`system`,`admin`), `actor_id`, `action`, `session_id`, `ip_hash`, `user_agent`, `request_id`, `created_at`. No personal data from the document in this table.

Migrations: plain SQL scripts in the `database/` project (`1-structure.sql`, then `AA-migration-release-X.Y.Z.sql`, tracked in a `db_version` table), built into the local Docker database image and applied to existing databases with `npm run migrate`. This replaced the original Knex migration; see `database/README.md`. Seeds create one test integrator and print its test API key.

---

## 12. Security and privacy

Images and extracted fields are personal data (identity document). For Sharebox use this falls under GDPR and Sharebox's internal data handling and incident process; legal/privacy review is required before production use. The engineering requirements are:

- TLS everywhere. HSTS on the hosted page.
- Encryption at rest for images and extracted fields: AES-256-GCM, per-object random data key wrapped by a master key from env/secret store (`ENCRYPTION_MASTER_KEY`, 32 bytes base64). Key id stored with each object so keys can rotate.
- Image storage behind an interface (`ImageStore`) with a local filesystem implementation for dev. Production backing store is an open question (see 15); it must not be a public bucket.
- No personal data in logs. Log session ids, codes, durations only. Add a log redaction test.
- Retention: purge job runs hourly. Deletes images and `fields_enc` after `integrator.retention_days` (default 30, max 90) from `completed_at`; deletes original (unprocessed) images right after processing unless `KEEP_ORIGINALS=true`. Expired/cancelled sessions purge any uploaded images within 24 h. HMACs and check results kept for statistics and reuse detection until a hard cutoff (default 365 days).
- Hosted page security headers: strict CSP with nonce, `frame-ancestors 'none'` (or configured integrator origins if iframe embedding is wanted), `Referrer-Policy: no-referrer` (the URL contains the token), `Permissions-Policy: camera=(self)`, `Cache-Control: no-store` on API responses.
- Uploads: magic-byte validation, size limits, decode with `sharp` and re-encode (drops anything embedded), reject images over a pixel limit (decompression bomb guard).
- Rate limit hosted endpoints per session and per IP.
- Token in URL is single use (see 10.1) and expires with the session.
- API keys and webhook secrets never logged; secrets compared in constant time.
- Dependency audit in CI (`npm audit --omit=dev` at high level).

---

## 13. Non-functional requirements

- Processing time: p95 under 20 s per session on a 4 vCPU server, measured on the fixture set. Open question: confirm the target.
- Throughput target v1: 10 concurrent sessions processing; scale by adding worker processes.
- Availability: API and hosted page stateless, can run multiple instances behind a load balancer. Workers safe to run in parallel (SKIP LOCKED).
- Observability: structured JSON logs with `request_id` and `session_id`; `/metrics` Prometheus endpoint (sessions by status, decision counts, check fail counts, processing duration histogram, OCR confidence histogram, queue depth).
- Config via env only, validated at startup; process exits on invalid config.
- Clock: injected everywhere for testability; timezone UTC on the server. Document dates are date-only values and must not be shifted by timezone.

---

## 14. Future (not v1)

- AAMVA (US/Canada) template with PDF417 decode (`zxing-wasm`) and barcode vs OCR cross-check.
- Selfie capture with local face detection and face match against the license portrait (local model, for example via ONNX runtime).
- Passport / ID cards using MRZ with check digit validation (ICAO 9303).
- Admin UI for reviewing `review` sessions.
- Iframe embed mode and a small JS SDK for integrators.

---

## 15. Open questions

1. Which countries beyond Norway are needed for launch, and in what order?
2. US/Canada support needed (AAMVA)?
3. Where will images be stored in production (encrypted local disk, S3 with SSE-KMS, other)? Must the data stay in a specific region (EU/EEA)?
4. Retention period per integrator: is 30 days the right default? Legal/privacy to confirm.
5. Is the first integrator Sharebox API itself? If yes, which flow uses it (weblink check-in already has a driver-license step in `sharebox-weblink`), and should this service replace or complement that?
6. Processing time target and expected volume.
7. Should the end user ever see the result on the hosted page, or always only the integrator?
8. Do we need iframe embedding in v1?
9. Who handles `review` outcomes (integrator's staff, or an admin UI here)?

---

## 16. Implementation plan (milestones)

Build in this order. Each milestone ends with passing tests and a short note in `CHANGELOG.md`.

M1. Skeleton
- Monorepo, workspaces, TS config, ESLint/Prettier, Vitest, docker-compose with MySQL 8.
- Env config, logger, request id, error handler, health endpoints.
- Knex migrations for all tables in section 11, seed test integrator.

M2. Integrator API and state machine
- API key auth, rate limit, `POST/GET/LIST/DELETE /v1/sessions`, Zod schemas in `shared/`.
- Session state machine with full unit tests.
- Expiry job.

M3. Hosted page and uploads
- Hosted API (open/token exchange, cookie, upload, submit, status).
- Image store interface + encrypted filesystem implementation.
- Vue app: intro/consent, capture front/back with camera and file fallback, review, submit, done, error screens, i18n en/nb.
- Playwright e2e using a fake camera stream (`--use-fake-device-for-media-stream` with fixture image).

M4. Processing pipeline without OCR
- Job queue, worker process, pipeline orchestration with step timing.
- Preprocessing and image quality checks.
- Checks framework, all date/logic checks as pure functions with table-driven tests (no OCR needed: feed extracted objects directly).
- Decision module.

M5. OCR and EU template
- Tesseract worker pool with bundled tessdata, network-blocked test.
- Card detection/crop, orientation, zone OCR.
- `eu-card-v1` template parser, NO country profile.
- Fixture set: official specimen images (where license terms permit) plus synthetic generated cards (script that renders fake cards with known values onto backgrounds, with blur/glare/rotation variants). Each fixture has an expected JSON. Test reports field-level accuracy; CI fails if accuracy drops below a baseline.

M6. Webhooks, retention, audit, metrics
- Signed webhooks with retries.
- Purge job.
- Audit log on all integrator reads of results/images.
- `/metrics`.
- `docs/integration.md` (flow, auth, endpoints, webhook verification example, limitations from section 9).

M7. Hardening
- Security headers/CSP, upload hardening, log redaction test, dependency audit in CI.
- Load test of the pipeline on fixture set, record p95.

---

## 17. Acceptance criteria (v1)

- An integrator can create a session, redirect a user, and pull a completed result using only `docs/integration.md`.
- With a clear photo of a valid Norwegian specimen/synthetic card, all required fields are extracted correctly and decision is `approved`.
- Synthetic cards with each of these defects produce the expected failing check: expired, issue date in future, issue after expiry, DOB after issue, underage for category, unknown category, wrong license number format, blurred image, front equals back.
- No outbound network connections are made during processing (verified by test).
- No document personal data appears in logs (verified by test).
- Images and extracted fields are encrypted at rest and purged per retention settings (verified by test with an injected clock).
- `DELETE /v1/sessions/:id` removes images and personal fields immediately.
- Unit test coverage of `checks/`, `decision/`, and the state machine at 90%+ lines.
