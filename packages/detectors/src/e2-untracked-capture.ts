// E2 UNTRACKED_CAPTURE ("Ship-Safe"): a completed capture for physical goods with no carrier
// tracker after N hours. Framed as an evidence-completeness check: Vigil does NOT compute
// PayPal Seller Protection eligibility.
import { score } from './score.js';
import type { CaptureRow, DetectedException } from './types.js';

export const E2_VERSION = 'e2.v1';
const HOUR = 3_600_000;

export interface E2Config {
  /** Fire when a capture has had no tracker for this long. */
  graceHours: number;
  /** Target time to have tracking on file. */
  targetHours: number;
}

export const E2_DEFAULTS: E2Config = { graceHours: 24, targetHours: 72 };
const SHIPPABLE = new Set(['COMPLETED', 'PARTIALLY_REFUNDED']);

export function detectUntrackedCaptures(
  captures: readonly CaptureRow[],
  now: Date,
  config: E2Config = E2_DEFAULTS,
): DetectedException[] {
  const out: DetectedException[] = [];
  for (const c of captures) {
    if (!c.isPhysical || c.hasTracker || !SHIPPABLE.has(c.status) || !c.createdAt || !c.orderId)
      continue;
    if (now.getTime() - c.createdAt.getTime() < config.graceHours * HOUR) continue;
    const deadlineAt = new Date(c.createdAt.getTime() + config.targetHours * HOUR);
    out.push({
      type: 'UNTRACKED_CAPTURE',
      targetRef: `capture:${c.id}`,
      amountAtRiskCents: c.amountCents,
      currency: c.currency,
      deadlineAt,
      ...score(c.amountCents, deadlineAt, now),
      detectorVersion: E2_VERSION,
      evidence: {
        capture_id: c.id,
        order_id: c.orderId,
        status: c.status,
        amount_cents: c.amountCents,
        captured_at: c.createdAt.toISOString(),
        tracking_target_at: deadlineAt.toISOString(),
      },
    });
  }
  return out;
}
