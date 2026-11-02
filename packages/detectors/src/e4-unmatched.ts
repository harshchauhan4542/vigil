// E4 UNMATCHED_TXN: reconcile PayPal Transaction Search rows against the merchant's books.
// A PayPal item (gross amount, or its fee) matches a ledger row on currency + amount +
// reference (invoice_id / custom_id / transaction id) + date within ±2 days. Matching is
// one-to-one, so a booked duplicate is left over and flagged. Both directions are reported.
import type { DetectedException, LedgerRow, TransactionRow } from './types.js';
import { score } from './score.js';

export const E4_VERSION = 'e4.v1';
const DAY = 86_400_000;

export interface E4Config {
  dateToleranceDays: number;
  /** Transaction Search statuses that count as money that moved. */
  statuses: readonly string[];
}

export const E4_DEFAULTS: E4Config = { dateToleranceDays: 2, statuses: ['S', 'P'] };

export type E4Reason =
  | 'missing_in_books'
  | 'fee_missing_in_books'
  | 'amount_mismatch'
  | 'missing_in_paypal'
  | 'duplicate_in_books';

interface PayPalItem {
  key: string; // txn:<id> or txn:<id>:fee
  transactionId: string;
  kind: 'gross' | 'fee';
  refs: string[];
  cents: number;
  currency: string;
  day: number; // UTC day number
}

export interface E4Result {
  exceptions: DetectedException[];
  /** ledger row id → transaction id, for marking matched_txn_id. */
  matches: { ledgerId: string; transactionId: string; kind: 'gross' | 'fee' }[];
}

const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dayOfIso = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

function paypalItems(txns: readonly TransactionRow[], config: E4Config): PayPalItem[] {
  const items: PayPalItem[] = [];
  for (const t of txns) {
    if (!t.status || !config.statuses.includes(t.status) || !t.initiationDate) continue;
    const refs = [t.invoiceId, t.customId, t.transactionId].filter((r): r is string => !!r);
    const base = {
      transactionId: t.transactionId,
      refs,
      currency: t.currency,
      day: dayOf(t.initiationDate),
    };
    items.push({ ...base, key: `txn:${t.transactionId}`, kind: 'gross', cents: t.amountCents });
    if (t.feeCents) {
      // Books record a fee as money out, whatever sign PayPal used.
      items.push({
        ...base,
        key: `txn:${t.transactionId}:fee`,
        kind: 'fee',
        cents: -Math.abs(t.feeCents),
      });
    }
  }
  return items.sort((a, b) => a.day - b.day || (a.key < b.key ? -1 : 1));
}

export function detectUnmatchedTransactions(
  txns: readonly TransactionRow[],
  ledger: readonly LedgerRow[],
  now: Date,
  config: E4Config = E4_DEFAULTS,
): E4Result {
  const items = paypalItems(txns, config);
  const rows = [...ledger].sort((a, b) =>
    a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : a.id < b.id ? -1 : 1,
  );
  const matchedLedger = new Map<string, PayPalItem>();
  const matchedItems = new Set<string>();
  const sameRef = (item: PayPalItem, row: LedgerRow) =>
    !!row.externalRef && item.refs.includes(row.externalRef);

  // 1. Exact matches, nearest date first.
  for (const item of items) {
    let best: LedgerRow | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (matchedLedger.has(row.id)) continue;
      if (row.currency !== item.currency || row.amountCents !== item.cents || !sameRef(item, row))
        continue;
      const gap = Math.abs(dayOfIso(row.bookedOn) - item.day);
      if (gap <= config.dateToleranceDays && gap < bestGap) {
        best = row;
        bestGap = gap;
      }
    }
    if (best) {
      matchedLedger.set(best.id, item);
      matchedItems.add(item.key);
    }
  }

  const exceptions: DetectedException[] = [];
  const pairedLedger = new Set<string>();
  const push = (
    targetRef: string,
    currency: string,
    amountAtRiskCents: number,
    reason: E4Reason,
    evidence: Record<string, unknown>,
  ) =>
    exceptions.push({
      type: 'UNMATCHED_TXN',
      targetRef,
      amountAtRiskCents: Math.abs(amountAtRiskCents),
      currency,
      deadlineAt: null,
      ...score(amountAtRiskCents, null, now),
      detectorVersion: E4_VERSION,
      evidence: { reason, ...evidence },
    });

  // 2. PayPal items with no booking. Pair a same-reference, same-kind leftover as amount_mismatch.
  for (const item of items) {
    if (matchedItems.has(item.key)) continue;
    const partner = rows.find(
      (row) =>
        !matchedLedger.has(row.id) &&
        !pairedLedger.has(row.id) &&
        row.currency === item.currency &&
        sameRef(item, row) &&
        Math.sign(row.amountCents) === Math.sign(item.cents) &&
        Math.abs(dayOfIso(row.bookedOn) - item.day) <= config.dateToleranceDays &&
        (item.kind === 'fee' ? /fee/i.test(row.memo ?? '') : !/fee/i.test(row.memo ?? '')),
    );
    const evidence = {
      transaction_id: item.transactionId,
      item: item.kind,
      paypal_amount_cents: item.cents,
      refs: item.refs,
    };
    if (partner) {
      pairedLedger.add(partner.id);
      push(item.key, item.currency, item.cents - partner.amountCents, 'amount_mismatch', {
        ...evidence,
        ledger_entry_id: partner.id,
        ledger_amount_cents: partner.amountCents,
        difference_cents: item.cents - partner.amountCents,
      });
    } else {
      push(
        item.key,
        item.currency,
        item.cents,
        item.kind === 'fee' ? 'fee_missing_in_books' : 'missing_in_books',
        evidence,
      );
    }
  }

  // 3. Bookings with no PayPal item. A repeat of an earlier identical booking is a duplicate.
  const seen: LedgerRow[] = [];
  for (const row of rows) {
    if (matchedLedger.has(row.id) || pairedLedger.has(row.id)) {
      seen.push(row);
      continue;
    }
    const original = seen.find(
      (s) =>
        s.externalRef === row.externalRef &&
        s.amountCents === row.amountCents &&
        s.currency === row.currency &&
        Math.abs(dayOfIso(s.bookedOn) - dayOfIso(row.bookedOn)) <= config.dateToleranceDays,
    );
    seen.push(row);
    push(
      `ledger:${row.id}`,
      row.currency,
      row.amountCents,
      original ? 'duplicate_in_books' : 'missing_in_paypal',
      {
        ledger_entry_id: row.id,
        external_ref: row.externalRef,
        ledger_amount_cents: row.amountCents,
        booked_on: row.bookedOn,
        memo: row.memo,
        ...(original ? { duplicate_of: original.id } : {}),
      },
    );
  }

  const matches = [...matchedLedger].map(([ledgerId, item]) => ({
    ledgerId,
    transactionId: item.transactionId,
    kind: item.kind,
  }));
  return { exceptions, matches };
}
