import { fail, pass, requireFields } from './helpers.js';
import type { Check } from './types.js';

export const expiryNotPassed: Check = (doc, ctx) => {
  const r = requireFields('EXPIRY_NOT_PASSED', doc, ['expiry_date']);
  if ('skipped' in r) return r.skipped;
  return r.values.expiry_date >= ctx.today
    ? pass('EXPIRY_NOT_PASSED', 'Document is not expired.')
    : fail('EXPIRY_NOT_PASSED', 'Document is expired.');
};
