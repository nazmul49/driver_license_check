import type { CheckCode, Decision, Severity } from '@dlc/shared';
import type { CheckResult } from '../checks/types.js';

/**
 * Per-integrator decision policy (stored in integrator.decision_policy_json). Defaults reproduce
 * SPEC section 8 exactly.
 */
export interface DecisionPolicy {
  /** Number of warns that turns an otherwise clean result into review. */
  warnThreshold: number;
  /** A critical check skipped for low confidence leads to review. */
  reviewOnCriticalLowConfidence: boolean;
  /** Change a check's effective severity, or ignore it for the decision. */
  severityOverrides: Partial<Record<CheckCode, Severity | 'ignore'>>;
  /** Map review to a stricter outcome. */
  mapReviewTo: 'review' | 'rejected';
}

export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  warnThreshold: 2,
  reviewOnCriticalLowConfidence: true,
  severityOverrides: {},
  mapReviewTo: 'review',
};

export function resolvePolicy(partial: Partial<DecisionPolicy> | null | undefined): DecisionPolicy {
  return {
    ...DEFAULT_DECISION_POLICY,
    ...(partial ?? {}),
    severityOverrides: { ...(partial?.severityOverrides ?? {}) },
  };
}

export interface DecisionOutcome {
  decision: Decision;
  reasons: string[];
}

export function decide(
  checks: CheckResult[],
  policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
): DecisionOutcome {
  const effective = checks
    .map((c) => ({ ...c, severity: policy.severityOverrides[c.code] ?? c.severity }))
    .filter((c): c is CheckResult => c.severity !== 'ignore');

  const criticalFails = effective.filter((c) => c.status === 'fail' && c.severity === 'critical');
  if (criticalFails.length > 0) {
    return { decision: 'rejected', reasons: unique(criticalFails.map((c) => c.code)) };
  }

  const reasons: string[] = [];
  reasons.push(
    ...effective.filter((c) => c.status === 'fail' && c.severity === 'major').map((c) => c.code),
  );
  if (policy.reviewOnCriticalLowConfidence) {
    reasons.push(
      ...effective
        .filter(
          (c) =>
            c.status === 'skipped' &&
            c.severity === 'critical' &&
            c.details?.reason === 'low_confidence',
        )
        .map((c) => c.code),
    );
  }
  const warns = effective.filter((c) => c.status === 'warn');
  if (warns.length >= policy.warnThreshold) reasons.push(...warns.map((c) => c.code));

  if (reasons.length > 0) {
    return { decision: policy.mapReviewTo, reasons: unique(reasons) };
  }
  return { decision: 'approved', reasons: [] };
}

function unique(codes: string[]): string[] {
  return [...new Set(codes)];
}

export function summarize(checks: CheckResult[]) {
  return {
    passed: checks.filter((c) => c.status === 'pass').length,
    warned: checks.filter((c) => c.status === 'warn').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    skipped: checks.filter((c) => c.status === 'skipped').length,
  };
}
