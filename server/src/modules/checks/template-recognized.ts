import { fail, pass } from './helpers.js';
import type { Check } from './types.js';

export const templateRecognized: Check = (doc, ctx) =>
  doc.template
    ? pass('TEMPLATE_RECOGNIZED', 'Document layout recognized.', { template: doc.template })
    : fail('TEMPLATE_RECOGNIZED', 'Document layout not recognized.', {
        ...(ctx.templateScore !== undefined ? { score: ctx.templateScore } : {}),
      });
