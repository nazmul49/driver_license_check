import type { Cradle } from '../../container.js';
import { createHash } from 'node:crypto';
import {
  RESULT_STATEMENT_NOT_PASSED,
  RESULT_STATEMENT_PASSED,
  type CreateSessionInput,
  type CreateSessionResponse,
  type DocumentFields,
  type ListSessionsQuery,
  type SessionDto,
  type SessionListDto,
} from '@dlc/shared';
import type { Clock } from '../../lib/clock.js';
import type { Encryptor } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { newSessionId, randomToken } from '../../lib/ids.js';
import type { ExtractedDocument } from '../checks/types.js';
import { summarize } from '../decision/decision.js';
import type { Integrator } from '../integrators/integrator.types.js';
import type { ResultRepository } from '../processing/result.repository.js';
import type { PurgeService } from '../retention/purge.service.js';
import type { SessionRepository } from './session.repository.js';
import type { Session } from './session.types.js';
import { PRE_SUBMIT_STATUSES, transition } from './state-machine.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase();
    return e.startsWith('*.')
      ? host.endsWith(e.slice(1)) && host.length > e.length - 1
      : host === e;
  });
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function toPublicFields(doc: ExtractedDocument): DocumentFields {
  const f = (name: keyof ExtractedDocument['fields']) => {
    const field = doc.fields[name];
    return {
      value: field.value,
      confidence: Math.round(field.confidence * 100) / 100,
      ...(field.low_confidence ? { low_confidence: true } : {}),
    };
  };
  return {
    surname: f('surname'),
    given_names: f('given_names'),
    date_of_birth: f('date_of_birth'),
    place_of_birth: f('place_of_birth'),
    issue_date: f('issue_date'),
    expiry_date: f('expiry_date'),
    issuing_authority: f('issuing_authority'),
    license_number: f('license_number'),
    categories: doc.categories.map((c) => ({
      code: c.code,
      issue_date: c.issue_date,
      expiry_date: c.expiry_date,
      restrictions: c.restrictions,
    })),
  };
}

export class SessionService {
  private readonly sessions: SessionRepository;
  private readonly results: ResultRepository;
  private readonly purge: PurgeService;
  private readonly encryptor: Encryptor;
  private readonly clock: Clock;
  private readonly opts: { publicBaseUrl: string; allowHttp: boolean };

  constructor({
    sessionRepository,
    resultRepository,
    purgeService,
    encryptor,
    clock,
    config,
  }: Pick<
    Cradle,
    'sessionRepository' | 'resultRepository' | 'purgeService' | 'encryptor' | 'clock' | 'config'
  >) {
    this.sessions = sessionRepository;
    this.results = resultRepository;
    this.purge = purgeService;
    this.encryptor = encryptor;
    this.clock = clock;
    this.opts = { publicBaseUrl: config.publicBaseUrl, allowHttp: config.isDev };
  }

  private validateUrl(raw: string, field: string, integrator: Integrator): void {
    const url = new URL(raw);
    const okProtocol =
      url.protocol === 'https:' || (this.opts.allowHttp && url.protocol === 'http:');
    if (!okProtocol) {
      throw new AppError('VALIDATION_ERROR', `${field} must use HTTPS.`, [
        { path: [field], message: 'HTTPS required' },
      ]);
    }
    if (!hostAllowed(url.hostname, integrator.return_url_hosts)) {
      throw new AppError('VALIDATION_ERROR', `${field} host is not in the integrator allowlist.`, [
        { path: [field], message: 'Host not allowed' },
      ]);
    }
  }

  async create(integrator: Integrator, input: CreateSessionInput): Promise<CreateSessionResponse> {
    this.validateUrl(input.return_url, 'return_url', integrator);
    if (input.webhook_url) this.validateUrl(input.webhook_url, 'webhook_url', integrator);
    const now = this.clock.now();
    const token = randomToken(32);
    const id = newSessionId();
    const expiresAt = new Date(now.getTime() + input.expires_in_seconds * 1000);
    await this.sessions.insert(
      {
        id,
        integrator_id: integrator.id,
        reference: input.reference ?? null,
        token_hash: hashToken(token),
        return_url: input.return_url,
        webhook_url: input.webhook_url ?? null,
        country_hint: input.country_hint ?? null,
        locale: input.locale ?? null,
        requirements: { ...(integrator.default_requirements ?? {}), ...(input.requirements ?? {}) },
        expires_at: expiresAt,
      },
      now,
    );
    return {
      id,
      status: 'created',
      hosted_url: `${this.opts.publicBaseUrl}/s/${token}`,
      expires_at: expiresAt.toISOString(),
    };
  }

  async getForIntegrator(integrator: Integrator, id: string): Promise<Session> {
    const session = await this.sessions.findForIntegrator(id, integrator.id);
    if (!session) throw notFound();
    return session;
  }

  async getDto(integrator: Integrator, id: string): Promise<SessionDto> {
    return this.toDto(await this.getForIntegrator(integrator, id), true);
  }

  async list(integrator: Integrator, q: ListSessionsQuery): Promise<SessionListDto> {
    const rows = await this.sessions.list(integrator.id, q);
    const page = rows.slice(0, q.limit);
    return {
      data: await Promise.all(page.map((s) => this.toDto(s, false))),
      next_cursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  async delete(integrator: Integrator, id: string): Promise<void> {
    const session = await this.getForIntegrator(integrator, id);
    if (session.deleted_at) return;
    if (PRE_SUBMIT_STATUSES.includes(session.status)) {
      await transition(this.sessions, session, 'cancelled', this.clock.now());
      // Anything uploaded before cancel goes now rather than waiting for the purge job.
      await this.purge.purgePii(session.id);
      return;
    }
    await this.purge.deleteSession(session.id);
  }

  async toDto(session: Session, withResult: boolean): Promise<SessionDto> {
    const dto: SessionDto = {
      id: session.id,
      reference: session.reference,
      status: session.status,
      created_at: iso(session.created_at)!,
      expires_at: iso(session.expires_at)!,
      opened_at: iso(session.opened_at),
      submitted_at: iso(session.submitted_at),
      completed_at: iso(session.completed_at),
      deleted_at: iso(session.deleted_at),
      decision: session.decision,
    };
    if (!withResult || session.status !== 'completed' || !session.decision || session.deleted_at)
      return dto;

    const checks = await this.results.listChecks(session.id);
    const extraction = await this.results.findExtraction(session.id);
    const fields = extraction?.fields_enc
      ? toPublicFields(this.encryptor.decryptJson<ExtractedDocument>(extraction.fields_enc))
      : null;
    dto.result = {
      decision: session.decision,
      decision_reasons: session.decision_reasons,
      statement:
        session.decision === 'approved' ? RESULT_STATEMENT_PASSED : RESULT_STATEMENT_NOT_PASSED,
      document: {
        type: 'driver_license',
        template: session.template,
        country: session.country,
        fields,
      },
      checks,
      summary: summarize(checks),
    };
    return dto;
  }
}
