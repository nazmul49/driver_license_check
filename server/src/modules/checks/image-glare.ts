import { pass, skip, warn } from './helpers.js';
import type { Check } from './types.js';

export const imageGlare: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('IMAGE_GLARE', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const glare = (['front', 'back'] as const).filter(
    (s) => (s === 'front' ? front : back).glareRatio > thresholds.maxGlareRatio,
  );
  if (glare.length === 0) return pass('IMAGE_GLARE', 'No significant glare detected.');
  const side = glare.length === 2 ? 'both' : glare[0];
  return warn(
    'IMAGE_GLARE',
    `Glare detected on ${side === 'both' ? 'both images' : `${side} image`}.`,
    { side },
  );
};
