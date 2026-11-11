// Read models for the web app (queue, audit feed, AI budget).
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import { agentRuns, auditLog, exceptions, proposals } from './schema.js';

/** The exception queue with each exception's latest proposal, highest priority first. */
export async function listQueue(db: Executor, limit = 200) {
  const rows = await db
    .select()
    .from(exceptions)
    .orderBy(desc(exceptions.score), asc(exceptions.deadlineAt))
    .limit(limit);
  const latest = await db
    .selectDistinctOn([proposals.exceptionId], {
      exceptionId: proposals.exceptionId,
      id: proposals.id,
      actionType: proposals.actionType,
      status: proposals.status,
      riskTier: proposals.riskTier,
      amountCents: proposals.amountCents,
      currency: proposals.currency,
    })
    .from(proposals)
    .orderBy(proposals.exceptionId, desc(proposals.createdAt));
  const byException = new Map(latest.map((p) => [p.exceptionId, p]));
  return rows.map((e) => ({ ...e, latestProposal: byException.get(e.id) ?? null }));
}

export async function auditSince(db: Executor, afterSeq: number, limit = 100) {
  return db
    .select()
    .from(auditLog)
    .where(gt(auditLog.seq, afterSeq))
    .orderBy(asc(auditLog.seq))
    .limit(limit);
}

export async function latestAuditSeq(db: Executor): Promise<number> {
  const [row] = await db
    .select({ seq: sql<number>`coalesce(max(${auditLog.seq}), 0)::int` })
    .from(auditLog);
  return row?.seq ?? 0;
}

export async function listAudit(db: Executor, limit = 500) {
  return db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(limit);
}

/** Tokens spent by agent runs since `since` (daily AI budget). */
export async function agentTokensSince(db: Executor, since: Date): Promise<number> {
  const [row] = await db
    .select({
      n: sql<string>`coalesce(sum(coalesce(${agentRuns.inputTokens},0) + coalesce(${agentRuns.outputTokens},0)), 0)`,
    })
    .from(agentRuns)
    .where(gte(agentRuns.startedAt, since));
  return Number(row?.n ?? 0);
}

export async function listProposalsForExceptionLatestFirst(db: Executor, exceptionId: string) {
  return db
    .select()
    .from(proposals)
    .where(and(eq(proposals.exceptionId, exceptionId)))
    .orderBy(desc(proposals.createdAt));
}

const OPEN_EXCEPTION_STATUSES = [
  'OPEN',
  'TRIAGING',
  'PROPOSED',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'AWAITING_SETTLEMENT',
  'ESCALATED',
  'FAILED',
];

/** W1: money at risk in open exceptions vs. money recovered (settled monetary proposals). */
export async function moneyStats(db: Executor, since: Date) {
  const atRisk = await db
    .select({
      currency: exceptions.currency,
      cents: sql<string>`coalesce(sum(${exceptions.amountAtRiskCents}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(exceptions)
    .where(inArray(exceptions.status, OPEN_EXCEPTION_STATUSES))
    .groupBy(exceptions.currency);
  const recovered = await db
    .select({
      currency: proposals.currency,
      cents: sql<string>`coalesce(sum(abs(${proposals.amountCents})), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(proposals)
    .where(
      and(
        inArray(proposals.status, ['SUCCEEDED', 'SETTLED']),
        inArray(proposals.actionType, [
          'capture_authorization',
          'reauthorize',
          'retry_outstanding_balance',
        ]),
        gte(proposals.createdAt, since),
      ),
    )
    .groupBy(proposals.currency);
  const shape = (rows: { currency: string | null; cents: string; n: number }[]) =>
    rows
      .filter((r) => r.currency)
      .map((r) => ({ currency: r.currency!, cents: Number(r.cents), count: r.n }));
  return { atRisk: shape(atRisk), recovered: shape(recovered) };
}

/** W4: every audit row about an exception and its proposals, oldest first. */
export async function auditForEntities(db: Executor, entityIds: readonly string[]) {
  if (entityIds.length === 0) return [];
  return db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.entityId, [...entityIds]))
    .orderBy(asc(auditLog.seq));
}
