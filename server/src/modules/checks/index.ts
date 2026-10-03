import { ageAtIssuePlausible } from './age-at-issue-plausible.js';
import { categoriesValid } from './categories-valid.js';
import { categoryDatesConsistent } from './category-dates-consistent.js';
import { countryMatchesHint } from './country-matches-hint.js';
import { datesParseable } from './dates-parseable.js';
import { dobBeforeIssue } from './dob-before-issue.js';
import { dobPlausible } from './dob-plausible.js';
import { documentDetected } from './document-detected.js';
import { documentNumberReused } from './document-number-reused.js';
import { duplicateImage } from './duplicate-image.js';
import { expiryNotPassed } from './expiry-not-passed.js';
import { frontBackConsistent } from './front-back-consistent.js';
import { frontBackSameImage } from './front-back-same-image.js';
import { imageBlur } from './image-blur.js';
import { imageTooBright, imageTooDark } from './image-exposure.js';
import { imageGlare } from './image-glare.js';
import { imageResolution } from './image-resolution.js';
import { issueBeforeExpiry } from './issue-before-expiry.js';
import { issueDateNotFuture } from './issue-date-not-future.js';
import { issuingAuthorityKnown } from './issuing-authority-known.js';
import { licenseNumberFormat } from './license-number-format.js';
import { minAge } from './min-age.js';
import { minRemainingValidity } from './min-remaining-validity.js';
import { minYearsHeld } from './min-years-held.js';
import { requiredCategoriesHeld } from './required-categories-held.js';
import { requiredFieldsPresent } from './required-fields-present.js';
import { templateRecognized } from './template-recognized.js';
import type { Check, CheckContext, CheckResult, ExtractedDocument } from './types.js';
import { validityPeriodPlausible } from './validity-period-plausible.js';

export * from './types.js';

/** Image quality checks (SPEC 7.1). Run before OCR; a critical fail stops processing. */
export const IMAGE_CHECKS: Check[] = [
  documentDetected,
  imageResolution,
  imageBlur,
  imageGlare,
  imageTooDark,
  imageTooBright,
  frontBackSameImage,
  duplicateImage,
];

/** Data checks (SPEC 7.2 to 7.4). */
export const DATA_CHECKS: Check[] = [
  templateRecognized,
  requiredFieldsPresent,
  licenseNumberFormat,
  datesParseable,
  categoriesValid,
  issuingAuthorityKnown,
  countryMatchesHint,
  expiryNotPassed,
  minRemainingValidity,
  issueDateNotFuture,
  issueBeforeExpiry,
  validityPeriodPlausible,
  dobPlausible,
  dobBeforeIssue,
  ageAtIssuePlausible,
  categoryDatesConsistent,
  minAge,
  requiredCategoriesHeld,
  minYearsHeld,
  frontBackConsistent,
  documentNumberReused,
];

export function runChecks(
  checks: Check[],
  doc: ExtractedDocument,
  ctx: CheckContext,
): CheckResult[] {
  return checks.map((check) => check(doc, ctx));
}

/** An extracted document with nothing found, used when processing stops before OCR. */
export function emptyDocument(): ExtractedDocument {
  const empty = {
    value: null,
    confidence: 0,
    low_confidence: false,
    present: false,
    invalid: false,
  };
  return {
    template: null,
    country: null,
    fields: {
      surname: { ...empty },
      given_names: { ...empty },
      date_of_birth: { ...empty },
      place_of_birth: { ...empty },
      issue_date: { ...empty },
      expiry_date: { ...empty },
      issuing_authority: { ...empty },
      license_number: { ...empty },
    },
    categories: [],
    back: { license_number: null, surname: null },
  };
}
