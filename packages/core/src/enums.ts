// Shared vocabulary: exception types, action types, risk tiers and statuses.
import { z } from 'zod';

export const ExceptionType = z.enum([
  'FAILED_RENEWAL',
  'UNTRACKED_CAPTURE',
  'AUTH_HONOR_EXPIRING',
  'UNMATCHED_TXN',
  'DISPUTE_DEADLINE',
]);
export type ExceptionType = z.infer<typeof ExceptionType>;

/** Short codes used in the UI and docs (E1–E5). */
export const EXCEPTION_CODE: Record<ExceptionType, string> = {
  FAILED_RENEWAL: 'E1',
  UNTRACKED_CAPTURE: 'E2',
  AUTH_HONOR_EXPIRING: 'E3',
  UNMATCHED_TXN: 'E4',
  DISPUTE_DEADLINE: 'E5',
};

export const ActionType = z.enum([
  'capture_authorization',
  'reauthorize',
  'void_authorization',
  'refund',
  'add_tracking',
  'retry_outstanding_balance',
  'suspend_subscription',
  'journal_entry',
  'send_invoice_reminder',
  'dismiss',
]);
export type ActionType = z.infer<typeof ActionType>;

/** Actions that move money at PayPal (vs. internal-only or non-monetary actions). */
export const MONETARY_ACTIONS: ReadonlySet<ActionType> = new Set([
  'capture_authorization',
  'reauthorize',
  'refund',
  'retry_outstanding_balance',
]);

/** Which actions the playbook allows per exception type (policy rule R1 reads this). */
export const ALLOWED_ACTIONS: Record<ExceptionType, readonly ActionType[]> = {
  FAILED_RENEWAL: ['retry_outstanding_balance', 'suspend_subscription', 'dismiss'],
  UNTRACKED_CAPTURE: ['add_tracking', 'dismiss'],
  AUTH_HONOR_EXPIRING: ['capture_authorization', 'reauthorize', 'void_authorization', 'dismiss'],
  UNMATCHED_TXN: ['journal_entry', 'refund', 'dismiss'],
  DISPUTE_DEADLINE: ['dismiss'],
};

/** T0 read · T1 non-monetary mutation · T2 money ≤ cap · T3 money above cap or irreversible. */
export const RiskTier = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type RiskTier = z.infer<typeof RiskTier>;

export const ExceptionStatus = z.enum([
  'OPEN',
  'TRIAGING',
  'PROPOSED',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'AWAITING_SETTLEMENT',
  'RESOLVED',
  'DISMISSED',
  'ESCALATED',
  'FAILED',
]);
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

export const ProposalStatus = z.enum([
  'DRAFT',
  'POLICY_REJECTED',
  'PENDING_APPROVAL',
  'REJECTED',
  'EXPIRED',
  'APPROVED',
  'QUEUED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'NEEDS_RECONCILE',
  'SETTLED',
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/** Proposal states that count as "open" for the one-open-proposal-per-target rule (R6). */
export const OPEN_PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'QUEUED',
  'EXECUTING',
  'FAILED_RETRYABLE',
  'NEEDS_RECONCILE',
];

export const ExecutionStatus = z.enum([
  'QUEUED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'NEEDS_RECONCILE',
  'SETTLED',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const WebhookEventStatus = z.enum([
  'RECEIVED',
  'VERIFIED',
  'REJECTED',
  'PROCESSED',
  'IGNORED_DUPLICATE',
  'FAILED',
]);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatus>;

export const ApprovalDecision = z.enum(['APPROVED', 'REJECTED']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const VigilMode = z.enum(['live', 'replay']);
export type VigilMode = z.infer<typeof VigilMode>;

export const ActorType = z.enum(['system', 'agent', 'human', 'paypal', 'policy', 'detector']);
export type ActorType = z.infer<typeof ActorType>;
