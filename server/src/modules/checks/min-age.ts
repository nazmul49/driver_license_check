import { ageOn } from './dates.js';
import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

export const minAge: Check = (doc, ctx) => {
  const min = ctx.requirements.min_age;
  if (min === undefined) return skip('MIN_AGE', 'not_requested', 'No minimum age required.');
  const r = requireFields('MIN_AGE', doc, ['date_of_birth']);
  if ('skipped' in r) return r.skipped;
  return ageOn(r.values.date_of_birth, ctx.today) >= min
    ? pass('MIN_AGE', 'Holder meets the minimum age.')
    : fail('MIN_AGE', 'Holder is younger than the required minimum age.', { min_age: min });
};
