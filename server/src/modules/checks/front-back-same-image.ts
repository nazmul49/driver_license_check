import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export const frontBackSameImage: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('FRONT_BACK_SAME_IMAGE', 'missing_data');
  const { frontBackDistance, thresholds } = ctx.images;
  if (frontBackDistance <= thresholds.phashMaxDistance) {
    return fail('FRONT_BACK_SAME_IMAGE', 'Front and back images appear to be the same image.', {
      distance: frontBackDistance,
    });
  }
  return pass('FRONT_BACK_SAME_IMAGE', 'Front and back images differ.');
};
