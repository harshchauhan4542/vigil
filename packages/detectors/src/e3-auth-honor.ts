// E3 AUTH_HONOR_EXPIRING: an authorization still capturable whose 3-day honor period ends within
// 12 hours (i.e. it is at least 60 h old), or whose validity (expiration_time) ends within 24 h.
// Rules from SPEC-PAY: 3-day honor period inside a 29-day validity window.
import type { AuthorizationRow, DetectedException } from './types.js';
import { score } from './score.js';

export const E3_VERSION = 'e3.v1';
const HOUR = 3_600_000;

export interface E3Config {
  honorHours: number;
  /** Fire this many hours before the honor period ends. */
  warnHours: number;
  /** Fire this many hours before expiration_time. */
  expiryWarnHours: number;
}

export const E3_DEFAULTS: E3Config = { honorHours: 72, warnHours: 12, expiryWarnHours: 24 };

const CAPTURABLE = new Set(['CREATED', 'PARTIALLY_CAPTURED']);

export function detectAuthHonorExpiring(
  auths: readonly AuthorizationRow[],
  now: Date,
  config: E3Config = E3_DEFAULTS,
): DetectedException[] {
  const out: DetectedException[] = [];
  for (const a of auths) {
    if (!CAPTURABLE.has(a.status) || !a.createdAt) continue;
    const remaining = a.amountCents - a.capturedTotalCents;
    if (remaining <= 0) continue;

    const honorEndsAt = new Date(a.createdAt.getTime() + config.honorHours * HOUR);
    const warnAt = honorEndsAt.getTime() - config.warnHours * HOUR;
    const expiryWarnAt = a.expirationTime
      ? a.expirationTime.getTime() - config.expiryWarnHours * HOUR
      : Number.POSITIVE_INFINITY;
    const t = now.getTime();
    const honorTrigger = t >= warnAt;
    const expiryTrigger = t >= expiryWarnAt;
    if (!honorTrigger && !expiryTrigger) continue;

    // The nearest deadline that still matters: honor end if not yet passed, else validity end.
    const inHonor = t < honorEndsAt.getTime();
    const expiry = a.expirationTime;
    const deadlineAt = inHonor
      ? expiry && expiry < honorEndsAt
        ? expiry
        : honorEndsAt
      : (expiry ?? honorEndsAt);
    const phase = inHonor ? 'honor_ending' : 'honor_lapsed';

    out.push({
      type: 'AUTH_HONOR_EXPIRING',
      targetRef: `authorization:${a.id}`,
      amountAtRiskCents: remaining,
      currency: a.currency,
      deadlineAt,
      ...score(remaining, deadlineAt, now),
      detectorVersion: E3_VERSION,
      evidence: {
        authorization_id: a.id,
        order_id: a.orderId,
        status: a.status,
        amount_cents: a.amountCents,
        captured_total_cents: a.capturedTotalCents,
        created_at: a.createdAt.toISOString(),
        honor_ends_at: honorEndsAt.toISOString(),
        expiration_time: a.expirationTime?.toISOString() ?? null,
        phase,
        trigger: honorTrigger ? 'honor_window' : 'expiry_window',
      },
    });
  }
  return out;
}
