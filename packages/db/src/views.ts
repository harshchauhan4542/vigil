// Read models for the web app (queue, audit feed, AI budget).
import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';
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
