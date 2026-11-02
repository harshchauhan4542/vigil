// Repositories for demo seeding: seed objects, ledger entries and customer notes.
import { asc, eq, sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import { customerNotes, ledgerEntries, seedObjects } from './schema.js';

export type SeedObject = typeof seedObjects.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferInsert;
export type CustomerNote = typeof customerNotes.$inferInsert;

export async function getSeedObject(db: Executor, seedKey: string): Promise<SeedObject | null> {
  const [row] = await db.select().from(seedObjects).where(eq(seedObjects.seedKey, seedKey));
  return row ?? null;
}

export async function listSeedObjects(db: Executor): Promise<SeedObject[]> {
  return db.select().from(seedObjects).orderBy(asc(seedObjects.seedKey));
}

export async function upsertSeedObject(
  db: Executor,
  row: {
    seedKey: string;
    kind: string;
    paypalId: string;
    status: string;
    data?: Record<string, unknown>;
  },
): Promise<SeedObject> {
  const [out] = await db
    .insert(seedObjects)
    .values({ ...row, data: row.data ?? {} })
    .onConflictDoUpdate({
      target: seedObjects.seedKey,
      set: {
        paypalId: row.paypalId,
        status: row.status,
        ...(row.data ? { data: row.data } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return out!;
}

/** Insert ledger rows by deterministic id; existing ids are left untouched. Returns rows added. */
export async function insertLedgerEntries(db: Executor, rows: LedgerEntry[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(ledgerEntries)
    .values(rows)
    .onConflictDoNothing({ target: ledgerEntries.id })
    .returning({ id: ledgerEntries.id });
  return inserted.length;
}

export async function listLedgerEntries(db: Executor) {
  return db
    .select()
    .from(ledgerEntries)
    .orderBy(asc(ledgerEntries.bookedOn), asc(ledgerEntries.id));
}

export async function insertCustomerNote(db: Executor, row: CustomerNote): Promise<boolean> {
  const inserted = await db
    .insert(customerNotes)
    .values(row)
    .onConflictDoNothing({ target: customerNotes.id })
    .returning({ id: customerNotes.id });
  return inserted.length === 1;
}

export async function listCustomerNotes(db: Executor, externalRef?: string) {
  const q = db.select().from(customerNotes);
  return externalRef ? q.where(eq(customerNotes.externalRef, externalRef)) : q;
}
