import { z } from 'zod';
import {
  CHECK_STATUSES,
  DECISIONS,
  IMAGE_SIDES,
  LOCALES,
  SESSION_STATUSES,
  SEVERITIES,
} from './enums.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'Expected ISO 3166-1 alpha-2 code')
  .transform((s) => s.toUpperCase());

export const RequirementsSchema = z
  .object({
    min_age: z.number().int().min(0).max(120).optional(),
    required_categories: z.array(z.string().min(1).max(8)).max(32).optional(),
    min_remaining_validity_days: z.number().int().min(0).max(36500).optional(),
    min_years_held: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export type Requirements = z.infer<typeof RequirementsSchema>;

export const CreateSessionRequestSchema = z
  .object({
    reference: z.string().min(1).max(128).optional(),
    return_url: z.string().url().max(2048),
    webhook_url: z.string().url().max(2048).optional(),
    country_hint: countryCode.optional(),
    locale: z.enum(LOCALES).optional(),
    expires_in_seconds: z.number().int().min(300).max(86400).default(1800),
    requirements: RequirementsSchema.optional(),
  })
  .strict();
export type CreateSessionRequest = z.input<typeof CreateSessionRequestSchema>;
export type CreateSessionInput = z.output<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.object({
  id: z.string(),
  status: z.enum(SESSION_STATUSES),
  hosted_url: z.string(),
  expires_at: z.string(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const ListSessionsQuerySchema = z
  .object({
    reference: z.string().min(1).max(128).optional(),
    status: z.enum(SESSION_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
  })
  .strict();
export type ListSessionsQuery = z.output<typeof ListSessionsQuerySchema>;

export const SessionIdParamSchema = z.object({
  id: z.string().regex(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid session id'),
});

export const ImageSideParamSchema = z.object({ side: z.enum(IMAGE_SIDES) });

/* ---------- Result payloads ---------- */

export interface FieldValue<T = string> {
  value: T | null;
  confidence: number;
  low_confidence?: boolean;
}

export interface CategoryEntry {
  code: string;
  issue_date: string | null;
  expiry_date: string | null;
  restrictions: string[];
}

export interface DocumentFields {
  surname: FieldValue;
  given_names: FieldValue;
  date_of_birth: FieldValue;
  place_of_birth: FieldValue;
  issue_date: FieldValue;
  expiry_date: FieldValue;
  issuing_authority: FieldValue;
  license_number: FieldValue;
  categories: CategoryEntry[];
}

export const CheckResultSchema = z.object({
  code: z.string(),
  status: z.enum(CHECK_STATUSES),
  severity: z.enum(SEVERITIES),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type CheckResultDto = z.infer<typeof CheckResultSchema>;

export interface SessionResult {
  decision: (typeof DECISIONS)[number];
  decision_reasons: string[];
  /** Plain-language statement. Never claims authenticity. */
  statement: string;
  document: {
    type: 'driver_license';
    template: string | null;
    country: string | null;
    /** null once personal data has been purged (retention or DELETE). */
    fields: DocumentFields | null;
  };
  checks: CheckResultDto[];
  summary: { passed: number; warned: number; failed: number; skipped: number };
}

export interface SessionDto {
  id: string;
  reference: string | null;
  status: (typeof SESSION_STATUSES)[number];
  created_at: string;
  expires_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  decision: (typeof DECISIONS)[number] | null;
  result?: SessionResult;
}

export interface SessionListDto {
  data: SessionDto[];
  next_cursor: string | null;
}

export interface WebhookBody {
  event: string;
  session_id: string;
  reference: string | null;
  status: (typeof SESSION_STATUSES)[number];
  decision: (typeof DECISIONS)[number] | null;
  occurred_at: string;
}

/* ---------- Hosted page API ---------- */

export const HostedOpenRequestSchema = z.object({ token: z.string().min(20).max(128) }).strict();

export const HostedConsentRequestSchema = z
  .object({ consent_version: z.string().min(1).max(32), accepted: z.literal(true) })
  .strict();

export interface HostedSessionInfo {
  integrator: { display_name: string; logo_url: string | null; primary_color: string | null };
  locale: (typeof LOCALES)[number] | null;
  status: (typeof SESSION_STATUSES)[number];
  uploaded: { front: boolean; back: boolean };
  consent: { required_version: string; accepted: boolean };
  expires_at: string;
  desktop_handoff: boolean;
}

export interface HostedSubmitResponse {
  status: (typeof SESSION_STATUSES)[number];
  redirect_url: string;
}

export interface HostedStatusResponse {
  status: (typeof SESSION_STATUSES)[number];
  redirect_url: string | null;
}

export const CONSENT_VERSION = '2026-10-01';

/** Wording the API and docs use instead of any authenticity claim (SPEC section 8). */
export const RESULT_STATEMENT_PASSED =
  'The document passed automated data consistency checks. This is not a confirmation that the document is genuine.';
export const RESULT_STATEMENT_NOT_PASSED =
  'The document did not pass all automated data consistency checks.';

export { isoDate };
