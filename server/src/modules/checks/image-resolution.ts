import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export const imageResolution: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('IMAGE_RESOLUTION', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const low = (['front', 'back'] as const).filter(
    (s) =>
      Math.max((s === 'front' ? front : back).width, (s === 'front' ? front : back).height) <
      thresholds.minLongEdge,
  );
  if (low.length === 0) return pass('IMAGE_RESOLUTION', 'Image resolution is sufficient.');
  return fail('IMAGE_RESOLUTION', 'Card image resolution is too low.', {
    side: low.length === 2 ? 'both' : low[0],
    min_long_edge: thresholds.minLongEdge,
  });
};
