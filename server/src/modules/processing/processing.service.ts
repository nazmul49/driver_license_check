import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Config } from '../../config/index.js';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import { utcToday, type Clock } from '../../lib/clock.js';
import { hmacHex, type Encryptor } from '../../lib/crypto.js';
import type { Logger } from '../../lib/logger.js';
import {
  DATA_CHECKS,
  IMAGE_CHECKS,
  emptyDocument,
  runChecks,
  type CheckContext,
  type CheckResult,
  type ExtractedDocument,
} from '../checks/index.js';
import { decide, resolvePolicy } from '../decision/decision.js';
import type { ImageRepository } from '../images/image.repository.js';
import type { ImageService } from '../images/image.service.js';
import type { IntegratorRepository } from '../integrators/integrator.repository.js';
import type { ResultRepository } from './result.repository.js';
import type { WorkerMetrics } from '../metrics/metrics.js';
import { hammingDistance } from '../preprocess/index.js';
import type { DocumentAnalyzer, StepTimer } from './document-analyzer.js';
import type { SessionRepository } from '../sessions/session.repository.js';
import type { Session } from '../sessions/session.types.js';
import { transition } from '../sessions/state-machine.js';
import { enqueueWebhook } from '../webhooks/webhook-events.js';

const DAY = 86_400_000;

export class ProcessingTimeoutError extends Error {}

/**
 * Processing pipeline (SPEC 6.1). Runs in the worker for one submitted session. System errors
 * propagate so the job is retried; problems with the images complete the session with a
 * decision instead.
 */
@injectable()
export class ProcessingService {
  private readonly uow: UnitOfWork;
  private readonly sessions: SessionRepository;
  private readonly integrators: IntegratorRepository;
  private readonly images: ImageService;
  private readonly imageRepo: ImageRepository;
  private readonly results: ResultRepository;
  private readonly encryptor: Encryptor;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly config: Config;
  private readonly analyzer: DocumentAnalyzer;
  private readonly metrics: WorkerMetrics;

  constructor(
    @inject(TOKENS.uow) uow: UnitOfWork,
    @inject(TOKENS.sessionRepository) sessionRepository: SessionRepository,
    @inject(TOKENS.integratorRepository) integratorRepository: IntegratorRepository,
    @inject(TOKENS.imageService) imageService: ImageService,
    @inject(TOKENS.imageRepository) imageRepository: ImageRepository,
    @inject(TOKENS.resultRepository) resultRepository: ResultRepository,
    @inject(TOKENS.encryptor) encryptor: Encryptor,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.logger) logger: Logger,
    @inject(TOKENS.config) config: Config,
    @inject(TOKENS.documentAnalyzer) documentAnalyzer: DocumentAnalyzer,
    @inject(TOKENS.workerMetrics) workerMetrics: WorkerMetrics,
  ) {
    this.uow = uow;
    this.sessions = sessionRepository;
    this.integrators = integratorRepository;
    this.images = imageService;
    this.imageRepo = imageRepository;
    this.results = resultRepository;
    this.encryptor = encryptor;
    this.clock = clock;
    this.logger = logger;
    this.config = config;
    this.analyzer = documentAnalyzer;
    this.metrics = workerMetrics;
  }

  async process(sessionId: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ProcessingTimeoutError('Processing timed out')),
        this.config.JOB_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.run(sessionId), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Called by the worker when retries are exhausted. */
  async markFailed(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session || (session.status !== 'submitted' && session.status !== 'processing')) return;
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await transition(tx.sessions, session, 'failed', now);
      await enqueueWebhook(tx.jobs, session, 'session.failed', now);
    });
    this.logger.warn({ session_id: sessionId }, 'session failed');
  }

  private async step<T>(sessionId: string, name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const ms = performance.now() - start;
      this.metrics.stepDuration.observe({ step: name }, ms / 1000);
      this.logger.debug(
        { session_id: sessionId, step: name, duration_ms: Math.round(ms) },
        'pipeline step',
      );
    }
  }

  private async run(sessionId: string): Promise<void> {
    const started = performance.now();
    let session = await this.sessions.findById(sessionId);
    if (!session) return;
    if (session.deleted_at) {
      // Deleted by the integrator after submit: images are gone, nothing to process.
      await this.markFailed(sessionId);
      return;
    }
    if (session.status === 'submitted') {
      await transition(this.sessions, session, 'processing', this.clock.now());
      session = (await this.sessions.findById(sessionId))!;
    } else if (session.status !== 'processing') {
      return; // Already finished (duplicate job): idempotent no-op.
    }

    const integrator = await this.integrators.findById(session.integrator_id);
    if (!integrator) throw new Error('Integrator missing');
    const today = utcToday(this.clock);
    const q = this.config.quality;

    const time: StepTimer = (name, fn) => this.step(sessionId, name, fn);

    // Step 1: load and decrypt. Steps 2 to 4: normalize, card detection, quality metrics.
    const originals = await time('load', async () => {
      const front = await this.images.load(sessionId, 'front', 'original');
      const back = await this.images.load(sessionId, 'back', 'original');
      if (!front || !back) throw new Error('Original image missing');
      return { front: front.data, back: back.data };
    });
    const sides = await this.analyzer.analyzeImages(originals, time);
    for (const side of ['front', 'back'] as const) {
      await this.images.save(sessionId, side, 'processed', {
        data: sides[side].card.image,
        width: sides[side].card.width,
        height: sides[side].card.height,
        mime: 'image/jpeg',
        phash: sides[side].metrics.phash,
      });
    }

    const duplicateFound = await this.step(sessionId, 'duplicate_lookup', async () => {
      const since = new Date(this.clock.now().getTime() - this.config.DUPLICATE_WINDOW_DAYS * DAY);
      const others = await this.imageRepo.recentPhashes(sessionId, since, 5000);
      const mine = [sides.front.metrics.phash, sides.back.metrics.phash];
      return others.some((o) => mine.some((m) => hammingDistance(o, m) <= q.phashMaxDistance));
    });

    const ctx: CheckContext = {
      today,
      requirements: session.requirements,
      profile: null,
      countryHint: session.country_hint,
      detectedCountry: null,
      images: {
        front: sides.front.metrics,
        back: sides.back.metrics,
        thresholds: q,
        frontBackDistance: hammingDistance(sides.front.metrics.phash, sides.back.metrics.phash),
        duplicateFound,
      },
    };
    const imageChecks = runChecks(IMAGE_CHECKS, emptyDocument(), ctx);
    if (imageChecks.some((c) => c.status === 'fail' && c.severity === 'critical')) {
      const reasons = imageChecks
        .filter((c) => c.status === 'fail' && c.severity === 'critical')
        .map((c) => c.code);
      await this.complete(session, {
        doc: null,
        checks: imageChecks,
        decision: 'rejected',
        reasons: ['IMAGE_QUALITY', ...reasons],
        ocrConfidence: null,
        startedAt: started,
      });
      return;
    }

    // Steps 5 to 10: orientation, OCR, template, country, field parsing.
    const extraction = await this.analyzer.extract(sides, session.country_hint, today, time);
    const doc = extraction.doc;
    ctx.profile = extraction.profile;
    ctx.detectedCountry = extraction.detectedCountry;
    ctx.templateScore = extraction.templateScore;

    // Step 11: checks.
    ctx.reuse = await this.reuseLookup(sessionId, doc);
    const dataChecks = runChecks(DATA_CHECKS, doc, ctx);
    const checks = [...imageChecks, ...dataChecks];

    // Step 12: decision.
    const { decision, reasons } = decide(checks, resolvePolicy(integrator.decision_policy));
    const ocrConfidence = extraction.ocrConfidence;
    this.metrics.ocrConfidence.observe(ocrConfidence);

    // Step 13: persist and notify.
    await this.complete(session, {
      doc,
      checks,
      decision,
      reasons,
      ocrConfidence,
      startedAt: started,
      raw: this.config.KEEP_RAW_OCR ? extraction.rawText : undefined,
    });
  }

  private licenseHmac(doc: ExtractedDocument): string | null {
    const n = doc.fields.license_number.value;
    return n ? hmacHex(this.config.HMAC_SECRET, `ln:${doc.country ?? ''}:${n}`) : null;
  }

  private identityHmac(doc: ExtractedDocument): string | null {
    const { surname, given_names, date_of_birth } = doc.fields;
    if (!surname.value || !date_of_birth.value) return null;
    return hmacHex(
      this.config.HMAC_SECRET,
      `id:${surname.value}|${given_names.value ?? ''}|${date_of_birth.value}`,
    );
  }

  private async reuseLookup(sessionId: string, doc: ExtractedDocument) {
    const ln = this.licenseHmac(doc);
    if (!ln) return null;
    const since = new Date(this.clock.now().getTime() - this.config.HARD_CUTOFF_DAYS * DAY);
    const conflicting = await this.results.countReuseConflicts(
      ln,
      this.identityHmac(doc),
      sessionId,
      since,
    );
    return { conflictingSessions: conflicting };
  }

  private async complete(
    session: Session,
    r: {
      doc: ExtractedDocument | null;
      checks: CheckResult[];
      decision: 'approved' | 'review' | 'rejected';
      reasons: string[];
      ocrConfidence: number | null;
      startedAt: number;
      raw?: { front: string; back: string };
    },
  ): Promise<void> {
    const now = this.clock.now();
    const processingMs = Math.round(performance.now() - r.startedAt);
    const fields = r.doc ? this.encryptor.encryptJson(r.doc) : null;
    const raw = r.raw ? this.encryptor.encryptJson(r.raw) : null;

    await this.uow.run(async (tx) => {
      await tx.results.saveExtraction(
        {
          session_id: session.id,
          fields_enc: fields?.envelope ?? null,
          raw_ocr_enc: raw?.envelope ?? null,
          enc_key_id: fields?.keyId ?? null,
          license_number_hmac: r.doc ? this.licenseHmac(r.doc) : null,
          identity_hmac: r.doc ? this.identityHmac(r.doc) : null,
          ocr_engine_version: r.doc ? this.analyzer.engineVersion : null,
          template_version: r.doc?.template ? `${r.doc.template}@1.0.0` : null,
          processing_ms: processingMs,
          ocr_mean_confidence: r.ocrConfidence,
        },
        now,
      );
      await tx.results.replaceChecks(session.id, r.checks, now);
      await transition(tx.sessions, session, 'completed', now, {
        completed_at: now,
        decision: r.decision,
        decision_reasons: r.reasons,
        template: r.doc?.template ?? null,
        country: r.doc?.country ?? null,
      });
      await enqueueWebhook(tx.jobs, session, 'session.completed', now);
    });

    if (!this.config.KEEP_ORIGINALS) await this.images.deleteImages(session.id, 'original');
    this.metrics.processingDuration.observe(processingMs / 1000);
    this.logger.info(
      {
        session_id: session.id,
        decision: r.decision,
        reasons: r.reasons,
        duration_ms: processingMs,
      },
      'session processed',
    );
  }
}
