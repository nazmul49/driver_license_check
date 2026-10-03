import type { ImageSide } from '@dlc/shared';
import type { Db } from '../../db/knex.js';

export type ImageKind = 'original' | 'processed';

export interface SessionImage {
  id: string;
  session_id: string;
  side: ImageSide;
  kind: ImageKind;
  storage_key: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  phash: string | null;
  enc_key_id: string;
  created_at: Date;
  deleted_at: Date | null;
}

export class ImageRepository {
  private readonly db: Db;

  constructor({ db }: { db: Db }) {
    this.db = db;
  }

  async upsert(img: Omit<SessionImage, 'deleted_at'>): Promise<void> {
    await this.db('session_image')
      .insert({ ...img, deleted_at: null })
      .onConflict(['session_id', 'side', 'kind'])
      .merge();
  }

  find(sessionId: string, side: ImageSide, kind: ImageKind): Promise<SessionImage | undefined> {
    return this.db('session_image')
      .where({ session_id: sessionId, side, kind })
      .whereNull('deleted_at')
      .first();
  }

  listActive(sessionId: string): Promise<SessionImage[]> {
    return this.db('session_image').where({ session_id: sessionId }).whereNull('deleted_at');
  }

  async markDeleted(ids: string[], now: Date): Promise<void> {
    if (ids.length) await this.db('session_image').whereIn('id', ids).update({ deleted_at: now });
  }

  /** Perceptual hashes of live processed images from other sessions inside the window. */
  async findPhashMatches(
    phashes: string[],
    excludeSessionId: string,
    since: Date,
  ): Promise<string[]> {
    if (phashes.length === 0) return [];
    const rows = await this.db('session_image')
      .select('phash')
      .whereIn('phash', phashes)
      .andWhereNot('session_id', excludeSessionId)
      .andWhere('created_at', '>=', since)
      .andWhere({ kind: 'processed' });
    return rows.map((r) => r.phash as string);
  }

  /** Recent processed-image hashes from other sessions for near-match comparison. */
  async recentPhashes(excludeSessionId: string, since: Date, limit: number): Promise<string[]> {
    const rows = await this.db('session_image')
      .select('phash')
      .whereNotNull('phash')
      .andWhereNot('session_id', excludeSessionId)
      .andWhere('created_at', '>=', since)
      .andWhere({ kind: 'processed' })
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map((r) => r.phash as string);
  }
}
