import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Db } from '../../db/knex.js';

export interface AuditRow {
  actor_type: 'integrator' | 'end_user' | 'system' | 'admin';
  actor_id: string | null;
  action: string;
  session_id: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

@injectable()
export class AuditRepository {
  constructor(@inject(TOKENS.db) private readonly db: Db) {}

  async insert(row: AuditRow): Promise<void> {
    await this.db('audit_log').insert(row);
  }

  listForSession(sessionId: string): Promise<(AuditRow & { id: number })[]> {
    return this.db('audit_log').where({ session_id: sessionId }).orderBy('id');
  }
}
