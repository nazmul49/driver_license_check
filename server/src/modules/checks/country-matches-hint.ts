import { pass, skip, warn } from './helpers.js';
import type { Check } from './types.js';

export const countryMatchesHint: Check = (_doc, ctx) => {
  if (!ctx.countryHint)
    return skip('COUNTRY_MATCHES_HINT', 'not_requested', 'No country hint given.');
  if (!ctx.detectedCountry)
    return skip('COUNTRY_MATCHES_HINT', 'missing_data', 'Country could not be detected.');
  return ctx.detectedCountry === ctx.countryHint
    ? pass('COUNTRY_MATCHES_HINT', 'Detected country matches the hint.')
    : warn('COUNTRY_MATCHES_HINT', 'Detected country differs from the hint.', {
        detected: ctx.detectedCountry,
        hint: ctx.countryHint,
      });
};
