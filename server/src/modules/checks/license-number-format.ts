import { fail, pass, requireFields, skip } from './helpers.js';
import type { Check } from './types.js';

export const licenseNumberFormat: Check = (doc, ctx) => {
  const r = requireFields('LICENSE_NUMBER_FORMAT', doc, ['license_number']);
  if ('skipped' in r) return r.skipped;
  const pattern = ctx.profile?.licenseNumberPattern;
  if (!pattern)
    return skip(
      'LICENSE_NUMBER_FORMAT',
      'rule_unknown',
      'No license number format known for this country.',
    );
  return pattern.test(r.values.license_number)
    ? pass('LICENSE_NUMBER_FORMAT', 'License number format is valid.')
    : fail('LICENSE_NUMBER_FORMAT', 'License number does not match the expected format.');
};
