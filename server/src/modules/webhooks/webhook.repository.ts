import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Db } from '../../db/knex.js';

export interface WebhookDeliveryRow {
  id: string;
  session_id: string;
  integrator_id: string;
  event_id: string;
  event: string;
  url: string;
  attempt: number;
  response_status: number | null;
  response_ms: number | null;
  error: string | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

@injectable()
export class WebhookRepository {
  constructor(@inject(TOKENS.db) private readonly db: Db) {}

  async insert(row: WebhookDeliveryRow): Promise<void> {
    await this.db('webhook_delivery').insert(row);
  }

  listForSession(sessionId: string): Promise<WebhookDeliveryRow[]> {
    return this.db('webhook_delivery')
      .where({ session_id: sessionId })
      .orderBy('created_at')
      .orderBy('attempt');
  }
}
