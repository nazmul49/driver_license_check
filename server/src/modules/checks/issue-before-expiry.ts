import { fail, pass, requireFields } from './helpers.js';
import type { Check } from './types.js';

export const issueBeforeExpiry: Check = (doc) => {
  const r = requireFields('ISSUE_BEFORE_EXPIRY', doc, ['issue_date', 'expiry_date']);
  if ('skipped' in r) return r.skipped;
  return r.values.issue_date < r.values.expiry_date
    ? pass('ISSUE_BEFORE_EXPIRY', 'Issue date is before expiry date.')
    : fail('ISSUE_BEFORE_EXPIRY', 'Issue date is not before expiry date.');
};
