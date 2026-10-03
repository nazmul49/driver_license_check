import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '../..');
export const fixturesDir = path.join(here, 'fixtures');
export const authFile = path.join(here, '.auth/e2e.json');

export const API_PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Environment for the API under test and the setup script. Points at the dedicated dlc_e2e
 * database only. Secrets are fixed, non-production test values.
 */
export const serverEnv: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  PUBLIC_BASE_URL: BASE_URL,
  DB_HOST: '127.0.0.1',
  // Local docker-compose maps MySQL to 3307; CI overrides with E2E_DB_PORT.
  DB_PORT: process.env.E2E_DB_PORT ?? '3307',
  DB_USER: 'dlc',
  DB_PASSWORD: 'dlc',
  DB_NAME: 'dlc_e2e',
  COOKIE_SECURE: 'false',
  HSTS: 'false',
  LOG_LEVEL: 'warn',
  DESKTOP_HANDOFF_ENABLED: 'true',
  ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  API_KEY_PEPPER: 'e2e-api-key-pepper-0000000000000000000',
  HMAC_SECRET: 'e2e-hmac-secret-000000000000000000000000',
  COOKIE_SECRET: 'e2e-cookie-secret-0000000000000000000000',
  IMAGE_STORE_DIR: path.join(os.tmpdir(), 'dlc-e2e-images'),
  // The suite opens many sessions from one IP in a short time.
  HOSTED_RATE_LIMIT_PER_MIN: '1000',
  RATE_LIMIT_PER_MIN: '1000',
};

export interface E2eKeys {
  apiKey: string;
  apiKeyNoReopen: string;
}

export function readKeys(): E2eKeys {
  return JSON.parse(readFileSync(authFile, 'utf8')) as E2eKeys;
}
