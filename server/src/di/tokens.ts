// Inversify reads decorator metadata through the Reflect API; load the polyfill before any
// @injectable class is defined. Every injectable imports this module, so it always runs first.
import 'reflect-metadata';
import type { Config } from '../config/index.js';
import type { Db } from '../db/knex.js';
import type { UnitOfWork } from '../db/unit-of-work.js';
import type { Clock } from '../lib/clock.js';
import type { Encryptor } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';
import type { AuditRepository } from '../modules/audit/audit.repository.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { CountryProfile } from '../modules/countries/index.js';
import type { HostedService } from '../modules/hosted/hosted.service.js';
import type { ImageStore } from '../modules/images/image-store.js';
import type { ImageRepository } from '../modules/images/image.repository.js';
import type { ImageService } from '../modules/images/image.service.js';
import type { IntegratorRepository } from '../modules/integrators/integrator.repository.js';
import type { IntegratorService } from '../modules/integrators/integrator.service.js';
import type { JobRunner } from '../modules/jobs/job-runner.js';
import type { JobRepository } from '../modules/jobs/job.repository.js';
import type { WorkerMetrics } from '../modules/metrics/metrics.js';
import type { OcrEngine } from '../modules/ocr/ocr.types.js';
import type { DocumentAnalyzer } from '../modules/processing/document-analyzer.js';
import type { ProcessingService } from '../modules/processing/processing.service.js';
import type { ResultRepository } from '../modules/processing/result.repository.js';
import type { PurgeService } from '../modules/retention/purge.service.js';
import type { ExpiryService } from '../modules/sessions/expiry.service.js';
import type { SessionRepository } from '../modules/sessions/session.repository.js';
import type { SessionService } from '../modules/sessions/session.service.js';
import type { HttpFetch } from '../modules/webhooks/webhook.service.js';
import type { WebhookRepository } from '../modules/webhooks/webhook.repository.js';
import type { WebhookService } from '../modules/webhooks/webhook.service.js';

/**
 * Everything the container can resolve, keyed by name. Each key has a matching token in
 * TOKENS; classes ask for a dependency with `@inject(TOKENS.<key>)` on a constructor parameter.
 */
export interface Deps {
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
  /** Resolves ocrEngine on call, so classes built in the API process never touch OCR. */
  ocrEngineProvider: () => OcrEngine;
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

/**
 * Inversify service identifiers, one per Deps key. `satisfies` makes the build fail when a key
 * is added to Deps without a token, or the other way round.
 */
export const TOKENS = {
  config: Symbol('dlc.config'),
  db: Symbol('dlc.db'),
  uow: Symbol('dlc.uow'),
  clock: Symbol('dlc.clock'),
  logger: Symbol('dlc.logger'),
  encryptor: Symbol('dlc.encryptor'),
  imageStore: Symbol('dlc.imageStore'),
  ocrEngine: Symbol('dlc.ocrEngine'),
  ocrEngineProvider: Symbol('dlc.ocrEngineProvider'),
  httpFetch: Symbol('dlc.httpFetch'),
  workerMetrics: Symbol('dlc.workerMetrics'),
  countryProfiles: Symbol('dlc.countryProfiles'),
  integratorRepository: Symbol('dlc.integratorRepository'),
  sessionRepository: Symbol('dlc.sessionRepository'),
  imageRepository: Symbol('dlc.imageRepository'),
  resultRepository: Symbol('dlc.resultRepository'),
  jobRepository: Symbol('dlc.jobRepository'),
  auditRepository: Symbol('dlc.auditRepository'),
  webhookRepository: Symbol('dlc.webhookRepository'),
  integratorService: Symbol('dlc.integratorService'),
  sessionService: Symbol('dlc.sessionService'),
  hostedService: Symbol('dlc.hostedService'),
  imageService: Symbol('dlc.imageService'),
  purgeService: Symbol('dlc.purgeService'),
  auditService: Symbol('dlc.auditService'),
  documentAnalyzer: Symbol('dlc.documentAnalyzer'),
  processingService: Symbol('dlc.processingService'),
  webhookService: Symbol('dlc.webhookService'),
  expiryService: Symbol('dlc.expiryService'),
  jobRunner: Symbol('dlc.jobRunner'),
} as const satisfies Record<keyof Deps, symbol>;
