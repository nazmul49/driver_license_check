import type { OcrResult } from '../ocr/ocr.types.js';
import type { CountryProfile } from './country-profile.js';
import { listCountryProfiles } from './index.js';

export interface CountryDetection {
  detected: string | null;
  /** Country whose profile is applied: detected, else the integrator's hint when a profile exists. */
  applied: string | null;
  score: number;
}

/**
 * SPEC 6.1 step 8: distinguishing sign in the blue band, issuing authority text, title words.
 * A conflict with country_hint is reported by COUNTRY_MATCHES_HINT, not resolved here.
 */
export function detectCountry(
  front: OcrResult,
  back: OcrResult,
  hint: string | null,
  profiles: CountryProfile[] = listCountryProfiles(),
): CountryDetection {
  const text = `${front.text}\n${back.text}`.toUpperCase();
  const shortLines = front.lines
    .map((l) => l.text.trim().toUpperCase())
    .filter((t) => t.length <= 3);
  let best: { code: string; score: number } | null = null;
  for (const p of profiles) {
    let score = 0;
    if (p.issuingAuthorityPatterns?.some((r) => r.test(text))) score += 2;
    if (p.titleKeywords.some((k) => text.includes(k))) score += 1;
    if (p.distinguishingSign && shortLines.includes(p.distinguishingSign)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { code: p.code, score };
  }
  const detected = best?.code ?? null;
  const hintHasProfile = hint ? profiles.some((p) => p.code === hint) : false;
  return { detected, applied: detected ?? (hintHasProfile ? hint : null), score: best?.score ?? 0 };
}
