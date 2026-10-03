import { randomBytes } from 'node:crypto';
import { loadConfig, type Config } from '../../src/config/index.js';

const fixedSecret = (label: string) => `test-${label}-`.padEnd(40, 'x');

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'https://dlc.test',
    LOG_LEVEL: 'silent',
    DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT ?? '3307',
    DB_USER: process.env.TEST_DB_USER ?? 'dlc',
    DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? 'dlc',
    DB_NAME: process.env.TEST_DB_NAME ?? 'dlc_test',
    ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64'),
    API_KEY_PEPPER: fixedSecret('pepper'),
    HMAC_SECRET: fixedSecret('hmac'),
    COOKIE_SECRET: fixedSecret('cookie'),
    COOKIE_SECURE: 'false',
    HSTS: 'true',
    OCR_POOL_SIZE: '1',
    ...overrides,
  });
}
