import { addYears } from './dates.js';
import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

/**
 * The earliest first-issue date (column 10) among the required categories must be at least N
 * years before today. Without required categories, every extracted category is considered.
 */
export const minYearsHeld: Check = (doc, ctx) => {
  const years = ctx.requirements.min_years_held;
  if (years === undefined || years === 0)
    return skip('MIN_YEARS_HELD', 'not_requested', 'No minimum years held required.');
  const required = (ctx.requirements.required_categories ?? []).map((c) => c.toUpperCase());
  const relevant = doc.categories.filter((c) => required.length === 0 || required.includes(c.code));
  const dates = relevant
    .map((c) => c.issue_date)
    .filter((d): d is string => d !== null)
    .sort();
  const earliest = dates[0];
  if (!earliest)
    return skip('MIN_YEARS_HELD', 'missing_data', 'No category issue dates available.');
  return addYears(earliest, years) <= ctx.today
    ? pass('MIN_YEARS_HELD', 'License held for the required number of years.')
    : fail('MIN_YEARS_HELD', 'License not held for the required number of years.', {
        required_years: years,
      });
};
