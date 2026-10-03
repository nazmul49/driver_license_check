import {
  InjectionMode,
  asClass,
  asFunction,
  asValue,
  createContainer as createAwilix,
  type AwilixContainer,
} from 'awilix';
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
import { createWorkerMetrics, type WorkerMetrics } from './modules/metrics/metrics.js';
import type { OcrEngine } from './modules/ocr/ocr.types.js';
import { listCountryProfiles, type CountryProfile } from './modules/countries/index.js';
import { ProcessingService } from './modules/processing/processing.service.js';
import { DocumentAnalyzer } from './modules/processing/document-analyzer.js';
import { WebhookRepository } from './modules/webhooks/webhook.repository.js';
import { WebhookService, type HttpFetch } from './modules/webhooks/webhook.service.js';

/**
 * Everything the container can resolve. Classes declare what they need with
 * `Pick<Cradle, ...>` in their constructor, so dependencies are explicit and type checked.
 */
export interface Cradle {
  // Infrastructure
  config: Config;
  db: Db;
  uow: UnitOfWork;
  clock: Clock;
  logger: Logger;
  encryptor: Encryptor;
  imageStore: ImageStore;
  /** Set by the worker after the Tesseract pool starts. */
  ocrEngine: OcrEngine;
  /** Outbound HTTP for webhooks only. Processing never makes network calls. */
  httpFetch: HttpFetch;
  workerMetrics: WorkerMetrics;
  /** Country profiles are configuration (SPEC 6.4); tests inject their own. */
  countryProfiles: CountryProfile[];
  // Repositories: the only code that touches the database
  integratorRepository: IntegratorRepository;
  sessionRepository: SessionRepository;
  imageRepository: ImageRepository;
  resultRepository: ResultRepository;
  jobRepository: JobRepository;
  auditRepository: AuditRepository;
  webhookRepository: WebhookRepository;
  // Services: business logic
  integratorService: IntegratorService;
  sessionService: SessionService;
  hostedService: HostedService;
  imageService: ImageService;
  purgeService: PurgeService;
  auditService: AuditService;
  documentAnalyzer: DocumentAnalyzer;
  processingService: ProcessingService;
  webhookService: WebhookService;
  expiryService: ExpiryService;
  // Worker
  jobRunner: JobRunner;
}

export interface ContainerOverrides {
  db?: Db;
  clock?: Clock;
  logger?: Logger;
  imageStore?: ImageStore;
  ocrEngine?: OcrEngine;
  httpFetch?: HttpFetch;
  countryProfiles?: CountryProfile[];
}

export type Container = AwilixContainer<Cradle>;

/**
 * Composition root (awilix, PROXY injection mode, no decorators). Layers, bottom up:
 * repositories -> services -> routes. Routes only parse input with Zod and call services.
 * Everything is a singleton: services are stateless and transactions go through UnitOfWork.
 * Tests pass overrides (clock, logger, image store) or call container.register() to swap one.
 */
export function createContainer(config: Config, o: ContainerOverrides = {}): Container {
  const container = createAwilix<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });

  container.register({
    config: asValue(config),
    db: o.db
      ? asValue(o.db)
      : asFunction(({ config: c }: Pick<Cradle, 'config'>) => createDb(c))
          .singleton()
          .disposer((db) => db.destroy()),
    uow: asClass(UnitOfWork).singleton(),
    clock: asValue(o.clock ?? systemClock),
    logger: asValue(o.logger ?? createLogger(config.LOG_LEVEL)),
    encryptor: asFunction(
      ({ config: c }: Pick<Cradle, 'config'>) => new Encryptor(c.encryption),
    ).singleton(),
    imageStore: o.imageStore
      ? asValue(o.imageStore)
      : asFunction(
          ({ config: c }: Pick<Cradle, 'config'>) => new FsImageStore(c.IMAGE_STORE_DIR),
        ).singleton(),

    ocrEngine: o.ocrEngine
      ? asValue(o.ocrEngine)
      : asFunction((): OcrEngine => {
          throw new Error('OCR engine not initialized (only the worker registers it)');
        }),
    httpFetch: asValue(o.httpFetch ?? globalThis.fetch.bind(globalThis)),
    workerMetrics: asFunction(createWorkerMetrics).singleton(),
    countryProfiles: asValue(o.countryProfiles ?? listCountryProfiles()),

    integratorRepository: asClass(IntegratorRepository).singleton(),
    sessionRepository: asClass(SessionRepository).singleton(),
    imageRepository: asClass(ImageRepository).singleton(),
    resultRepository: asClass(ResultRepository).singleton(),
    jobRepository: asClass(JobRepository).singleton(),
    auditRepository: asClass(AuditRepository).singleton(),
    webhookRepository: asClass(WebhookRepository).singleton(),

    integratorService: asClass(IntegratorService).singleton(),
    sessionService: asClass(SessionService).singleton(),
    hostedService: asClass(HostedService).singleton(),
    imageService: asClass(ImageService).singleton(),
    purgeService: asClass(PurgeService).singleton(),
    auditService: asClass(AuditService).singleton(),
    documentAnalyzer: asClass(DocumentAnalyzer).singleton(),
    processingService: asClass(ProcessingService).singleton(),
    webhookService: asClass(WebhookService).singleton(),
    expiryService: asClass(ExpiryService).singleton(),

    jobRunner: asClass(JobRunner).singleton(),
  });

  return container;
}
