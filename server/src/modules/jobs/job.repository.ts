import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Db } from '../../db/knex.js';

export type JobType = 'process_session' | 'deliver_webhook';

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * MySQL-backed job queue (SPEC 4). Claiming uses SELECT ... FOR UPDATE SKIP LOCKED so several
 * workers can poll the same table without handing the same job to two of them.
 */
@injectable()
export class JobRepository {
  constructor(@inject(TOKENS.db) private readonly db: Db) {}

  async enqueue(
    type: JobType,
    payload: Record<string, unknown>,
    now: Date,
    runAfter: Date = now,
  ): Promise<number> {
    const [id] = await this.db('job').insert({
      type,
      payload_json: JSON.stringify(payload),
      status: 'queued',
      attempts: 0,
      run_after: runAfter,
      created_at: now,
      updated_at: now,
    });
    return Number(id);
  }

  async claim(workerId: string, now: Date, types?: JobType[]): Promise<Job | null> {
    return this.db.transaction(async (trx) => {
      const q = trx('job')
        .where({ status: 'queued' })
        .andWhere('run_after', '<=', now)
        .orderBy('id')
        .limit(1)
        .forUpdate()
        .skipLocked();
      if (types) q.whereIn('type', types);
      const row = await q.first();
      if (!row) return null;
      await trx('job')
        .where({ id: row.id })
        .update({
          status: 'running',
          locked_by: workerId,
          locked_at: now,
          attempts: row.attempts + 1,
          updated_at: now,
        });
      const payload =
        typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
      return { id: Number(row.id), type: row.type, payload, attempts: row.attempts + 1 };
    });
  }

  async complete(id: number, now: Date): Promise<void> {
    await this.db('job').where({ id }).update({ status: 'done', locked_by: null, updated_at: now });
  }

  async retry(id: number, runAfter: Date, error: string, now: Date): Promise<void> {
    await this.db('job')
      .where({ id })
      .update({
        status: 'queued',
        run_after: runAfter,
        last_error: error.slice(0, 2000),
        locked_by: null,
        updated_at: now,
      });
  }

  async fail(id: number, error: string, now: Date): Promise<void> {
    await this.db('job')
      .where({ id })
      .update({
        status: 'failed',
        last_error: error.slice(0, 2000),
        locked_by: null,
        updated_at: now,
      });
  }

  /** Jobs whose worker died mid-run go back to the queue. */
  async requeueStale(olderThan: Date, now: Date): Promise<number> {
    return this.db('job')
      .where({ status: 'running' })
      .andWhere('locked_at', '<', olderThan)
      .update({ status: 'queued', locked_by: null, run_after: now, updated_at: now });
  }

  async queueDepth(): Promise<number> {
    const row = await this.db('job').where({ status: 'queued' }).count({ n: '*' }).first();
    return Number(row?.n ?? 0);
  }
}
