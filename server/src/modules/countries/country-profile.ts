/**
 * Country-specific rules applied on top of a template (SPEC 6.4). Profiles are configuration.
 *
 * Rule: never invent a regulatory value. Anything not confirmed against an official source is
 * null, and the checks that depend on it return `skipped` with reason `rule_unknown`. Every
 * confirmed value carries a source comment in the profile file.
 */
export interface CountryProfile {
  code: string;
  name: string;
  /** International distinguishing sign printed in the blue band (for example "N"). */
  distinguishingSign: string | null;
  /** Words printed on the card that identify the country (used for detection only). */
  titleKeywords: string[];
  /** date-fns format of dates printed on the card. */
  dateFormat: string;
  licenseNumberPattern: RegExp | null;
  personalNumberPattern: RegExp | null;
  issuingAuthorityPatterns: RegExp[] | null;
  maxValidityYears: { default: number; over: { age: number; years: number }[] } | null;
  /** Slack added to the maximum validity period. */
  validityToleranceDays: number;
  minAgeByCategory: Record<string, number> | null;
  validCategories: string[] | null;
}
