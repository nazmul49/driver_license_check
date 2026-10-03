import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_CARD, iso, renderCard, type CardData, type Variant } from './synthetic-card.js';

/**
 * Generates server/test/fixtures/synthetic/<name>/{front.jpg,back.jpg,expected.json}.
 * expected.json holds the printed values and the check that must fail (SPEC 17), evaluated
 * with "today" = 2026-10-03 and the SPEC 6.4 example profile used by the tests.
 */
interface FixtureSpec {
  name: string;
  card?: Partial<CardData>;
  variant?: Variant;
  backVariant?: Variant;
  sameImage?: boolean;
  expectFail?: string[];
  expectWarn?: string[];
  expectDecision?: 'approved' | 'review' | 'rejected';
  /** Include in the field-accuracy measurement. */
  accuracy?: boolean;
}

const FIXTURES: FixtureSpec[] = [
  { name: 'valid', expectDecision: 'approved', accuracy: true },
  {
    name: 'valid-multi-category',
    card: {
      surname: 'HANSEN',
      givenNames: 'KARI ANNE',
      dob: '03.11.1985',
      placeOfBirth: 'BERGEN',
      issueDate: '15.03.2019',
      expiryDate: '15.03.2034',
      licenseNumber: '98765432109',
      categories: [
        { code: 'B', issue: '20.12.2003', expiry: '15.03.2034' },
        { code: 'BE', issue: '04.05.2010', expiry: '15.03.2034' },
      ],
    },
    expectDecision: 'approved',
    accuracy: true,
  },
  {
    name: 'rotated-180',
    variant: { rotate: 180 },
    backVariant: { rotate: 180 },
    expectDecision: 'approved',
    accuracy: true,
  },
  {
    name: 'small-card',
    variant: { cardWidth: 1150 },
    backVariant: { cardWidth: 1150 },
    expectDecision: 'approved',
    accuracy: true,
  },
  {
    name: 'expired',
    card: {
      issueDate: '01.06.2009',
      expiryDate: '01.06.2024',
      categories: [{ code: 'B', issue: '10.05.2008', expiry: '01.06.2024' }],
    },
    expectFail: ['EXPIRY_NOT_PASSED'],
    expectDecision: 'rejected',
    accuracy: true,
  },
  {
    name: 'issue-in-future',
    card: { issueDate: '01.06.2027', expiryDate: '01.06.2036' },
    expectFail: ['ISSUE_DATE_NOT_FUTURE'],
    expectDecision: 'rejected',
    accuracy: true,
  },
  {
    name: 'issue-after-expiry',
    card: {
      issueDate: '01.06.2026',
      expiryDate: '01.06.2025',
      categories: [{ code: 'B', issue: '10.05.2008', expiry: '01.06.2025' }],
    },
    expectFail: ['ISSUE_BEFORE_EXPIRY'],
    expectDecision: 'rejected',
    accuracy: true,
  },
  {
    name: 'dob-after-issue',
    card: { dob: '12.04.2022' },
    expectFail: ['DOB_BEFORE_ISSUE'],
    expectDecision: 'rejected',
    accuracy: true,
  },
  {
    name: 'underage-for-category',
    card: {
      dob: '12.04.2005',
      issueDate: '01.06.2021',
      expiryDate: '01.06.2036',
      categories: [{ code: 'B', issue: '01.06.2021', expiry: '01.06.2036' }],
    },
    expectFail: ['AGE_AT_ISSUE_PLAUSIBLE', 'CATEGORY_DATES_CONSISTENT'],
    expectDecision: 'review',
    accuracy: true,
  },
  {
    name: 'unknown-category',
    card: {
      categories: [
        { code: 'B', issue: '10.05.2008', expiry: '01.06.2036' },
        { code: 'X', issue: '10.05.2010', expiry: '01.06.2036' },
      ],
    },
    expectFail: ['CATEGORIES_VALID'],
    expectDecision: 'review',
    accuracy: true,
  },
  {
    name: 'wrong-license-format',
    card: { licenseNumber: 'AB 12' },
    expectFail: ['LICENSE_NUMBER_FORMAT'],
    expectDecision: 'review',
    accuracy: true,
  },
  {
    name: 'blurred',
    variant: { blur: 9 },
    backVariant: { blur: 9 },
    expectFail: ['IMAGE_BLUR'],
    expectDecision: 'rejected',
  },
  {
    name: 'front-equals-back',
    sameImage: true,
    expectFail: ['FRONT_BACK_SAME_IMAGE'],
    expectDecision: 'rejected',
  },
  { name: 'glare', variant: { glare: true }, expectWarn: ['IMAGE_GLARE'] },
  {
    name: 'too-dark',
    variant: { dark: true },
    backVariant: { dark: true },
    expectFail: ['IMAGE_TOO_DARK'],
    expectDecision: 'rejected',
  },
];

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/synthetic',
);

for (const f of FIXTURES) {
  const card: CardData = { ...BASE_CARD, ...f.card };
  const { front, back } = await renderCard(card, f.variant ?? {}, f.backVariant ?? {});
  const dir = path.join(root, f.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'front.jpg'), front);
  await writeFile(path.join(dir, 'back.jpg'), f.sameImage ? front : back);
  const expected = {
    name: f.name,
    accuracy: f.accuracy ?? false,
    fields: {
      surname: card.surname,
      given_names: card.givenNames,
      date_of_birth: iso(card.dob),
      place_of_birth: card.placeOfBirth,
      issue_date: iso(card.issueDate),
      expiry_date: iso(card.expiryDate),
      issuing_authority: card.authority,
      license_number: card.licenseNumber.replace(/[^A-Z0-9]/g, ''),
      categories: card.categories.map((c) => ({
        code: c.code,
        issue_date: iso(c.issue),
        expiry_date: iso(c.expiry),
      })),
    },
    expect_fail: f.expectFail ?? [],
    expect_warn: f.expectWarn ?? [],
    expect_decision: f.expectDecision ?? null,
  };
  await writeFile(path.join(dir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`wrote ${f.name}`);
}
