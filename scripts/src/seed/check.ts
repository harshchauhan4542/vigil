// Re-reads every seeded object from the sandbox and summarises what exists.
import {
  listCustomerNotes,
  listLedgerEntries,
  listSeedObjects,
  upsertSeedObject,
  type Db,
} from '@vigil/db';
import { reads, type PayPalHttp } from '@vigil/paypal';

export interface SeedReport {
  objects: { key: string; kind: string; paypalId: string; status: string; tracked: boolean }[];
  byKindStatus: Record<string, Record<string, number>>;
  ledgerRows: number;
  notes: number;
  pending: { key: string; link: string | undefined }[];
}

export async function inspectSeed(http: PayPalHttp, db: Db): Promise<SeedReport> {
  const report: SeedReport = {
    objects: [],
    byKindStatus: {},
    ledgerRows: 0,
    notes: 0,
    pending: [],
  };
  for (const row of await listSeedObjects(db)) {
    const d = row.data as {
      authorization_id?: string;
      capture_id?: string;
      approve_link?: string;
      tracker_added?: boolean;
    };
    let status = row.status;
    if (row.kind === 'subscription')
      status = (await reads.getSubscription(http, row.paypalId)).status;
    else if (d.authorization_id)
      status = (await reads.getAuthorization(http, d.authorization_id)).status;
    else if (d.capture_id) status = (await reads.getCapture(http, d.capture_id)).status;
    else if (row.kind.startsWith('order_'))
      status = (await reads.getOrder(http, row.paypalId)).status;
    if (status !== row.status) {
      await upsertSeedObject(db, {
        seedKey: row.seedKey,
        kind: row.kind,
        paypalId: row.paypalId,
        status,
      });
    }
    report.objects.push({
      key: row.seedKey,
      kind: row.kind,
      paypalId: row.paypalId,
      status,
      tracked: !!d.tracker_added,
    });
    (report.byKindStatus[row.kind] ??= {})[status] =
      (report.byKindStatus[row.kind]?.[status] ?? 0) + 1;
    const awaitingBuyer =
      (row.kind === 'subscription' && status === 'APPROVAL_PENDING') ||
      (row.kind.startsWith('order_') && !d.authorization_id && !d.capture_id);
    if (awaitingBuyer) {
      report.pending.push({ key: row.seedKey, link: d.approve_link });
    }
  }
  report.ledgerRows = (await listLedgerEntries(db)).length;
  report.notes = (await listCustomerNotes(db)).length;
  return report;
}
