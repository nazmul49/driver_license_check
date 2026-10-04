import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { enqueueWebhook } from '../webhooks/webhook-events.js';
import type { SessionRepository } from './session.repository.js';
import { transition } from './state-machine.js';

/** Expiry job (SPEC 2 M2): sessions not submitted before expires_at become expired. */
@injectable()
export class ExpiryService {
  private readonly uow: UnitOfWork;
  private readonly sessions: SessionRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(
    @inject(TOKENS.uow) uow: UnitOfWork,
    @inject(TOKENS.sessionRepository) sessionRepository: SessionRepository,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.logger) logger: Logger,
  ) {
    this.uow = uow;
    this.sessions = sessionRepository;
    this.clock = clock;
    this.logger = logger;
  }

  async run(batch = 200): Promise<number> {
    const now = this.clock.now();
    let expired = 0;
    for (const session of await this.sessions.findExpirable(now, batch)) {
      try {
        await this.uow.run(async (tx) => {
          await transition(tx.sessions, session, 'expired', now);
          await enqueueWebhook(tx.jobs, session, 'session.expired', now);
        });
        expired++;
      } catch (err) {
        // Another worker or a hosted request moved it first.
        if (!(err instanceof AppError && err.code === 'INVALID_STATE')) throw err;
      }
    }
    if (expired) this.logger.info({ expired }, 'expired sessions');
    return expired;
  }
}
