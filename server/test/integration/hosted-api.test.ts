import { CONSENT_VERSION } from '@dlc/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';
import { testJpeg } from '../helpers/images.js';

let h: Harness;

async function newSession(o: Record<string, unknown> = {}) {
  const r = await request(h.app)
    .post('/v1/sessions')
    .set('Authorization', `Bearer ${h.apiKey}`)
    .send({
      return_url: 'https://integrator.test/back?x=1',
      webhook_url: 'https://integrator.test/hook',
      ...o,
    });
  return { id: r.body.id as string, token: (r.body.hosted_url as string).split('/s/')[1]! };
}

async function open(token: string, cookie?: string) {
  const req = request(h.app).post('/hosted/api/session/open').send({ token });
  if (cookie) req.set('Cookie', cookie);
  const r = await req;
  const setCookie = r.headers['set-cookie'] as unknown as string[] | undefined;
  return { r, cookie: setCookie?.[0]?.split(';')[0] ?? cookie ?? '' };
}

async function ready() {
  const s = await newSession();
  const { cookie } = await open(s.token);
  await request(h.app)
    .post('/hosted/api/session/consent')
    .set('Cookie', cookie)
    .send({ consent_version: CONSENT_VERSION, accepted: true });
  return { ...s, cookie };
}

const upload = async (cookie: string, side: string, buf: Buffer, filename = 'x.jpg') =>
  request(h.app)
    .post(`/hosted/api/session/images/${side}`)
    .set('Cookie', cookie)
    .attach('file', buf, filename);

beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('token exchange', () => {
  it('opens once, sets a strict HttpOnly cookie and moves to in_progress', async () => {
    const s = await newSession({ locale: 'nb' });
    const { r } = await open(s.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      integrator: { display_name: 'Acme Rentals' },
      locale: 'nb',
      status: 'in_progress',
      uploaded: { front: false, back: false },
      consent: { required_version: CONSENT_VERSION, accepted: false },
    });
    const raw = (r.headers['set-cookie'] as unknown as string[])[0]!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Strict/);
    expect(raw).toMatch(/Path=\/hosted\/api/);
    expect(r.headers['cache-control']).toBe('no-store');
    const session = await h.c.sessionRepository.findById(s.id);
    expect(session!.status).toBe('in_progress');
    expect(session!.opened_at).not.toBeNull();
  });

  it('token is single use from another device, reusable with the cookie', async () => {
    const s = await newSession();
    const first = await open(s.token);
    const again = await open(s.token);
    expect(again.r.status).toBe(409);
    expect(again.r.body.error.code).toBe('LINK_ALREADY_USED');
    const sameDevice = await open(s.token, first.cookie);
    expect(sameDevice.r.status).toBe(200);
  });

  it('allow_reopen lets another device open an in-progress session', async () => {
    await h.close();
    h = await createHarness({}, { allow_reopen: true });
    const s = await newSession();
    await open(s.token);
    expect((await open(s.token)).r.status).toBe(200);
  });

  it('unknown token is 404, expired link is 410 and queues the expired webhook', async () => {
    expect((await open('x'.repeat(43))).r.status).toBe(404);
    const s = await newSession({ expires_in_seconds: 300 });
    h.clock.advance(301_000);
    const { r } = await open(s.token);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('SESSION_EXPIRED');
    expect((await h.c.sessionRepository.findById(s.id))!.status).toBe('expired');
    const jobs = await h.c.db('job').where({ type: 'deliver_webhook' });
    expect(jobs).toHaveLength(1);
  });

  it('cancelled sessions cannot be opened', async () => {
    const s = await newSession();
    await request(h.app).delete(`/v1/sessions/${s.id}`).set('Authorization', `Bearer ${h.apiKey}`);
    expect((await open(s.token)).r.status).toBe(410);
  });

  it('hosted endpoints require the cookie', async () => {
    const r = await request(h.app).get('/hosted/api/session');
    expect(r.status).toBe(401);
    const forged = await request(h.app)
      .get('/hosted/api/session')
      .set('Cookie', 'dlc_hs=ses_X.9999999999.deadbeef');
    expect(forged.status).toBe(401);
  });
});

describe('consent, upload, submit', () => {
  it('requires consent before upload and stores the consent version', async () => {
    const s = await newSession();
    const { cookie } = await open(s.token);
    const early = await upload(cookie, 'front', await testJpeg(1));
    expect(early.status).toBe(409);
    const bad = await request(h.app)
      .post('/hosted/api/session/consent')
      .set('Cookie', cookie)
      .send({ consent_version: 'old', accepted: true });
    expect(bad.status).toBe(400);
    const ok = await request(h.app)
      .post('/hosted/api/session/consent')
      .set('Cookie', cookie)
      .send({ consent_version: CONSENT_VERSION, accepted: true });
    expect(ok.status).toBe(204);
    const session = await h.c.sessionRepository.findById(s.id);
    expect(session!.consent_version).toBe(CONSENT_VERSION);
  });

  it('uploads are validated by magic bytes, re-encoded and encrypted at rest', async () => {
    const s = await ready();
    const gif = await upload(s.cookie, 'front', Buffer.from('GIF89a........'), 'x.jpg');
    expect(gif.status).toBe(415);
    const img = await testJpeg(1);
    const r = await upload(s.cookie, 'front', img);
    expect(r.status).toBe(200);
    expect(r.body.uploaded).toEqual({ front: true, back: false });
    const rows = await h.c.db('session_image').where({ session_id: s.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].enc_key_id).toBe('k1');
    const blob = h.store.blobs.get(rows[0].storage_key)!;
    expect(blob.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    const loaded = await h.c.imageService.load(s.id, 'front', 'original');
    expect(loaded!.data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  });

  it('re-upload replaces the previous image', async () => {
    const s = await ready();
    await upload(s.cookie, 'front', await testJpeg(1));
    await upload(s.cookie, 'front', await testJpeg(2));
    expect(h.store.blobs.size).toBe(1);
    expect(await h.c.db('session_image').where({ session_id: s.id })).toHaveLength(1);
  });

  it('rejects oversized files and invalid sides', async () => {
    await h.close();
    h = await createHarness({ UPLOAD_MAX_BYTES: '1000' });
    const s = await ready();
    const big = await upload(s.cookie, 'front', await testJpeg(1));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const side = await upload(s.cookie, 'middle', Buffer.from([0xff, 0xd8, 0xff]));
    expect(side.status).toBe(400);
  });

  it('rejects images over the pixel limit (decompression bomb guard)', async () => {
    await h.close();
    h = await createHarness({ UPLOAD_MAX_PIXELS: '10000' });
    const s = await ready();
    expect((await upload(s.cookie, 'front', await testJpeg(1))).status).toBe(413);
  });

  it('requires a multipart body', async () => {
    const s = await ready();
    const r = await request(h.app)
      .post('/hosted/api/session/images/front')
      .set('Cookie', s.cookie)
      .send({});
    expect(r.status).toBe(415);
  });

  it('submit requires both sides, then queues processing and returns the redirect', async () => {
    const s = await ready();
    await upload(s.cookie, 'front', await testJpeg(1));
    const early = await request(h.app).post('/hosted/api/session/submit').set('Cookie', s.cookie);
    expect(early.status).toBe(409);
    await upload(s.cookie, 'back', await testJpeg(2));
    const r = await request(h.app).post('/hosted/api/session/submit').set('Cookie', s.cookie);
    expect(r.status).toBe(200);
    const redirect = new URL(r.body.redirect_url);
    expect(redirect.host).toBe('integrator.test');
    expect(redirect.searchParams.get('x')).toBe('1');
    expect(redirect.searchParams.get('session_id')).toBe(s.id);
    expect(redirect.searchParams.get('status')).toBe('submitted');
    const session = await h.c.sessionRepository.findById(s.id);
    expect(session!.status).toBe('submitted');
    expect(await h.c.db('job').where({ type: 'process_session' })).toHaveLength(1);
    // No more changes after submit.
    expect((await upload(s.cookie, 'front', await testJpeg(3))).status).toBe(409);
    expect(
      (await request(h.app).post('/hosted/api/session/submit').set('Cookie', s.cookie)).status,
    ).toBe(409);
    const status = await request(h.app).get('/hosted/api/session/status').set('Cookie', s.cookie);
    expect(status.body).toMatchObject({ status: 'submitted' });
    expect(status.body.redirect_url).toContain('session_id=');
  });

  it('status before submit has no redirect; audit trail records end-user actions', async () => {
    const s = await ready();
    const st = await request(h.app).get('/hosted/api/session/status').set('Cookie', s.cookie);
    expect(st.body).toEqual({ status: 'in_progress', redirect_url: null });
    const info = await request(h.app).get('/hosted/api/session').set('Cookie', s.cookie);
    expect(info.body.consent.accepted).toBe(true);
    const actions = (await h.c.auditService.list(s.id)).map((a) => a.action);
    expect(actions).toEqual(['session.create', 'hosted.open', 'hosted.consent']);
  });

  it('DELETE before submit removes uploaded images immediately', async () => {
    const s = await ready();
    await upload(s.cookie, 'front', await testJpeg(1));
    const del = await request(h.app)
      .delete(`/v1/sessions/${s.id}`)
      .set('Authorization', `Bearer ${h.apiKey}`);
    expect(del.status).toBe(204);
    expect(h.store.blobs.size).toBe(0);
  });

  it('rate limits hosted calls per IP', async () => {
    await h.close();
    h = await createHarness({ HOSTED_RATE_LIMIT_PER_MIN: '2' });
    await request(h.app).get('/hosted/api/session');
    await request(h.app).get('/hosted/api/session');
    const r = await request(h.app).get('/hosted/api/session');
    expect(r.status).toBe(429);
  });
});

describe('hosted page HTML', () => {
  it('serves strict security headers (page may be unbuilt in unit runs)', async () => {
    const r = await request(h.app).get('/s/sometoken');
    expect([200, 503]).toContain(r.status);
    expect(r.headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-/);
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['permissions-policy']).toContain('camera=(self)');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
