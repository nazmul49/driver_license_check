import { fail, pass, skip } from './helpers.js';
import type { Check, FieldName } from './types.js';

export const REQUIRED_FIELDS: readonly FieldName[] = [
  'surname',
  'given_names',
  'date_of_birth',
  'issue_date',
  'expiry_date',
  'license_number',
];

/**
 * Fails when a required field was not found at all. When every missing field was found but read
 * with low confidence, the check is skipped with reason low_confidence so the decision routes the
 * session to review (SPEC 8) instead of rejecting a readable-but-blurry document outright.
 */
export const requiredFieldsPresent: Check = (doc) => {
  const absent = REQUIRED_FIELDS.filter((f) => !doc.fields[f].present);
  const unusable = REQUIRED_FIELDS.filter(
    (f) => doc.fields[f].value === null && !doc.fields[f].invalid,
  );
  if (absent.length > 0) {
    return fail('REQUIRED_FIELDS_PRESENT', 'Required fields are missing.', { fields: absent });
  }
  const lowConfidence = unusable.filter((f) => doc.fields[f].low_confidence);
  if (lowConfidence.length > 0) {
    return skip(
      'REQUIRED_FIELDS_PRESENT',
      'low_confidence',
      'Some required fields could not be read reliably.',
      {
        fields: lowConfidence,
      },
    );
  }
  return pass('REQUIRED_FIELDS_PRESENT', 'All required fields were extracted.');
};
