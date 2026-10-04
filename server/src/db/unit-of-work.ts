import { inject, injectable } from 'inversify';
import { TOKENS } from '../di/tokens.js';
import type { Db } from './knex.js';
import { AuditRepository } from '../modules/audit/audit.repository.js';
import { ImageRepository } from '../modules/images/image.repository.js';
import { IntegratorRepository } from '../modules/integrators/integrator.repository.js';
import { JobRepository } from '../modules/jobs/job.repository.js';
import { ResultRepository } from '../modules/processing/result.repository.js';
import { SessionRepository } from '../modules/sessions/session.repository.js';
import { WebhookRepository } from '../modules/webhooks/webhook.repository.js';

export interface Repositories {
  integrators: IntegratorRepository;
  sessions: SessionRepository;
  images: ImageRepository;
  results: ResultRepository;
  jobs: JobRepository;
  audit: AuditRepository;
  webhooks: WebhookRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    integrators: new IntegratorRepository(db),
    sessions: new SessionRepository(db),
    images: new ImageRepository(db),
    results: new ResultRepository(db),
    jobs: new JobRepository(db),
    audit: new AuditRepository(db),
    webhooks: new WebhookRepository(db),
  };
}

/**
 * Runs work in one database transaction with repositories bound to it. Services receive this
 * instead of a raw connection, so repositories stay the only code that touches the database.
 */
@injectable()
export class UnitOfWork {
  constructor(@inject(TOKENS.db) private readonly db: Db) {}

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((trx) => work(createRepositories(trx)));
  }

  /** Readiness probe. */
  async ping(): Promise<void> {
    await this.db.raw('SELECT 1');
  }
}
