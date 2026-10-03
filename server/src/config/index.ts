import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be 32 bytes, base64 encoded');

const secret = z.string().min(32, 'Must be at least 32 characters');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('dlc'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('dlc'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  ENCRYPTION_MASTER_KEY: base64Key32,
  ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default('k1'),
  /** Older master keys still needed to decrypt existing objects: "id:base64,id:base64". */
  ENCRYPTION_PREVIOUS_KEYS: z.string().default(''),
  API_KEY_PEPPER: secret,
  HMAC_SECRET: secret,
  COOKIE_SECRET: secret,

  IMAGE_STORE_DIR: z.string().default(path.join(serverRoot, 'var/images')),
  TESSDATA_DIR: z.string().default(path.join(serverRoot, 'tessdata')),
  HOSTED_PAGE_DIST: z.string().default(path.resolve(serverRoot, '../hosted-page/dist')),

  COOKIE_SECURE: bool.default(true),
  HSTS: bool.default(true),
  /** Space separated origins allowed to frame the hosted page. Empty means 'none'. */
  FRAME_ANCESTORS: z.string().default(''),
  DESKTOP_HANDOFF_ENABLED: bool.default(false),

  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  HOSTED_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  UPLOAD_MAX_PIXELS: z.coerce.number().int().positive().default(40_000_000),

  FIELD_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  KEEP_ORIGINALS: bool.default(false),
  KEEP_RAW_OCR: bool.default(false),
  OCR_POOL_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .default(Math.max(1, os.cpus().length - 1)),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).default(9464),
  METRICS_TOKEN: z.string().default(''),

  RETENTION_DEFAULT_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  HARD_CUTOFF_DAYS: z.coerce.number().int().min(1).default(365),
  DUPLICATE_WINDOW_DAYS: z.coerce.number().int().min(1).default(30),

  // Image quality thresholds. Tune with the fixture set (SPEC 7.1).
  QUALITY_MIN_LONG_EDGE: z.coerce.number().int().positive().default(1000),
  QUALITY_MIN_BLUR_VARIANCE: z.coerce.number().positive().default(60),
  QUALITY_MAX_GLARE_RATIO: z.coerce.number().min(0).max(1).default(0.04),
  QUALITY_MIN_LUMINANCE: z.coerce.number().min(0).max(255).default(50),
  // Light card stocks average around 230; overexposure shows up first in the glare ratio.
  QUALITY_MAX_LUMINANCE: z.coerce.number().min(0).max(255).default(242),
  QUALITY_ASPECT_TOLERANCE: z.coerce.number().min(0).max(1).default(0.05),
  QUALITY_PHASH_MAX_DISTANCE: z.coerce.number().int().min(0).max(64).default(6),
});

export type Config = ReturnType<typeof toConfig>;

function parsePreviousKeys(raw: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const idx = entry.indexOf(':');
    if (idx <= 0) throw new Error('ENCRYPTION_PREVIOUS_KEYS entries must be "id:base64"');
    const key = Buffer.from(entry.slice(idx + 1), 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_PREVIOUS_KEYS keys must be 32 bytes');
    keys.set(entry.slice(0, idx), key);
  }
  return keys;
}

function toConfig(env: z.output<typeof EnvSchema>) {
  return {
    ...env,
    isDev: env.NODE_ENV === 'development',
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    encryption: {
      currentKeyId: env.ENCRYPTION_KEY_ID,
      keys: new Map<string, Buffer>([
        ...parsePreviousKeys(env.ENCRYPTION_PREVIOUS_KEYS),
        [env.ENCRYPTION_KEY_ID, Buffer.from(env.ENCRYPTION_MASTER_KEY, 'base64')],
      ]),
    },
    quality: {
      minLongEdge: env.QUALITY_MIN_LONG_EDGE,
      minBlurVariance: env.QUALITY_MIN_BLUR_VARIANCE,
      maxGlareRatio: env.QUALITY_MAX_GLARE_RATIO,
      minLuminance: env.QUALITY_MIN_LUMINANCE,
      maxLuminance: env.QUALITY_MAX_LUMINANCE,
      aspectTolerance: env.QUALITY_ASPECT_TOLERANCE,
      phashMaxDistance: env.QUALITY_PHASH_MAX_DISTANCE,
    },
  };
}

export type QualityConfig = Config['quality'];

/** Parse and validate config. Throws with a readable message on invalid env. */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return toConfig(parsed.data);
}

/** Load config or exit the process (SPEC 13: exit on invalid config). */
export function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
