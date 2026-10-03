import type { CountryProfile } from './country-profile.js';

/**
 * Norway.
 *
 * Status: NOT production ready. SPEC 6.4 gives example values for licenseNumberPattern,
 * maxValidityYears, minAgeByCategory and validCategories, but marks them as placeholders that
 * must be confirmed against official specimens and regulations. They have not been confirmed,
 * so they are null here and the dependent checks are skipped. When a value is confirmed, set it
 * and add the source (document, section, date checked) next to it.
 *
 * Unconfirmed SPEC placeholders, for reference only:
 *   licenseNumberPattern: /^\d{11}$/
 *   maxValidityYears: { default: 15, over: [{ age: 75, years: 5 }] }
 *   minAgeByCategory: { AM: 16, A1: 16, A2: 18, A: 24, B: 18, BE: 18, C1: 18, C: 21, D: 24 }
 *   validCategories: AM A1 A2 A B BE C1 C1E C CE D1 D1E D DE T S
 */
export const NO: CountryProfile = {
  code: 'NO',
  name: 'Norway',
  // Source: 1968 Vienna Convention on Road Traffic, distinguishing sign of Norway is "N".
  distinguishingSign: 'N',
  // "Førerkort" is the Norwegian word printed as the card title. Detection hint only.
  titleKeywords: ['FØRERKORT', 'FORERKORT', 'NORGE', 'NOREG'],
  // Source: Directive 2006/126/EC Annex I (dates written as dd.mm.yy(yy)); confirm on specimen.
  dateFormat: 'dd.MM.yyyy',
  licenseNumberPattern: null,
  personalNumberPattern: null,
  // Statens vegvesen (Norwegian Public Roads Administration) issues Norwegian licenses.
  // Detection and ISSUING_AUTHORITY_KNOWN only; confirm the printed form on a specimen.
  issuingAuthorityPatterns: [/STATENS\s*VEGVESEN/i],
  maxValidityYears: null,
  validityToleranceDays: 31,
  minAgeByCategory: null,
  validCategories: null,
};
