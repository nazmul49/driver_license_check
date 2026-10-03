import { fail, pass, requireFields } from './helpers.js';
import type { Check } from './types.js';

export const dobBeforeIssue: Check = (doc) => {
  const r = requireFields('DOB_BEFORE_ISSUE', doc, ['date_of_birth', 'issue_date']);
  if ('skipped' in r) return r.skipped;
  return r.values.date_of_birth < r.values.issue_date
    ? pass('DOB_BEFORE_ISSUE', 'Date of birth is before issue date.')
    : fail('DOB_BEFORE_ISSUE', 'Date of birth is not before issue date.');
};
