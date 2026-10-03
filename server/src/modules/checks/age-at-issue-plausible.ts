import { ageOn } from './dates.js';
import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

export const ageAtIssuePlausible: Check = (doc, ctx) => {
  const minAges = ctx.profile?.minAgeByCategory;
  if (!minAges)
    return skip(
      'AGE_AT_ISSUE_PLAUSIBLE',
      'rule_unknown',
      'No minimum ages known for this country.',
    );
  const known = doc.categories
    .map((c) => minAges[c.code])
    .filter((a): a is number => a !== undefined);
  if (known.length === 0)
    return skip(
      'AGE_AT_ISSUE_PLAUSIBLE',
      'missing_data',
      'No categories with a known minimum age.',
    );
  const r = requireFields('AGE_AT_ISSUE_PLAUSIBLE', doc, ['date_of_birth', 'issue_date']);
  if ('skipped' in r) return r.skipped;
  const lowest = Math.min(...known);
  const age = ageOn(r.values.date_of_birth, r.values.issue_date);
  return age >= lowest
    ? pass('AGE_AT_ISSUE_PLAUSIBLE', 'Age at issue is plausible.')
    : fail('AGE_AT_ISSUE_PLAUSIBLE', 'Holder was younger than the minimum age at issue.', {
        min_age: lowest,
      });
};
