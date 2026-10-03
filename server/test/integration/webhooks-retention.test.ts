import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from '../../src/modules/webhooks/webhook-signature.js';
import { WEBHOOK_BACKOFF_SECONDS } from '../../src/modules/webhooks/webhook.service.js';
import { createSession, fakeFetch, submitImages } from '../helpers/flow.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { testJpeg } from '../helpers/images.js';

let h: Harness;
let fetchMock: ReturnType<typeof fakeFetch>;
const DAY = 86_400_000;

async function harness(
  statuses: number[] = [],
  env: Record<string, string> = {},
  integrator: Record<string, unknown> = {},
) {
  fetchMock = fakeFetch(statuses);
  h = await createHarness(env, integrator, { httpFetch: fetchMock.fn });
}

afterEach(async () => {
  await h?.close();
});

describe('webhook signature', () => {
  it('signs t.body with HMAC-SHA256 and rejects stale or tampered payloads', () => {
    const header = signWebhook('whsec_x', '{"a":1}', 1_000);
    expect(header).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook('whsec_x', '{"a":1}', header, 1_100)).toBe(true);
    expect(verifyWebhook('whsec_x', '{"a":2}', header, 1_100)).toBe(false);
    expect(verifyWebhook('whsec_x', '{"a":1}', header, 2_000)).toBe(false);
    expect(verifyWebhook('whsec_x', '{"a":1}', 'garbage', 1_000)).toBe(false);
  });
});

describe('expiry job and webhook retries', () => {
  it('expires overdue sessions and delivers session.expired', async () => {
    await harness();
    const s = await createSession(h, { expires_in_seconds: 300 });
    expect(await h.c.expiryService.run()).toBe(0);
    h.clock.advance(301_000);
    expect(await h.c.expiryService.run()).toBe(1);
    expect((await h.c.sessionRepository.findById(s.id))!.status).toBe('expired');
    await h.c.jobRunner.drain();
    expect(JSON.parse(fetchMock.calls[0]!.body)).toMatchObject({
      event: 'session.expired',
      status: 'expired',
      session_id: s.id,
    });
  });

  it('retries with 1m, 5m, 30m, 2h, 6h backoff then gives up', async () => {
    await harness([500, 0, 503, 500, 500, 500]);
    const s = await createSession(h, { expires_in_seconds: 300 });
    h.clock.advance(301_000);
    await h.c.expiryService.run();
    for (let attempt = 1; attempt <= 6; attempt++) {
      expect(await h.c.jobRunner.drain()).toBe(1);
      expect(await h.c.jobRunner.drain()).toBe(0); // next attempt not due yet
      const delay = WEBHOOK_BACKOFF_SECONDS[attempt - 1];
      if (delay) h.clock.advance(delay * 1000);
    }
    const rows = await h.c.webhookRepository.listForSession(s.id);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.error)).toEqual([
      'http_500',
      'network_error',
      'http_503',
      'http_500',
      'http_500',
      'http_500',
    ]);
    expect(rows.at(-1)!.next_attempt_at).toBeNull();
    expect(rows.every((r) => r.delivered_at === null)).toBe(true);
    // All attempts carry the same event id so the integrator can deduplicate.
    expect(new Set(fetchMock.calls.map((c) => c.headers['X-DLC-Event-Id'])).size).toBe(1);
    h.clock.advance(7 * DAY);
    expect(await h.c.jobRunner.drain()).toBe(0);
  });

  it('a 2xx after a failure stops retries; rotated secrets sign new deliveries', async () => {
    await harness([500, 204]);
    await createSession(h, { expires_in_seconds: 300 });
    h.clock.advance(301_000);
    await h.c.expiryService.run();
    await h.c.jobRunner.drain();
    const newSecret = await h.c.integratorService.rotateWebhookSecret(h.integrator.id);
    h.clock.advance(60_000);
    await h.c.jobRunner.drain();
    const last = fetchMock.calls.at(-1)!;
    const now = Math.floor(h.clock.now().getTime() / 1000);
    expect(verifyWebhook(newSecret, last.body, last.headers['X-DLC-Signature']!, now)).toBe(true);
    expect(verifyWebhook(h.webhookSecret, last.body, last.headers['X-DLC-Signature']!, now)).toBe(
      false,
    );
    h.clock.advance(DAY);
    expect(await h.c.jobRunner.drain()).toBe(0);
  });

  it('no webhook_url, no delivery', async () => {
    await harness();
    await createSession(h, { webhook_url: undefined, expires_in_seconds: 300 });
    h.clock.advance(301_000);
    await h.c.expiryService.run();
    expect(await h.c.jobRunner.drain()).toBe(0);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('stale running jobs are requeued', async () => {
    await harness();
    const id = await h.c.jobRepository.enqueue(
      'deliver_webhook',
      { session_id: 'x' },
      h.clock.now(),
    );
    await h.c.jobRepository.claim('dead-worker', h.clock.now());
    h.clock.advance(5 * 60_000);
    const now = h.clock.now();
    expect(await h.c.jobRepository.requeueStale(new Date(now.getTime() - 120_000), now)).toBe(1);
    const job = await h.c.db('job').where({ id }).first();
    expect(job.status).toBe('queued');
  });
});

describe('retention purge (SPEC 12, injected clock)', () => {
  async function completedSession() {
    const s = await submitImages(h, await testJpeg(1), await testJpeg(2));
    // Mark completed without OCR: this test is about retention, not processing.
    const session = (await h.c.sessionRepository.findById(s.id))!;
    await h.c.sessionRepository.updateStatus(s.id, 'submitted', 'processing', {}, h.clock.now());
    await h.c.sessionRepository.updateStatus(
      s.id,
      'processing',
      'completed',
      { completed_at: h.clock.now(), decision: 'approved', decision_reasons: [] },
      h.clock.now(),
    );
    const { envelope, keyId } = h.c.encryptor.encryptJson({ fields: 'x' });
    await h.c.resultRepository.saveExtraction(
      {
        session_id: s.id,
        fields_enc: envelope,
        raw_ocr_enc: null,
        enc_key_id: keyId,
        license_number_hmac: 'a'.repeat(64),
        identity_hmac: null,
        ocr_engine_version: null,
        template_version: null,
        processing_ms: 1,
        ocr_mean_confidence: null,
      },
      h.clock.now(),
    );
    await h.c.resultRepository.replaceChecks(
      s.id,
      [{ code: 'MIN_AGE', status: 'pass', severity: 'critical', message: 'ok' }],
      h.clock.now(),
    );
    return session;
  }

  it('purges images and fields after retention_days, keeps HMACs and checks until the hard cutoff', async () => {
    await harness([], {}, { retention_days: 30 });
    const s = await completedSession();
    expect(h.store.blobs.size).toBe(2);
    h.clock.advance(29 * DAY);
    expect((await h.c.purgeService.run()).retention).toBe(0);
    h.clock.advance(2 * DAY);
    expect((await h.c.purgeService.run()).retention).toBe(1);
    expect(h.store.blobs.size).toBe(0);
    const ex = await h.c.db('extraction_result').where({ session_id: s.id }).first();
    expect(ex.fields_enc).toBeNull();
    expect(ex.license_number_hmac).toHaveLength(64);
    expect(await h.c.db('check_result').where({ session_id: s.id })).toHaveLength(1);
    expect((await h.c.purgeService.run()).retention).toBe(0); // idempotent

    // GET still answers with the decision but no personal fields.
    const dto = await request(h.app)
      .get(`/v1/sessions/${s.id}`)
      .set('Authorization', `Bearer ${h.apiKey}`);
    expect(dto.body.result.decision).toBe('approved');
    expect(dto.body.result.document.fields).toBeNull();

    h.clock.advance(400 * DAY);
    expect((await h.c.purgeService.run()).hardCutoff).toBe(1);
    expect(await h.c.db('extraction_result').where({ session_id: s.id })).toHaveLength(0);
    expect(await h.c.db('check_result').where({ session_id: s.id })).toHaveLength(0);
    expect(await h.c.db('verification_session').where({ id: s.id })).toHaveLength(1);
  });

  it('purges uploads of expired sessions', async () => {
    await harness();
    const s = await createSession(h, { expires_in_seconds: 300 });
    const open = await request(h.app).post('/hosted/api/session/open').send({ token: s.token });
    const cookie = (open.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    await request(h.app)
      .post('/hosted/api/session/consent')
      .set('Cookie', cookie)
      .send({ consent_version: '2026-10-01', accepted: true });
    await request(h.app)
      .post('/hosted/api/session/images/front')
      .set('Cookie', cookie)
      .attach('file', await testJpeg(1), 'f.jpg');
    expect(h.store.blobs.size).toBe(1);
    h.clock.advance(301_000);
    await h.c.expiryService.run();
    expect((await h.c.purgeService.run()).abandoned).toBe(1);
    expect(h.store.blobs.size).toBe(0);
  });
});
