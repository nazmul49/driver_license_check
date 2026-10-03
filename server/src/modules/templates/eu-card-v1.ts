import type {
  ExtractedCategory,
  ExtractedDocument,
  ExtractedField,
  FieldName,
} from '../checks/types.js';
import type { OcrResult } from '../ocr/ocr.types.js';
import type { DocumentTemplate, ParseContext } from './template.types.js';
import {
  cleanName,
  cleanText,
  emptyField,
  findDate,
  indexLine,
  makeField,
  spanConfidence,
  type IndexedLine,
} from './text-utils.js';

/**
 * EU/EEA card licence (Directive 2006/126/EC, ISO/IEC 18013-1 layout). Front fields carry
 * numbered labels: 1 surname, 2 given names, 3 date and place of birth, 4a issue date,
 * 4b expiry date, 4c issuing authority, 4d personal number, 5 licence number, 8 address,
 * 9 categories. The back has a category table with columns 9, 10, 11, 12.
 *
 * Parsing is label driven: the numbered labels are part of the standard, while their position
 * varies between countries. Zones refine individual fields with tuned OCR parameters.
 */

// A label is followed by a space or directly by a letter ("9.B"); never by a digit, so the
// day/month parts of dates such as 12.04.1990 are not mistaken for labels.
const LABEL = /(?:^|\s)(4\s?[a-dA-D]|[1235789])\s?[.,:;](?=\s|$|[A-ZÆØÅ])/g;
const FRONT_LABELS = ['1', '2', '3', '4a', '4b', '4c', '5', '9'];
const TITLE_HINTS =
  /DRIVING\s+LICEN[CS]E|F[ØO]RERKORT|PERMIS\s+DE\s+CONDUIRE|FÜHRERSCHEIN|K[ÖO]RKORT|K[ØO]REKORT|AJOKORTTI|RIJBEWIJS/i;

/**
 * Shape of a category code (AM, A1, B, BE, C1E, national T or S, ...). Whether a code is valid
 * is the country profile's call (CATEGORIES_VALID); the parser only recognises the shape.
 * Back-table rows additionally need at least one date, which filters out OCR noise.
 */
const CATEGORY_TOKEN = /^[A-Z][A-Z0-9]{0,2}$/;
const STOP_WORDS = new Set(['THE', 'OG', 'AND', 'OR']);

interface Segment {
  label: string;
  text: string;
  confidence: number;
}

function segments(lines: IndexedLine[]): Segment[] {
  const out: Segment[] = [];
  for (const line of lines) {
    const matches = [...line.text.matchAll(LABEL)];
    matches.forEach((m, i) => {
      const labelStart = m.index! + m[0].indexOf(m[1]!);
      const valueStart = m.index! + m[0].length;
      const valueEnd = i + 1 < matches.length ? matches[i + 1]!.index! : line.text.length;
      const text = line.text.slice(valueStart, valueEnd).trim();
      if (labelStart < 0) return;
      out.push({
        label: m[1]!.replace(/\s/g, '').toLowerCase(),
        text,
        confidence: text ? spanConfidence(line, valueStart, valueEnd) : 0,
      });
    });
  }
  return out;
}

function firstSegment(segs: Segment[], label: string): Segment | undefined {
  return segs.find((s) => s.label === label && s.text.length > 0);
}

function dateField(seg: Segment | undefined, ctx: ParseContext, kind: 'birth' | 'other') {
  if (!seg) return { field: emptyField(), rest: '' };
  const fmt = ctx.profile?.dateFormat ?? 'dd.MM.yyyy';
  const match = findDate(seg.text, fmt, ctx.today, kind);
  if (!match) return { field: makeField(null, seg.confidence, ctx.minConfidence), rest: seg.text };
  const rest = (
    seg.text.slice(0, match.index) +
    ' ' +
    seg.text.slice(match.index + match.length)
  ).trim();
  return {
    field: makeField(match.value, seg.confidence, ctx.minConfidence, { invalid: match.invalid }),
    rest,
  };
}

function textField(
  seg: Segment | undefined,
  ctx: ParseContext,
  clean: (s: string) => string,
): ExtractedField {
  if (!seg) return emptyField();
  const value = clean(seg.text);
  return makeField(value || null, value ? seg.confidence : seg.confidence * 0.5, ctx.minConfidence);
}

function licenseNumber(seg: Segment | undefined, ctx: ParseContext): ExtractedField {
  if (!seg) return emptyField();
  const value = cleanText(seg.text).replace(/[^A-Z0-9]/g, '');
  return makeField(value || null, seg.confidence, ctx.minConfidence);
}

function parseCategoryCodes(text: string): string[] {
  return cleanText(text)
    .split(/[\s/,;]+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .filter((t) => CATEGORY_TOKEN.test(t) && !STOP_WORDS.has(t));
}

/** Rows of the back table: "<code> <col10 date> <col11 date> <col12 codes>". */
function parseCategoryTable(back: OcrResult, ctx: ParseContext): ExtractedCategory[] {
  const fmt = ctx.profile?.dateFormat ?? 'dd.MM.yyyy';
  const rows = new Map<string, ExtractedCategory>();
  for (const line of back.lines) {
    // Skip the column header row ("9. 10. 11. 12.").
    if (
      (line.text.match(/\b1[0-2]\s?[.,]/g) ?? []).length >= 2 &&
      !/\d{2}[.,]\d{2}[.,]\d{2}/.test(line.text)
    )
      continue;
    const text = cleanText(line.text).replace(/^9\s?[.,]\s*/, '');
    const code = text.split(' ')[0]?.replace(/[^A-Z0-9]/g, '') ?? '';
    if (!CATEGORY_TOKEN.test(code)) continue;
    let rest = text.slice(text.indexOf(' ') + 1);
    const dates: { value: string | null; invalid: boolean }[] = [];
    for (let i = 0; i < 2; i++) {
      const m = findDate(rest, fmt, ctx.today, 'other');
      if (!m) break;
      dates.push(m);
      rest = rest.slice(m.index + m.length);
    }
    // On EU cards every category row is printed; only held categories carry dates.
    if (dates.length === 0) continue;
    const restrictions = rest
      .split(/[\s,;]+/)
      .map((t) => t.replace(/[^0-9.]/g, ''))
      .filter((t) => /^\d{2,3}(\.\d{2})?$/.test(t));
    if (!rows.has(code)) {
      rows.set(code, {
        code,
        issue_date: dates[0]?.value ?? null,
        expiry_date: dates[1]?.value ?? null,
        restrictions,
        confidence: line.confidence,
        invalid_dates: dates.some((d) => d.invalid),
      });
    }
  }
  return [...rows.values()];
}

export const euCardV1: DocumentTemplate = {
  id: 'eu-card-v1',
  version: '1.0.0',
  threshold: 0.5,

  score(front: OcrResult): number {
    const segs = segments(front.lines.map(indexLine));
    const found = new Set(segs.map((s) => s.label));
    const labelScore = FRONT_LABELS.filter((l) => found.has(l)).length / FRONT_LABELS.length;
    const titleBonus = TITLE_HINTS.test(front.text) ? 0.15 : 0;
    return Math.min(1, labelScore + titleBonus);
  },

  // Relative positions on the reference layout used by the synthetic fixtures. Used only to
  // re-read a field whose label-based value is missing or low confidence.
  zones: [
    {
      field: 'date_of_birth',
      side: 'front',
      rect: { x: 0.3, y: 0.36, w: 0.4, h: 0.1 },
      ocr: { psm: '7', whitelist: '0123456789.' },
    },
    {
      field: 'issue_date',
      side: 'front',
      rect: { x: 0.3, y: 0.46, w: 0.35, h: 0.1 },
      ocr: { psm: '7', whitelist: '0123456789.' },
    },
    {
      field: 'expiry_date',
      side: 'front',
      rect: { x: 0.3, y: 0.56, w: 0.35, h: 0.1 },
      ocr: { psm: '7', whitelist: '0123456789.' },
    },
    {
      field: 'license_number',
      side: 'front',
      rect: { x: 0.3, y: 0.76, w: 0.5, h: 0.1 },
      ocr: { psm: '7', whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
    },
  ],

  parse(front: OcrResult, back: OcrResult, ctx: ParseContext): Omit<ExtractedDocument, 'country'> {
    const segs = segments(front.lines.map(indexLine));
    const birth = dateField(firstSegment(segs, '3'), ctx, 'birth');
    const placeConfidence = firstSegment(segs, '3')?.confidence ?? 0;
    const place = cleanName(birth.rest);

    const fields: Record<FieldName, ExtractedField> = {
      surname: textField(firstSegment(segs, '1'), ctx, cleanName),
      given_names: textField(firstSegment(segs, '2'), ctx, cleanName),
      date_of_birth: birth.field,
      place_of_birth: place ? makeField(place, placeConfidence, ctx.minConfidence) : emptyField(),
      issue_date: dateField(firstSegment(segs, '4a'), ctx, 'other').field,
      expiry_date: dateField(firstSegment(segs, '4b'), ctx, 'other').field,
      issuing_authority: textField(firstSegment(segs, '4c'), ctx, cleanText),
      license_number: licenseNumber(firstSegment(segs, '5'), ctx),
    };

    let categories = parseCategoryTable(back, ctx);
    if (categories.length === 0) {
      const seg9 = firstSegment(segs, '9');
      categories = seg9
        ? parseCategoryCodes(seg9.text).map((code) => ({
            code,
            issue_date: null,
            expiry_date: null,
            restrictions: [],
            confidence: seg9.confidence,
            invalid_dates: false,
          }))
        : [];
    }

    const backSegs = segments(back.lines.map(indexLine));
    const backNumber = firstSegment(backSegs, '5');
    return {
      template: this.id,
      fields,
      categories,
      back: {
        license_number: backNumber ? licenseNumber(backNumber, ctx) : null,
        surname: null,
      },
    };
  },
};

/** Re-parse a zone OCR result for one field. */
export function parseZoneValue(
  field: 'date_of_birth' | 'issue_date' | 'expiry_date' | 'license_number',
  zone: OcrResult,
  ctx: ParseContext,
): ExtractedField {
  const conf = zone.confidence;
  const text = zone.lines.map((l) => l.text).join(' ') || zone.text;
  if (field === 'license_number') {
    const value = cleanText(text)
      .replace(/^5\s?[.,]\s*/, '')
      .replace(/[^A-Z0-9]/g, '');
    return makeField(value || null, conf, ctx.minConfidence);
  }
  const m = findDate(
    text,
    ctx.profile?.dateFormat ?? 'dd.MM.yyyy',
    ctx.today,
    field === 'date_of_birth' ? 'birth' : 'other',
  );
  if (!m) return makeField(null, conf, ctx.minConfidence);
  return makeField(m.value, conf, ctx.minConfidence, { invalid: m.invalid });
}
