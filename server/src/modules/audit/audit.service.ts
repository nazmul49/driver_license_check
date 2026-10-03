import type { Cradle } from '../../container.js';
import type { Clock } from '../../lib/clock.js';
import { hmacHex } from '../../lib/crypto.js';
import type { AuditRepository } from './audit.repository.js';

export type ActorType = 'integrator' | 'end_user' | 'system' | 'admin';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Audit trail. Holds no document data; the IP is stored as a keyed hash (SPEC 11). */
export class AuditService {
  private readonly repo: AuditRepository;
  private readonly clock: Clock;
  private readonly secret: string;

  constructor({
    auditRepository,
    clock,
    config,
  }: Pick<Cradle, 'auditRepository' | 'clock' | 'config'>) {
    this.repo = auditRepository;
    this.clock = clock;
    this.secret = config.HMAC_SECRET;
  }

  async record(e: AuditEntry): Promise<void> {
    await this.repo.insert({
      actor_type: e.actorType,
      actor_id: e.actorId ?? null,
      action: e.action,
      session_id: e.sessionId ?? null,
      ip_hash: e.ip ? hmacHex(this.secret, `ip:${e.ip}`) : null,
      user_agent: e.userAgent ? e.userAgent.slice(0, 512) : null,
      request_id: e.requestId ?? null,
      created_at: this.clock.now(),
    });
  }

  list(sessionId: string) {
    return this.repo.listForSession(sessionId);
  }
}
