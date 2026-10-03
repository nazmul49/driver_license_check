import type { CountryProfile } from '../../src/modules/countries/country-profile.js';
import type {
  CheckContext,
  ExtractedCategory,
  ExtractedDocument,
  ExtractedField,
  FieldName,
  ImageMetrics,
} from '../../src/modules/checks/types.js';

export const field = (value: string | null, confidence = 0.95): ExtractedField => ({
  value,
  confidence,
  low_confidence: false,
  present: value !== null,
  invalid: false,
});
export const lowConfidence = (): ExtractedField => ({
  value: null,
  confidence: 0.3,
  low_confidence: true,
  present: true,
  invalid: false,
});
export const missing = (): ExtractedField => ({
  value: null,
  confidence: 0,
  low_confidence: false,
  present: false,
  invalid: false,
});
export const invalid = (): ExtractedField => ({
  value: null,
  confidence: 0.9,
  low_confidence: false,
  present: true,
  invalid: true,
});

export const category = (
  code: string,
  issue: string | null,
  expiry: string | null,
): ExtractedCategory => ({
  code,
  issue_date: issue,
  expiry_date: expiry,
  restrictions: [],
  confidence: 0.9,
  invalid_dates: false,
});

/** A valid synthetic Norwegian license as of TODAY. */
export function makeDoc(
  fields: Partial<Record<FieldName, ExtractedField>> = {},
  extra: Partial<Omit<ExtractedDocument, 'fields'>> = {},
): ExtractedDocument {
  return {
    template: 'eu-card-v1',
    country: 'NO',
    fields: {
      surname: field('NORDMANN'),
      given_names: field('OLA'),
      date_of_birth: field('1990-04-12'),
      place_of_birth: field('OSLO'),
      issue_date: field('2021-06-01'),
      expiry_date: field('2036-06-01'),
      issuing_authority: field('STATENS VEGVESEN'),
      license_number: field('12345678901'),
      ...fields,
    },
    categories: [category('B', '2008-05-10', '2036-06-01')],
    back: { license_number: null, surname: null },
    ...extra,
  };
}

/**
 * The SPEC 6.4 example values, used ONLY to exercise the checks in tests. They are unverified
 * placeholders and are deliberately not in the shipped NO profile.
 */
export const SPEC_EXAMPLE_PROFILE: CountryProfile = {
  code: 'NO',
  name: 'Norway (test profile)',
  distinguishingSign: 'N',
  titleKeywords: ['FØRERKORT'],
  dateFormat: 'dd.MM.yyyy',
  licenseNumberPattern: /^\d{11}$/,
  personalNumberPattern: null,
  issuingAuthorityPatterns: [/STATENS\s+VEGVESEN/i],
  maxValidityYears: { default: 15, over: [{ age: 75, years: 5 }] },
  validityToleranceDays: 31,
  minAgeByCategory: { AM: 16, A1: 16, A2: 18, A: 24, B: 18, BE: 18, C1: 18, C: 21, D: 24 },
  validCategories: [
    'AM',
    'A1',
    'A2',
    'A',
    'B',
    'BE',
    'C1',
    'C1E',
    'C',
    'CE',
    'D1',
    'D1E',
    'D',
    'DE',
    'T',
    'S',
  ],
};

export const TODAY = '2026-10-03';

export function makeCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    today: TODAY,
    requirements: {},
    profile: SPEC_EXAMPLE_PROFILE,
    countryHint: null,
    detectedCountry: 'NO',
    ...overrides,
  };
}

export const goodImage = (o: Partial<ImageMetrics> = {}): ImageMetrics => ({
  detected: true,
  width: 1586,
  height: 1000,
  aspectRatio: 1.586,
  blurVariance: 400,
  glareRatio: 0.001,
  meanLuminance: 140,
  phash: 'ffff0000ffff0000',
  ...o,
});

export const THRESHOLDS = {
  minLongEdge: 1000,
  minBlurVariance: 60,
  maxGlareRatio: 0.04,
  minLuminance: 50,
  maxLuminance: 225,
  aspectTolerance: 0.05,
  phashMaxDistance: 6,
};

export function imageCtx(
  o: Partial<{
    front: Partial<ImageMetrics>;
    back: Partial<ImageMetrics>;
    frontBackDistance: number;
    duplicateFound: boolean;
  }> = {},
): CheckContext {
  return makeCtx({
    images: {
      front: goodImage(o.front),
      back: goodImage(o.back),
      thresholds: THRESHOLDS,
      frontBackDistance: o.frontBackDistance ?? 30,
      duplicateFound: o.duplicateFound ?? false,
    },
  });
}
