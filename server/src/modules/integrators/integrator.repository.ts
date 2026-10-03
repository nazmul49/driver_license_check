import type { Db } from '../../db/knex.js';
import type { ApiKeyRow, Integrator } from './integrator.types.js';

const parseJson = <T>(v: unknown): T | null => {
  if (v === null || v === undefined) return null;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
};

function toIntegrator(row: Record<string, unknown>): Integrator {
  return {
    id: row.id as string,
    name: row.name as string,
    display_name: row.display_name as string,
    logo_url: (row.logo_url as string | null) ?? null,
    theme: parseJson(row.theme_json),
    return_url_hosts: parseJson<string[]>(row.return_url_hosts_json) ?? [],
    webhook_secret_enc: (row.webhook_secret_enc as Buffer | null) ?? null,
    default_requirements: parseJson(row.default_requirements_json),
    decision_policy: parseJson(row.decision_policy_json),
    allow_image_download: Boolean(row.allow_image_download),
    allow_reopen: Boolean(row.allow_reopen),
    retention_days: Number(row.retention_days),
    disabled_at: (row.disabled_at as Date | null) ?? null,
  };
}

export interface NewIntegrator {
  id: string;
  name: string;
  display_name: string;
  logo_url?: string | null;
  theme?: Integrator['theme'];
  return_url_hosts: string[];
  webhook_secret_enc: Buffer | null;
  default_requirements?: Integrator['default_requirements'];
  decision_policy?: Integrator['decision_policy'];
  allow_image_download?: boolean;
  allow_reopen?: boolean;
  retention_days: number;
}

export class IntegratorRepository {
  private readonly db: Db;

  constructor({ db }: { db: Db }) {
    this.db = db;
  }

  async findById(id: string): Promise<Integrator | null> {
    const row = await this.db('integrator').where({ id }).first();
    return row ? toIntegrator(row) : null;
  }

  async findByName(name: string): Promise<Integrator | null> {
    const row = await this.db('integrator').where({ name }).first();
    return row ? toIntegrator(row) : null;
  }

  async listAll(): Promise<Integrator[]> {
    const rows = await this.db('integrator').select('*').orderBy('created_at');
    return rows.map(toIntegrator);
  }

  async insert(data: NewIntegrator, now: Date): Promise<void> {
    await this.db('integrator').insert({
      id: data.id,
      name: data.name,
      display_name: data.display_name,
      logo_url: data.logo_url ?? null,
      theme_json: data.theme ? JSON.stringify(data.theme) : null,
      return_url_hosts_json: JSON.stringify(data.return_url_hosts),
      webhook_secret_enc: data.webhook_secret_enc,
      default_requirements_json: data.default_requirements
        ? JSON.stringify(data.default_requirements)
        : null,
      decision_policy_json: data.decision_policy ? JSON.stringify(data.decision_policy) : null,
      allow_image_download: data.allow_image_download ?? false,
      allow_reopen: data.allow_reopen ?? false,
      retention_days: data.retention_days,
      created_at: now,
      updated_at: now,
    });
  }

  async update(id: string, patch: Record<string, unknown>, now: Date): Promise<void> {
    await this.db('integrator')
      .where({ id })
      .update({ ...patch, updated_at: now });
  }

  async findKeysByPrefix(prefix: string): Promise<ApiKeyRow[]> {
    return this.db('api_key').where({ prefix }).whereNull('revoked_at');
  }

  async insertKey(row: Omit<ApiKeyRow, 'revoked_at'>, now: Date): Promise<void> {
    await this.db('api_key').insert({ ...row, created_at: now });
  }

  async touchKey(id: string, now: Date): Promise<void> {
    await this.db('api_key').where({ id }).update({ last_used_at: now });
  }

  async revokeKey(id: string, now: Date): Promise<number> {
    return this.db('api_key').where({ id }).whereNull('revoked_at').update({ revoked_at: now });
  }
}
