import { addDays, addYears, ageOn } from './dates.js';
import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

/**
 * expiry - issue must not exceed the country's maximum validity for the holder's age at issue,
 * plus the profile's tolerance. Age rules: the shortest period among rules whose age threshold
 * the holder had reached at issue applies; otherwise the default.
 */
export const validityPeriodPlausible: Check = (doc, ctx) => {
  const rule = ctx.profile?.maxValidityYears;
  if (!rule)
    return skip(
      'VALIDITY_PERIOD_PLAUSIBLE',
      'rule_unknown',
      'No validity rule known for this country.',
    );
  const r = requireFields('VALIDITY_PERIOD_PLAUSIBLE', doc, [
    'issue_date',
    'expiry_date',
    'date_of_birth',
  ]);
  if ('skipped' in r) return r.skipped;
  const { issue_date, expiry_date, date_of_birth } = r.values;
  const age = ageOn(date_of_birth, issue_date);
  const applicable = rule.over.filter((o) => age >= o.age).map((o) => o.years);
  const maxYears = applicable.length > 0 ? Math.min(...applicable) : rule.default;
  const latest = addDays(addYears(issue_date, maxYears), ctx.profile?.validityToleranceDays ?? 0);
  return expiry_date <= latest
    ? pass('VALIDITY_PERIOD_PLAUSIBLE', 'Validity period is plausible.')
    : fail('VALIDITY_PERIOD_PLAUSIBLE', 'Validity period is longer than allowed.', {
        max_years: maxYears,
      });
};
