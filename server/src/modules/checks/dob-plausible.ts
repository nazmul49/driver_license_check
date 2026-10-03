import { ageOn } from './dates.js';
import { fail, pass, requireFields } from './helpers.js';
import type { Check } from './types.js';

export const MIN_PLAUSIBLE_AGE = 14;
export const MAX_PLAUSIBLE_AGE = 110;

export const dobPlausible: Check = (doc, ctx) => {
  const r = requireFields('DOB_PLAUSIBLE', doc, ['date_of_birth']);
  if ('skipped' in r) return r.skipped;
  const dob = r.values.date_of_birth;
  if (dob >= ctx.today) return fail('DOB_PLAUSIBLE', 'Date of birth is not in the past.');
  const age = ageOn(dob, ctx.today);
  return age >= MIN_PLAUSIBLE_AGE && age <= MAX_PLAUSIBLE_AGE
    ? pass('DOB_PLAUSIBLE', 'Date of birth is plausible.')
    : fail('DOB_PLAUSIBLE', 'Age derived from date of birth is not plausible.');
};
