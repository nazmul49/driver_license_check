import { fail, pass, skip } from './helpers.js';
import type { Check } from './types.js';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ÆØÅÄÖÜ]/g, '');

export const frontBackConsistent: Check = (doc) => {
  const pairs = [
    ['license_number', doc.fields.license_number.value, doc.back.license_number?.value ?? null],
    ['surname', doc.fields.surname.value, doc.back.surname?.value ?? null],
  ] as const;
  const compared = pairs.filter(([, f, b]) => f !== null && b !== null);
  if (compared.length === 0) {
    return skip(
      'FRONT_BACK_CONSISTENT',
      'not_applicable',
      'The back side does not repeat front data.',
    );
  }
  const mismatched = compared
    .filter(([, f, b]) => levenshtein(normalize(f!), normalize(b!)) > 1)
    .map(([name]) => name);
  return mismatched.length === 0
    ? pass('FRONT_BACK_CONSISTENT', 'Front and back are consistent.')
    : fail('FRONT_BACK_CONSISTENT', 'Front and back do not match.', { fields: mismatched });
};
