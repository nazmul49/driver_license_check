import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

export const issuingAuthorityKnown: Check = (doc, ctx) => {
  const r = requireFields('ISSUING_AUTHORITY_KNOWN', doc, ['issuing_authority']);
  if ('skipped' in r) return r.skipped;
  const patterns = ctx.profile?.issuingAuthorityPatterns;
  if (!patterns || patterns.length === 0) {
    return skip(
      'ISSUING_AUTHORITY_KNOWN',
      'rule_unknown',
      'No issuing authorities known for this country.',
    );
  }
  return patterns.some((p) => p.test(r.values.issuing_authority))
    ? pass('ISSUING_AUTHORITY_KNOWN', 'Issuing authority is known.')
    : fail('ISSUING_AUTHORITY_KNOWN', 'Issuing authority is not recognized.');
};
