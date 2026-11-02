// detect_exceptions core logic: pull PayPal state into the mirror tables, run the pure
// detectors, and upsert exceptions (no duplicates; a resolved one re-opens if it fires again).
import { detectAll } from '@vigil/detectors';
import {
  getAuthorizationMirror,
  knownAuthorizationIds,
  listAuthorizations,
  listLedgerBetween,
  listTransactionsBetween,
  markLedgerMatched,
  upsertAuthorization,
  upsertException,
  upsertTransactions,
  type Actor,
  type Db,
} from '@vigil/db';
import { PayPalApiError, reads, type PayPalHttp } from '@vigil/paypal';
import { authorizationRow, transactionRow } from './mappers.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface DetectOptions {
  db: Db;
  http: PayPalHttp;
  now?: Date;
  /** How far back Transaction Search looks. */
  searchDays?: number;
  /** Transaction Search lags up to 3 h: ledger rows newer than this are not judged yet. */
  lagHours?: number;
  actor?: Actor;
}

export interface DetectSummary {
  authorizationsSynced: number;
  transactionsSynced: number;
  detected: number;
  created: string[];
  reopened: string[];
}

export async function syncAuthorizations(db: Db, http: PayPalHttp): Promise<number> {
  let n = 0;
  for (const id of await knownAuthorizationIds(db)) {
    try {
      const a = await reads.getAuthorization(http, id);
      const prev = await getAuthorizationMirror(db, id);
      await upsertAuthorization(db, authorizationRow(a, prev?.capturedTotalCents));
      n++;
    } catch (error) {
      // A 404 for a stale id must not stop the sweep.
      if (!(error instanceof PayPalApiError && error.status === 404)) throw error;
    }
  }
  return n;
}

export async function syncTransactions(
  db: Db,
  http: PayPalHttp,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = [];
  for await (const detail of reads.searchTransactions(http, start, end))
    rows.push(transactionRow(detail));
  await upsertTransactions(db, rows);
  return rows.length;
}

export async function detectExceptions(options: DetectOptions): Promise<DetectSummary> {
  const { db, http } = options;
  const now = options.now ?? new Date();
  const actor = options.actor ?? { type: 'detector', id: 'detect_exceptions' };
  const start = new Date(now.getTime() - (options.searchDays ?? 7) * DAY);
  const ledgerEnd = new Date(now.getTime() - (options.lagHours ?? 3) * HOUR);

  const authorizationsSynced = await syncAuthorizations(db, http);
  const transactionsSynced = await syncTransactions(db, http, start, now);

  // Judge the books only inside the window, keeping the ±2-day tolerance away from its edges.
  const ledger = await listLedgerBetween(
    db,
    isoDay(new Date(start.getTime() + 2 * DAY)),
    isoDay(ledgerEnd),
  );
  const { exceptions, ledgerMatches } = detectAll({
    authorizations: await listAuthorizations(db),
    transactions: await listTransactionsBetween(db, start, now),
    ledger,
    now,
  });

  const summary: DetectSummary = {
    authorizationsSynced,
    transactionsSynced,
    detected: exceptions.length,
    created: [],
    reopened: [],
  };
  for (const e of exceptions) {
    const r = await upsertException(
      db,
      {
        type: e.type,
        targetRef: e.targetRef,
        amountAtRiskCents: e.amountAtRiskCents,
        currency: e.currency,
        severity: e.severity,
        score: e.score,
        deadlineAt: e.deadlineAt,
        detectorVersion: e.detectorVersion,
        evidence: e.evidence,
      },
      actor,
    );
    if (r.created) summary.created.push(r.exception.id);
    if (r.reopened) summary.reopened.push(r.exception.id);
  }
  await markLedgerMatched(db, ledgerMatches);
  return summary;
}
