import { pass, skip, warn } from './helpers.js';
import type { Check } from './types.js';

export const documentNumberReused: Check = (_doc, ctx) => {
  if (!ctx.reuse)
    return skip('DOCUMENT_NUMBER_REUSED', 'missing_data', 'License number not available.');
  return ctx.reuse.conflictingSessions > 0
    ? warn(
        'DOCUMENT_NUMBER_REUSED',
        'License number was seen in another session with different holder data.',
        {
          sessions: ctx.reuse.conflictingSessions,
        },
      )
    : pass('DOCUMENT_NUMBER_REUSED', 'No conflicting reuse of the license number found.');
};
