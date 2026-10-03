import { describe, expect, it } from 'vitest';
import type { OcrLine, OcrResult } from '../../src/modules/ocr/ocr.types.js';
import { detectCountry } from '../../src/modules/countries/detect-country.js';
import { NO } from '../../src/modules/countries/no.js';
import { detectTemplate, euCardV1, parseZoneValue } from '../../src/modules/templates/index.js';
import { findDate, makeField } from '../../src/modules/templates/text-utils.js';

const bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
function line(text: string, confidence = 0.95): OcrLine {
  return {
    text,
    confidence,
    bbox,
    words: text
      .split(' ')
      .filter(Boolean)
      .map((w) => ({ text: w, confidence, bbox })),
  };
}
function ocr(lines: string[], confidence = 0.95): OcrResult {
  return { text: lines.join('\n'), confidence, lines: lines.map((l) => line(l, confidence)) };
}

const FRONT = ocr([
  'FØRERKORT NORGE',
  '1. NORDMANN',
  '2. OLA',
  '3. 12.04.1990 OSLO',
  '4a. 01.06.2021',
  '4b. 01.06.2036',
  '4c. STATENS VEGVESEN',
  '5. 12345678901',
  '9.B',
  'N',
]);
const BACK = ocr([
  '9. 10. 11. 12.',
  'B 10.05.2008 01.06.2036 78',
  'BE 04.05.2010 01.06.2036',
  'AM',
  'C1',
]);
const ctx = { profile: NO, minConfidence: 0.6, today: '2026-10-03' };

describe('eu-card-v1 template', () => {
  it('is detected from the numbered labels', () => {
    expect(detectTemplate(FRONT)).toMatchObject({ template: euCardV1 });
    expect(detectTemplate(ocr(['hello world', 'nothing here'])).template).toBeNull();
  });

  it('parses front fields and the back category table', () => {
    const doc = euCardV1.parse(FRONT, BACK, ctx);
    const values = Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, v.value]));
    expect(values).toEqual({
      surname: 'NORDMANN',
      given_names: 'OLA',
      date_of_birth: '1990-04-12',
      place_of_birth: 'OSLO',
      issue_date: '2021-06-01',
      expiry_date: '2036-06-01',
      issuing_authority: 'STATENS VEGVESEN',
      license_number: '12345678901',
    });
    expect(doc.categories).toEqual([
      expect.objectContaining({
        code: 'B',
        issue_date: '2008-05-10',
        expiry_date: '2036-06-01',
        restrictions: ['78'],
      }),
      expect.objectContaining({ code: 'BE', issue_date: '2010-05-04', expiry_date: '2036-06-01' }),
    ]);
  });

  it('handles labels sharing a line and OCR confusions in dates', () => {
    const front = ocr([
      '1. NORDMANN 2. OLA',
      '3. 12.O4.199O OSLO',
      '4a. 01-06-2021 4c. STATENS VEGVESEN',
      '4b. 0l.06.2036',
      '5. 1234 5678 901',
    ]);
    const doc = euCardV1.parse(front, ocr([]), ctx);
    expect(doc.fields.surname.value).toBe('NORDMANN');
    expect(doc.fields.given_names.value).toBe('OLA');
    expect(doc.fields.date_of_birth.value).toBe('1990-04-12');
    expect(doc.fields.issue_date.value).toBe('2021-06-01');
    expect(doc.fields.issuing_authority.value).toBe('STATENS VEGVESEN');
    expect(doc.fields.expiry_date.value).toBe('2036-06-01');
    expect(doc.fields.license_number.value).toBe('12345678901');
  });

  it('marks impossible dates invalid and low confidence fields null', () => {
    const front = ocr(['1. NORDMANN', '3. 31.02.1990 OSLO', '4a. 01.06.2021']);
    const doc = euCardV1.parse(front, ocr([]), ctx);
    expect(doc.fields.date_of_birth).toMatchObject({ value: null, invalid: true, present: true });
    const blurry = euCardV1.parse(ocr(['1. NORDMANN', '4b. 01.06.2036'], 0.4), ocr([]), ctx);
    expect(blurry.fields.surname).toMatchObject({
      value: null,
      low_confidence: true,
      present: true,
    });
    expect(blurry.fields.license_number).toMatchObject({ value: null, present: false });
  });

  it('falls back to front field 9 when the back table has no dates', () => {
    const doc = euCardV1.parse(FRONT, ocr(['AM', 'B']), ctx);
    expect(doc.categories.map((c) => c.code)).toEqual(['B']);
    expect(doc.categories[0]!.issue_date).toBeNull();
  });

  it('parses zone OCR results', () => {
    expect(parseZoneValue('expiry_date', ocr(['4b. 01.06.2036']), ctx).value).toBe('2036-06-01');
    expect(parseZoneValue('license_number', ocr(['5. 12345678901']), ctx).value).toBe(
      '12345678901',
    );
    expect(parseZoneValue('issue_date', ocr(['garbage']), ctx).value).toBeNull();
  });
});

describe('text utils', () => {
  it('two-digit years keep birth dates in the past', () => {
    expect(findDate('12.04.90', 'dd.MM.yy', '2026-10-03', 'birth')?.value).toBe('1990-04-12');
    expect(findDate('12.04.10', 'dd.MM.yy', '2026-10-03', 'birth')?.value).toBe('2010-04-12');
    expect(findDate('12.04.36', 'dd.MM.yy', '2026-10-03', 'other')?.value).toBe('2036-04-12');
    expect(findDate('12.04.199', 'dd.MM.yyyy', '2026-10-03', 'other')).toMatchObject({
      invalid: true,
    });
    expect(findDate('no date', 'dd.MM.yyyy', '2026-10-03', 'other')).toBeNull();
  });
  it('makeField applies the confidence threshold', () => {
    expect(makeField('X', 0.5, 0.6)).toMatchObject({ value: null, low_confidence: true });
    expect(makeField('X', 0.7, 0.6)).toMatchObject({ value: 'X', low_confidence: false });
    expect(makeField(null, 0, 0.6)).toMatchObject({ present: false });
  });
});

describe('country detection', () => {
  it('detects Norway from authority, title and sign', () => {
    expect(detectCountry(FRONT, BACK, null)).toMatchObject({ detected: 'NO', applied: 'NO' });
  });
  it('falls back to the hint only when a profile exists', () => {
    const blank = ocr(['1. X']);
    expect(detectCountry(blank, blank, 'NO')).toMatchObject({ detected: null, applied: 'NO' });
    expect(detectCountry(blank, blank, 'ZZ')).toMatchObject({ detected: null, applied: null });
  });
});
