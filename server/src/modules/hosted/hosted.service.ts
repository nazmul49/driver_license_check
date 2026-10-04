import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Config } from '../../config/index.js';
import {
  CONSENT_VERSION,
  type HostedSessionInfo,
  type HostedStatusResponse,
  type HostedSubmitResponse,
  type ImageSide,
} from '@dlc/shared';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { ImageService } from '../images/image.service.js';
import type { IntegratorRepository } from '../integrators/integrator.repository.js';
import type { SessionRepository } from '../sessions/session.repository.js';
import { hashToken } from '../sessions/session.service.js';
import type { Session } from '../sessions/session.types.js';
import { PRE_SUBMIT_STATUSES, transition } from '../sessions/state-machine.js';
import { enqueueWebhook } from '../webhooks/webhook-events.js';

export interface OpenResult {
  session: Session;
  info: HostedSessionInfo;
}

export function buildRedirectUrl(returnUrl: string, sessionId: string, status: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set('session_id', sessionId);
  url.searchParams.set('status', status);
  return url.toString();
}

@injectable()
export class HostedService {
  private readonly uow: UnitOfWork;
  private readonly sessions: SessionRepository;
  private readonly integrators: IntegratorRepository;
  private readonly images: ImageService;
  private readonly clock: Clock;
  private readonly opts: { desktopHandoff: boolean };

  constructor(
    @inject(TOKENS.uow) uow: UnitOfWork,
    @inject(TOKENS.sessionRepository) sessionRepository: SessionRepository,
    @inject(TOKENS.integratorRepository) integratorRepository: IntegratorRepository,
    @inject(TOKENS.imageService) imageService: ImageService,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.config) config: Config,
  ) {
    this.uow = uow;
    this.sessions = sessionRepository;
    this.integrators = integratorRepository;
    this.images = imageService;
    this.clock = clock;
    this.opts = { desktopHandoff: config.DESKTOP_HANDOFF_ENABLED };
  }

  /** Move an overdue pre-submit session to expired (and queue its webhook). */
  private async expireIfDue(session: Session): Promise<boolean> {
    const now = this.clock.now();
    if (PRE_SUBMIT_STATUSES.includes(session.status) && new Date(session.expires_at) <= now) {
      await this.uow
        .run(async (tx) => {
          await transition(tx.sessions, session, 'expired', now);
          await enqueueWebhook(tx.jobs, session, 'session.expired', now);
        })
        .catch(() => undefined); // Lost a race with the expiry job: fine, it is expired either way.
      return true;
    }
    return session.status === 'expired';
  }

  /**
   * Token exchange (SPEC 10.1). The token is single use: once the session is in progress it can
   * only be reopened with the session cookie, or from another device when the integrator allows
   * reopen (desktop to phone handoff).
   */
  async open(token: string, cookieSessionId: string | null): Promise<OpenResult> {
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (!session || session.deleted_at)
      throw new AppError('SESSION_NOT_FOUND', 'This link is not valid.');
    if (session.status === 'cancelled')
      throw new AppError('SESSION_EXPIRED', 'This link is no longer valid.');
    if (await this.expireIfDue(session))
      throw new AppError('SESSION_EXPIRED', 'This link has expired.');

    const integrator = (await this.integrators.findById(session.integrator_id))!;
    const hasCookie = cookieSessionId === session.id;

    if (session.status === 'created') {
      const now = this.clock.now();
      await transition(this.sessions, session, 'in_progress', now, { opened_at: now });
    } else if (!hasCookie && !(integrator.allow_reopen && session.status === 'in_progress')) {
      throw new AppError('LINK_ALREADY_USED', 'This link has already been used.');
    }
    const fresh = (await this.sessions.findById(session.id))!;
    return { session: fresh, info: await this.info(fresh) };
  }

  async load(sessionId: string): Promise<Session> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.deleted_at)
      throw new AppError('SESSION_NOT_FOUND', 'Session not found.');
    return session;
  }

  /** Loads a session that must still accept end-user input. */
  private async loadActive(sessionId: string): Promise<Session> {
    const session = await this.load(sessionId);
    if (await this.expireIfDue(session))
      throw new AppError('SESSION_EXPIRED', 'This session has expired.');
    if (session.status !== 'in_progress')
      throw new AppError('INVALID_STATE', 'This session no longer accepts changes.');
    return session;
  }

  async info(session: Session): Promise<HostedSessionInfo> {
    const integrator = (await this.integrators.findById(session.integrator_id))!;
    return {
      integrator: {
        display_name: integrator.display_name,
        logo_url: integrator.logo_url,
        primary_color: integrator.theme?.primary_color ?? null,
      },
      locale: session.locale === 'en' || session.locale === 'nb' ? session.locale : null,
      status: session.status,
      uploaded: await this.images.uploadedSides(session.id),
      consent: {
        required_version: CONSENT_VERSION,
        accepted: session.consent_version === CONSENT_VERSION && session.consent_at !== null,
      },
      expires_at: new Date(session.expires_at).toISOString(),
      desktop_handoff: this.opts.desktopHandoff && integrator.allow_reopen,
    };
  }

  async consent(sessionId: string, version: string): Promise<void> {
    const session = await this.loadActive(sessionId);
    if (version !== CONSENT_VERSION)
      throw new AppError('VALIDATION_ERROR', 'Unknown consent version.');
    const now = this.clock.now();
    await this.sessions.update(session.id, { consent_version: version, consent_at: now }, now);
  }

  async upload(
    sessionId: string,
    side: ImageSide,
    file: Buffer,
  ): Promise<{ front: boolean; back: boolean }> {
    const session = await this.loadActive(sessionId);
    if (!session.consent_at)
      throw new AppError('INVALID_STATE', 'Consent is required before uploading.');
    const img = await this.images.normalizeUpload(file);
    await this.images.save(session.id, side, 'original', { ...img, mime: 'image/jpeg' });
    return this.images.uploadedSides(session.id);
  }

  async submit(sessionId: string): Promise<HostedSubmitResponse> {
    const session = await this.loadActive(sessionId);
    if (!session.consent_at) throw new AppError('INVALID_STATE', 'Consent is required.');
    const uploaded = await this.images.uploadedSides(session.id);
    if (!uploaded.front || !uploaded.back) {
      throw new AppError('INVALID_STATE', 'Both front and back images are required.');
    }
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await transition(tx.sessions, session, 'submitted', now, { submitted_at: now });
      await tx.jobs.enqueue('process_session', { session_id: session.id }, now);
    });
    return {
      status: 'submitted',
      redirect_url: buildRedirectUrl(session.return_url!, session.id, 'submitted'),
    };
  }

  async status(sessionId: string): Promise<HostedStatusResponse> {
    const session = await this.load(sessionId);
    await this.expireIfDue(session);
    const fresh = (await this.sessions.findById(session.id))!;
    const done =
      !PRE_SUBMIT_STATUSES.includes(fresh.status) &&
      fresh.status !== 'expired' &&
      fresh.status !== 'cancelled';
    return {
      status: fresh.status,
      redirect_url:
        done && fresh.return_url ? buildRedirectUrl(fresh.return_url, fresh.id, 'submitted') : null,
    };
  }
}
