import type { CheckCode, CheckStatus, Requirements, Severity } from '@dlc/shared';
import type { CountryProfile } from '../countries/country-profile.js';

export type FieldName =
  | 'surname'
  | 'given_names'
  | 'date_of_birth'
  | 'place_of_birth'
  | 'issue_date'
  | 'expiry_date'
  | 'issuing_authority'
  | 'license_number';

export const DATE_FIELDS = ['date_of_birth', 'issue_date', 'expiry_date'] as const;

export interface ExtractedField {
  /** Normalized value; dates as YYYY-MM-DD. null when absent, invalid, or low confidence. */
  value: string | null;
  confidence: number;
  /** Text was found but confidence is below FIELD_MIN_CONFIDENCE. */
  low_confidence: boolean;
  /** Text was found for the field (regardless of confidence or validity). */
  present: boolean;
  /** Text was found but could not be parsed (for example an impossible date). */
  invalid: boolean;
}

export interface ExtractedCategory {
  code: string;
  issue_date: string | null;
  expiry_date: string | null;
  restrictions: string[];
  confidence: number;
  /** A date column had text that is not a real calendar date. */
  invalid_dates: boolean;
}

export interface ExtractedDocument {
  template: string | null;
  country: string | null;
  fields: Record<FieldName, ExtractedField>;
  categories: ExtractedCategory[];
  /** Values the back side repeats, if the template finds any. */
  back: { license_number: ExtractedField | null; surname: ExtractedField | null };
}

export interface ImageMetrics {
  detected: boolean;
  /** Dimensions of the cropped card (or full image when no card found). */
  width: number;
  height: number;
  aspectRatio: number;
  blurVariance: number;
  glareRatio: number;
  meanLuminance: number;
  phash: string;
}

export interface QualityThresholds {
  minLongEdge: number;
  minBlurVariance: number;
  maxGlareRatio: number;
  minLuminance: number;
  maxLuminance: number;
  aspectTolerance: number;
  phashMaxDistance: number;
}

export interface CheckContext {
  /** Today's date (UTC) as YYYY-MM-DD, from the injected clock. */
  today: string;
  requirements: Requirements;
  profile: CountryProfile | null;
  countryHint: string | null;
  detectedCountry: string | null;
  images?: {
    front: ImageMetrics;
    back: ImageMetrics;
    thresholds: QualityThresholds;
    /** Hamming distance between front and back perceptual hashes. */
    frontBackDistance: number;
    /** True when an image's perceptual hash matches an image from another session. */
    duplicateFound: boolean;
  };
  /** Result of the keyed-hash lookup for DOCUMENT_NUMBER_REUSED; null when not computed. */
  reuse?: { conflictingSessions: number } | null;
  templateScore?: number;
}

export type SkipReason =
  'low_confidence' | 'missing_data' | 'not_requested' | 'rule_unknown' | 'not_applicable';

export interface CheckResult {
  code: CheckCode;
  status: CheckStatus;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
}

export type Check = (doc: ExtractedDocument, ctx: CheckContext) => CheckResult;
