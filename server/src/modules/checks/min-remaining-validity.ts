import { diffDays } from './dates.js';
import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

export const minRemainingValidity: Check = (doc, ctx) => {
  const min = ctx.requirements.min_remaining_validity_days;
  if (min === undefined)
    return skip(
      'MIN_REMAINING_VALIDITY',
      'not_requested',
      'No minimum remaining validity required.',
    );
  const r = requireFields('MIN_REMAINING_VALIDITY', doc, ['expiry_date']);
  if ('skipped' in r) return r.skipped;
  const remaining = diffDays(ctx.today, r.values.expiry_date);
  return remaining >= min
    ? pass('MIN_REMAINING_VALIDITY', 'Remaining validity meets the requirement.')
    : fail('MIN_REMAINING_VALIDITY', 'Remaining validity is shorter than required.', {
        remaining_days: remaining,
        required_days: min,
      });
};
