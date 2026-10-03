import { describe, expect, it } from 'vitest';
import { result } from '../../src/modules/checks/helpers.js';
import type { CheckResult } from '../../src/modules/checks/types.js';
import {
  DEFAULT_DECISION_POLICY,
  decide,
  resolvePolicy,
  summarize,
} from '../../src/modules/decision/decision.js';

const P = (code: Parameters<typeof result>[0]) => result(code, 'pass', 'ok');
const F = (code: Parameters<typeof result>[0]) => result(code, 'fail', 'bad');
const W = (code: Parameters<typeof result>[0]) => result(code, 'warn', 'hmm');
const S = (code: Parameters<typeof result>[0], reason: string): CheckResult => ({
  ...result(code, 'skipped', 'skip'),
  details: { reason },
});

describe('decide (SPEC 8)', () => {
  const cases: { name: string; checks: CheckResult[]; decision: string; reasons: string[] }[] = [
    {
      name: 'all pass',
      checks: [P('EXPIRY_NOT_PASSED'), P('MIN_AGE')],
      decision: 'approved',
      reasons: [],
    },
    {
      name: 'critical fail',
      checks: [F('EXPIRY_NOT_PASSED'), F('LICENSE_NUMBER_FORMAT')],
      decision: 'rejected',
      reasons: ['EXPIRY_NOT_PASSED'],
    },
    {
      name: 'major fail',
      checks: [F('LICENSE_NUMBER_FORMAT'), P('MIN_AGE')],
      decision: 'review',
      reasons: ['LICENSE_NUMBER_FORMAT'],
    },
    {
      name: 'minor fail alone',
      checks: [F('ISSUING_AUTHORITY_KNOWN')],
      decision: 'approved',
      reasons: [],
    },
    { name: 'one warn', checks: [W('IMAGE_GLARE')], decision: 'approved', reasons: [] },
    {
      name: 'two warns',
      checks: [W('IMAGE_GLARE'), W('DUPLICATE_IMAGE')],
      decision: 'review',
      reasons: ['IMAGE_GLARE', 'DUPLICATE_IMAGE'],
    },
    {
      name: 'critical skipped low confidence',
      checks: [S('EXPIRY_NOT_PASSED', 'low_confidence')],
      decision: 'review',
      reasons: ['EXPIRY_NOT_PASSED'],
    },
    {
      name: 'critical skipped not requested',
      checks: [S('MIN_AGE', 'not_requested')],
      decision: 'approved',
      reasons: [],
    },
    {
      name: 'major skipped low confidence',
      checks: [S('LICENSE_NUMBER_FORMAT', 'low_confidence')],
      decision: 'approved',
      reasons: [],
    },
    {
      name: 'critical fail beats review',
      checks: [F('DOB_PLAUSIBLE'), W('IMAGE_GLARE'), W('DUPLICATE_IMAGE')],
      decision: 'rejected',
      reasons: ['DOB_PLAUSIBLE'],
    },
  ];
  it.each(cases)('$name', ({ checks, decision, reasons }) => {
    expect(decide(checks)).toEqual({ decision, reasons });
  });

  it('per-integrator policy: ignore, raise severity, threshold, map review', () => {
    expect(
      decide(
        [F('EXPIRY_NOT_PASSED')],
        resolvePolicy({ severityOverrides: { EXPIRY_NOT_PASSED: 'ignore' } }),
      ).decision,
    ).toBe('approved');
    expect(
      decide(
        [F('LICENSE_NUMBER_FORMAT')],
        resolvePolicy({ severityOverrides: { LICENSE_NUMBER_FORMAT: 'critical' } }),
      ).decision,
    ).toBe('rejected');
    expect(decide([W('IMAGE_GLARE')], resolvePolicy({ warnThreshold: 1 })).decision).toBe('review');
    expect(
      decide([F('LICENSE_NUMBER_FORMAT')], resolvePolicy({ mapReviewTo: 'rejected' })).decision,
    ).toBe('rejected');
    expect(
      decide(
        [S('EXPIRY_NOT_PASSED', 'low_confidence')],
        resolvePolicy({ reviewOnCriticalLowConfidence: false }),
      ).decision,
    ).toBe('approved');
  });

  it('resolvePolicy defaults', () => {
    expect(resolvePolicy(null)).toEqual(DEFAULT_DECISION_POLICY);
  });

  it('summarize counts statuses', () => {
    expect(
      summarize([P('MIN_AGE'), W('IMAGE_GLARE'), F('DOB_PLAUSIBLE'), S('MIN_AGE', 'x')]),
    ).toEqual({
      passed: 1,
      warned: 1,
      failed: 1,
      skipped: 1,
    });
  });
});
