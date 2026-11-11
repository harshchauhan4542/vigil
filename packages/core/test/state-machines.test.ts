import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  exceptionMachine,
  executionMachine,
  proposalMachine,
  webhookEventMachine,
  type StateMachine,
} from '../src/state-machines.js';

/** Allowed transitions, written out independently of the implementation. */
const EXPECTED: Record<string, Record<string, string[]>> = {
  proposal: {
    DRAFT: ['POLICY_REJECTED', 'PENDING_APPROVAL'],
    POLICY_REJECTED: [],
    PENDING_APPROVAL: ['REJECTED', 'EXPIRED', 'APPROVED'],
    REJECTED: [],
    EXPIRED: [],
    APPROVED: ['QUEUED'],
    QUEUED: ['EXECUTING'],
    EXECUTING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
    FAILED_RETRYABLE: ['EXECUTING', 'NEEDS_RECONCILE'],
    NEEDS_RECONCILE: ['SUCCEEDED', 'FAILED_FINAL'],
    SUCCEEDED: ['SETTLED'],
    FAILED_FINAL: [],
    SETTLED: [],
  },
  execution: {
    QUEUED: ['EXECUTING'],
    EXECUTING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
    FAILED_RETRYABLE: ['EXECUTING', 'NEEDS_RECONCILE'],
    NEEDS_RECONCILE: ['SUCCEEDED', 'FAILED_FINAL'],
    SUCCEEDED: ['SETTLED'],
    FAILED_FINAL: [],
    SETTLED: [],
  },
  exception: {
    OPEN: ['TRIAGING', 'DISMISSED', 'ESCALATED', 'FAILED'],
    TRIAGING: ['PROPOSED', 'DISMISSED', 'ESCALATED', 'FAILED'],
    PROPOSED: ['AWAITING_APPROVAL', 'TRIAGING', 'DISMISSED', 'ESCALATED', 'FAILED'],
    AWAITING_APPROVAL: ['EXECUTING', 'TRIAGING', 'DISMISSED', 'ESCALATED', 'FAILED'],
    EXECUTING: ['AWAITING_SETTLEMENT', 'TRIAGING', 'FAILED', 'ESCALATED', 'DISMISSED'],
    AWAITING_SETTLEMENT: ['RESOLVED', 'FAILED', 'ESCALATED'],
    RESOLVED: ['OPEN'],
    DISMISSED: ['OPEN'],
    ESCALATED: ['TRIAGING', 'DISMISSED', 'RESOLVED'],
    FAILED: ['OPEN', 'TRIAGING'],
  },
  webhook_event: {
    RECEIVED: ['VERIFIED', 'REJECTED'],
    VERIFIED: ['PROCESSED', 'IGNORED_DUPLICATE', 'FAILED'],
    FAILED: ['PROCESSED', 'IGNORED_DUPLICATE', 'FAILED'],
    REJECTED: [],
    PROCESSED: [],
    IGNORED_DUPLICATE: [],
  },
};

const machines = [
  proposalMachine,
  executionMachine,
  exceptionMachine,
  webhookEventMachine,
] as StateMachine<string>[];

describe.each(machines.map((m) => [m.name, m] as const))('%s machine', (name, machine) => {
  const expected = EXPECTED[name]!;

  it('has exactly the expected states', () => {
    expect([...machine.states].sort()).toEqual(Object.keys(expected).sort());
  });

  // Every (from, to) pair: allowed ones pass, every other one throws.
  const pairs = Object.keys(expected).flatMap((from) =>
    Object.keys(expected).map((to) => [from, to, expected[from]!.includes(to)] as const),
  );

  it.each(pairs)('%s -> %s allowed=%s', (from, to, allowed) => {
    expect(machine.canTransition(from, to)).toBe(allowed);
    if (allowed) expect(() => machine.assertTransition(from, to)).not.toThrow();
    else expect(() => machine.assertTransition(from, to)).toThrow(InvalidTransitionError);
  });
});

describe('machine helpers', () => {
  it('reports terminal states', () => {
    expect([...proposalMachine.terminal].sort()).toEqual(
      ['EXPIRED', 'FAILED_FINAL', 'POLICY_REJECTED', 'REJECTED', 'SETTLED'].sort(),
    );
  });

  it('rejects unknown states', () => {
    expect(proposalMachine.canTransition('NOPE' as never, 'DRAFT')).toBe(false);
  });
});
