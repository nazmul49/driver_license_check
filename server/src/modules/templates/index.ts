import type { OcrResult } from '../ocr/ocr.types.js';
import { euCardV1 } from './eu-card-v1.js';
import type { DocumentTemplate } from './template.types.js';

export type { DocumentTemplate, ParseContext, TemplateZone } from './template.types.js';
export { euCardV1, parseZoneValue } from './eu-card-v1.js';

/** Registered templates. AAMVA (PDF417) can be added here later (SPEC 1.3, 14). */
export const TEMPLATES: DocumentTemplate[] = [euCardV1];

/** Pick the best scoring template above its threshold (SPEC 6.1 step 7). */
export function detectTemplate(front: OcrResult): {
  template: DocumentTemplate | null;
  score: number;
} {
  let best: DocumentTemplate | null = null;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const s = t.score(front);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best && bestScore >= best.threshold
    ? { template: best, score: bestScore }
    : { template: null, score: bestScore };
}
