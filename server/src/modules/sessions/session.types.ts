import type { Decision, Requirements, SessionStatus } from '@dlc/shared';

export interface Session {
  id: string;
  integrator_id: string;
  reference: string | null;
  status: SessionStatus;
  token_hash: string;
  return_url: string | null;
  webhook_url: string | null;
  country_hint: string | null;
  locale: string | null;
  requirements: Requirements;
  consent_version: string | null;
  consent_at: Date | null;
  opened_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  expires_at: Date;
  decision: Decision | null;
  decision_reasons: string[];
  template: string | null;
  country: string | null;
  pii_purged_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Columns that may be written together with a status change. */
export type SessionPatch = Partial<{
  consent_version: string | null;
  consent_at: Date | null;
  opened_at: Date;
  submitted_at: Date;
  completed_at: Date;
  decision: Decision;
  decision_reasons: string[];
  template: string | null;
  country: string | null;
}>;
