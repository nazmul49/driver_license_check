import type { Severity } from './enums.js';

/**
 * Every check the service can emit, with its default severity (SPEC section 7).
 * The code is part of the public API contract; do not rename.
 */
export const CHECK_DEFINITIONS = {
  // 7.1 Image quality
  IMAGE_RESOLUTION: 'critical',
  IMAGE_BLUR: 'critical',
  IMAGE_GLARE: 'major',
  IMAGE_TOO_DARK: 'major',
  IMAGE_TOO_BRIGHT: 'major',
  DOCUMENT_NOT_DETECTED: 'critical',
  FRONT_BACK_SAME_IMAGE: 'critical',
  DUPLICATE_IMAGE: 'major',
  // 7.2 Data presence and format
  TEMPLATE_RECOGNIZED: 'critical',
  REQUIRED_FIELDS_PRESENT: 'critical',
  LICENSE_NUMBER_FORMAT: 'major',
  DATES_PARSEABLE: 'critical',
  CATEGORIES_VALID: 'major',
  ISSUING_AUTHORITY_KNOWN: 'minor',
  COUNTRY_MATCHES_HINT: 'major',
  // 7.3 Date logic
  EXPIRY_NOT_PASSED: 'critical',
  MIN_REMAINING_VALIDITY: 'major',
  ISSUE_DATE_NOT_FUTURE: 'critical',
  ISSUE_BEFORE_EXPIRY: 'critical',
  VALIDITY_PERIOD_PLAUSIBLE: 'major',
  DOB_PLAUSIBLE: 'critical',
  DOB_BEFORE_ISSUE: 'critical',
  AGE_AT_ISSUE_PLAUSIBLE: 'major',
  CATEGORY_DATES_CONSISTENT: 'major',
  MIN_AGE: 'critical',
  REQUIRED_CATEGORIES_HELD: 'critical',
  MIN_YEARS_HELD: 'major',
  // 7.4 Cross-consistency
  FRONT_BACK_CONSISTENT: 'major',
  DOCUMENT_NUMBER_REUSED: 'major',
} as const satisfies Record<string, Severity>;

export type CheckCode = keyof typeof CHECK_DEFINITIONS;
export const CHECK_CODES = Object.keys(CHECK_DEFINITIONS) as CheckCode[];
