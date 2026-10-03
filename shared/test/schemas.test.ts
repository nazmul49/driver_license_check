import { describe, expect, it } from 'vitest';
import { CreateSessionRequestSchema, SessionIdParamSchema, CHECK_CODES } from '../src/index.js';

describe('CreateSessionRequestSchema', () => {
  it('applies defaults and uppercases country hint', () => {
    const parsed = CreateSessionRequestSchema.parse({
      return_url: 'https://example.com/back',
      country_hint: 'no',
    });
    expect(parsed.expires_in_seconds).toBe(1800);
    expect(parsed.country_hint).toBe('NO');
  });

  it('rejects out-of-range expiry and unknown keys', () => {
    expect(
      CreateSessionRequestSchema.safeParse({ return_url: 'https://e.com', expires_in_seconds: 10 })
        .success,
    ).toBe(false);
    expect(
      CreateSessionRequestSchema.safeParse({ return_url: 'https://e.com', foo: 1 }).success,
    ).toBe(false);
  });
});

describe('SessionIdParamSchema', () => {
  it('accepts ses_ ULIDs only', () => {
    expect(SessionIdParamSchema.safeParse({ id: 'ses_01J9Z3ABCDEFGHJKMNPQRSTVWX' }).success).toBe(
      true,
    );
    expect(SessionIdParamSchema.safeParse({ id: '01J9Z3ABCDEFGHJKMNPQRSTVWX' }).success).toBe(
      false,
    );
  });
});

it('check codes are unique', () => {
  expect(new Set(CHECK_CODES).size).toBe(CHECK_CODES.length);
});
