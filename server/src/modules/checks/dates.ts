/**
 * Pure calendar arithmetic on YYYY-MM-DD strings. No Date objects in local time, so nothing
 * can shift a document date across a timezone boundary (SPEC 13).
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseIso(value: string): Ymd | null {
  const m = ISO.exec(value);
  if (!m) return null;
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return isRealDate(ymd) ? ymd : null;
}

export function isRealDate({ y, m, d }: Ymd): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function must(value: string): Ymd {
  const p = parseIso(value);
  if (!p) throw new Error(`Invalid ISO date: ${value}`);
  return p;
}

/** Days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  const pa = must(a);
  const pb = must(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Adds whole years. Feb 29 becomes Feb 28 in non-leap years. */
export function addYears(date: string, years: number): string {
  const p = must(date);
  const y = p.y + years;
  return toIso({ y, m: p.m, d: Math.min(p.d, daysInMonth(y, p.m)) });
}

export function addDays(date: string, days: number): string {
  const p = must(date);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** Completed years of age on a given date. */
export function ageOn(dob: string, on: string): number {
  const b = must(dob);
  const o = must(on);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age -= 1;
  return age;
}

/** ISO strings compare correctly as strings. */
export const isBefore = (a: string, b: string) => a < b;
export const isOnOrBefore = (a: string, b: string) => a <= b;
