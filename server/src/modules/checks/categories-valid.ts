import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export const categoriesValid: Check = (doc, ctx) => {
  if (doc.categories.length === 0)
    return skip('CATEGORIES_VALID', 'missing_data', 'No categories extracted.');
  const valid = ctx.profile?.validCategories;
  if (!valid)
    return skip('CATEGORIES_VALID', 'rule_unknown', 'No category list known for this country.');
  const unknown = doc.categories.map((c) => c.code).filter((c) => !valid.includes(c));
  return unknown.length === 0
    ? pass('CATEGORIES_VALID', 'All categories are valid.')
    : fail('CATEGORIES_VALID', 'Unknown license category.', { categories: unknown });
};
