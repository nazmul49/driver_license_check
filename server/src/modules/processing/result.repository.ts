import type { Db } from '../../db/knex.js';
import { newId } from '../../lib/ids.js';
import type { CheckResult } from '../checks/types.js';

export interface ExtractionRow {
  session_id: string;
  fields_enc: Buffer | null;
  raw_ocr_enc: Buffer | null;
  enc_key_id: string | null;
  license_number_hmac: string | null;
  identity_hmac: string | null;
  ocr_engine_version: string | null;
  template_version: string | null;
  processing_ms: number | null;
  ocr_mean_confidence: number | null;
}

export class ResultRepository {
  private readonly db: Db;

  constructor({ db }: { db: Db }) {
    this.db = db;
  }

  async saveExtraction(row: ExtractionRow, now: Date): Promise<void> {
    await this.db('extraction_result')
      .insert({ ...row, created_at: now })
      .onConflict('session_id')
      .merge();
  }

  findExtraction(sessionId: string): Promise<ExtractionRow | undefined> {
    return this.db('extraction_result').where({ session_id: sessionId }).first();
  }

  async replaceChecks(sessionId: string, checks: CheckResult[], now: Date): Promise<void> {
    await this.db('check_result').where({ session_id: sessionId }).delete();
    if (checks.length === 0) return;
    await this.db('check_result').insert(
      checks.map((c) => ({
        id: newId(),
        session_id: sessionId,
        code: c.code,
        status: c.status,
        severity: c.severity,
        message: c.message,
        details_json: c.details ? JSON.stringify(c.details) : null,
        created_at: now,
      })),
    );
  }

  async listChecks(sessionId: string): Promise<CheckResult[]> {
    const rows = await this.db('check_result').where({ session_id: sessionId }).orderBy('id');
    return rows.map((r) => ({
      code: r.code,
      status: r.status,
      severity: r.severity,
      message: r.message,
      ...(r.details_json
        ? {
            details:
              typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json,
          }
        : {}),
    }));
  }

  /** Remove personal fields; keep HMACs and metadata for statistics and reuse detection. */
  async purgeFields(sessionId: string): Promise<void> {
    await this.db('extraction_result')
      .where({ session_id: sessionId })
      .update({ fields_enc: null, raw_ocr_enc: null });
  }

  async deleteAll(sessionId: string): Promise<void> {
    await this.db('check_result').where({ session_id: sessionId }).delete();
    await this.db('extraction_result').where({ session_id: sessionId }).delete();
  }

  /**
   * Sessions that share the license number HMAC but have a different identity HMAC
   * (DOCUMENT_NUMBER_REUSED, SPEC 7.4).
   */
  async countReuseConflicts(
    licenseHmac: string,
    identityHmac: string | null,
    excludeSessionId: string,
    since: Date,
  ): Promise<number> {
    const q = this.db('extraction_result')
      .where({ license_number_hmac: licenseHmac })
      .andWhereNot('session_id', excludeSessionId)
      .andWhere('created_at', '>=', since);
    if (identityHmac)
      q.andWhere((b) => b.whereNot('identity_hmac', identityHmac).orWhereNull('identity_hmac'));
    const row = await q.count({ n: '*' }).first();
    return Number(row?.n ?? 0);
  }

  async checkFailCounts(): Promise<{ code: string; status: string; n: number }[]> {
    const rows = await this.db('check_result')
      .select('code', 'status')
      .count({ n: '*' })
      .whereIn('status', ['fail', 'warn'])
      .groupBy('code', 'status');
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: String(r.code),
      status: String(r.status),
      n: Number(r.n),
    }));
  }
}
