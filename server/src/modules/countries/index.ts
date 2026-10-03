import type { CountryProfile } from './country-profile.js';
import { NO } from './no.js';

export type { CountryProfile };

const PROFILES: Record<string, CountryProfile> = { NO };

export function getCountryProfile(code: string | null | undefined): CountryProfile | null {
  return code ? (PROFILES[code.toUpperCase()] ?? null) : null;
}

export function listCountryProfiles(): CountryProfile[] {
  return Object.values(PROFILES);
}
