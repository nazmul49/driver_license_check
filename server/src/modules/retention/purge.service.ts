import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Config } from '../../config/index.js';
import type { Clock } from '../../lib/clock.js';
import type { Logger } from '../../lib/logger.js';
import type { ImageService } from '../images/image.service.js';
import type { ResultRepository } from '../processing/result.repository.js';
import type { SessionRepository } from '../sessions/session.repository.js';

export interface RetentionSettings {
  hardCutoffDays: number;
}

const DAY = 86_400_000;

/**
 * Removes personal data. Used by DELETE /v1/sessions/:id and by the hourly purge job
 * (SPEC 12 retention rules).
 */
@injectable()
export class PurgeService {
  private readonly sessions: SessionRepository;
  private readonly images: ImageService;
  private readonly results: ResultRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly settings: RetentionSettings;

  constructor(
    @inject(TOKENS.sessionRepository) sessionRepository: SessionRepository,
    @inject(TOKENS.imageService) imageService: ImageService,
    @inject(TOKENS.resultRepository) resultRepository: ResultRepository,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.logger) logger: Logger,
    @inject(TOKENS.config) config: Config,
  ) {
    this.sessions = sessionRepository;
    this.images = imageService;
    this.results = resultRepository;
    this.clock = clock;
    this.logger = logger;
    this.settings = { hardCutoffDays: config.HARD_CUTOFF_DAYS };
  }

  /** DELETE after submit: drop images and personal data now, keep a minimal tombstone. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.images.deleteImages(sessionId);
    await this.results.deleteAll(sessionId);
    await this.sessions.markDeleted(sessionId, this.clock.now(), true);
  }

  /** Images plus encrypted fields; HMACs and check results stay until the hard cutoff. */
  async purgePii(sessionId: string): Promise<void> {
    await this.images.deleteImages(sessionId);
    await this.results.purgeFields(sessionId);
    await this.sessions.markPiiPurged(sessionId, this.clock.now());
  }

  async run(): Promise<{ retention: number; abandoned: number; hardCutoff: number }> {
    const now = this.clock.now();
    let retention = 0;
    let abandoned = 0;
    let hardCutoff = 0;

    // 1. Completed/failed sessions past the integrator's retention period.
    for (const id of await this.sessions.findRetentionDue(now, 500)) {
      await this.purgePii(id);
      retention++;
    }

    // 2. Expired or cancelled sessions: remove any uploaded images.
    for (const id of await this.sessions.findAbandonedUnpurged(500)) {
      await this.purgePii(id);
      abandoned++;
    }

    // 3. Hard cutoff: HMACs and check results go too; the session row remains as a tombstone.
    const cutoff = new Date(now.getTime() - this.settings.hardCutoffDays * DAY);
    for (const id of await this.sessions.findCreatedBefore(cutoff, 500)) {
      await this.deleteSession(id);
      hardCutoff++;
    }

    if (retention || abandoned || hardCutoff) {
      this.logger.info({ retention, abandoned, hardCutoff }, 'retention purge');
    }
    return { retention, abandoned, hardCutoff };
  }
}
