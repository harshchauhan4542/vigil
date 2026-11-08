// Hash-chained, append-only audit log.
// Each row stores hash = sha256(prev_hash + canonical_json(row)); verifyChain() re-checks all rows.
import { canonicalJson, sha256Hex, type ActorType } from '@vigil/core';
import { asc, desc, sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import { auditLog } from './schema.js';

export const GENESIS_HASH = '0'.repeat(64);
/** Arbitrary constant key for the advisory lock that serialises audit appends. */
const AUDIT_LOCK_KEY = 7_142_001;

export interface AuditEntry {
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

interface HashedFields {
  ts: Date;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
}

export function auditRowHash(prevHash: string, row: HashedFields): string {
  const canonical = canonicalJson({
    ts: row.ts.toISOString(),
    actor_type: row.actorType,
    actor_id: row.actorId,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    payload: row.payload ?? {},
  });
  return sha256Hex(prevHash + canonical);
}

/**
 * Append one audit row. Runs inside a transaction holding an advisory lock so concurrent
 * writers can't fork the chain. Pass an open transaction to make the audit row atomic
 * with the change it records.
 */
export async function appendAudit(executor: Executor, entry: AuditEntry) {
  const run = async (tx: Executor) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
    const [last] = await tx
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    // JS dates are millisecond precision, so the value round-trips through timestamptz unchanged.
    const ts = new Date();
    const payload = JSON.parse(canonicalJson(entry.payload ?? {})) as Record<string, unknown>;
    const hash = auditRowHash(prevHash, { ...entry, ts, payload });
    const [row] = await tx
      .insert(auditLog)
      .values({ ...entry, ts, payload, prevHash, hash })
      .returning();
    return row!;
  };
  // On an open transaction this becomes a savepoint; the advisory lock lives until the outer commit.
  return executor.transaction(run);
}

export type ChainResult =
  | { ok: true; rows: number; head: string }
  | {
      ok: false;
      rows: number;
      brokenAtSeq: number;
      reason: 'hash_mismatch' | 'prev_hash_mismatch';
    };

/** Walk the whole chain in seq order and recompute every hash. */
export async function verifyChain(executor: Executor): Promise<ChainResult> {
  const rows = await executor.select().from(auditLog).orderBy(asc(auditLog.seq));
  let prev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return { ok: false, rows: rows.length, brokenAtSeq: row.seq, reason: 'prev_hash_mismatch' };
    }
    if (auditRowHash(row.prevHash, row) !== row.hash) {
      return { ok: false, rows: rows.length, brokenAtSeq: row.seq, reason: 'hash_mismatch' };
    }
    prev = row.hash;
  }
  return { ok: true, rows: rows.length, head: prev };
}
