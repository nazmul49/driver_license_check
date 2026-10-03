import { fail, pass } from './helpers.js';
import { DATE_FIELDS, type Check } from './types.js';

export const datesParseable: Check = (doc) => {
  const invalid: string[] = DATE_FIELDS.filter((f) => doc.fields[f].invalid);
  doc.categories.forEach((c) => {
    if (c.invalid_dates) invalid.push(`categories.${c.code}`);
  });
  return invalid.length === 0
    ? pass('DATES_PARSEABLE', 'All extracted dates are valid calendar dates.')
    : fail('DATES_PARSEABLE', 'Some dates are not valid calendar dates.', { fields: invalid });
};
