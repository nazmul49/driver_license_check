import type { Requirements } from '@dlc/shared';
import type { DecisionPolicy } from '../decision/decision.js';

export interface Integrator {
  id: string;
  name: string;
  display_name: string;
  logo_url: string | null;
  theme: { primary_color?: string } | null;
  return_url_hosts: string[];
  webhook_secret_enc: Buffer | null;
  default_requirements: Requirements | null;
  decision_policy: Partial<DecisionPolicy> | null;
  allow_image_download: boolean;
  allow_reopen: boolean;
  retention_days: number;
  disabled_at: Date | null;
}

export interface ApiKeyRow {
  id: string;
  integrator_id: string;
  prefix: string;
  key_hash: string;
  mode: 'live' | 'test';
  revoked_at: Date | null;
}
