import { SESSION_STATUSES, type SessionStatus } from '@dlc/shared';
import { describe, expect, it } from 'vitest';
import {
  TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  transition,
  type StatusWriter,
} from '../../src/modules/sessions/state-machine.js';

const allowed: [SessionStatus, SessionStatus][] = [
  ['created', 'in_progress'],
  ['created', 'expired'],
  ['created', 'cancelled'],
  ['in_progress', 'submitted'],
  ['in_progress', 'expired'],
  ['in_progress', 'cancelled'],
  ['submitted', 'processing'],
  ['submitted', 'failed'],
  ['processing', 'completed'],
  ['processing', 'failed'],
];

describe('session state machine', () => {
  it('allows exactly the SPEC 3 transitions', () => {
    for (const from of SESSION_STATUSES) {
      for (const to of SESSION_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('terminal states have no exits', () => {
    for (const s of ['completed', 'failed', 'expired', 'cancelled'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(TRANSITIONS[s]).toEqual([]);
    }
    expect(isTerminal('processing')).toBe(false);
  });

  it('assertTransition throws INVALID_STATE', () => {
    expect(() => assertTransition('completed', 'processing')).toThrowError(/Cannot move session/);
    expect(() => assertTransition('created', 'in_progress')).not.toThrow();
  });

  it('transition writes conditionally on the current status', async () => {
    const calls: unknown[] = [];
    const writer: StatusWriter = {
      async updateStatus(id, from, to, patch) {
        calls.push({ id, from, to, patch });
        return 1;
      },
    };
    const now = new Date('2026-10-03T00:00:00Z');
    await transition(writer, { id: 'ses_1', status: 'created' }, 'in_progress', now, {
      opened_at: now,
    });
    expect(calls).toEqual([
      { id: 'ses_1', from: 'created', to: 'in_progress', patch: { opened_at: now } },
    ]);
  });

  it('transition fails when another process changed the status first', async () => {
    const writer: StatusWriter = { updateStatus: async () => 0 };
    await expect(
      transition(writer, { id: 'ses_1', status: 'submitted' }, 'processing', new Date()),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('transition refuses illegal moves without writing', async () => {
    let wrote = false;
    const writer: StatusWriter = {
      updateStatus: async () => {
        wrote = true;
        return 1;
      },
    };
    await expect(
      transition(writer, { id: 'ses_1', status: 'expired' }, 'submitted', new Date()),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(wrote).toBe(false);
  });
});
