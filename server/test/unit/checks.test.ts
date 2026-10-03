import { describe, expect, it } from 'vitest';
import { ageAtIssuePlausible } from '../../src/modules/checks/age-at-issue-plausible.js';
import { categoriesValid } from '../../src/modules/checks/categories-valid.js';
import { categoryDatesConsistent } from '../../src/modules/checks/category-dates-consistent.js';
import { countryMatchesHint } from '../../src/modules/checks/country-matches-hint.js';
import { datesParseable } from '../../src/modules/checks/dates-parseable.js';
import { dobBeforeIssue } from '../../src/modules/checks/dob-before-issue.js';
import { dobPlausible } from '../../src/modules/checks/dob-plausible.js';
import { documentDetected } from '../../src/modules/checks/document-detected.js';
import { documentNumberReused } from '../../src/modules/checks/document-number-reused.js';
import { duplicateImage } from '../../src/modules/checks/duplicate-image.js';
import { expiryNotPassed } from '../../src/modules/checks/expiry-not-passed.js';
import {
  frontBackConsistent,
  levenshtein,
} from '../../src/modules/checks/front-back-consistent.js';
import { frontBackSameImage } from '../../src/modules/checks/front-back-same-image.js';
import { imageBlur } from '../../src/modules/checks/image-blur.js';
import { imageTooBright, imageTooDark } from '../../src/modules/checks/image-exposure.js';
import { imageGlare } from '../../src/modules/checks/image-glare.js';
import { imageResolution } from '../../src/modules/checks/image-resolution.js';
import {
  DATA_CHECKS,
  IMAGE_CHECKS,
  emptyDocument,
  runChecks,
} from '../../src/modules/checks/index.js';
import { issueBeforeExpiry } from '../../src/modules/checks/issue-before-expiry.js';
import { issueDateNotFuture } from '../../src/modules/checks/issue-date-not-future.js';
import { issuingAuthorityKnown } from '../../src/modules/checks/issuing-authority-known.js';
import { licenseNumberFormat } from '../../src/modules/checks/license-number-format.js';
import { minAge } from '../../src/modules/checks/min-age.js';
import { minRemainingValidity } from '../../src/modules/checks/min-remaining-validity.js';
import { minYearsHeld } from '../../src/modules/checks/min-years-held.js';
import { requiredCategoriesHeld } from '../../src/modules/checks/required-categories-held.js';
import { requiredFieldsPresent } from '../../src/modules/checks/required-fields-present.js';
import { templateRecognized } from '../../src/modules/checks/template-recognized.js';
import type { Check, CheckContext, ExtractedDocument } from '../../src/modules/checks/types.js';
import { validityPeriodPlausible } from '../../src/modules/checks/validity-period-plausible.js';
import { NO } from '../../src/modules/countries/no.js';
import {
  SPEC_EXAMPLE_PROFILE,
  category,
  field,
  imageCtx,
  invalid,
  lowConfidence,
  makeCtx,
  makeDoc,
  missing,
} from '../helpers/documents.js';

type Expected = 'pass' | 'warn' | 'fail' | 'skipped';
interface Case {
  name: string;
  doc?: ExtractedDocument;
  ctx?: CheckContext;
  expect: Expected;
  reason?: string;
}

function table(check: Check, cases: Case[]) {
  it.each(cases)('$name -> $expect', (c) => {
    const r = check(c.doc ?? makeDoc(), c.ctx ?? makeCtx());
    expect(r.status).toBe(c.expect);
    if (c.reason) expect(r.details?.reason).toBe(c.reason);
  });
}

describe('image quality checks', () => {
  describe('IMAGE_RESOLUTION', () =>
    table(imageResolution, [
      { name: 'large enough', ctx: imageCtx(), expect: 'pass' },
      {
        name: 'front too small',
        ctx: imageCtx({ front: { width: 800, height: 504 } }),
        expect: 'fail',
      },
      { name: 'no metrics', expect: 'skipped', reason: 'missing_data' },
    ]));

  it('IMAGE_RESOLUTION names both sides', () => {
    const r = imageResolution(
      makeDoc(),
      imageCtx({ front: { width: 500, height: 300 }, back: { width: 500, height: 300 } }),
    );
    expect(r.details?.side).toBe('both');
  });

  describe('IMAGE_BLUR', () =>
    table(imageBlur, [
      { name: 'sharp', ctx: imageCtx(), expect: 'pass' },
      { name: 'blurred back', ctx: imageCtx({ back: { blurVariance: 10 } }), expect: 'fail' },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  describe('IMAGE_GLARE', () =>
    table(imageGlare, [
      { name: 'no glare', ctx: imageCtx(), expect: 'pass' },
      { name: 'glare front', ctx: imageCtx({ front: { glareRatio: 0.2 } }), expect: 'warn' },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  it('IMAGE_GLARE reports side like the SPEC example', () => {
    const r = imageGlare(makeDoc(), imageCtx({ front: { glareRatio: 0.2 } }));
    expect(r).toMatchObject({
      severity: 'major',
      details: { side: 'front' },
      message: 'Glare detected on front image.',
    });
    expect(
      imageGlare(makeDoc(), imageCtx({ front: { glareRatio: 0.2 }, back: { glareRatio: 0.2 } }))
        .details?.side,
    ).toBe('both');
  });

  describe('IMAGE_TOO_DARK', () =>
    table(imageTooDark, [
      { name: 'normal', ctx: imageCtx(), expect: 'pass' },
      {
        name: 'dark',
        ctx: imageCtx({ front: { meanLuminance: 20 }, back: { meanLuminance: 20 } }),
        expect: 'fail',
      },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  describe('IMAGE_TOO_BRIGHT', () =>
    table(imageTooBright, [
      { name: 'normal', ctx: imageCtx(), expect: 'pass' },
      { name: 'bright', ctx: imageCtx({ back: { meanLuminance: 250 } }), expect: 'fail' },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  describe('DOCUMENT_NOT_DETECTED', () =>
    table(documentDetected, [
      { name: 'ID-1 card', ctx: imageCtx(), expect: 'pass' },
      {
        name: 'portrait card still ID-1',
        ctx: imageCtx({ front: { aspectRatio: 1 / 1.586 } }),
        expect: 'pass',
      },
      { name: 'not detected', ctx: imageCtx({ front: { detected: false } }), expect: 'fail' },
      { name: 'wrong aspect', ctx: imageCtx({ back: { aspectRatio: 1.33 } }), expect: 'fail' },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  describe('FRONT_BACK_SAME_IMAGE', () =>
    table(frontBackSameImage, [
      { name: 'different', ctx: imageCtx({ frontBackDistance: 30 }), expect: 'pass' },
      { name: 'same', ctx: imageCtx({ frontBackDistance: 2 }), expect: 'fail' },
      { name: 'no metrics', expect: 'skipped' },
    ]));

  describe('DUPLICATE_IMAGE', () =>
    table(duplicateImage, [
      { name: 'unique', ctx: imageCtx(), expect: 'pass' },
      { name: 'duplicate', ctx: imageCtx({ duplicateFound: true }), expect: 'warn' },
      { name: 'no metrics', expect: 'skipped' },
    ]));
});

describe('data presence and format checks', () => {
  describe('TEMPLATE_RECOGNIZED', () =>
    table(templateRecognized, [
      { name: 'matched', expect: 'pass' },
      {
        name: 'no template',
        doc: makeDoc({}, { template: null }),
        ctx: makeCtx({ templateScore: 0.2 }),
        expect: 'fail',
      },
      { name: 'no template, no score', doc: makeDoc({}, { template: null }), expect: 'fail' },
    ]));

  describe('REQUIRED_FIELDS_PRESENT', () =>
    table(requiredFieldsPresent, [
      { name: 'all present', expect: 'pass' },
      { name: 'surname absent', doc: makeDoc({ surname: missing() }), expect: 'fail' },
      {
        name: 'dob low confidence',
        doc: makeDoc({ date_of_birth: lowConfidence() }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
      {
        name: 'invalid date is present (DATES_PARSEABLE owns it)',
        doc: makeDoc({ issue_date: invalid() }),
        expect: 'pass',
      },
    ]));

  describe('LICENSE_NUMBER_FORMAT', () =>
    table(licenseNumberFormat, [
      { name: 'matches', expect: 'pass' },
      { name: 'wrong format', doc: makeDoc({ license_number: field('AB12') }), expect: 'fail' },
      {
        name: 'low confidence',
        doc: makeDoc({ license_number: lowConfidence() }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
      {
        name: 'pattern unknown (shipped NO profile)',
        ctx: makeCtx({ profile: NO }),
        expect: 'skipped',
        reason: 'rule_unknown',
      },
    ]));

  describe('DATES_PARSEABLE', () =>
    table(datesParseable, [
      { name: 'valid', expect: 'pass' },
      { name: 'impossible expiry', doc: makeDoc({ expiry_date: invalid() }), expect: 'fail' },
      {
        name: 'invalid category date',
        doc: makeDoc({}, { categories: [{ ...category('B', null, null), invalid_dates: true }] }),
        expect: 'fail',
      },
    ]));

  describe('CATEGORIES_VALID', () =>
    table(categoriesValid, [
      { name: 'known', expect: 'pass' },
      {
        name: 'unknown code',
        doc: makeDoc({}, { categories: [category('ZZ', null, null)] }),
        expect: 'fail',
      },
      { name: 'no categories', doc: makeDoc({}, { categories: [] }), expect: 'skipped' },
      {
        name: 'list unknown',
        ctx: makeCtx({ profile: NO }),
        expect: 'skipped',
        reason: 'rule_unknown',
      },
    ]));

  describe('ISSUING_AUTHORITY_KNOWN', () =>
    table(issuingAuthorityKnown, [
      { name: 'known', expect: 'pass' },
      { name: 'unknown', doc: makeDoc({ issuing_authority: field('ACME DMV') }), expect: 'fail' },
      { name: 'missing', doc: makeDoc({ issuing_authority: missing() }), expect: 'skipped' },
      {
        name: 'no profile',
        ctx: makeCtx({ profile: null }),
        expect: 'skipped',
        reason: 'rule_unknown',
      },
      {
        name: 'empty pattern list',
        ctx: makeCtx({ profile: { ...SPEC_EXAMPLE_PROFILE, issuingAuthorityPatterns: [] } }),
        expect: 'skipped',
      },
    ]));

  describe('COUNTRY_MATCHES_HINT', () =>
    table(countryMatchesHint, [
      { name: 'match', ctx: makeCtx({ countryHint: 'NO' }), expect: 'pass' },
      { name: 'mismatch', ctx: makeCtx({ countryHint: 'SE' }), expect: 'warn' },
      { name: 'no hint', expect: 'skipped', reason: 'not_requested' },
      {
        name: 'no detection',
        ctx: makeCtx({ countryHint: 'NO', detectedCountry: null }),
        expect: 'skipped',
      },
    ]));
});

describe('date logic checks', () => {
  describe('EXPIRY_NOT_PASSED', () =>
    table(expiryNotPassed, [
      { name: 'valid', expect: 'pass' },
      {
        name: 'expires today is still valid',
        doc: makeDoc({ expiry_date: field('2026-10-03') }),
        expect: 'pass',
      },
      {
        name: 'expired yesterday',
        doc: makeDoc({ expiry_date: field('2026-10-02') }),
        expect: 'fail',
      },
      {
        name: 'low confidence',
        doc: makeDoc({ expiry_date: lowConfidence() }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
      {
        name: 'missing',
        doc: makeDoc({ expiry_date: missing() }),
        expect: 'skipped',
        reason: 'missing_data',
      },
    ]));

  describe('MIN_REMAINING_VALIDITY', () =>
    table(minRemainingValidity, [
      {
        name: 'enough',
        ctx: makeCtx({ requirements: { min_remaining_validity_days: 30 } }),
        expect: 'pass',
      },
      {
        name: 'too short',
        doc: makeDoc({ expiry_date: field('2026-10-20') }),
        ctx: makeCtx({ requirements: { min_remaining_validity_days: 30 } }),
        expect: 'fail',
      },
      { name: 'not requested', expect: 'skipped', reason: 'not_requested' },
      {
        name: 'missing expiry',
        doc: makeDoc({ expiry_date: missing() }),
        ctx: makeCtx({ requirements: { min_remaining_validity_days: 0 } }),
        expect: 'skipped',
      },
    ]));

  describe('ISSUE_DATE_NOT_FUTURE', () =>
    table(issueDateNotFuture, [
      { name: 'past', expect: 'pass' },
      { name: 'today', doc: makeDoc({ issue_date: field('2026-10-03') }), expect: 'pass' },
      { name: 'future', doc: makeDoc({ issue_date: field('2026-10-04') }), expect: 'fail' },
      { name: 'missing', doc: makeDoc({ issue_date: missing() }), expect: 'skipped' },
    ]));

  describe('ISSUE_BEFORE_EXPIRY', () =>
    table(issueBeforeExpiry, [
      { name: 'ordered', expect: 'pass' },
      {
        name: 'same day',
        doc: makeDoc({ issue_date: field('2030-01-01'), expiry_date: field('2030-01-01') }),
        expect: 'fail',
      },
      {
        name: 'reversed',
        doc: makeDoc({ issue_date: field('2031-01-01'), expiry_date: field('2030-01-01') }),
        expect: 'fail',
      },
      { name: 'missing', doc: makeDoc({ expiry_date: missing() }), expect: 'skipped' },
    ]));

  describe('VALIDITY_PERIOD_PLAUSIBLE', () =>
    table(validityPeriodPlausible, [
      { name: '15 years', expect: 'pass' },
      {
        name: 'within tolerance',
        doc: makeDoc({ expiry_date: field('2036-06-20') }),
        expect: 'pass',
      },
      { name: 'too long', doc: makeDoc({ expiry_date: field('2040-06-01') }), expect: 'fail' },
      {
        name: 'older holder gets shorter validity',
        doc: makeDoc({
          date_of_birth: field('1940-01-01'),
          issue_date: field('2021-06-01'),
          expiry_date: field('2031-06-01'),
        }),
        expect: 'fail',
      },
      {
        name: 'older holder within 5 years',
        doc: makeDoc({
          date_of_birth: field('1940-01-01'),
          issue_date: field('2021-06-01'),
          expiry_date: field('2026-06-01'),
        }),
        expect: 'pass',
      },
      {
        name: 'rule unknown',
        ctx: makeCtx({ profile: NO }),
        expect: 'skipped',
        reason: 'rule_unknown',
      },
      {
        name: 'missing dob',
        doc: makeDoc({ date_of_birth: lowConfidence() }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
    ]));

  describe('DOB_PLAUSIBLE', () =>
    table(dobPlausible, [
      { name: 'adult', expect: 'pass' },
      { name: 'future', doc: makeDoc({ date_of_birth: field('2027-01-01') }), expect: 'fail' },
      { name: 'today', doc: makeDoc({ date_of_birth: field('2026-10-03') }), expect: 'fail' },
      { name: 'age 10', doc: makeDoc({ date_of_birth: field('2016-01-01') }), expect: 'fail' },
      { name: 'age 120', doc: makeDoc({ date_of_birth: field('1906-01-01') }), expect: 'fail' },
      {
        name: 'exactly 14 today',
        doc: makeDoc({ date_of_birth: field('2012-10-03') }),
        expect: 'pass',
      },
      { name: 'missing', doc: makeDoc({ date_of_birth: missing() }), expect: 'skipped' },
    ]));

  describe('DOB_BEFORE_ISSUE', () =>
    table(dobBeforeIssue, [
      { name: 'ordered', expect: 'pass' },
      {
        name: 'dob after issue',
        doc: makeDoc({ date_of_birth: field('2022-01-01') }),
        expect: 'fail',
      },
      { name: 'missing', doc: makeDoc({ issue_date: missing() }), expect: 'skipped' },
    ]));

  describe('AGE_AT_ISSUE_PLAUSIBLE', () =>
    table(ageAtIssuePlausible, [
      { name: 'old enough', expect: 'pass' },
      {
        name: 'underage for B',
        doc: makeDoc({ date_of_birth: field('2005-01-01'), issue_date: field('2021-06-01') }),
        expect: 'fail',
      },
      {
        name: 'rule unknown',
        ctx: makeCtx({ profile: NO }),
        expect: 'skipped',
        reason: 'rule_unknown',
      },
      {
        name: 'only unknown categories',
        doc: makeDoc({}, { categories: [category('ZZ', null, null)] }),
        expect: 'skipped',
      },
      {
        name: 'dob low confidence',
        doc: makeDoc({ date_of_birth: lowConfidence() }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
    ]));

  describe('CATEGORY_DATES_CONSISTENT', () =>
    table(categoryDatesConsistent, [
      { name: 'consistent', expect: 'pass' },
      {
        name: 'category first issue after card issue',
        doc: makeDoc({}, { categories: [category('B', '2022-01-01', '2036-06-01')] }),
        expect: 'fail',
      },
      {
        name: 'category issued below min age',
        doc: makeDoc({}, { categories: [category('B', '2005-01-01', '2036-06-01')] }),
        expect: 'fail',
      },
      {
        name: 'category expiry after card expiry',
        doc: makeDoc({}, { categories: [category('B', '2008-05-10', '2040-01-01')] }),
        expect: 'fail',
      },
      { name: 'no categories', doc: makeDoc({}, { categories: [] }), expect: 'skipped' },
      {
        name: 'nothing to compare',
        doc: makeDoc({}, { categories: [category('B', null, null)] }),
        expect: 'skipped',
        reason: 'missing_data',
      },
      {
        name: 'nothing to compare, low confidence',
        doc: makeDoc(
          {
            issue_date: lowConfidence(),
            expiry_date: lowConfidence(),
            date_of_birth: lowConfidence(),
          },
          { categories: [category('B', '2008-05-10', '2036-06-01')] },
        ),
        expect: 'skipped',
        reason: 'low_confidence',
      },
    ]));

  describe('MIN_AGE', () =>
    table(minAge, [
      { name: 'adult', ctx: makeCtx({ requirements: { min_age: 18 } }), expect: 'pass' },
      { name: 'too young', ctx: makeCtx({ requirements: { min_age: 40 } }), expect: 'fail' },
      {
        name: 'birthday today counts',
        doc: makeDoc({ date_of_birth: field('2008-10-03') }),
        ctx: makeCtx({ requirements: { min_age: 18 } }),
        expect: 'pass',
      },
      {
        name: 'birthday tomorrow does not',
        doc: makeDoc({ date_of_birth: field('2008-10-04') }),
        ctx: makeCtx({ requirements: { min_age: 18 } }),
        expect: 'fail',
      },
      { name: 'not requested', expect: 'skipped', reason: 'not_requested' },
      {
        name: 'dob low confidence',
        doc: makeDoc({ date_of_birth: lowConfidence() }),
        ctx: makeCtx({ requirements: { min_age: 18 } }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
    ]));

  describe('REQUIRED_CATEGORIES_HELD', () =>
    table(requiredCategoriesHeld, [
      {
        name: 'held',
        ctx: makeCtx({ requirements: { required_categories: ['b'] } }),
        expect: 'pass',
      },
      {
        name: 'missing category',
        ctx: makeCtx({ requirements: { required_categories: ['C'] } }),
        expect: 'fail',
      },
      {
        name: 'category expired',
        doc: makeDoc({}, { categories: [category('B', '2008-05-10', '2020-01-01')] }),
        ctx: makeCtx({ requirements: { required_categories: ['B'] } }),
        expect: 'fail',
      },
      {
        name: 'falls back to card expiry',
        doc: makeDoc({}, { categories: [category('B', '2008-05-10', null)] }),
        ctx: makeCtx({ requirements: { required_categories: ['B'] } }),
        expect: 'pass',
      },
      {
        name: 'expiry unknown',
        doc: makeDoc(
          { expiry_date: lowConfidence() },
          { categories: [category('B', '2008-05-10', null)] },
        ),
        ctx: makeCtx({ requirements: { required_categories: ['B'] } }),
        expect: 'skipped',
        reason: 'low_confidence',
      },
      {
        name: 'expiry missing',
        doc: makeDoc(
          { expiry_date: missing() },
          { categories: [category('B', '2008-05-10', null)] },
        ),
        ctx: makeCtx({ requirements: { required_categories: ['B'] } }),
        expect: 'skipped',
        reason: 'missing_data',
      },
      { name: 'not requested', expect: 'skipped', reason: 'not_requested' },
      {
        name: 'no categories extracted',
        doc: makeDoc({}, { categories: [] }),
        ctx: makeCtx({ requirements: { required_categories: ['B'] } }),
        expect: 'skipped',
      },
    ]));

  describe('MIN_YEARS_HELD', () =>
    table(minYearsHeld, [
      {
        name: 'held long enough',
        ctx: makeCtx({ requirements: { min_years_held: 2, required_categories: ['B'] } }),
        expect: 'pass',
      },
      {
        name: 'any category when none required',
        ctx: makeCtx({ requirements: { min_years_held: 2 } }),
        expect: 'pass',
      },
      {
        name: 'too recent',
        ctx: makeCtx({ requirements: { min_years_held: 30 } }),
        expect: 'fail',
      },
      { name: 'not requested', expect: 'skipped' },
      {
        name: 'zero years is not a requirement',
        ctx: makeCtx({ requirements: { min_years_held: 0 } }),
        expect: 'skipped',
      },
      {
        name: 'no dates',
        doc: makeDoc({}, { categories: [category('B', null, null)] }),
        ctx: makeCtx({ requirements: { min_years_held: 2 } }),
        expect: 'skipped',
      },
    ]));
});

describe('cross-consistency checks', () => {
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  describe('FRONT_BACK_CONSISTENT', () =>
    table(frontBackConsistent, [
      {
        name: 'one char OCR difference tolerated',
        doc: makeDoc({}, { back: { license_number: field('12345678907'), surname: null } }),
        expect: 'pass',
      },
      {
        name: 'mismatch',
        doc: makeDoc(
          {},
          { back: { license_number: field('99999999999'), surname: field('HANSEN') } },
        ),
        expect: 'fail',
      },
      { name: 'back repeats nothing', expect: 'skipped', reason: 'not_applicable' },
    ]));

  describe('DOCUMENT_NUMBER_REUSED', () =>
    table(documentNumberReused, [
      { name: 'unique', ctx: makeCtx({ reuse: { conflictingSessions: 0 } }), expect: 'pass' },
      { name: 'reused', ctx: makeCtx({ reuse: { conflictingSessions: 2 } }), expect: 'warn' },
      { name: 'not computed', expect: 'skipped' },
    ]));
});

describe('check registry', () => {
  it('a clean document passes every applicable data check', () => {
    const results = runChecks(
      DATA_CHECKS,
      makeDoc(),
      makeCtx({ requirements: { min_age: 18, required_categories: ['B'] } }),
    );
    expect(results.filter((r) => r.status === 'fail' || r.status === 'warn')).toEqual([]);
  });

  it('empty document fails critical presence checks', () => {
    const results = runChecks(DATA_CHECKS, emptyDocument(), makeCtx());
    const failed = results.filter((r) => r.status === 'fail').map((r) => r.code);
    expect(failed).toEqual(
      expect.arrayContaining(['TEMPLATE_RECOGNIZED', 'REQUIRED_FIELDS_PRESENT']),
    );
  });

  it('every check code appears once', () => {
    const codes = [...IMAGE_CHECKS, ...DATA_CHECKS].map((c) => c(makeDoc(), imageCtx()).code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
