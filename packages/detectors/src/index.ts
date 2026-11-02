import { detectAuthHonorExpiring, E3_DEFAULTS, type E3Config } from './e3-auth-honor.js';
import { detectUnmatchedTransactions, E4_DEFAULTS, type E4Config } from './e4-unmatched.js';
import { byPriority } from './score.js';
import type { AuthorizationRow, DetectedException, LedgerRow, TransactionRow } from './types.js';

export * from './e3-auth-honor.js';
export * from './e4-unmatched.js';
export * from './score.js';
export type * from './types.js';

export interface DetectInput {
  authorizations: readonly AuthorizationRow[];
  transactions: readonly TransactionRow[];
  ledger: readonly LedgerRow[];
  now: Date;
  e3?: E3Config;
  e4?: E4Config;
}

/** Run every P0 detector and return exceptions in queue order (highest priority first). */
export function detectAll(input: DetectInput) {
  const e3 = detectAuthHonorExpiring(input.authorizations, input.now, input.e3 ?? E3_DEFAULTS);
  const e4 = detectUnmatchedTransactions(
    input.transactions,
    input.ledger,
    input.now,
    input.e4 ?? E4_DEFAULTS,
  );
  const exceptions: DetectedException[] = [...e3, ...e4.exceptions].sort(byPriority);
  return { exceptions, ledgerMatches: e4.matches };
}
