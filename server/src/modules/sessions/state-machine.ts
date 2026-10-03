import type { SessionStatus } from '@dlc/shared';
import { AppError } from '../../lib/errors.js';
import type { Session, SessionPatch } from './session.types.js';

/**
 * The only place session status changes (SPEC 3).
 *
 *   created -> in_progress -> submitted -> processing -> completed
 *   created | in_progress -> expired | cancelled
 *   submitted | processing -> failed
 */
export const TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  created: ['in_progress', 'expired', 'cancelled'],
  in_progress: ['submitted', 'expired', 'cancelled'],
  submitted: ['processing', 'failed'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: [],
  expired: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly SessionStatus[] = [
  'completed',
  'failed',
  'expired',
  'cancelled',
];

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('INVALID_STATE', `Cannot move session from ${from} to ${to}.`);
  }
}

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Statuses from which a session can still expire or be cancelled (before submit). */
export const PRE_SUBMIT_STATUSES: readonly SessionStatus[] = ['created', 'in_progress'];

export interface StatusWriter {
  /** Conditional update: only applies when the row still has status `from`. Returns rows changed. */
  updateStatus(
    id: string,
    from: SessionStatus,
    to: SessionStatus,
    patch: SessionPatch,
    now: Date,
  ): Promise<number>;
}

/**
 * Validate and apply a transition. The write is conditional on the current status so two
 * processes racing on the same session cannot both win; the loser gets INVALID_STATE.
 */
export async function transition(
  writer: StatusWriter,
  session: Pick<Session, 'id' | 'status'>,
  to: SessionStatus,
  now: Date,
  patch: SessionPatch = {},
): Promise<void> {
  assertTransition(session.status, to);
  const changed = await writer.updateStatus(session.id, session.status, to, patch, now);
  if (changed !== 1) {
    throw new AppError('INVALID_STATE', 'Session state changed concurrently.');
  }
}
