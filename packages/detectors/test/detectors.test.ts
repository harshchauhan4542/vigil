import { describe, expect, it } from 'vitest';
import {
  detectAll,
  detectAuthHonorExpiring,
  detectUnmatchedTransactions,
  score,
  urgency,
  type AuthorizationRow,
  type LedgerRow,
  type TransactionRow,
} from '../src/index.js';

const H = 3_600_000;
const T0 = new Date('2026-11-01T00:00:00Z');
const at = (hours: number) => new Date(T0.getTime() + hours * H);

const auth = (over: Partial<AuthorizationRow> = {}): AuthorizationRow => ({
  id: 'AUTH1',
  orderId: 'O1',
  status: 'CREATED',
  amountCents: 4800,
  currency: 'USD',
  capturedTotalCents: 0,
  createdAt: T0,
  expirationTime: at(29 * 24),
  ...over,
});

describe('E3 AUTH_HONOR_EXPIRING', () => {
  it.each([
    ['59h59m old', 59 + 59 / 60, false],
    ['exactly 60h old', 60, true],
    ['71h old', 71, true],
    ['honor lapsed (80h)', 80, true],
    ['brand new', 1, false],
  ])('%s → fires=%s', (_label, hours, fires) => {
    expect(detectAuthHonorExpiring([auth()], at(hours))).toHaveLength(fires ? 1 : 0);
  });

  it.each(['CAPTURED', 'VOIDED', 'DENIED', 'PENDING'])('ignores status %s', (status) => {
    expect(detectAuthHonorExpiring([auth({ status })], at(70))).toHaveLength(0);
  });

  it('fires on PARTIALLY_CAPTURED with the remaining amount at risk', () => {
    const [e] = detectAuthHonorExpiring(
      [auth({ status: 'PARTIALLY_CAPTURED', capturedTotalCents: 1800 })],
      at(65),
    );
    expect(e).toMatchObject({ amountAtRiskCents: 3000, targetRef: 'authorization:AUTH1' });
  });

  it('skips fully captured amounts and rows without a creation time', () => {
    expect(detectAuthHonorExpiring([auth({ capturedTotalCents: 4800 })], at(65))).toHaveLength(0);
    expect(detectAuthHonorExpiring([auth({ createdAt: null })], at(65))).toHaveLength(0);
  });

  it('uses the honor end as deadline while it lasts, then the validity end', () => {
    const [ending] = detectAuthHonorExpiring([auth()], at(61));
    expect(ending!.deadlineAt).toEqual(at(72));
    expect(ending!.evidence).toMatchObject({ phase: 'honor_ending', trigger: 'honor_window' });
    const [lapsed] = detectAuthHonorExpiring([auth()], at(100));
    expect(lapsed!.deadlineAt).toEqual(at(29 * 24));
    expect(lapsed!.evidence).toMatchObject({ phase: 'honor_lapsed' });
  });

  it('fires near expiration_time even inside the honor window (e.g. a reauthorization late in validity)', () => {
    const [e] = detectAuthHonorExpiring([auth({ expirationTime: at(30) })], at(10));
    expect(e).toMatchObject({ deadlineAt: at(30) });
    expect(e!.evidence).toMatchObject({ trigger: 'expiry_window' });
    expect(detectAuthHonorExpiring([auth({ expirationTime: at(30) })], at(5.9))).toHaveLength(0);
  });

  it('cites the evidence the agent will need', () => {
    const [e] = detectAuthHonorExpiring([auth()], at(61));
    expect(e!.evidence).toMatchObject({
      authorization_id: 'AUTH1',
      order_id: 'O1',
      amount_cents: 4800,
    });
  });
});

const txn = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  transactionId: 'TX1',
  eventCode: 'T0006',
  status: 'S',
  amountCents: 6500,
  currency: 'USD',
  feeCents: -276,
  invoiceId: 'VIG-ORD-2001',
  customId: null,
  initiationDate: new Date('2026-11-02T10:00:00Z'),
  ...over,
});

const row = (over: Partial<LedgerRow> & { id: string }): LedgerRow => ({
  externalRef: 'VIG-ORD-2001',
  amountCents: 6500,
  currency: 'USD',
  bookedOn: '2026-11-02',
  memo: 'Sale VIG-ORD-2001',
  ...over,
});

const NOW = new Date('2026-11-05T00:00:00Z');
const reasons = (txns: TransactionRow[], ledger: LedgerRow[]) =>
  detectUnmatchedTransactions(txns, ledger, NOW)
    .exceptions.map((e) => [e.targetRef, e.evidence.reason])
    .sort();

describe('E4 UNMATCHED_TXN', () => {
  const sale = row({ id: 'L-sale' });
  const fee = row({ id: 'L-fee', amountCents: -276, memo: 'PayPal fee VIG-ORD-2001' });

  it('matches gross and fee rows exactly → no exceptions', () => {
    const r = detectUnmatchedTransactions([txn()], [sale, fee], NOW);
    expect(r.exceptions).toEqual([]);
    expect(r.matches.map((m) => [m.ledgerId, m.kind]).sort()).toEqual([
      ['L-fee', 'fee'],
      ['L-sale', 'gross'],
    ]);
  });

  it.each([
    ['2 days earlier', '2026-10-31', true],
    ['2 days later', '2026-11-04', true],
    ['3 days later', '2026-11-05', false],
    ['3 days earlier', '2026-10-30', false],
  ])('date tolerance: booked %s → matched=%s', (_l, bookedOn, matched) => {
    const r = detectUnmatchedTransactions(
      [txn({ feeCents: null })],
      [row({ id: 'L', bookedOn })],
      NOW,
    );
    expect(r.exceptions.length === 0).toBe(matched);
  });

  it('flags a missing fee booking', () => {
    expect(reasons([txn()], [sale])).toEqual([['txn:TX1:fee', 'fee_missing_in_books']]);
  });

  it('pairs a wrong booked amount into one amount_mismatch', () => {
    const r = detectUnmatchedTransactions(
      [txn({ feeCents: null })],
      [row({ id: 'L', amountCents: 6200 })],
      NOW,
    );
    expect(r.exceptions).toHaveLength(1);
    expect(r.exceptions[0]).toMatchObject({
      targetRef: 'txn:TX1',
      amountAtRiskCents: 300,
      evidence: { reason: 'amount_mismatch', ledger_entry_id: 'L', difference_cents: 300 },
    });
  });

  it('flags a duplicate refund in the books when PayPal has one refund', () => {
    const refund = txn({
      transactionId: 'TX2',
      eventCode: 'T1107',
      amountCents: -1500,
      feeCents: null,
    });
    const r1 = row({ id: 'R-a', amountCents: -1500, memo: 'Refund' });
    const r2 = row({ id: 'R-b', amountCents: -1500, memo: 'Refund' });
    const r = detectUnmatchedTransactions([refund], [r1, r2], NOW);
    expect(r.exceptions).toHaveLength(1);
    expect(r.exceptions[0]).toMatchObject({
      targetRef: 'ledger:R-b',
      evidence: { reason: 'duplicate_in_books', duplicate_of: 'R-a' },
    });
  });

  it('flags a duplicate refund in the books when PayPal has none (seeded case)', () => {
    const r1 = row({ id: 'R-a', amountCents: -1500, memo: 'Refund' });
    const r2 = row({ id: 'R-b', amountCents: -1500, memo: 'Refund' });
    expect(reasons([], [r1, r2])).toEqual([
      ['ledger:R-a', 'missing_in_paypal'],
      ['ledger:R-b', 'duplicate_in_books'],
    ]);
  });

  it('flags PayPal money missing from the books', () => {
    expect(reasons([txn({ feeCents: null, invoiceId: 'X' })], [])).toEqual([
      ['txn:TX1', 'missing_in_books'],
    ]);
  });

  it('matches on custom_id or the transaction id when invoice_id is absent', () => {
    const t = txn({ feeCents: null, invoiceId: null, customId: 'C-9' });
    expect(reasons([t], [row({ id: 'L', externalRef: 'C-9' })])).toEqual([]);
    expect(reasons([t], [row({ id: 'L', externalRef: 'TX1' })])).toEqual([]);
  });

  it('ignores denied/reversed transactions and currency mismatches never match', () => {
    expect(reasons([txn({ status: 'D' })], [])).toEqual([]);
    expect(reasons([txn({ feeCents: null })], [row({ id: 'L', currency: 'EUR' })]).length).toBe(2);
  });

  it('is one-to-one: two identical PayPal sales need two bookings', () => {
    const a = txn({ transactionId: 'A', feeCents: null });
    const b = txn({ transactionId: 'B', feeCents: null });
    expect(reasons([a, b], [row({ id: 'L' })])).toEqual([['txn:B', 'missing_in_books']]);
  });
});

describe('scoring and detectAll', () => {
  it('maps hours to deadline into urgency', () => {
    const now = at(0);
    expect(urgency(null, now)).toBe(1);
    expect(urgency(at(30), now)).toBe(1);
    expect(urgency(at(24), now)).toBe(2);
    expect(urgency(at(12), now)).toBe(3);
    expect(urgency(at(0), now)).toBe(4);
    expect(score(-1000, at(1), now)).toEqual({ severity: 3, score: 3000 });
  });

  it('orders the queue by money at risk × urgency', () => {
    const { exceptions } = detectAll({
      authorizations: [
        auth({ id: 'SMALL_URGENT', amountCents: 2000, createdAt: at(-71) }), // 1h left → ×3
        auth({ id: 'BIG_LATER', amountCents: 9000, createdAt: at(-61) }), // 11h left → ×3
        auth({ id: 'MID', amountCents: 5000, createdAt: at(-62) }),
      ],
      transactions: [txn({ feeCents: null, invoiceId: 'NOPE' })],
      ledger: [],
      now: at(0),
    });
    expect(exceptions.map((e) => e.targetRef)).toEqual([
      'authorization:BIG_LATER',
      'authorization:MID',
      'txn:TX1',
      'authorization:SMALL_URGENT',
    ]);
  });
});
