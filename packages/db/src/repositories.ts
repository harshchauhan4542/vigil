// Repositories for exceptions, proposals, approvals, executions, idempotency keys and webhooks.
// Every status change goes through the core state machines and writes an audit row in the
// same transaction.
import {
  OPEN_PROPOSAL_STATUSES,
  exceptionMachine,
  proposalMachine,
  webhookEventMachine,
  type ActionType,
  type ActorType,
  type ApprovalDecision,
  type ExceptionStatus,
  type ExceptionType,
  type ProposalStatus,
  type WebhookEventStatus,
} from '@vigil/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit } from './audit.js';
import type { Executor } from './client.js';
import {
  approvals,
  exceptions,
  executions,
  idempotencyKeys,
  proposals,
  webhookEvents,
} from './schema.js';

export interface Actor {
  type: ActorType;
  id: string;
}

export class StaleStateError extends Error {
  override name = 'StaleStateError';
  constructor(entity: string, id: string, expected: string) {
    super(`${entity} ${id} is no longer in state ${expected}`);
  }
}

export class DuplicateOpenProposalError extends Error {
  override name = 'DuplicateOpenProposalError';
  constructor(readonly targetRef: string) {
    super(`An open proposal already exists for ${targetRef}`);
  }
}

/** Postgres unique_violation, unwrapped from drizzle's error wrapper if present. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let e: unknown = error;
  for (let i = 0; i < 3 && e; i++) {
    const pg = e as { code?: string; constraint?: string; message?: string };
    if (pg.code === '23505') {
      return !constraint || pg.constraint === constraint || !!pg.message?.includes(constraint);
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ------------------------------------------------------------------ exceptions

export interface UpsertExceptionInput {
  type: ExceptionType;
  targetRef: string;
  amountAtRiskCents?: number | null;
  currency?: string | null;
  severity?: number;
  deadlineAt?: Date | null;
  detectorVersion: string;
  evidence: Record<string, unknown>;
}

/**
 * Insert a new OPEN exception, or refresh the evidence of an existing one.
 * A RESOLVED or DISMISSED exception that fires again is re-opened.
 */
export async function upsertException(db: Executor, input: UpsertExceptionInput, actor: Actor) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(exceptions)
      .where(and(eq(exceptions.type, input.type), eq(exceptions.targetRef, input.targetRef)))
      .for('update');

    const fields = {
      amountAtRiskCents: input.amountAtRiskCents ?? null,
      currency: input.currency ?? null,
      severity: input.severity ?? 1,
      deadlineAt: input.deadlineAt ?? null,
      detectorVersion: input.detectorVersion,
      evidence: input.evidence,
    };

    if (!existing) {
      const [row] = await tx
        .insert(exceptions)
        .values({
          id: uuidv7(),
          type: input.type,
          targetRef: input.targetRef,
          status: 'OPEN',
          ...fields,
        })
        .returning();
      await appendAudit(tx, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'exception.detected',
        entityType: 'exception',
        entityId: row!.id,
        payload: { type: input.type, target_ref: input.targetRef },
      });
      return { exception: row!, created: true, reopened: false };
    }

    const status = existing.status as ExceptionStatus;
    const reopen = status === 'RESOLVED' || status === 'DISMISSED';
    if (reopen) exceptionMachine.assertTransition(status, 'OPEN');
    const [row] = await tx
      .update(exceptions)
      .set({ ...fields, ...(reopen ? { status: 'OPEN', resolvedAt: null } : {}) })
      .where(eq(exceptions.id, existing.id))
      .returning();
    if (reopen) {
      await appendAudit(tx, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'exception.reopened',
        entityType: 'exception',
        entityId: existing.id,
        payload: { from: status, to: 'OPEN' },
      });
    }
    return { exception: row!, created: false, reopened: reopen };
  });
}

export async function getException(db: Executor, id: string) {
  const [row] = await db.select().from(exceptions).where(eq(exceptions.id, id));
  return row ?? null;
}

export async function listExceptions(db: Executor, statuses?: readonly ExceptionStatus[]) {
  const q = db.select().from(exceptions);
  return (statuses?.length ? q.where(inArray(exceptions.status, [...statuses])) : q).orderBy(
    asc(exceptions.deadlineAt),
    desc(exceptions.severity),
  );
}

export async function transitionException(
  db: Executor,
  id: string,
  from: ExceptionStatus,
  to: ExceptionStatus,
  actor: Actor,
  payload: Record<string, unknown> = {},
) {
  exceptionMachine.assertTransition(from, to);
  return db.transaction(async (tx) => {
    const terminal = to === 'RESOLVED' || to === 'DISMISSED';
    const [row] = await tx
      .update(exceptions)
      .set({ status: to, ...(terminal ? { resolvedAt: new Date() } : {}) })
      .where(and(eq(exceptions.id, id), eq(exceptions.status, from)))
      .returning();
    if (!row) throw new StaleStateError('exception', id, from);
    await appendAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'exception.transition',
      entityType: 'exception',
      entityId: id,
      payload: { from, to, ...payload },
    });
    return row;
  });
}

// ------------------------------------------------------------------ proposals

export interface InsertDraftProposalInput {
  exceptionId: string;
  agentRunId?: string | null;
  actionType: ActionType;
  targetRef: string;
  params: Record<string, unknown>;
  paramsHash: string;
  rationale: string;
  evidenceRefs: string[];
  confidence: number;
  amountCents?: number | null;
  currency?: string | null;
  expiresAt?: Date | null;
}

/** The only write the agent may do: insert a DRAFT. Enforces one open proposal per target. */
export async function insertDraftProposal(
  db: Executor,
  input: InsertDraftProposalInput,
  actor: Actor,
) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(proposals)
        .values({
          id: uuidv7(),
          ...input,
          agentRunId: input.agentRunId ?? null,
          amountCents: input.amountCents ?? null,
          currency: input.currency ?? null,
          expiresAt: input.expiresAt ?? null,
          status: 'DRAFT',
        })
        .returning();
      await appendAudit(tx, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'proposal.drafted',
        entityType: 'proposal',
        entityId: row!.id,
        payload: {
          exception_id: input.exceptionId,
          action_type: input.actionType,
          target_ref: input.targetRef,
          params_hash: input.paramsHash,
        },
      });
      return row!;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'proposals_one_open_per_target')) {
      throw new DuplicateOpenProposalError(input.targetRef);
    }
    throw error;
  }
}

export async function getProposal(db: Executor, id: string) {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
  return row ?? null;
}

export async function findOpenProposalByTarget(db: Executor, targetRef: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.targetRef, targetRef),
        inArray(proposals.status, [...OPEN_PROPOSAL_STATUSES]),
      ),
    );
  return row ?? null;
}

export async function listProposalsForException(db: Executor, exceptionId: string) {
  return db
    .select()
    .from(proposals)
    .where(eq(proposals.exceptionId, exceptionId))
    .orderBy(desc(proposals.createdAt));
}

export interface ProposalTransitionExtras {
  policyVersion?: string;
  policyResult?: unknown;
  riskTier?: number;
}

export async function transitionProposal(
  db: Executor,
  id: string,
  from: ProposalStatus,
  to: ProposalStatus,
  actor: Actor,
  extras: ProposalTransitionExtras = {},
) {
  proposalMachine.assertTransition(from, to);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(proposals)
      .set({ status: to, ...extras })
      .where(and(eq(proposals.id, id), eq(proposals.status, from)))
      .returning();
    if (!row) throw new StaleStateError('proposal', id, from);
    await appendAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'proposal.transition',
      entityType: 'proposal',
      entityId: id,
      payload: {
        from,
        to,
        ...(extras.riskTier !== undefined ? { risk_tier: extras.riskTier } : {}),
      },
    });
    return row;
  });
}

// ------------------------------------------------------------------ approvals

export interface RecordApprovalInput {
  proposalId: string;
  decision: ApprovalDecision;
  approver: string;
  paramsHash: string;
  tokenHash?: string | null;
  typedConfirmation?: string | null;
  reason?: string | null;
}

/** One immutable decision per proposal (unique proposal_id). */
export async function recordApproval(db: Executor, input: RecordApprovalInput, actor: Actor) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(approvals)
      .values({
        id: uuidv7(),
        ...input,
        tokenHash: input.tokenHash ?? null,
        typedConfirmation: input.typedConfirmation ?? null,
        reason: input.reason ?? null,
      })
      .returning();
    await appendAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: `approval.${input.decision.toLowerCase()}`,
      entityType: 'proposal',
      entityId: input.proposalId,
      payload: { params_hash: input.paramsHash, approver: input.approver },
    });
    return row!;
  });
}

export async function getApproval(db: Executor, proposalId: string) {
  const [row] = await db.select().from(approvals).where(eq(approvals.proposalId, proposalId));
  return row ?? null;
}

/** Mark the approval token used. Returns false if it was already used (single use). */
export async function consumeApprovalToken(db: Executor, proposalId: string, tokenHash: string) {
  const rows = await db
    .update(approvals)
    .set({ tokenUsedAt: new Date() })
    .where(
      and(
        eq(approvals.proposalId, proposalId),
        eq(approvals.tokenHash, tokenHash),
        eq(approvals.decision, 'APPROVED'),
        sql`${approvals.tokenUsedAt} is null`,
      ),
    )
    .returning({ id: approvals.id });
  return rows.length === 1;
}

// ------------------------------------------------------------------ executions

export interface StartExecutionInput {
  proposalId: string;
  attempt: number;
  paypalRequestId?: string | null;
  operation: string;
  endpoint: string;
  mockCode?: string | null;
  renderTaskRunId?: string | null;
}

export async function startExecution(db: Executor, input: StartExecutionInput) {
  const [row] = await db
    .insert(executions)
    .values({
      id: uuidv7(),
      ...input,
      paypalRequestId: input.paypalRequestId ?? null,
      mockCode: input.mockCode ?? null,
      renderTaskRunId: input.renderTaskRunId ?? null,
    })
    .returning();
  return row!;
}

export interface FinishExecutionInput {
  httpStatus?: number | null;
  paypalStatus?: string | null;
  debugId?: string | null;
  response?: unknown;
}

export async function finishExecution(db: Executor, id: string, result: FinishExecutionInput) {
  const [row] = await db
    .update(executions)
    .set({ ...result, finishedAt: new Date() })
    .where(eq(executions.id, id))
    .returning();
  return row!;
}

export async function listExecutions(db: Executor, proposalId: string) {
  return db
    .select()
    .from(executions)
    .where(eq(executions.proposalId, proposalId))
    .orderBy(asc(executions.attempt));
}

// ------------------------------------------------------------------ idempotency keys

export interface IdempotencyKeyInput {
  operation: string;
  businessKey: string;
  paypalRequestId: string;
  requestHash: string;
  retentionUntil: Date | null;
}

/**
 * Persist a PayPal-Request-Id before the call. If one already exists for
 * (operation, business_key) it is returned unchanged so retries reuse it.
 * A different request body for the same key is a programming error.
 */
export async function reserveIdempotencyKey(db: Executor, input: IdempotencyKeyInput) {
  await db.insert(idempotencyKeys).values(input).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.operation, input.operation),
        eq(idempotencyKeys.businessKey, input.businessKey),
      ),
    );
  if (row!.requestHash !== input.requestHash) {
    throw new Error(
      `Idempotency key ${input.operation}/${input.businessKey} reused with a different request body`,
    );
  }
  return row!;
}

export async function setIdempotencyResult(
  db: Executor,
  operation: string,
  businessKey: string,
  resultRef: string,
) {
  await db
    .update(idempotencyKeys)
    .set({ resultRef })
    .where(
      and(eq(idempotencyKeys.operation, operation), eq(idempotencyKeys.businessKey, businessKey)),
    );
}

// ------------------------------------------------------------------ webhooks

export interface InsertWebhookEventInput {
  eventId: string;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  transmissionId?: string | null;
  transmissionTime?: Date | null;
  headers?: Record<string, string>;
  rawBody: Uint8Array;
  simulated?: boolean;
}

/** Store a received event. Returns `null` if the event id was already stored (dedupe). */
export async function insertWebhookEvent(db: Executor, input: InsertWebhookEventInput) {
  const [row] = await db
    .insert(webhookEvents)
    .values({ ...input, simulated: input.simulated ?? false, processingStatus: 'RECEIVED' })
    .onConflictDoNothing({ target: webhookEvents.eventId })
    .returning();
  return row ?? null;
}

export async function getWebhookEvent(db: Executor, eventId: string) {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, eventId));
  return row ?? null;
}

export interface WebhookTransitionExtras {
  verificationMethod?: string;
  verificationStatus?: string;
  error?: string | null;
}

export async function transitionWebhookEvent(
  db: Executor,
  eventId: string,
  from: WebhookEventStatus,
  to: WebhookEventStatus,
  extras: WebhookTransitionExtras = {},
) {
  webhookEventMachine.assertTransition(from, to);
  const done = to === 'PROCESSED' || to === 'IGNORED_DUPLICATE';
  const [row] = await db
    .update(webhookEvents)
    .set({ processingStatus: to, ...extras, ...(done ? { processedAt: new Date() } : {}) })
    .where(and(eq(webhookEvents.eventId, eventId), eq(webhookEvents.processingStatus, from)))
    .returning();
  if (!row) throw new StaleStateError('webhook_event', eventId, from);
  return row;
}
