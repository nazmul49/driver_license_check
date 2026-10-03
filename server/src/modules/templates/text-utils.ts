import { format, isValid, parse } from 'date-fns';
import type { ExtractedField } from '../checks/types.js';
import type { OcrLine } from '../ocr/ocr.types.js';

/** A line rebuilt from words with per-character word index, so text spans map to confidences. */
export interface IndexedLine {
  text: string;
  wordAt: number[];
  wordConf: number[];
}

export function indexLine(line: OcrLine): IndexedLine {
  let text = '';
  const wordAt: number[] = [];
  const wordConf: number[] = [];
  line.words.forEach((w, i) => {
    if (i > 0) {
      text += ' ';
      wordAt.push(-1);
    }
    text += w.text;
    for (let k = 0; k < w.text.length; k++) wordAt.push(i);
    wordConf.push(w.confidence);
  });
  if (line.words.length === 0) {
    text = line.text;
    for (let k = 0; k < text.length; k++) wordAt.push(0);
    wordConf.push(line.confidence);
  }
  return { text, wordAt, wordConf };
}

/** Mean confidence of the words overlapping [start, end). */
export function spanConfidence(line: IndexedLine, start: number, end: number): number {
  const words = new Set<number>();
  for (let i = start; i < end; i++) if (line.wordAt[i]! >= 0) words.add(line.wordAt[i]!);
  if (words.size === 0) return 0;
  let sum = 0;
  for (const w of words) sum += line.wordConf[w]!;
  return sum / words.size;
}

/** Remove OCR noise characters and normalize spacing and case (SPEC 6.1 step 9). */
export function cleanText(s: string): string {
  return s
    .toUpperCase()
    .replace(/[|_~`^"“”'‘’«»*#<>{}[\]\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanName(s: string): string {
  return cleanText(s)
    .replace(/[^A-ZÆØÅÄÖÜÉÈÁÀÓÒÍÌÚÙÑÇ\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fix common OCR confusions inside a date-looking token. */
function repairDateToken(s: string): string {
  return s
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/B/g, '8')
    .replace(/[,\-/:]/g, '.')
    .replace(/\s*\.\s*/g, '.');
}

const DATE_SHAPE =
  /([0-9OoQDIl|!SsB]{1,2})\s*[.,\-/:]\s*([0-9OoQDIl|!SsB]{1,2})\s*[.,\-/:]\s*([0-9OoQDIl|!SsB]{2,4})/;

export interface DateMatch {
  value: string | null;
  invalid: boolean;
  index: number;
  length: number;
}

/**
 * Find the first date-shaped token and parse it with the country's date-fns format. Dates are
 * formatted back from local-time parts, so no timezone conversion happens.
 * Two-digit years resolve to the century that keeps birth dates in the past.
 */
export function findDate(
  text: string,
  dateFormat: string,
  today: string,
  kind: 'birth' | 'other',
): DateMatch | null {
  const m = DATE_SHAPE.exec(text);
  if (!m) return null;
  const [d, mo, yRaw] = [m[1]!, m[2]!, m[3]!].map((p) => repairDateToken(p));
  let year = yRaw!;
  if (year.length === 2) {
    const yy = Number(year);
    const todayYy = Number(today.slice(2, 4));
    year = String(kind === 'birth' && yy > todayYy ? 1900 + yy : 2000 + yy);
  } else if (year.length === 3) {
    return { value: null, invalid: true, index: m.index, length: m[0].length };
  }
  const candidate = `${d!.padStart(2, '0')}.${mo!.padStart(2, '0')}.${year}`;
  // Two-digit years were expanded above, so always parse with a four-digit year pattern.
  const fmt = dateFormat.includes('yyyy') ? dateFormat : dateFormat.replace('yy', 'yyyy');
  const parsed = parse(candidate, fmt, new Date(2000, 0, 1));
  const ok = isValid(parsed) && format(parsed, fmt) === candidate;
  return {
    value: ok ? format(parsed, 'yyyy-MM-dd') : null,
    invalid: !ok,
    index: m.index,
    length: m[0].length,
  };
}

export function emptyField(): ExtractedField {
  return { value: null, confidence: 0, low_confidence: false, present: false, invalid: false };
}

/** Apply FIELD_MIN_CONFIDENCE (SPEC 6.3). */
export function makeField(
  value: string | null,
  confidence: number,
  minConfidence: number,
  opts: { invalid?: boolean } = {},
): ExtractedField {
  const c = Math.max(0, Math.min(1, confidence));
  if (opts.invalid)
    return { value: null, confidence: c, low_confidence: false, present: true, invalid: true };
  if (value === null || value === '')
    return { value: null, confidence: c, low_confidence: c > 0, present: c > 0, invalid: false };
  if (c < minConfidence)
    return { value: null, confidence: c, low_confidence: true, present: true, invalid: false };
  return { value, confidence: c, low_confidence: false, present: true, invalid: false };
}
