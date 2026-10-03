import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

/** A category counts as held when present and its expiry (column 11, else card expiry) is not passed. */
export const requiredCategoriesHeld: Check = (doc, ctx) => {
  const required = ctx.requirements.required_categories;
  if (!required || required.length === 0) {
    return skip('REQUIRED_CATEGORIES_HELD', 'not_requested', 'No categories required.');
  }
  if (doc.categories.length === 0) {
    return skip('REQUIRED_CATEGORIES_HELD', 'missing_data', 'No categories extracted.');
  }
  const cardExpiry = doc.fields.expiry_date.value;
  const missing: string[] = [];
  const expired: string[] = [];
  let unknownExpiry = false;
  for (const code of required.map((c) => c.toUpperCase())) {
    const cat = doc.categories.find((c) => c.code === code);
    if (!cat) {
      missing.push(code);
      continue;
    }
    const expiry = cat.expiry_date ?? cardExpiry;
    if (!expiry) unknownExpiry = true;
    else if (expiry < ctx.today) expired.push(code);
  }
  if (missing.length > 0 || expired.length > 0) {
    return fail('REQUIRED_CATEGORIES_HELD', 'Required categories are not held or have expired.', {
      missing,
      expired,
    });
  }
  if (unknownExpiry) {
    const low = doc.fields.expiry_date.low_confidence;
    return skip(
      'REQUIRED_CATEGORIES_HELD',
      low ? 'low_confidence' : 'missing_data',
      'Category expiry could not be determined.',
    );
  }
  return pass('REQUIRED_CATEGORIES_HELD', 'All required categories are held.');
};
