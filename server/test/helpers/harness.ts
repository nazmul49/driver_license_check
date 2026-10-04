import { Writable } from 'node:stream';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config/index.js';
import {
  createContainer,
  deps,
  disposeContainer,
  type Container,
  type ContainerOverrides,
  type Deps,
} from '../../src/container.js';
import type { Db } from '../../src/db/knex.js';
import { applySchema } from '../../src/db/schema.js';
import { FixedClock } from '../../src/lib/clock.js';
import { createLogger } from '../../src/lib/logger.js';
import { MemoryImageStore } from '../../src/modules/images/image-store.js';
import type { Integrator } from '../../src/modules/integrators/integrator.types.js';
import { testConfig } from './config.js';

const TABLES = [
  'audit_log',
  'webhook_delivery',
  'job',
  'check_result',
  'extraction_result',
  'session_image',
  'verification_session',
  'api_key',
  'integrator',
];

let migrated: Promise<unknown> | null = null;

function migrateOnce(config: Config): Promise<unknown> {
  migrated ??= applySchema(config);
  return migrated;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.raw('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABLES) await db.raw('TRUNCATE TABLE ??', [t]);
  await db.raw('SET FOREIGN_KEY_CHECKS = 1');
}

/** Captures every log line so tests can assert on log content (redaction test). */
export class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.lines.push(chunk.toString('utf8'));
    cb();
  }
  get text() {
    return this.lines.join('');
  }
}

export interface Harness {
  config: Config;
  container: Container;
  /** Resolved dependencies (deps(container)). */
  c: Deps;
  app: Express;
  clock: FixedClock;
  store: MemoryImageStore;
  logs: LogCapture;
  integrator: Integrator;
  apiKey: string;
  webhookSecret: string;
  close(): Promise<void>;
}

export async function createHarness(
  overrides: Record<string, string> = {},
  integratorOverrides: Partial<Parameters<Deps['integratorService']['createIntegrator']>[0]> = {},
  containerOverrides: Omit<ContainerOverrides, 'clock' | 'logger' | 'imageStore'> = {},
): Promise<Harness> {
  const config = testConfig(overrides);
  await migrateOnce(config);
  const clock = new FixedClock(new Date('2026-10-03T12:00:00.000Z'));
  const store = new MemoryImageStore();
  const logs = new LogCapture();
  const logger = createLogger('info', logs);
  const container = createContainer(config, {
    clock,
    imageStore: store,
    logger,
    ...containerOverrides,
  });
  const c = deps(container);
  await truncateAll(c.db);
  const { integrator, webhookSecret } = await c.integratorService.createIntegrator({
    name: 'acme',
    display_name: 'Acme Rentals',
    return_url_hosts: ['integrator.test', '*.acme.test'],
    retention_days: 30,
    ...integratorOverrides,
  });
  const { key } = await c.integratorService.createApiKey(integrator.id, 'test');
  return {
    config,
    container,
    c,
    app: createApp(container),
    clock,
    store,
    logs,
    integrator,
    apiKey: key,
    webhookSecret,
    close: () => disposeContainer(container),
  };
}
