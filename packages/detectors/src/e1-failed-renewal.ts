// E1 FAILED_RENEWAL: an active (or auto-suspended) subscription with an outstanding balance or a
// recent failed payment. Signals come from billing_info (outstanding_balance,
// last_failed_payment) and BILLING.SUBSCRIPTION.PAYMENT.FAILED webhooks (via the mirror).
import { score } from './score.js';
import type { DetectedException, SubscriptionRow } from './types.js';

export const E1_VERSION = 'e1.v1';
const HOUR = 3_600_000;

export interface E1Config {
  /** A failure older than this with nothing outstanding is history, not an exception. */
  failureLookbackHours: number;
  /** Retry window before the merchant should act (PayPal retries failed renewals itself). */
  actWithinHours: number;
}

export const E1_DEFAULTS: E1Config = { failureLookbackHours: 7 * 24, actWithinHours: 72 };
const LIVE = new Set(['ACTIVE', 'SUSPENDED']);

export function detectFailedRenewals(
  subs: readonly SubscriptionRow[],
  now: Date,
  config: E1Config = E1_DEFAULTS,
): DetectedException[] {
  const out: DetectedException[] = [];
  for (const s of subs) {
    if (!LIVE.has(s.status)) continue;
    const recentFailure =
      !!s.lastFailedAt &&
      now.getTime() - s.lastFailedAt.getTime() <= config.failureLookbackHours * HOUR;
    if (s.outstandingBalanceCents <= 0 && !recentFailure) continue;
    const deadlineAt = s.lastFailedAt
      ? new Date(s.lastFailedAt.getTime() + config.actWithinHours * HOUR)
      : null;
    out.push({
      type: 'FAILED_RENEWAL',
      targetRef: `subscription:${s.id}`,
      amountAtRiskCents: s.outstandingBalanceCents,
      currency: s.currency,
      deadlineAt,
      ...score(s.outstandingBalanceCents, deadlineAt, now),
      detectorVersion: E1_VERSION,
      evidence: {
        subscription_id: s.id,
        plan_id: s.planId,
        status: s.status,
        outstanding_balance_cents: s.outstandingBalanceCents,
        last_failed_reason: s.lastFailedReason,
        last_failed_at: s.lastFailedAt?.toISOString() ?? null,
      },
    });
  }
  return out;
}
