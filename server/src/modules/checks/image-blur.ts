import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export const imageBlur: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('IMAGE_BLUR', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const blurred = (['front', 'back'] as const).filter(
    (s) => (s === 'front' ? front : back).blurVariance < thresholds.minBlurVariance,
  );
  if (blurred.length === 0) return pass('IMAGE_BLUR', 'Images are sharp enough.');
  return fail('IMAGE_BLUR', 'Image is too blurry.', {
    side: blurred.length === 2 ? 'both' : blurred[0],
  });
};
