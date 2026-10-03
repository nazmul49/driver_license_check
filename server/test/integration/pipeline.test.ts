import { RESULT_STATEMENT_PASSED } from '@dlc/shared';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { verifyWebhook } from '../../src/modules/webhooks/webhook-signature.js';
import type { OcrEngine } from '../../src/modules/ocr/ocr.types.js';
import { NO } from '../../src/modules/countries/no.js';
import { SPEC_EXAMPLE_PROFILE } from '../helpers/documents.js';
import { fakeFetch, getSession, runJobs, submitImages } from '../helpers/flow.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { closeSharedPool, loadFixture, sharedPool } from '../helpers/ocr.js';

let h: Harness;
let fetchMock: ReturnType<typeof fakeFetch>;

async function harness(
  opts: {
    profiles?: (typeof NO)[];
    ocr?: OcrEngine;
    env?: Record<string, string>;
    integrator?: Record<string, unknown>;
  } = {},
) {
  fetchMock = fakeFetch();
  h = await createHarness(opts.env ?? {}, opts.integrator ?? {}, {
    ocrEngine: opts.ocr ?? (await sharedPool()),
    countryProfiles: opts.profiles ?? [SPEC_EXAMPLE_PROFILE],
    httpFetch: fetchMock.fn,
  });
  return h;
}

async function processFixture(name: string, body: Record<string, unknown> = {}) {
  const f = await loadFixture(name);
  const s = await submitImages(h, f.front, f.back, body);
  await runJobs(h);
  return { s, f, dto: await getSession(h, s.id) };
}

afterEach(async () => {
  await h?.close();
});
afterAll(async () => {
  await closeSharedPool();
});

describe('acceptance: synthetic cards (SPEC 17)', () => {
  const cases = [
    'expired',
    'issue-in-future',
    'issue-after-expiry',
    'dob-after-issue',
    'underage-for-category',
    'unknown-category',
    'wrong-license-format',
    'blurred',
    'front-equals-back',
    'too-dark',
    'glare',
  ];
  it.each(cases)('%s produces the expected failing check', async (name) => {
    await harness();
    const { dto, f } = await processFixture(name, {
      requirements: { min_age: 18, required_categories: ['B'] },
    });
    expect(dto.status).toBe('completed');
    const failed = dto.result!.checks.filter((c) => c.status === 'fail').map((c) => c.code);
    const warned = dto.result!.checks.filter((c) => c.status === 'warn').map((c) => c.code);
    for (const code of f.expected.expect_fail) expect(failed).toContain(code);
    for (const code of f.expected.expect_warn) expect(warned).toContain(code);
    if (f.expected.expect_decision) expect(dto.decision).toBe(f.expected.expect_decision);
  });
});

describe('happy path', () => {
  it('valid card: fields extracted, approved, webhook signed and minimal', async () => {
    await harness();
    const { dto, f, s } = await processFixture('valid', {
      requirements: { min_age: 18, required_categories: ['B'] },
    });
    expect(dto.status).toBe('completed');
    expect(dto.decision).toBe('approved');
    const r = dto.result!;
    expect(r.statement).toBe(RESULT_STATEMENT_PASSED);
    expect(JSON.stringify(r)).not.toMatch(/authentic|genuine document/i);
    expect(r.document).toMatchObject({
      type: 'driver_license',
      template: 'eu-card-v1',
      country: 'NO',
    });
    const fields = r.document.fields!;
    for (const key of [
      'surname',
      'given_names',
      'date_of_birth',
      'place_of_birth',
      'issue_date',
      'expiry_date',
      'issuing_authority',
      'license_number',
    ] as const) {
      expect(fields[key].value, key).toBe(f.expected.fields[key]);
    }
    expect(fields.categories).toEqual([
      { code: 'B', issue_date: '2008-05-10', expiry_date: '2036-06-01', restrictions: [] },
    ]);
    expect(r.summary.failed).toBe(0);

    // Webhook (SPEC 5.4): signed, no personal data.
    expect(fetchMock.calls).toHaveLength(1);
    const call = fetchMock.calls[0]!;
    expect(call.url).toBe('https://integrator.test/hooks');
    expect(JSON.parse(call.body)).toEqual({
      event: 'session.completed',
      session_id: s.id,
      reference: 'booking-1',
      status: 'completed',
      decision: 'approved',
      occurred_at: expect.any(String),
    });
    expect(call.body).not.toContain('NORDMANN');
    expect(call.headers['X-DLC-Event-Id']).toMatch(/^evt_/);
    const nowUnix = Math.floor(h.clock.now().getTime() / 1000);
    expect(
      verifyWebhook(h.webhookSecret, call.body, call.headers['X-DLC-Signature']!, nowUnix),
    ).toBe(true);
    expect(verifyWebhook('whsec_wrong', call.body, call.headers['X-DLC-Signature']!, nowUnix)).toBe(
      false,
    );
    const deliveries = await h.c.webhookRepository.listForSession(s.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.response_status).toBe(200);
  });

  it('encrypts fields at rest and deletes originals after processing', async () => {
    await harness();
    const { s } = await processFixture('valid');
    const row = await h.c.db('extraction_result').where({ session_id: s.id }).first();
    expect(Buffer.from(row.fields_enc).includes(Buffer.from('NORDMANN'))).toBe(false);
    expect(row.license_number_hmac).toHaveLength(64);
    expect(row.raw_ocr_enc).toBeNull();
    const images = await h.c
      .db('session_image')
      .where({ session_id: s.id })
      .whereNull('deleted_at');
    expect(images.map((i) => i.kind).sort()).toEqual(['processed', 'processed']);
    for (const blob of h.store.blobs.values()) {
      expect(blob.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    }
  });

  it('shipped NO profile (unconfirmed rules are null) still approves, with rule checks skipped', async () => {
    await harness({ profiles: [NO] });
    const { dto } = await processFixture('valid');
    expect(dto.decision).toBe('approved');
    const fmt = dto.result!.checks.find((c) => c.code === 'LICENSE_NUMBER_FORMAT')!;
    expect(fmt).toMatchObject({ status: 'skipped', details: { reason: 'rule_unknown' } });
  });

  it('rotated photos are read in the right orientation', async () => {
    await harness();
    const { dto } = await processFixture('rotated-180');
    expect(dto.decision).toBe('approved');
    expect(dto.result!.document.fields!.license_number.value).toBe('12345678901');
  });

  it('image download is audit logged when enabled', async () => {
    await harness({ integrator: { allow_image_download: true } });
    const { s } = await processFixture('valid');
    const img = await request(h.app)
      .get(`/v1/sessions/${s.id}/images/front`)
      .set('Authorization', `Bearer ${h.apiKey}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const actions = (await h.c.auditService.list(s.id)).map((a) => a.action);
    expect(actions).toContain('session.read_image.front');
    expect(actions).toContain('session.read_result');
  });
});

describe('cross-session checks', () => {
  it('same images and reused license number with different holder data warn', async () => {
    await harness();
    await processFixture('valid');
    // Same card again: duplicate image. Then the same number with a different date of birth.
    const again = await processFixture('valid');
    expect(again.dto.result!.checks.find((c) => c.code === 'DUPLICATE_IMAGE')!.status).toBe('warn');
    const other = await processFixture('dob-after-issue');
    expect(other.dto.result!.checks.find((c) => c.code === 'DOCUMENT_NUMBER_REUSED')!.status).toBe(
      'warn',
    );
  });
});

describe('deletion and failures', () => {
  it('DELETE after completion removes images and personal fields immediately (tombstone remains)', async () => {
    await harness();
    const { s } = await processFixture('valid');
    const del = await request(h.app)
      .delete(`/v1/sessions/${s.id}`)
      .set('Authorization', `Bearer ${h.apiKey}`);
    expect(del.status).toBe(204);
    expect(h.store.blobs.size).toBe(0);
    expect(await h.c.db('extraction_result').where({ session_id: s.id })).toHaveLength(0);
    expect(await h.c.db('check_result').where({ session_id: s.id })).toHaveLength(0);
    const dto = await getSession(h, s.id);
    expect(dto).toMatchObject({ id: s.id, status: 'completed', decision: 'approved' });
    expect(dto.deleted_at).not.toBeNull();
    expect(dto.result).toBeUndefined();
    const row = await h.c.db('verification_session').where({ id: s.id }).first();
    expect(row.return_url).toBeNull();
    expect(row.requirements_json).toBeNull();
  });

  it('DELETE between submit and processing fails the session without processing', async () => {
    await harness();
    const f = await loadFixture('valid');
    const s = await submitImages(h, f.front, f.back);
    await request(h.app).delete(`/v1/sessions/${s.id}`).set('Authorization', `Bearer ${h.apiKey}`);
    await runJobs(h);
    expect((await h.c.sessionRepository.findById(s.id))!.status).toBe('failed');
  });

  it('system errors retry twice, then the session fails and the failed webhook is sent', async () => {
    let calls = 0;
    const broken: OcrEngine = {
      version: 'broken',
      recognize: async () => {
        calls++;
        throw new Error('engine crashed');
      },
      terminate: async () => undefined,
    };
    await harness({ ocr: broken });
    const f = await loadFixture('valid');
    const s = await submitImages(h, f.front, f.back);
    for (let i = 0; i < 3; i++) {
      await runJobs(h);
      h.clock.advance(120_000);
    }
    expect(calls).toBe(3);
    const job = await h.c.db('job').where({ type: 'process_session' }).first();
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    expect((await getSession(h, s.id)).status).toBe('failed');
    await runJobs(h);
    expect(JSON.parse(fetchMock.calls.at(-1)!.body)).toMatchObject({
      event: 'session.failed',
      status: 'failed',
      decision: null,
    });
  });
});

describe('log redaction (SPEC 12, 17)', () => {
  it('no document personal data, tokens or keys appear in logs', async () => {
    await harness({ env: { LOG_LEVEL: 'debug' } });
    const { s } = await processFixture('valid');
    await getSession(h, s.id);
    const logs = h.logs.text;
    expect(logs.length).toBeGreaterThan(500);
    expect(logs).toContain(s.id);
    for (const secret of [
      'NORDMANN',
      'OLA"',
      'OSLO',
      '12345678901',
      '1990-04-12',
      '12.04.1990',
      'STATENS',
      s.token,
      h.apiKey,
      h.webhookSecret,
    ]) {
      expect(logs, `log contains ${secret}`).not.toContain(secret);
    }
  });
});
