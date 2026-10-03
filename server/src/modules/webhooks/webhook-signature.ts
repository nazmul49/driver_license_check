import { hmacHex, safeEqual } from '../../lib/crypto.js';

/** X-DLC-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)> (SPEC 5.4). */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${hmacHex(secret, `${unixSeconds}.${body}`)}`;
}

/** Reference verification, mirrored in docs/integration.md. */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  nowUnix: number,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=', 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowUnix - t) > toleranceSeconds) return false;
  return safeEqual(parts.v1, hmacHex(secret, `${t}.${body}`));
}
