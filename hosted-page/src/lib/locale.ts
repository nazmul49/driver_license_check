import type { LOCALES } from '@dlc/shared';

export type Locale = (typeof LOCALES)[number];

const NORWEGIAN = new Set(['nb', 'nn', 'no']);

/** Maps a BCP 47 tag to a supported locale, or null when unsupported. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split(/[-_]/)[0] ?? '';
  if (NORWEGIAN.has(primary)) return 'nb';
  if (primary === 'en') return 'en';
  return null;
}

/** Session locale first, then the browser languages in order, then English (SPEC 10.4). */
export function resolveLocale(sessionLocale: string | null | undefined): Locale {
  const fromSession = matchLocale(sessionLocale);
  if (fromSession) return fromSession;
  const browser =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const tag of browser) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return 'en';
}
