import { fail, pass, skip } from './helpers.js';
import type { Check, ImageMetrics } from './types.js';

const sides = ['front', 'back'] as const;
const pick = (s: (typeof sides)[number], f: ImageMetrics, b: ImageMetrics) =>
  s === 'front' ? f : b;

export const imageTooDark: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('IMAGE_TOO_DARK', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const dark = sides.filter((s) => pick(s, front, back).meanLuminance < thresholds.minLuminance);
  if (dark.length === 0) return pass('IMAGE_TOO_DARK', 'Image brightness is sufficient.');
  return fail('IMAGE_TOO_DARK', 'Image is too dark.', {
    side: dark.length === 2 ? 'both' : dark[0],
  });
};

export const imageTooBright: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('IMAGE_TOO_BRIGHT', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const bright = sides.filter((s) => pick(s, front, back).meanLuminance > thresholds.maxLuminance);
  if (bright.length === 0) return pass('IMAGE_TOO_BRIGHT', 'Image is not overexposed.');
  return fail('IMAGE_TOO_BRIGHT', 'Image is too bright.', {
    side: bright.length === 2 ? 'both' : bright[0],
  });
};
