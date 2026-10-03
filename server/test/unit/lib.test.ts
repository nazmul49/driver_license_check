import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addDays, addYears, ageOn, diffDays, parseIso } from '../../src/modules/checks/dates.js';
import { Encryptor, safeEqual } from '../../src/lib/crypto.js';
import { loadConfig } from '../../src/config/index.js';
import { hostAllowed } from '../../src/modules/sessions/session.service.js';
import { signHostedCookie, verifyHostedCookie } from '../../src/modules/hosted/hosted-cookie.js';
import { sniffImageType } from '../../src/modules/images/image.service.js';
import { RateLimiter } from '../../src/middleware/rate-limit.js';
import { FixedClock } from '../../src/lib/clock.js';
import { safePath } from '../../src/middleware/request-context.js';
import { testConfig } from '../helpers/config.js';

describe('dates', () => {
  it('parses real dates only', () => {
    expect(parseIso('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseIso('2023-02-29')).toBeNull();
    expect(parseIso('2023-13-01')).toBeNull();
    expect(parseIso('1.1.2020')).toBeNull();
  });
  it('arithmetic is timezone independent', () => {
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2); // spans EU DST change
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(ageOn('2000-10-04', '2026-10-03')).toBe(25);
    expect(ageOn('2000-10-03', '2026-10-03')).toBe(26);
    expect(() => diffDays('nope', '2020-01-01')).toThrow();
  });
});

describe('Encryptor', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  it('round trips and stores the key id', () => {
    const enc = new Encryptor({ currentKeyId: 'k1', keys: new Map([['k1', k1]]) });
    const { envelope, keyId } = enc.encrypt(Buffer.from('secret data'));
    expect(keyId).toBe('k1');
    expect(envelope.includes(Buffer.from('secret data'))).toBe(false);
    expect(enc.decrypt(envelope).toString()).toBe('secret data');
    expect(enc.decryptJson(enc.encryptJson({ a: 1 }).envelope)).toEqual({ a: 1 });
  });
  it('decrypts objects written under an older key after rotation', () => {
    const old = new Encryptor({ currentKeyId: 'k1', keys: new Map([['k1', k1]]) });
    const { envelope } = old.encrypt(Buffer.from('x'));
    const rotated = new Encryptor({
      currentKeyId: 'k2',
      keys: new Map([
        ['k1', k1],
        ['k2', k2],
      ]),
    });
    expect(rotated.decrypt(envelope).toString()).toBe('x');
    expect(rotated.encrypt(Buffer.from('y')).keyId).toBe('k2');
  });
  it('detects tampering and missing keys', () => {
    const enc = new Encryptor({ currentKeyId: 'k1', keys: new Map([['k1', k1]]) });
    const { envelope } = enc.encrypt(Buffer.from('payload'));
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => enc.decrypt(tampered)).toThrow();
    expect(() =>
      new Encryptor({ currentKeyId: 'k2', keys: new Map([['k2', k2]]) }).decrypt(envelope),
    ).toThrow(/not available/);
    expect(() => enc.decrypt(Buffer.from([9]))).toThrow(/version/);
  });
  it('requires the current key', () => {
    expect(() => new Encryptor({ currentKeyId: 'x', keys: new Map() })).toThrow();
  });
});

describe('misc', () => {
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('hostAllowed supports exact and wildcard entries', () => {
    expect(hostAllowed('integrator.test', ['integrator.test'])).toBe(true);
    expect(hostAllowed('app.acme.test', ['*.acme.test'])).toBe(true);
    expect(hostAllowed('acme.test', ['*.acme.test'])).toBe(false);
    expect(hostAllowed('evilacme.test', ['*.acme.test'])).toBe(false);
    expect(hostAllowed('evil.test', ['integrator.test'])).toBe(false);
  });
  it('hosted cookie signs and expires', () => {
    const exp = new Date('2026-10-03T13:00:00Z');
    const v = signHostedCookie('s'.repeat(32), 'ses_X', exp);
    expect(verifyHostedCookie('s'.repeat(32), v, new Date('2026-10-03T12:00:00Z'))).toBe('ses_X');
    expect(verifyHostedCookie('s'.repeat(32), v, new Date('2026-10-03T14:00:00Z'))).toBeNull();
    expect(verifyHostedCookie('t'.repeat(32), v, new Date('2026-10-03T12:00:00Z'))).toBeNull();
    expect(verifyHostedCookie('s'.repeat(32), 'garbage', new Date())).toBeNull();
    expect(verifyHostedCookie('s'.repeat(32), undefined, new Date())).toBeNull();
  });
  it('sniffs image types from magic bytes', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(
      sniffImageType(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic')])),
    ).toBe('image/heic');
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });
  it('rate limiter returns retry-after when exceeded', () => {
    const clock = new FixedClock(new Date('2026-10-03T12:00:00Z'));
    const rl = new RateLimiter(2, 60_000, clock);
    expect(rl.hit('k')).toBe(0);
    expect(rl.hit('k')).toBe(0);
    expect(rl.hit('k')).toBe(60);
    clock.advance(60_000);
    expect(rl.hit('k')).toBe(0);
  });
  it('safePath hides hosted tokens', () => {
    expect(safePath('/s/abcdef')).toBe('/s/:token');
    expect(safePath('/v1/sessions')).toBe('/v1/sessions');
  });
  it('config validation rejects bad env', () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'nope' })).toThrow(/Invalid configuration/);
    expect(testConfig().encryption.keys.size).toBe(1);
    const prev = randomBytes(32).toString('base64');
    expect(testConfig({ ENCRYPTION_PREVIOUS_KEYS: `old:${prev}` }).encryption.keys.size).toBe(2);
    expect(() => testConfig({ ENCRYPTION_PREVIOUS_KEYS: 'bad' })).toThrow();
  });
});
