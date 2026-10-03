import type { SessionStatus } from '@dlc/shared';
import type { Db } from '../../db/knex.js';
import type { StatusWriter } from './state-machine.js';
import type { Session, SessionPatch } from './session.types.js';

const json = <T>(v: unknown, fallback: T): T =>
  v === null || v === undefined ? fallback : ((typeof v === 'string' ? JSON.parse(v) : v) as T);

function toSession(row: Record<string, unknown>): Session {
  return {
    ...(row as unknown as Session),
    requirements: json(row.requirements_json, {}),
    decision_reasons: json(row.decision_reasons_json, []),
  };
}

function patchToRow(patch: SessionPatch): Record<string, unknown> {
  const { decision_reasons, ...rest } = patch;
  return {
    ...rest,
    ...(decision_reasons ? { decision_reasons_json: JSON.stringify(decision_reasons) } : {}),
  };
}

export interface NewSession {
  id: string;
  integrator_id: string;
  reference: string | null;
  token_hash: string;
  return_url: string;
  webhook_url: string | null;
  country_hint: string | null;
  locale: string | null;
  requirements: Record<string, unknown>;
  expires_at: Date;
}

export class SessionRepository implements StatusWriter {
  private readonly db: Db;

  constructor({ db }: { db: Db }) {
    this.db = db;
  }

  async insert(s: NewSession, now: Date): Promise<void> {
    const { requirements, ...rest } = s;
    await this.db('verification_session').insert({
      ...rest,
      status: 'created',
      requirements_json: JSON.stringify(requirements),
      created_at: now,
      updated_at: now,
    });
  }

  async findById(id: string): Promise<Session | null> {
    const row = await this.db('verification_session').where({ id }).first();
    return row ? toSession(row) : null;
  }

  async findForIntegrator(id: string, integratorId: string): Promise<Session | null> {
    const row = await this.db('verification_session')
      .where({ id, integrator_id: integratorId })
      .first();
    return row ? toSession(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = await this.db('verification_session').where({ token_hash: tokenHash }).first();
    return row ? toSession(row) : null;
  }

  async list(
    integratorId: string,
    q: { reference?: string; status?: SessionStatus; limit: number; cursor?: string },
  ): Promise<Session[]> {
    const query = this.db('verification_session')
      .where({ integrator_id: integratorId })
      .orderBy('id', 'desc')
      .limit(q.limit + 1);
    if (q.reference) query.andWhere({ reference: q.reference });
    if (q.status) query.andWhere({ status: q.status });
    if (q.cursor) query.andWhere('id', '<', q.cursor);
    return (await query).map(toSession);
  }

  async updateStatus(
    id: string,
    from: SessionStatus,
    to: SessionStatus,
    patch: SessionPatch,
    now: Date,
  ): Promise<number> {
    return this.db('verification_session')
      .where({ id, status: from })
      .update({ ...patchToRow(patch), status: to, updated_at: now });
  }

  /** Non-status columns (consent). Status changes go through the state machine. */
  async update(id: string, patch: Pick<SessionPatch, 'consent_version' | 'consent_at'>, now: Date) {
    await this.db('verification_session')
      .where({ id })
      .update({ ...patch, updated_at: now });
  }

  async markDeleted(id: string, now: Date, tombstone: boolean): Promise<void> {
    await this.db('verification_session')
      .where({ id })
      .update({
        deleted_at: now,
        pii_purged_at: now,
        updated_at: now,
        ...(tombstone
          ? {
              return_url: null,
              webhook_url: null,
              requirements_json: null,
              country_hint: null,
              locale: null,
            }
          : {}),
      });
  }

  async markPiiPurged(id: string, now: Date): Promise<void> {
    await this.db('verification_session')
      .where({ id })
      .update({ pii_purged_at: now, updated_at: now });
  }

  async findExpirable(now: Date, limit: number): Promise<Session[]> {
    const rows = await this.db('verification_session')
      .whereIn('status', ['created', 'in_progress'])
      .andWhere('expires_at', '<', now)
      .limit(limit);
    return rows.map(toSession);
  }

  /** Completed/failed sessions past their integrator's retention period, PII not yet purged. */
  async findRetentionDue(now: Date, limit: number): Promise<string[]> {
    const rows = await this.db('verification_session as s')
      .join('integrator as i', 'i.id', 's.integrator_id')
      .select('s.id')
      .whereIn('s.status', ['completed', 'failed'])
      .whereNull('s.pii_purged_at')
      .whereRaw(
        'COALESCE(s.completed_at, s.updated_at) < DATE_SUB(?, INTERVAL i.retention_days DAY)',
        [now],
      )
      .limit(limit);
    return rows.map((r: { id: string }) => r.id);
  }

  /** Expired or cancelled sessions whose uploads have not been purged yet. */
  async findAbandonedUnpurged(limit: number): Promise<string[]> {
    const rows = await this.db('verification_session')
      .select('id')
      .whereIn('status', ['expired', 'cancelled'])
      .whereNull('pii_purged_at')
      .limit(limit);
    return rows.map((r: { id: string }) => r.id);
  }

  /** Sessions created before the hard cutoff that are not yet tombstoned. */
  async findCreatedBefore(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.db('verification_session')
      .select('id')
      .where('created_at', '<', cutoff)
      .whereNull('deleted_at')
      .limit(limit);
    return rows.map((r: { id: string }) => r.id);
  }

  async countByStatus(): Promise<{ status: string; n: number }[]> {
    const rows = await this.db('verification_session')
      .select('status')
      .count({ n: '*' })
      .groupBy('status');
    return (rows as Record<string, unknown>[]).map((r) => ({
      status: String(r.status),
      n: Number(r.n),
    }));
  }

  async countByDecision(): Promise<{ decision: string; n: number }[]> {
    const rows = await this.db('verification_session')
      .select('decision')
      .count({ n: '*' })
      .whereNotNull('decision')
      .groupBy('decision');
    return (rows as Record<string, unknown>[]).map((r) => ({
      decision: String(r.decision),
      n: Number(r.n),
    }));
  }
}
