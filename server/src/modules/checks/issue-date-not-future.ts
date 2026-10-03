import { fail, pass, requireFields } from './helpers.js';
import type { Check } from './types.js';

export const issueDateNotFuture: Check = (doc, ctx) => {
  const r = requireFields('ISSUE_DATE_NOT_FUTURE', doc, ['issue_date']);
  if ('skipped' in r) return r.skipped;
  return r.values.issue_date <= ctx.today
    ? pass('ISSUE_DATE_NOT_FUTURE', 'Issue date is not in the future.')
    : fail('ISSUE_DATE_NOT_FUTURE', 'Issue date is in the future.');
};
