// Inputs (mirror rows) and output (detected exceptions) of the pure detectors.
// Shapes match the @vigil/db mirror tables structurally; this package never imports the db.
import type { ExceptionType } from '@vigil/core';

export interface AuthorizationRow {
  id: string;
  orderId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  capturedTotalCents: number;
  createdAt: Date | null;
  expirationTime: Date | null;
}

export interface TransactionRow {
  transactionId: string;
  eventCode: string | null;
  /** Transaction Search status: S success, P pending, D denied, V reversed, F partially refunded. */
  status: string | null;
  amountCents: number;
  currency: string;
  /** As PayPal reports it (usually negative for a charge). */
  feeCents: number | null;
  invoiceId: string | null;
  customId: string | null;
  initiationDate: Date | null;
}

export interface LedgerRow {
  id: string;
  externalRef: string | null;
  amountCents: number;
  currency: string;
  /** YYYY-MM-DD */
  bookedOn: string;
  memo: string | null;
}

export interface DetectedException {
  type: ExceptionType;
  targetRef: string;
  amountAtRiskCents: number;
  currency: string;
  deadlineAt: Date | null;
  /** 1 (low) … 4 (overdue). */
  severity: number;
  /** Money at risk × urgency; the queue sorts by this. */
  score: number;
  detectorVersion: string;
  evidence: Record<string, unknown>;
}
