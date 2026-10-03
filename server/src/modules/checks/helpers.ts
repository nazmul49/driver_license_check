import { CHECK_DEFINITIONS, type CheckCode, type CheckStatus } from '@dlc/shared';
import type {
  CheckResult,
  ExtractedDocument,
  ExtractedField,
  FieldName,
  SkipReason,
} from './types.js';

export function result(
  code: CheckCode,
  status: CheckStatus,
  message: string,
  details?: Record<string, unknown>,
): CheckResult {
  return {
    code,
    status,
    severity: CHECK_DEFINITIONS[code],
    message,
    ...(details ? { details } : {}),
  };
}

export const pass = (code: CheckCode, message: string, details?: Record<string, unknown>) =>
  result(code, 'pass', message, details);
export const warn = (code: CheckCode, message: string, details?: Record<string, unknown>) =>
  result(code, 'warn', message, details);
export const fail = (code: CheckCode, message: string, details?: Record<string, unknown>) =>
  result(code, 'fail', message, details);
export const skip = (
  code: CheckCode,
  reason: SkipReason,
  message = 'Check skipped.',
  extra?: Record<string, unknown>,
) => result(code, 'skipped', message, { reason, ...extra });

export function skipReasonFor(field: ExtractedField | null | undefined): SkipReason {
  return field?.low_confidence ? 'low_confidence' : 'missing_data';
}

/**
 * Returns the values of the named fields, or a skipped result naming why they are unusable.
 * Low confidence wins over missing so the decision module can route it to review.
 */
export function requireFields<const N extends FieldName>(
  code: CheckCode,
  doc: ExtractedDocument,
  names: readonly N[],
): { values: Record<N, string> } | { skipped: CheckResult } {
  const values = {} as Record<N, string>;
  let reason: SkipReason | null = null;
  const missing: N[] = [];
  for (const name of names) {
    const field = doc.fields[name];
    if (field.value === null) {
      missing.push(name);
      if (field.low_confidence) reason = 'low_confidence';
      else reason ??= 'missing_data';
    } else {
      values[name] = field.value;
    }
  }
  if (missing.length > 0) {
    return { skipped: skip(code, reason!, 'Required data not available.', { fields: missing }) };
  }
  return { values };
}
