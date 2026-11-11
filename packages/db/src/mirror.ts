// Repositories for the PayPal mirror tables and ledger matching.
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import {
  ledgerEntries,
  ppAuthorizations,
  ppCaptures,
  ppOrders,
  ppSubscriptions,
  ppTransactions,
  seedObjects,
} from './schema.js';

export type AuthorizationMirror = typeof ppAuthorizations.$inferInsert;
export type CaptureMirror = typeof ppCaptures.$inferInsert;
export type OrderMirror = typeof ppOrders.$inferInsert;
export type SubscriptionMirror = typeof ppSubscriptions.$inferInsert;
export type TransactionMirror = typeof ppTransactions.$inferInsert;

const now = sql`now()`;

/** Insert or refresh an authorization. `capturedTotalCents` is only overwritten when given. */
export async function upsertAuthorization(db: Executor, row: AuthorizationMirror) {
  const { id: _id, ...rest } = row;
  await db
    .insert(ppAuthorizations)
    .values(row)
    .onConflictDoUpdate({ target: ppAuthorizations.id, set: { ...rest, syncedAt: now } });
}

export async function upsertCapture(db: Executor, row: CaptureMirror) {
  const { id: _id, ...rest } = row;
  await db
    .insert(ppCaptures)
    .values(row)
    .onConflictDoUpdate({ target: ppCaptures.id, set: { ...rest, syncedAt: now } });
}

export async function upsertOrder(db: Executor, row: OrderMirror) {
  const { id: _id, ...rest } = row;
  await db
    .insert(ppOrders)
    .values(row)
    .onConflictDoUpdate({ target: ppOrders.id, set: { ...rest, syncedAt: now } });
}

export async function upsertSubscription(db: Executor, row: SubscriptionMirror) {
  const { id: _id, ...rest } = row;
  await db
    .insert(ppSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: ppSubscriptions.id, set: { ...rest, syncedAt: now } });
}

export async function upsertTransactions(db: Executor, rows: TransactionMirror[]) {
  for (const row of rows) {
    const { transactionId: _id, ...rest } = row;
    await db
      .insert(ppTransactions)
      .values(row)
      .onConflictDoUpdate({ target: ppTransactions.transactionId, set: rest });
  }
}

export async function getAuthorizationMirror(db: Executor, id: string) {
  const [row] = await db.select().from(ppAuthorizations).where(eq(ppAuthorizations.id, id));
  return row ?? null;
}

export async function getCaptureMirror(db: Executor, id: string) {
  const [row] = await db.select().from(ppCaptures).where(eq(ppCaptures.id, id));
  return row ?? null;
}

export async function listAuthorizations(db: Executor, statuses?: readonly string[]) {
  const q = db.select().from(ppAuthorizations);
  return statuses?.length ? q.where(inArray(ppAuthorizations.status, [...statuses])) : q;
}

export async function listTransactionsBetween(db: Executor, start: Date, end: Date) {
  return db
    .select()
    .from(ppTransactions)
    .where(and(gte(ppTransactions.initiationDate, start), lt(ppTransactions.initiationDate, end)));
}

/** Ledger rows booked on dates in [startDay, endDay) (YYYY-MM-DD). */
export async function listLedgerBetween(db: Executor, startDay: string, endDay: string) {
  return db
    .select()
    .from(ledgerEntries)
    .where(and(gte(ledgerEntries.bookedOn, startDay), lt(ledgerEntries.bookedOn, endDay)));
}

export async function markLedgerMatched(
  db: Executor,
  matches: readonly { ledgerId: string; transactionId: string }[],
) {
  for (const m of matches) {
    await db
      .update(ledgerEntries)
      .set({ matchedTxnId: m.transactionId })
      .where(eq(ledgerEntries.id, m.ledgerId));
  }
}

/** Authorization ids Vigil knows about: mirrored ones plus those the seeder created. */
export async function knownAuthorizationIds(db: Executor): Promise<string[]> {
  const mirrored = await db.select({ id: ppAuthorizations.id }).from(ppAuthorizations);
  const seeded = await db
    .select({ id: sql<string>`${seedObjects.data}->>'authorization_id'` })
    .from(seedObjects)
    .where(sql`${seedObjects.data} ? 'authorization_id'`);
  return [...new Set([...mirrored, ...seeded].map((r) => r.id).filter(Boolean))].sort();
}

/** Capture ids Vigil knows about (mirror + seeder). */
export async function knownCaptureIds(db: Executor): Promise<string[]> {
  const mirrored = await db.select({ id: ppCaptures.id }).from(ppCaptures);
  const seeded = await db
    .select({ id: sql<string>`${seedObjects.data}->>'capture_id'` })
    .from(seedObjects)
    .where(sql`${seedObjects.data} ? 'capture_id'`);
  return [...new Set([...mirrored, ...seeded].map((r) => r.id).filter(Boolean))].sort();
}

export async function updateAuthorizationMirror(
  db: Executor,
  id: string,
  fields: Partial<Pick<AuthorizationMirror, 'status' | 'capturedTotalCents'>>,
) {
  await db
    .update(ppAuthorizations)
    .set({ ...fields, syncedAt: now })
    .where(eq(ppAuthorizations.id, id));
}

export async function updateCaptureMirror(
  db: Executor,
  id: string,
  fields: Partial<Pick<CaptureMirror, 'status' | 'refundedTotalCents' | 'hasTracker'>>,
) {
  await db
    .update(ppCaptures)
    .set({ ...fields, syncedAt: now })
    .where(eq(ppCaptures.id, id));
}

export async function knownSubscriptionIds(db: Executor): Promise<string[]> {
  const mirrored = await db.select({ id: ppSubscriptions.id }).from(ppSubscriptions);
  const seeded = await db
    .select({ id: seedObjects.paypalId })
    .from(seedObjects)
    .where(eq(seedObjects.kind, 'subscription'));
  return [...new Set([...mirrored, ...seeded].map((r) => r.id).filter(Boolean))].sort();
}

export async function listSubscriptions(db: Executor) {
  return db.select().from(ppSubscriptions);
}

/** Captures with the physical-goods flag of their order (default physical). */
export async function listCapturesForDetection(db: Executor) {
  const rows = await db
    .select({ capture: ppCaptures, isPhysical: ppOrders.isPhysical })
    .from(ppCaptures)
    .leftJoin(ppOrders, eq(ppOrders.id, ppCaptures.orderId));
  return rows.map((r) => ({ ...r.capture, isPhysical: r.isPhysical ?? true }));
}

export async function getSubscriptionMirror(db: Executor, id: string) {
  const [row] = await db.select().from(ppSubscriptions).where(eq(ppSubscriptions.id, id));
  return row ?? null;
}

/** Capture ids with the order id the seeder recorded (order id is needed for /track). */
export async function seededCaptureOrders(db: Executor): Promise<Map<string, string>> {
  const rows = await db
    .select({ cap: sql<string>`${seedObjects.data}->>'capture_id'`, order: seedObjects.paypalId })
    .from(seedObjects)
    .where(sql`${seedObjects.data} ? 'capture_id'`);
  return new Map(rows.map((r) => [r.cap, r.order]));
}
