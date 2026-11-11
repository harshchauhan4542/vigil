import { describe, expect, it } from 'vitest';
import {
  detectAll,
  detectFailedRenewals,
  detectUntrackedCaptures,
  type CaptureRow,
  type SubscriptionRow,
} from '../src/index.js';

const H = 3_600_000;
const NOW = new Date('2026-11-05T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * H);

const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: 'I-SUB1',
  planId: 'P-1',
  status: 'ACTIVE',
  outstandingBalanceCents: 2400,
  currency: 'USD',
  lastFailedReason: 'PAYMENT_DENIED',
  lastFailedAt: ago(10),
  ...over,
});

const cap = (over: Partial<CaptureRow> = {}): CaptureRow => ({
  id: 'CAP1',
  orderId: 'O1',
  status: 'COMPLETED',
  amountCents: 8900,
  currency: 'USD',
  hasTracker: false,
  createdAt: ago(30),
  isPhysical: true,
  ...over,
});

describe('E1 FAILED_RENEWAL', () => {
  it('fires on an outstanding balance with a deadline from the failure time', () => {
    const [e] = detectFailedRenewals([sub()], NOW);
    expect(e).toMatchObject({
      type: 'FAILED_RENEWAL',
      targetRef: 'subscription:I-SUB1',
      amountAtRiskCents: 2400,
      deadlineAt: new Date(ago(10).getTime() + 72 * H),
    });
    expect(e!.evidence).toMatchObject({ last_failed_reason: 'PAYMENT_DENIED', plan_id: 'P-1' });
  });

  it('fires on a recent failure even when nothing is outstanding yet', () => {
    expect(detectFailedRenewals([sub({ outstandingBalanceCents: 0 })], NOW)).toHaveLength(1);
  });

  it.each([
    ['cancelled', { status: 'CANCELLED' }],
    ['approval pending', { status: 'APPROVAL_PENDING' }],
    ['old failure, nothing owed', { outstandingBalanceCents: 0, lastFailedAt: ago(8 * 24) }],
    ['never failed, nothing owed', { outstandingBalanceCents: 0, lastFailedAt: null }],
  ])('ignores %s', (_l, over) => {
    expect(detectFailedRenewals([sub(over as Partial<SubscriptionRow>)], NOW)).toHaveLength(0);
  });

  it('includes SUSPENDED subscriptions (PayPal suspends after repeated failures)', () => {
    expect(detectFailedRenewals([sub({ status: 'SUSPENDED' })], NOW)).toHaveLength(1);
  });
});

describe('E2 UNTRACKED_CAPTURE', () => {
  it.each([
    ['23h59m old', 23 + 59 / 60, false],
    ['exactly 24h old', 24, true],
    ['30h old', 30, true],
  ])('%s → fires=%s', (_l, hours, fires) => {
    expect(detectUntrackedCaptures([cap({ createdAt: ago(hours) })], NOW)).toHaveLength(
      fires ? 1 : 0,
    );
  });

  it.each([
    ['has a tracker', { hasTracker: true }],
    ['digital goods', { isPhysical: false }],
    ['refunded', { status: 'REFUNDED' }],
    ['pending', { status: 'PENDING' }],
    ['no order id (cannot track)', { orderId: null }],
  ])('ignores a capture that %s', (_l, over) => {
    expect(detectUntrackedCaptures([cap(over as Partial<CaptureRow>)], NOW)).toHaveLength(0);
  });

  it('targets the capture and cites the order id needed for /track', () => {
    const [e] = detectUntrackedCaptures([cap()], NOW);
    expect(e).toMatchObject({ targetRef: 'capture:CAP1', amountAtRiskCents: 8900 });
    expect(e!.evidence).toMatchObject({ capture_id: 'CAP1', order_id: 'O1' });
  });
});

describe('detectAll with E1–E4', () => {
  it('merges all detectors into one priority-ordered queue', () => {
    const { exceptions } = detectAll({
      authorizations: [],
      transactions: [],
      ledger: [],
      subscriptions: [sub()],
      captures: [cap()],
      now: NOW,
    });
    expect(exceptions.map((e) => e.type).sort()).toEqual(['FAILED_RENEWAL', 'UNTRACKED_CAPTURE']);
  });
});
