// State machines for exceptions, proposals, executions and webhook events.
// Every status change in the system goes through `assertTransition`.
import type {
  ExceptionStatus,
  ExecutionStatus,
  ProposalStatus,
  WebhookEventStatus,
} from './enums.js';

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${machine} transition: ${from} -> ${to}`);
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
  next(from: S): readonly S[];
}

export function defineMachine<S extends string>(
  name: string,
  transitions: Record<S, readonly S[]>,
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  const terminal = states.filter((s) => transitions[s].length === 0);
  const canTransition = (from: S, to: S): boolean => transitions[from]?.includes(to) ?? false;
  return {
    name,
    states,
    terminal,
    canTransition,
    next: (from) => transitions[from] ?? [],
    assertTransition(from, to) {
      if (!canTransition(from, to)) throw new InvalidTransitionError(name, from, to);
    },
  };
}

export const proposalMachine = defineMachine<ProposalStatus>('proposal', {
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
});

/** The execution lifecycle of an approved proposal (subset of the proposal machine). */
export const executionMachine = defineMachine<ExecutionStatus>('execution', {
  QUEUED: ['EXECUTING'],
  EXECUTING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
  FAILED_RETRYABLE: ['EXECUTING', 'NEEDS_RECONCILE'],
  NEEDS_RECONCILE: ['SUCCEEDED', 'FAILED_FINAL'],
  SUCCEEDED: ['SETTLED'],
  FAILED_FINAL: [],
  SETTLED: [],
});

const EXCEPTION_SIDE_EXITS = ['DISMISSED', 'ESCALATED', 'FAILED'] as const;

export const exceptionMachine = defineMachine<ExceptionStatus>('exception', {
  OPEN: ['TRIAGING', ...EXCEPTION_SIDE_EXITS],
  TRIAGING: ['PROPOSED', ...EXCEPTION_SIDE_EXITS],
  // Back to TRIAGING after a policy rejection, human rejection or expiry.
  PROPOSED: ['AWAITING_APPROVAL', 'TRIAGING', ...EXCEPTION_SIDE_EXITS],
  AWAITING_APPROVAL: ['EXECUTING', 'TRIAGING', ...EXCEPTION_SIDE_EXITS],
  // A final PayPal error (e.g. 422 AUTHORIZATION_EXPIRED) sends it back to the agent.
  EXECUTING: ['AWAITING_SETTLEMENT', 'TRIAGING', 'FAILED', 'ESCALATED'],
  AWAITING_SETTLEMENT: ['RESOLVED', 'FAILED', 'ESCALATED'],
  // Re-opens when the detector fires again after it was closed.
  RESOLVED: ['OPEN'],
  DISMISSED: ['OPEN'],
  ESCALATED: ['TRIAGING', 'DISMISSED', 'RESOLVED'],
  FAILED: ['OPEN', 'TRIAGING'],
});

export const webhookEventMachine = defineMachine<WebhookEventStatus>('webhook_event', {
  RECEIVED: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['PROCESSED', 'IGNORED_DUPLICATE', 'FAILED'],
  // FAILED is retryable processing.
  FAILED: ['PROCESSED', 'IGNORED_DUPLICATE', 'FAILED'],
  REJECTED: [],
  PROCESSED: [],
  IGNORED_DUPLICATE: [],
});
