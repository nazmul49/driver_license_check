import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
const auth = () => ({ Authorization: `Bearer ${h.apiKey}` });
const body = (o: Record<string, unknown> = {}) => ({
  reference: 'booking-12345',
  return_url: 'https://integrator.test/after?ref=1',
  webhook_url: 'https://integrator.test/hooks',
  country_hint: 'NO',
  locale: 'nb',
  requirements: { min_age: 18, required_categories: ['B'] },
  ...o,
});

beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('auth and errors', () => {
  it('rejects missing and wrong keys with the uniform error shape', async () => {
    const r1 = await request(h.app).get('/v1/sessions');
    expect(r1.status).toBe(401);
    expect(r1.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(r1.body.error.request_id).toMatch(/^req_/);
    const r2 = await request(h.app)
      .get('/v1/sessions')
      .set('Authorization', `Bearer dlc_test_${'A'.repeat(43)}`);
    expect(r2.status).toBe(401);
  });

  it('rejects revoked keys and disabled integrators', async () => {
    const { id, key } = await h.c.integratorService.createApiKey(h.integrator.id, 'live');
    expect(
      (await request(h.app).get('/v1/sessions').set('Authorization', `Bearer ${key}`)).status,
    ).toBe(200);
    await h.c.integratorService.revokeApiKey(id);
    expect(
      (await request(h.app).get('/v1/sessions').set('Authorization', `Bearer ${key}`)).status,
    ).toBe(401);
    await h.c.integratorRepository.update(
      h.integrator.id,
      { disabled_at: h.clock.now() },
      h.clock.now(),
    );
    expect((await request(h.app).get('/v1/sessions').set(auth())).status).toBe(401);
  });

  it('returns VALIDATION_ERROR with details', async () => {
    const r = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send({ return_url: 'not a url' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(r.body.error.details)).toBe(true);
  });

  it('rejects malformed JSON and wrong content type', async () => {
    const r = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(r.status).toBe(400);
    const r2 = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(r2.status).toBe(415);
  });

  it('rate limits per key with Retry-After', async () => {
    await h.close();
    h = await createHarness({ RATE_LIMIT_PER_MIN: '3' });
    for (let i = 0; i < 3; i++)
      expect((await request(h.app).get('/v1/sessions').set(auth())).status).toBe(200);
    const r = await request(h.app).get('/v1/sessions').set(auth());
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('unknown routes 404 and security headers are set', async () => {
    const r = await request(h.app).get('/v1/nope');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toContain('max-age');
  });
});

describe('POST /v1/sessions', () => {
  it('creates a session with hosted_url and expiry', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^ses_[0-9A-Z]{26}$/);
    expect(r.body.status).toBe('created');
    expect(r.body.hosted_url).toMatch(/^https:\/\/dlc\.test\/s\/[A-Za-z0-9_-]{43}$/);
    expect(r.body.expires_at).toBe('2026-10-03T12:30:00.000Z');
  });

  it('stores only a hash of the hosted token', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    const token = r.body.hosted_url.split('/s/')[1];
    const row = await h.c.db('verification_session').where({ id: r.body.id }).first();
    expect(row.token_hash).not.toContain(token);
    expect(row.token_hash).toHaveLength(64);
  });

  it('merges integrator default requirements', async () => {
    await h.close();
    h = await createHarness({}, { default_requirements: { min_age: 21, min_years_held: 2 } });
    const r = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ requirements: { min_age: 18 } }));
    const s = await h.c.sessionRepository.findById(r.body.id);
    expect(s!.requirements).toEqual({ min_age: 18, min_years_held: 2 });
  });

  it('enforces HTTPS and the return host allowlist', async () => {
    const http = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ return_url: 'http://integrator.test/x' }));
    expect(http.status).toBe(400);
    const host = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ return_url: 'https://evil.test/x' }));
    expect(host.status).toBe(400);
    const hook = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ webhook_url: 'https://evil.test/h' }));
    expect(hook.status).toBe(400);
    const wildcard = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ return_url: 'https://app.acme.test/x' }));
    expect(wildcard.status).toBe(201);
  });

  it('allows HTTP return URLs in development only', async () => {
    await h.close();
    h = await createHarness({ NODE_ENV: 'development' });
    const r = await request(h.app)
      .post('/v1/sessions')
      .set(auth())
      .send(body({ return_url: 'http://integrator.test/x' }));
    expect(r.status).toBe(201);
  });
});

describe('GET, LIST, DELETE', () => {
  it('integrators only see their own sessions', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    const other = await h.c.integratorService.createIntegrator({
      name: 'other',
      display_name: 'Other',
      return_url_hosts: ['o.test'],
      retention_days: 30,
    });
    const { key } = await h.c.integratorService.createApiKey(other.integrator.id, 'test');
    const g = await request(h.app)
      .get(`/v1/sessions/${r.body.id}`)
      .set('Authorization', `Bearer ${key}`);
    expect(g.status).toBe(404);
    expect(g.body.error.code).toBe('SESSION_NOT_FOUND');
    const own = await request(h.app).get(`/v1/sessions/${r.body.id}`).set(auth());
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      id: r.body.id,
      reference: 'booking-12345',
      status: 'created',
      decision: null,
    });
    expect(own.body.result).toBeUndefined();
  });

  it('validates the id format', async () => {
    expect((await request(h.app).get('/v1/sessions/abc').set(auth())).status).toBe(400);
  });

  it('lists with filters and cursor pagination', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(h.app)
        .post('/v1/sessions')
        .set(auth())
        .send(body({ reference: i < 3 ? 'a' : 'b' }));
      ids.push(r.body.id);
    }
    const p1 = await request(h.app).get('/v1/sessions?limit=2').set(auth());
    expect(p1.body.data.map((s: { id: string }) => s.id)).toEqual([ids[4], ids[3]]);
    const p2 = await request(h.app)
      .get(`/v1/sessions?limit=2&cursor=${p1.body.next_cursor}`)
      .set(auth());
    expect(p2.body.data.map((s: { id: string }) => s.id)).toEqual([ids[2], ids[1]]);
    const p3 = await request(h.app)
      .get(`/v1/sessions?limit=2&cursor=${p2.body.next_cursor}`)
      .set(auth());
    expect(p3.body.next_cursor).toBeNull();
    const byRef = await request(h.app).get('/v1/sessions?reference=a&status=created').set(auth());
    expect(byRef.body.data).toHaveLength(3);
    expect((await request(h.app).get('/v1/sessions?status=bogus').set(auth())).status).toBe(400);
  });

  it('DELETE before submit cancels', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    expect((await request(h.app).delete(`/v1/sessions/${r.body.id}`).set(auth())).status).toBe(204);
    const g = await request(h.app).get(`/v1/sessions/${r.body.id}`).set(auth());
    expect(g.body.status).toBe('cancelled');
  });

  it('image download is forbidden unless enabled', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    const img = await request(h.app).get(`/v1/sessions/${r.body.id}/images/front`).set(auth());
    expect(img.status).toBe(403);
    expect(img.body.error.code).toBe('FORBIDDEN');
  });

  it('audit-logs session creation without document data', async () => {
    const r = await request(h.app).post('/v1/sessions').set(auth()).send(body());
    const rows = await h.c.auditService.list(r.body.id);
    expect(rows.map((x) => x.action)).toEqual(['session.create']);
    expect(rows[0]!.ip_hash).toHaveLength(64);
  });
});

describe('health', () => {
  it('health and ready', async () => {
    expect((await request(h.app).get('/v1/health')).body).toEqual({ status: 'ok' });
    const ready = await request(h.app).get('/v1/ready');
    // tessdata may not be downloaded yet in a fresh checkout; db must be up either way.
    expect([200, 503]).toContain(ready.status);
    if (ready.status === 503) expect(ready.body.error.details.db).toBe(true);
  });

  it('metrics endpoint exposes session gauges', async () => {
    await request(h.app).post('/v1/sessions').set(auth()).send(body());
    const m = await request(h.app).get('/metrics');
    expect(m.status).toBe(200);
    expect(m.text).toContain('dlc_sessions_by_status{status="created"} 1');
    expect(m.text).toContain('dlc_job_queue_depth');
  });
});
