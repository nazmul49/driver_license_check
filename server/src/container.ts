import { Container } from 'inversify';
import { TOKENS, type Deps } from './di/tokens.js';
import type { Config } from './config/index.js';
import { createDb, type Db } from './db/knex.js';
import { UnitOfWork } from './db/unit-of-work.js';
import { systemClock, type Clock } from './lib/clock.js';
import { Encryptor } from './lib/crypto.js';
import { createLogger, type Logger } from './lib/logger.js';
import { AuditRepository } from './modules/audit/audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { HostedService } from './modules/hosted/hosted.service.js';
import { FsImageStore, type ImageStore } from './modules/images/image-store.js';
import { ImageRepository } from './modules/images/image.repository.js';
import { ImageService } from './modules/images/image.service.js';
import { IntegratorRepository } from './modules/integrators/integrator.repository.js';
import { IntegratorService } from './modules/integrators/integrator.service.js';
import { JobRepository } from './modules/jobs/job.repository.js';
import { ResultRepository } from './modules/processing/result.repository.js';
import { PurgeService } from './modules/retention/purge.service.js';
import { SessionRepository } from './modules/sessions/session.repository.js';
import { SessionService } from './modules/sessions/session.service.js';
import { ExpiryService } from './modules/sessions/expiry.service.js';
import { JobRunner } from './modules/jobs/job-runner.js';
import { createWorkerMetrics } from './modules/metrics/metrics.js';
import type { OcrEngine } from './modules/ocr/ocr.types.js';
import { listCountryProfiles, type CountryProfile } from './modules/countries/index.js';
import { ProcessingService } from './modules/processing/processing.service.js';
import { DocumentAnalyzer } from './modules/processing/document-analyzer.js';
import { WebhookRepository } from './modules/webhooks/webhook.repository.js';
import { WebhookService, type HttpFetch } from './modules/webhooks/webhook.service.js';

export { TOKENS, type Deps } from './di/tokens.js';
export type { Container };

export interface ContainerOverrides {
  db?: Db;
  clock?: Clock;
  logger?: Logger;
  imageStore?: ImageStore;
  ocrEngine?: OcrEngine;
  httpFetch?: HttpFetch;
  countryProfiles?: CountryProfile[];
}

/**
 * Composition root (inversify). Layers, bottom up: repositories -> services -> routes. Routes
 * only parse input with Zod and call services. Everything is a singleton: services are
 * stateless and transactions go through UnitOfWork. Classes are `@injectable()` and name each
 * constructor dependency with `@inject(TOKENS.<key>)`; tokens are explicit because tsx/esbuild
 * does not emit decorator type metadata. Tests pass overrides (clock, logger, image store) or
 * call `container.rebind(TOKENS.<key>)` to swap one before it is first resolved.
 */
export function createContainer(config: Config, o: ContainerOverrides = {}): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  const value = <K extends keyof Deps>(key: K, v: Deps[K]) =>
    container.bind<Deps[K]>(TOKENS[key]).toConstantValue(v);

  value('config', config);
  if (o.db) value('db', o.db);
  else {
    container
      .bind<Db>(TOKENS.db)
      .toDynamicValue(() => createDb(config))
      .onDeactivation((db) => db.destroy());
  }
  container.bind(TOKENS.uow).to(UnitOfWork);
  value('clock', o.clock ?? systemClock);
  value('logger', o.logger ?? createLogger(config.LOG_LEVEL));
  container.bind(TOKENS.encryptor).toDynamicValue(() => new Encryptor(config.encryption));
  if (o.imageStore) value('imageStore', o.imageStore);
  else {
    container
      .bind<ImageStore>(TOKENS.imageStore)
      .toDynamicValue(() => new FsImageStore(config.IMAGE_STORE_DIR));
  }

  if (o.ocrEngine) value('ocrEngine', o.ocrEngine);
  else {
    container
      .bind<OcrEngine>(TOKENS.ocrEngine)
      .toDynamicValue(() => {
        throw new Error('OCR engine not initialized (only the worker registers it)');
      })
      .inTransientScope();
  }
  container
    .bind<Deps['ocrEngineProvider']>(TOKENS.ocrEngineProvider)
    .toConstantValue(() => container.get<OcrEngine>(TOKENS.ocrEngine));
  value('httpFetch', o.httpFetch ?? globalThis.fetch.bind(globalThis));
  container.bind(TOKENS.workerMetrics).toDynamicValue(createWorkerMetrics);
  value('countryProfiles', o.countryProfiles ?? listCountryProfiles());

  container.bind(TOKENS.integratorRepository).to(IntegratorRepository);
  container.bind(TOKENS.sessionRepository).to(SessionRepository);
  container.bind(TOKENS.imageRepository).to(ImageRepository);
  container.bind(TOKENS.resultRepository).to(ResultRepository);
  container.bind(TOKENS.jobRepository).to(JobRepository);
  container.bind(TOKENS.auditRepository).to(AuditRepository);
  container.bind(TOKENS.webhookRepository).to(WebhookRepository);

  container.bind(TOKENS.integratorService).to(IntegratorService);
  container.bind(TOKENS.sessionService).to(SessionService);
  container.bind(TOKENS.hostedService).to(HostedService);
  container.bind(TOKENS.imageService).to(ImageService);
  container.bind(TOKENS.purgeService).to(PurgeService);
  container.bind(TOKENS.auditService).to(AuditService);
  container.bind(TOKENS.documentAnalyzer).to(DocumentAnalyzer);
  container.bind(TOKENS.processingService).to(ProcessingService);
  container.bind(TOKENS.webhookService).to(WebhookService);
  container.bind(TOKENS.expiryService).to(ExpiryService);

  container.bind(TOKENS.jobRunner).to(JobRunner);

  return container;
}

/**
 * Typed, lazy view of the container: `deps(container).sessionService` resolves on property
 * access, so a binding swapped with rebind() is picked up as long as it was not resolved yet.
 */
export function deps(container: Container): Deps {
  return new Proxy({} as Deps, {
    get: (_target, key) => {
      if (typeof key !== 'string' || !(key in TOKENS)) {
        throw new Error(`Unknown dependency: ${String(key)}`);
      }
      return container.get(TOKENS[key as keyof Deps]);
    },
  });
}

/** Runs deactivation hooks (closes the database pool) and drops all bindings. */
export function disposeContainer(container: Container): Promise<void> {
  return container.unbindAllAsync();
}
