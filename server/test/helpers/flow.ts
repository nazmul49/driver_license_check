import { CONSENT_VERSION, type SessionDto } from '@dlc/shared';
import request from 'supertest';
import type { Harness } from './harness.js';

export interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Records outbound webhook calls; responds with the queued statuses (default 200). */
export function fakeFetch(statuses: number[] = []) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: String(init?.body ?? ''),
    });
    const status = statuses.shift() ?? 200;
    if (status === 0) throw new TypeError('fetch failed');
    return new Response(null, { status });
  }) as typeof fetch;
  return { fn, calls };
}

export async function createSession(h: Harness, body: Record<string, unknown> = {}) {
  const r = await request(h.app)
    .post('/v1/sessions')
    .set('Authorization', `Bearer ${h.apiKey}`)
    .send({
      reference: 'booking-1',
      return_url: 'https://integrator.test/back',
      webhook_url: 'https://integrator.test/hooks',
      country_hint: 'NO',
      ...body,
    });
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.id as string, token: (r.body.hosted_url as string).split('/s/')[1]! };
}

/** Runs the end-user flow: open, consent, upload both sides, submit. */
export async function submitImages(
  h: Harness,
  front: Buffer,
  back: Buffer,
  body: Record<string, unknown> = {},
) {
  const s = await createSession(h, body);
  const open = await request(h.app).post('/hosted/api/session/open').send({ token: s.token });
  const cookie = (open.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  await request(h.app)
    .post('/hosted/api/session/consent')
    .set('Cookie', cookie)
    .send({ consent_version: CONSENT_VERSION, accepted: true });
  for (const [side, buf] of [
    ['front', front],
    ['back', back],
  ] as const) {
    const r = await request(h.app)
      .post(`/hosted/api/session/images/${side}`)
      .set('Cookie', cookie)
      .attach('file', buf, `${side}.jpg`);
    if (r.status !== 200) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.body)}`);
  }
  const submit = await request(h.app).post('/hosted/api/session/submit').set('Cookie', cookie);
  if (submit.status !== 200) throw new Error(`submit failed ${submit.status}`);
  return { ...s, cookie };
}

export async function getSession(h: Harness, id: string): Promise<SessionDto> {
  const r = await request(h.app)
    .get(`/v1/sessions/${id}`)
    .set('Authorization', `Bearer ${h.apiKey}`);
  return r.body as SessionDto;
}

/** Runs every job that is due now. */
export async function runJobs(h: Harness): Promise<number> {
  return h.c.jobRunner.drain();
}
