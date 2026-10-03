import { addYears } from './dates.js';
import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

/**
 * Per category (SPEC 7.3 and its note): column 10 (first obtained) <= card issue date (4a);
 * column 10 >= date of birth + minimum age for the category; column 11 <= card expiry (4b).
 * Each comparison runs only when both sides are available.
 */
export const categoryDatesConsistent: Check = (doc, ctx) => {
  if (doc.categories.length === 0)
    return skip('CATEGORY_DATES_CONSISTENT', 'missing_data', 'No categories extracted.');
  const issue = doc.fields.issue_date.value;
  const expiry = doc.fields.expiry_date.value;
  const dob = doc.fields.date_of_birth.value;
  const minAges = ctx.profile?.minAgeByCategory ?? null;
  const problems: { code: string; rule: string }[] = [];
  let compared = 0;
  for (const c of doc.categories) {
    if (c.issue_date && issue) {
      compared++;
      if (c.issue_date > issue)
        problems.push({ code: c.code, rule: 'category_issue_after_card_issue' });
    }
    const minAge = minAges?.[c.code];
    if (c.issue_date && dob && minAge !== undefined) {
      compared++;
      if (c.issue_date < addYears(dob, minAge))
        problems.push({ code: c.code, rule: 'issued_below_min_age' });
    }
    if (c.expiry_date && expiry) {
      compared++;
      if (c.expiry_date > expiry)
        problems.push({ code: c.code, rule: 'category_expiry_after_card_expiry' });
    }
  }
  if (problems.length > 0) {
    return fail('CATEGORY_DATES_CONSISTENT', 'Category dates are inconsistent.', { problems });
  }
  if (compared === 0) {
    const lowConfidence = ['issue_date', 'expiry_date', 'date_of_birth'].some(
      (f) => doc.fields[f as 'issue_date'].low_confidence,
    );
    return skip(
      'CATEGORY_DATES_CONSISTENT',
      lowConfidence ? 'low_confidence' : 'missing_data',
      'Not enough dates to compare.',
    );
  }
  return pass('CATEGORY_DATES_CONSISTENT', 'Category dates are consistent.');
};
