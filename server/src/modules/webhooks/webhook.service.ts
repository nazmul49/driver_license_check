import type { WebhookBody } from '@dlc/shared';
import type { Cradle } from '../../container.js';
import type { Clock } from '../../lib/clock.js';
import { newId } from '../../lib/ids.js';
import type { Logger } from '../../lib/logger.js';
import type { IntegratorService } from '../integrators/integrator.service.js';
import type { IntegratorRepository } from '../integrators/integrator.repository.js';
import type { JobRepository } from '../jobs/job.repository.js';
import type { SessionRepository } from '../sessions/session.repository.js';
import type { DeliverWebhookPayload } from './webhook-events.js';
import type { WebhookRepository } from './webhook.repository.js';
import { signWebhook } from './webhook-signature.js';

/** Delays after attempt 1, 2, ... (SPEC 5.4): 1m, 5m, 30m, 2h, 6h, then give up. */
export const WEBHOOK_BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600];
export const WEBHOOK_TIMEOUT_MS = 10_000;

export type HttpFetch = typeof fetch;

export class WebhookService {
  private readonly sessions: SessionRepository;
  private readonly integratorRepo: IntegratorRepository;
  private readonly integrators: IntegratorService;
  private readonly deliveries: WebhookRepository;
  private readonly jobs: JobRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly http: HttpFetch;

  constructor(
    c: Pick<
      Cradle,
      | 'sessionRepository'
      | 'integratorRepository'
      | 'integratorService'
      | 'webhookRepository'
      | 'jobRepository'
      | 'clock'
      | 'logger'
      | 'httpFetch'
    >,
  ) {
    this.sessions = c.sessionRepository;
    this.integratorRepo = c.integratorRepository;
    this.integrators = c.integratorService;
    this.deliveries = c.webhookRepository;
    this.jobs = c.jobRepository;
    this.clock = c.clock;
    this.logger = c.logger;
    this.http = c.httpFetch;
  }

  /** One delivery attempt. Schedules the next attempt itself on failure. */
  async deliver(p: DeliverWebhookPayload): Promise<'delivered' | 'retry' | 'gave_up' | 'skipped'> {
    const session = await this.sessions.findById(p.session_id);
    if (!session?.webhook_url) return 'skipped';
    const integrator = await this.integratorRepo.findById(session.integrator_id);
    const secret = integrator ? this.integrators.webhookSecret(integrator) : null;
    if (!integrator || !secret) return 'skipped';

    const payload: WebhookBody = {
      event: p.event,
      session_id: session.id,
      reference: session.reference,
      status: session.status,
      decision: session.decision,
      occurred_at: p.occurred_at,
    };
    const body = JSON.stringify(payload);
    const now = this.clock.now();
    const signature = signWebhook(secret, body, Math.floor(now.getTime() / 1000));

    const start = performance.now();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await this.http(session.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dlc-webhooks/1',
          'X-DLC-Signature': signature,
          'X-DLC-Event-Id': p.event_id,
          'X-DLC-Event': p.event,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
    } catch (err) {
      error = (err as Error).name === 'TimeoutError' ? 'timeout' : 'network_error';
    }
    const ok = status !== null && status >= 200 && status < 300;
    const delay = WEBHOOK_BACKOFF_SECONDS[p.attempt - 1];
    const nextAt = !ok && delay !== undefined ? new Date(now.getTime() + delay * 1000) : null;

    await this.deliveries.insert({
      id: newId(),
      session_id: session.id,
      integrator_id: integrator.id,
      event_id: p.event_id,
      event: p.event,
      url: session.webhook_url,
      attempt: p.attempt,
      response_status: status,
      response_ms: Math.round(performance.now() - start),
      error: ok ? null : (error ?? `http_${status}`),
      next_attempt_at: nextAt,
      delivered_at: ok ? now : null,
      created_at: now,
    });

    if (ok) return 'delivered';
    if (!nextAt) {
      this.logger.warn(
        { session_id: session.id, event_id: p.event_id, attempts: p.attempt },
        'webhook gave up',
      );
      return 'gave_up';
    }
    await this.jobs.enqueue('deliver_webhook', { ...p, attempt: p.attempt + 1 }, now, nextAt);
    return 'retry';
  }
}
