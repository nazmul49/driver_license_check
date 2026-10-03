# Driver License Check: integration guide

This guide covers everything an integrator needs: the flow, authentication, endpoints, webhooks and the limits of what the service checks. Base URL in the examples: `https://dlc.example.com`.

## What the service does, and what it does not

The service reads a photographed driver license with local OCR and runs rule-based data consistency checks. A positive result means "the document passed automated data consistency checks". It does not mean the license is genuine.

Read these limitations before relying on a result:

- Verification is based on OCR and rule-based consistency checks only. The service does not contact issuing authorities and does not confirm that the license is genuine, currently valid in a registry, or not revoked or suspended.
- A high-quality forgery with internally consistent data can pass.
- The service does not check that the person holding the phone is the license holder (no face match in v1).
- OCR accuracy depends on image quality. Send `review` outcomes to a human.

## Flow

1. Your backend creates a session: `POST /v1/sessions`. You get an `id` and a `hosted_url`.
2. Redirect the end user to `hosted_url`. The link is single use and expires with the session.
3. The end user gives consent and photographs the front and back of their license.
4. The hosted page sends the user to your `return_url` with `session_id` and `status=submitted` appended. The end user never sees the result.
5. You receive a webhook (optional) and/or poll `GET /v1/sessions/:id` until `status` is `completed`, `failed` or `expired`.

Session states: `created` → `in_progress` (link opened) → `submitted` → `processing` → `completed`. Also `failed` (system error, distinct from a rejected decision), `expired` (not submitted in time) and `cancelled` (you deleted it before submit).

## Authentication

Send your API key as a bearer token on every `/v1` request:

```
Authorization: Bearer dlc_live_...
```

Keys are shown once when created. `dlc_test_` keys belong to test integrators. You only see your own sessions. The limit is 60 requests per minute per key; above that you get `429` with a `Retry-After` header.

## Endpoints

All bodies are JSON. Timestamps are ISO 8601 UTC. Dates printed on the document are returned as `YYYY-MM-DD` with no timezone conversion.

### Create a session

`POST /v1/sessions`

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

- `return_url` is required. It must be HTTPS and its host must be on your allowlist (ask the operator to add hosts). `webhook_url` follows the same rule.
- `expires_in_seconds`: default 1800, min 300, max 86400.
- `requirements` are optional. Missing values come from your integrator defaults. A requirement that is not set makes its check `skipped`.

Response `201`:

```json
{
  "id": "ses_01J9Z3...",
  "status": "created",
  "hosted_url": "https://dlc.example.com/s/3f9c...",
  "expires_at": "2026-10-03T20:00:00.000Z"
}
```

### Get a session

`GET /v1/sessions/:id` returns the session. When `status` is `completed` it includes `result`:

```json
{
  "id": "ses_01J9Z3...",
  "reference": "booking-12345",
  "status": "completed",
  "decision": "approved",
  "created_at": "...",
  "submitted_at": "...",
  "completed_at": "...",
  "result": {
    "decision": "approved",
    "decision_reasons": [],
    "statement": "The document passed automated data consistency checks. This is not a confirmation that the document is genuine.",
    "document": {
      "type": "driver_license",
      "template": "eu-card-v1",
      "country": "NO",
      "fields": {
        "surname": { "value": "NORDMANN", "confidence": 0.95 },
        "date_of_birth": { "value": "1990-04-12", "confidence": 0.96 },
        "license_number": { "value": null, "confidence": 0.41, "low_confidence": true },
        "categories": [
          {
            "code": "B",
            "issue_date": "2008-05-10",
            "expiry_date": "2036-06-01",
            "restrictions": []
          }
        ]
      }
    },
    "checks": [
      {
        "code": "EXPIRY_NOT_PASSED",
        "status": "pass",
        "severity": "critical",
        "message": "Document is not expired."
      }
    ],
    "summary": { "passed": 18, "warned": 1, "failed": 0, "skipped": 2 }
  }
}
```

- A field read with low confidence has `value: null` and `low_confidence: true`. The checks that depend on it are `skipped`.
- `document.fields` is `null` once personal data has been purged (retention period or `DELETE`). The decision and checks remain.

Decision rules:

- `rejected`: any critical check failed.
- `review`: no critical failure, but a major check failed, a critical check was skipped because of low confidence, or two or more checks warned.
- `approved`: everything else.

`decision_reasons` lists the check codes behind a non-approved decision. If processing stopped because of image quality, the reasons start with `IMAGE_QUALITY`. The operator can tune the rules per integrator (for example to treat `review` as `rejected`).

### List sessions

`GET /v1/sessions?reference=...&status=...&limit=50&cursor=...`

Returns `{ "data": [...], "next_cursor": "ses_..." | null }`, newest first. Pass `next_cursor` as `cursor` to get the next page. List items do not include `result`.

### Download processed images

`GET /v1/sessions/:id/images/front|back` returns the processed JPEG. Disabled by default (`403 FORBIDDEN`); the operator enables it per integrator. Every download is audit logged.

### Delete a session

`DELETE /v1/sessions/:id` returns `204`.

- Before submit, the session becomes `cancelled`.
- After submit, images and extracted personal data are deleted immediately. A minimal record remains (id, timestamps, decision, `deleted_at`).

### Health

`GET /v1/health` (liveness) and `GET /v1/ready` (database and OCR data available). No authentication.

## Errors

Every error has the same shape:

```json
{
  "error": { "code": "SESSION_NOT_FOUND", "message": "Session not found.", "request_id": "req_..." }
}
```

| Code                                | HTTP |
| ----------------------------------- | ---- |
| `VALIDATION_ERROR` (with `details`) | 400  |
| `UNAUTHORIZED`                      | 401  |
| `FORBIDDEN`                         | 403  |
| `SESSION_NOT_FOUND`                 | 404  |
| `INVALID_STATE`                     | 409  |
| `PAYLOAD_TOO_LARGE`                 | 413  |
| `UNSUPPORTED_MEDIA_TYPE`            | 415  |
| `RATE_LIMITED`                      | 429  |
| `INTERNAL_ERROR`                    | 500  |

Include `request_id` when you contact support.

## Webhooks

Webhooks are sent when a session becomes `completed`, `failed` or `expired`, if you gave a `webhook_url`. The body contains no personal data. Call `GET /v1/sessions/:id` for details.

```json
{
  "event": "session.completed",
  "session_id": "ses_01J9Z3...",
  "reference": "booking-12345",
  "status": "completed",
  "decision": "review",
  "occurred_at": "2026-10-03T19:42:10.123Z"
}
```

Headers:

- `X-DLC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>`
- `X-DLC-Event-Id`: the same on every retry of one event. Use it to deduplicate.
- `X-DLC-Event`: the event name.

Any 2xx response counts as delivered. Other responses, timeouts (10 seconds) and network errors are retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then the delivery is abandoned. Redirects are not followed. Respond quickly and do the work asynchronously.

The webhook secret (`whsec_...`) is shown once when your integrator is created. The operator can rotate it; deliveries after a rotation are signed with the new secret.

### Verifying the signature (Node.js)

Verify against the raw request body, before any JSON parsing.

```js
import crypto from 'node:crypto';
import express from 'express';

const WEBHOOK_SECRET = process.env.DLC_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

function verifyDlcSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((p) => p.split('=', 2)),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
app.post('/hooks/dlc', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyDlcSignature(raw, req.get('X-DLC-Signature'), WEBHOOK_SECRET)) {
    return res.status(400).end();
  }
  const event = JSON.parse(raw);
  // Deduplicate on req.get('X-DLC-Event-Id'), then fetch GET /v1/sessions/:id asynchronously.
  res.status(204).end();
});
```

## End-to-end example (Node.js)

```js
const API = 'https://dlc.example.com';
const headers = {
  Authorization: `Bearer ${process.env.DLC_API_KEY}`,
  'Content-Type': 'application/json',
};

// 1. Create the session and send the user to hosted_url.
const created = await fetch(`${API}/v1/sessions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    reference: 'booking-12345',
    return_url: 'https://integrator.example.com/after-check?ref=booking-12345',
    webhook_url: 'https://integrator.example.com/hooks/dlc',
    country_hint: 'NO',
    requirements: { min_age: 18, required_categories: ['B'] },
  }),
}).then((r) => r.json());

// 2. Later (after the webhook, or by polling):
const session = await fetch(`${API}/v1/sessions/${created.id}`, { headers }).then((r) => r.json());
if (session.status === 'completed') {
  switch (session.result.decision) {
    case 'approved':
      /* passed automated data consistency checks */ break;
    case 'review':
      /* route to a human */ break;
    case 'rejected':
      /* failed a critical check; see decision_reasons */ break;
  }
}

// 3. Delete personal data as soon as you no longer need it.
await fetch(`${API}/v1/sessions/${created.id}`, { method: 'DELETE', headers });
```

## Data retention

- Original uploads are deleted right after processing.
- Processed images and extracted fields are deleted after your integrator's retention period (default 30 days, max 90) from completion.
- Uploads of expired or cancelled sessions are deleted within the hour.
- Keyed hashes of the license number and check results are kept for reuse detection and statistics until a hard cutoff (default 365 days). They cannot be turned back into the original values.
