import { detectFailedRenewals, E1_DEFAULTS, type E1Config } from './e1-failed-renewal.js';
import { detectUntrackedCaptures, E2_DEFAULTS, type E2Config } from './e2-untracked-capture.js';
import { detectAuthHonorExpiring, E3_DEFAULTS, type E3Config } from './e3-auth-honor.js';
import { detectUnmatchedTransactions, E4_DEFAULTS, type E4Config } from './e4-unmatched.js';
import { byPriority } from './score.js';
import type {
  AuthorizationRow,
  CaptureRow,
  DetectedException,
  LedgerRow,
  SubscriptionRow,
  TransactionRow,
} from './types.js';

export * from './e1-failed-renewal.js';
export * from './e2-untracked-capture.js';
export * from './e3-auth-honor.js';
export * from './e4-unmatched.js';
export * from './score.js';
export type * from './types.js';

export interface DetectInput {
  authorizations: readonly AuthorizationRow[];
  transactions: readonly TransactionRow[];
  ledger: readonly LedgerRow[];
  subscriptions?: readonly SubscriptionRow[];
  captures?: readonly CaptureRow[];
  now: Date;
  e1?: E1Config;
  e2?: E2Config;
  e3?: E3Config;
  e4?: E4Config;
}

/** Run every detector (E1–E4) and return exceptions in queue order (highest priority first). */
export function detectAll(input: DetectInput) {
  const e3 = detectAuthHonorExpiring(input.authorizations, input.now, input.e3 ?? E3_DEFAULTS);
  const e4 = detectUnmatchedTransactions(
    input.transactions,
    input.ledger,
    input.now,
    input.e4 ?? E4_DEFAULTS,
  );
  const e1 = detectFailedRenewals(input.subscriptions ?? [], input.now, input.e1 ?? E1_DEFAULTS);
  const e2 = detectUntrackedCaptures(input.captures ?? [], input.now, input.e2 ?? E2_DEFAULTS);
  const exceptions: DetectedException[] = [...e1, ...e2, ...e3, ...e4.exceptions].sort(byPriority);
  return { exceptions, ledgerMatches: e4.matches };
}
