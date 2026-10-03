import { hmacHex, safeEqual } from '../../lib/crypto.js';

export const HOSTED_COOKIE = 'dlc_hs';

/**
 * Session-scoped cookie value: "<sessionId>.<expiresUnix>.<hmac>". Stateless, so the API can
 * run as several instances without shared session storage.
 */
export function signHostedCookie(secret: string, sessionId: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const body = `${sessionId}.${exp}`;
  return `${body}.${hmacHex(secret, `hosted:${body}`)}`;
}

export function verifyHostedCookie(
  secret: string,
  value: string | undefined,
  now: Date,
): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, exp, mac] = parts as [string, string, string];
  if (!safeEqual(mac, hmacHex(secret, `hosted:${sessionId}.${exp}`))) return null;
  if (Number(exp) * 1000 < now.getTime()) return null;
  return sessionId;
}
