import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfigOrExit } from './config/index.js';
import { createContainer } from './container.js';

/**
 * Admin CLI (SPEC 2: no admin UI in v1).
 *   npm run cli -- integrator:create --name acme --display-name "Acme" --hosts acme.com,*.acme.com
 *   npm run cli -- integrator:list
 *   npm run cli -- key:create --integrator <id> --mode live|test
 *   npm run cli -- key:revoke --key-id <id>
 *   npm run cli -- webhook:rotate --integrator <id>
 */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'display-name': { type: 'string' },
    hosts: { type: 'string' },
    'retention-days': { type: 'string' },
    'allow-reopen': { type: 'boolean', default: false },
    'allow-image-download': { type: 'boolean', default: false },
    integrator: { type: 'string' },
    mode: { type: 'string', default: 'test' },
    'key-id': { type: 'string' },
  },
});

const config = loadConfigOrExit();
const container = createContainer(config);
const c = container.cradle;
const need = (v: string | undefined, flag: string): string => {
  if (!v) throw new Error(`--${flag} is required`);
  return v;
};

try {
  switch (positionals[0]) {
    case 'integrator:create': {
      const retention = Number(values['retention-days'] ?? config.RETENTION_DEFAULT_DAYS);
      if (!Number.isInteger(retention) || retention < 1 || retention > 90)
        throw new Error('retention-days must be 1..90');
      const { integrator, webhookSecret } = await c.integratorService.createIntegrator({
        name: need(values.name, 'name'),
        display_name: values['display-name'] ?? values.name!,
        return_url_hosts: need(values.hosts, 'hosts')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        retention_days: retention,
        allow_reopen: values['allow-reopen'],
        allow_image_download: values['allow-image-download'],
      });
      console.log(`Integrator id: ${integrator.id}`);
      console.log(`Webhook secret (shown once): ${webhookSecret}`);
      break;
    }
    case 'integrator:list':
      for (const i of await c.integratorRepository.listAll()) {
        console.log(
          `${i.id}  ${i.name}  hosts=${i.return_url_hosts.join(',')}${i.disabled_at ? '  (disabled)' : ''}`,
        );
      }
      break;
    case 'key:create': {
      const mode = values.mode === 'live' ? 'live' : 'test';
      const key = await c.integratorService.createApiKey(
        need(values.integrator, 'integrator'),
        mode,
      );
      console.log(`Key id: ${key.id}`);
      console.log(`API key (shown once): ${key.key}`);
      break;
    }
    case 'key:revoke': {
      const n = await c.integratorService.revokeApiKey(need(values['key-id'], 'key-id'));
      console.log(n ? 'Revoked.' : 'No active key with that id.');
      break;
    }
    case 'webhook:rotate': {
      const secret = await c.integratorService.rotateWebhookSecret(
        need(values.integrator, 'integrator'),
      );
      console.log(`New webhook secret (shown once): ${secret}`);
      break;
    }
    default:
      console.log(
        'Commands: integrator:create, integrator:list, key:create, key:revoke, webhook:rotate',
      );
      process.exitCode = positionals[0] ? 1 : 0;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await container.dispose();
}
