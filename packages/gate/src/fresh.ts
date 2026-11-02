// Re-read the proposal's target from PayPal right before policy runs (R3 input).
import { parseMoney, type ActionType } from '@vigil/core';
import { getAuthorizationMirror, getCaptureMirror, type Db } from '@vigil/db';
import { PayPalApiError, reads, type PayPalHttp } from '@vigil/paypal';
import type { FreshState } from '@vigil/policy';

const INTERNAL: ReadonlySet<ActionType> = new Set(['journal_entry', 'dismiss']);
const CLOSED_DISPUTE = new Set(['RESOLVED']);

export function parseTargetRef(targetRef: string): { kind: string; id: string } {
  const i = targetRef.indexOf(':');
  return i < 0
    ? { kind: '', id: targetRef }
    : { kind: targetRef.slice(0, i), id: targetRef.slice(i + 1) };
}

async function isDisputed(http: PayPalHttp, captureId: string): Promise<boolean> {
  try {
    const disputes = await reads.listDisputes(http, { disputed_transaction_id: captureId });
    return disputes.some((d) => !CLOSED_DISPUTE.has(d.status));
  } catch {
    // Disputes API not enabled for the app: the refund call's TRANSACTION_DISPUTED error is the backstop.
    return false;
  }
}

export async function freshStateFor(
  db: Db,
  http: PayPalHttp,
  actionType: ActionType,
  targetRef: string,
): Promise<FreshState> {
  if (INTERNAL.has(actionType)) return { kind: 'none' };
  const { kind, id } = parseTargetRef(targetRef);
  try {
    if (kind === 'authorization') {
      const a = await reads.getAuthorization(http, id);
      const m = parseMoney(a.amount.value, a.amount.currency_code);
      const mirror = await getAuthorizationMirror(db, id);
      return {
        kind: 'authorization',
        id: a.id,
        status: a.status,
        amountCents: m.cents,
        currency: m.currency,
        capturedCents: mirror?.capturedTotalCents ?? 0,
        createdAt: a.create_time ? new Date(a.create_time) : null,
      };
    }
    if (kind === 'capture') {
      const c = await reads.getCapture(http, id);
      const m = parseMoney(c.amount.value, c.amount.currency_code);
      const mirror = await getCaptureMirror(db, id);
      if (actionType === 'add_tracking') {
        return {
          kind: 'capture_for_tracking',
          captureId: c.id,
          orderId: c.supplementary_data?.related_ids?.order_id ?? mirror?.orderId ?? '',
          captureStatus: c.status,
          hasTracker: mirror?.hasTracker ?? false,
        };
      }
      return {
        kind: 'capture',
        id: c.id,
        status: c.status,
        amountCents: m.cents,
        currency: m.currency,
        refundedCents: mirror?.refundedTotalCents ?? 0,
        disputed: await isDisputed(http, c.id),
      };
    }
    if (kind === 'subscription') {
      const s = await reads.getSubscription(http, id);
      const bal = s.billing_info?.outstanding_balance;
      const m = bal ? parseMoney(bal.value, bal.currency_code) : null;
      return {
        kind: 'subscription',
        id: s.id,
        status: s.status,
        outstandingCents: m?.cents ?? 0,
        currency: m?.currency ?? 'USD',
      };
    }
    return { kind: 'unavailable', reason: `Unknown target kind "${kind}"` };
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return {
        kind: 'unavailable',
        reason: `PayPal ${error.status}${error.issue ? ` ${error.issue}` : ''} (debug_id ${error.debugId ?? 'n/a'})`,
      };
    }
    throw error;
  }
}
