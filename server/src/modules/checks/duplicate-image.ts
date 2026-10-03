import { pass, skip, warn } from './helpers.js';
import type { Check } from './types.js';

export const duplicateImage: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('DUPLICATE_IMAGE', 'missing_data');
  return ctx.images.duplicateFound
    ? warn('DUPLICATE_IMAGE', 'An image matches an image from another session.')
    : pass('DUPLICATE_IMAGE', 'No matching image found in other sessions.');
};
