export const SESSION_STATUSES = [
  'created',
  'in_progress',
  'submitted',
  'processing',
  'completed',
  'failed',
  'expired',
  'cancelled',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const DECISIONS = ['approved', 'review', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

export const CHECK_STATUSES = ['pass', 'warn', 'fail', 'skipped'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const IMAGE_SIDES = ['front', 'back'] as const;
export type ImageSide = (typeof IMAGE_SIDES)[number];

export const LOCALES = ['en', 'nb'] as const;
export type Locale = (typeof LOCALES)[number];

export const WEBHOOK_EVENTS = ['session.completed', 'session.failed', 'session.expired'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
