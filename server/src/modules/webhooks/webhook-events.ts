import type { WebhookEvent } from '@dlc/shared';
import { newEventId } from '../../lib/ids.js';
import type { JobRepository } from '../jobs/job.repository.js';

export interface DeliverWebhookPayload {
  [key: string]: unknown;
  session_id: string;
  event: WebhookEvent;
  event_id: string;
  occurred_at: string;
  attempt: number;
}

/** Queue a webhook for a session transition (SPEC 5.4). No-op when the session has no URL. */
export async function enqueueWebhook(
  jobs: JobRepository,
  session: { id: string; webhook_url: string | null },
  event: WebhookEvent,
  now: Date,
): Promise<void> {
  if (!session.webhook_url) return;
  const payload: DeliverWebhookPayload = {
    session_id: session.id,
    event,
    event_id: newEventId(),
    occurred_at: now.toISOString(),
    attempt: 1,
  };
  await jobs.enqueue('deliver_webhook', payload, now);
}
