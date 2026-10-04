/**
 * Prepares the dedicated e2e database for the hosted page Playwright suite: applies the schema scripts,
 * empties every table, creates the e2e integrators and writes their test API keys to
 * hosted-page/e2e/.auth/e2e.json (gitignored). Refuses to run against any database other than
 * one whose name ends in "_e2e", so it can never wipe the dev or unit test databases.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/index.js';
import { createContainer, deps, disposeContainer } from '../src/container.js';
import { createDb } from '../src/db/knex.js';
import { applySchema } from '../src/db/schema.js';

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outFile = path.join(repoRoot, 'hosted-page/e2e/.auth/e2e.json');

const config = loadConfig();
if (!config.DB_NAME.endsWith('_e2e')) {
  console.error(`Refusing to reset database "${config.DB_NAME}": name must end in _e2e.`);
  process.exit(1);
}

await applySchema(config);
const db = createDb(config);
try {
  const conn = await db.client.acquireConnection();
  try {
    // FOREIGN_KEY_CHECKS is per connection, so the truncates must share one connection.
    const run = (sql: string) => db.raw(sql).connection(conn);
    await run('SET FOREIGN_KEY_CHECKS=0');
    for (const table of TABLES) await run(`TRUNCATE TABLE \`${table}\``);
    await run('SET FOREIGN_KEY_CHECKS=1');
  } finally {
    await db.client.releaseConnection(conn);
  }
} finally {
  await db.destroy();
}

const container = createContainer(config);
try {
  const svc = deps(container).integratorService;
  const base = { return_url_hosts: ['integrator.test'], retention_days: 30 };
  const reopen = await svc.createIntegrator({
    ...base,
    name: 'e2e',
    display_name: 'E2E Rentals',
    theme: { primary_color: '#0f766e' },
    allow_reopen: true,
  });
  const single = await svc.createIntegrator({
    ...base,
    name: 'e2e-single-use',
    display_name: 'E2E Single Use',
    allow_reopen: false,
  });
  const apiKey = (await svc.createApiKey(reopen.integrator.id, 'test')).key;
  const apiKeyNoReopen = (await svc.createApiKey(single.integrator.id, 'test')).key;
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ apiKey, apiKeyNoReopen }, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`e2e database ready, keys written to ${path.relative(repoRoot, outFile)}`);
} finally {
  await disposeContainer(container);
}
