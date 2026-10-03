import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export const ID1_ASPECT_RATIO = 85.6 / 53.98;

export const documentDetected: Check = (_doc, ctx) => {
  if (!ctx.images) return skip('DOCUMENT_NOT_DETECTED', 'missing_data');
  const { front, back, thresholds } = ctx.images;
  const missing = (['front', 'back'] as const).filter((s) => {
    const m = s === 'front' ? front : back;
    const ratio = Math.max(m.aspectRatio, 1 / m.aspectRatio);
    return (
      !m.detected ||
      Math.abs(ratio - ID1_ASPECT_RATIO) / ID1_ASPECT_RATIO > thresholds.aspectTolerance
    );
  });
  if (missing.length === 0) return pass('DOCUMENT_NOT_DETECTED', 'Card detected on both images.');
  return fail('DOCUMENT_NOT_DETECTED', 'No ID-1 sized card could be detected.', {
    side: missing.length === 2 ? 'both' : missing[0],
  });
};
