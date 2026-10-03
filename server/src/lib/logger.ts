import pino, { type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logger. Policy (SPEC 12): log ids, codes and durations only. Never log
 * document data, images, tokens, API keys or secrets. The redact list is a safety net for
 * accidental object logging, not a replacement for the policy.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.secret',
  '*.password',
  '*.fields',
  '*.surname',
  '*.given_names',
  '*.date_of_birth',
  '*.license_number',
  '*.place_of_birth',
  '*.text',
  '*.raw',
  'token',
  'fields',
  'text',
];

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'dlc' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
