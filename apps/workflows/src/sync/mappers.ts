// PayPal resource → mirror row. Money is converted to integer cents here, once.
import { parseMoney } from '@vigil/core';
import type {
  AuthorizationMirror,
  CaptureMirror,
  SubscriptionMirror,
  TransactionMirror,
} from '@vigil/db';
import type { Authorization, Capture, Subscription, TransactionDetail } from '@vigil/paypal';

const date = (iso: string | undefined) => (iso ? new Date(iso) : null);

export function authorizationRow(
  a: Authorization,
  capturedTotalCents?: number,
): AuthorizationMirror {
  const m = parseMoney(a.amount.value, a.amount.currency_code);
  return {
    id: a.id,
    orderId: a.supplementary_data?.related_ids?.order_id ?? null,
    status: a.status,
    amountCents: m.cents,
    currency: m.currency,
    ...(capturedTotalCents !== undefined ? { capturedTotalCents } : {}),
    createdAt: date(a.create_time),
    expirationTime: date(a.expiration_time),
    raw: a,
  };
}

export function captureRow(
  c: Capture,
  extra: { refundedTotalCents?: number; hasTracker?: boolean } = {},
): CaptureMirror {
  const m = parseMoney(c.amount.value, c.amount.currency_code);
  return {
    id: c.id,
    authorizationId: c.supplementary_data?.related_ids?.authorization_id ?? null,
    orderId: c.supplementary_data?.related_ids?.order_id ?? null,
    status: c.status,
    amountCents: m.cents,
    currency: m.currency,
    ...extra,
    createdAt: date(c.create_time),
    raw: c,
  };
}

export function transactionRow(d: TransactionDetail): TransactionMirror {
  const t = d.transaction_info;
  const m = parseMoney(t.transaction_amount.value, t.transaction_amount.currency_code);
  return {
    transactionId: t.transaction_id,
    eventCode: t.transaction_event_code ?? null,
    status: t.transaction_status ?? null,
    amountCents: m.cents,
    currency: m.currency,
    feeCents: t.fee_amount
      ? parseMoney(t.fee_amount.value, t.fee_amount.currency_code).cents
      : null,
    invoiceId: t.invoice_id ?? null,
    customId: t.custom_field ?? null,
    initiationDate: date(t.transaction_initiation_date),
    raw: d,
  };
}

export function subscriptionRow(s: Subscription): SubscriptionMirror {
  const bal = s.billing_info?.outstanding_balance;
  const failed = s.billing_info?.last_failed_payment;
  const m = bal ? parseMoney(bal.value, bal.currency_code) : null;
  return {
    id: s.id,
    planId: s.plan_id,
    status: s.status,
    outstandingBalanceCents: m?.cents ?? 0,
    currency: m?.currency ?? failed?.amount.currency_code ?? 'USD',
    lastFailedReason: failed?.reason_code ?? null,
    lastFailedAt: failed?.time ? new Date(failed.time) : null,
    raw: s,
  };
}
