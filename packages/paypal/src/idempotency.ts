// Deterministic PayPal-Request-Id per (proposal, operation), and how long PayPal keeps it.
import { v5 as uuidv5 } from 'uuid';

/** Vigil's fixed UUID namespace for request ids. Never change it: ids must stay stable. */
export const VIGIL_NAMESPACE = '6f1d7c2a-4b8e-5a39-9c0d-2e7b4f6a8d15';

const HOUR = 3_600_000;

/**
 * Every PayPal operation Vigil performs. `retentionMs` is how long PayPal stores a
 * PayPal-Request-Id; `null` means the API declares no header, so idempotency comes from the
 * (operation, business_key) primary key plus a check-before-act GET.
 */
export const OPERATIONS = {
  'orders.create': { retentionMs: 6 * HOUR, method: 'POST' },
  'orders.authorize': { retentionMs: 6 * HOUR, method: 'POST' },
  'orders.capture': { retentionMs: 6 * HOUR, method: 'POST' },
  'orders.track': { retentionMs: null, method: 'POST' },
  // Payments v2: the SDK docs say 45 days; the plan treats it as 6 h to stay conservative.
  'authorizations.capture': { retentionMs: 6 * HOUR, method: 'POST' },
  'authorizations.reauthorize': { retentionMs: 6 * HOUR, method: 'POST' },
  'authorizations.void': { retentionMs: 6 * HOUR, method: 'POST' },
  'captures.refund': { retentionMs: 6 * HOUR, method: 'POST' },
  'subscriptions.create': { retentionMs: 72 * HOUR, method: 'POST' },
  'subscriptions.capture': { retentionMs: 72 * HOUR, method: 'POST' },
  'subscriptions.suspend': { retentionMs: null, method: 'POST' },
  'plans.create': { retentionMs: 72 * HOUR, method: 'POST' },
  'products.create': { retentionMs: 72 * HOUR, method: 'POST' },
} as const satisfies Record<string, { retentionMs: number | null; method: 'POST' }>;

export type MutatingOperation = keyof typeof OPERATIONS;

export function paypalRequestId(businessKey: string, operation: MutatingOperation): string {
  return uuidv5(`${businessKey}:${operation}`, VIGIL_NAMESPACE);
}

export function supportsRequestId(operation: MutatingOperation): boolean {
  return OPERATIONS[operation].retentionMs !== null;
}

/** When PayPal forgets the key; `null` if the API has no PayPal-Request-Id. */
export function retentionUntil(operation: MutatingOperation, from: Date = new Date()): Date | null {
  const ms = OPERATIONS[operation].retentionMs;
  return ms === null ? null : new Date(from.getTime() + ms);
}

/**
 * Safe to retry with the same request id? Only while PayPal still remembers it.
 * Past retention Vigil never blind-retries: the execution moves to NEEDS_RECONCILE.
 */
export function canRetryWithSameId(retention: Date | null, now: Date = new Date()): boolean {
  return retention !== null && now.getTime() < retention.getTime();
}
