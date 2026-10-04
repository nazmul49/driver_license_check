import 'dotenv/config';
import { loadConfigOrExit } from '../config/index.js';
import { createContainer, deps, disposeContainer } from '../container.js';

/** Creates one test integrator (if missing) and prints a fresh test API key (SPEC 11). */
const config = loadConfigOrExit();
const container = createContainer(config);
const c = deps(container);
try {
  let integrator = await c.integratorRepository.findByName('test-integrator');
  let webhookSecret: string | null = null;
  if (!integrator) {
    const created = await c.integratorService.createIntegrator({
      name: 'test-integrator',
      display_name: 'Test Integrator',
      return_url_hosts: ['localhost', '127.0.0.1', 'integrator.test'],
      retention_days: config.RETENTION_DEFAULT_DAYS,
      default_requirements: { min_age: 18 },
      allow_reopen: true,
    });
    integrator = created.integrator;
    webhookSecret = created.webhookSecret;
  }
  const key = await c.integratorService.createApiKey(integrator.id, 'test');
  console.log(`Integrator: ${integrator.name} (${integrator.id})`);
  if (webhookSecret) console.log(`Webhook secret (shown once): ${webhookSecret}`);
  console.log(`Test API key (shown once): ${key.key}`);
} finally {
  await disposeContainer(container);
}
