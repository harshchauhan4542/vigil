// Tier 2: the gate between a DRAFT proposal and money. Re-reads PayPal, runs the deterministic
// policy, and on human approval mints a single-use token bound to the exact params, then queues
// execution. Imports neither the LLM nor the money-moving actions.
import {
  MONETARY_ACTIONS,
  paramsHash,
  type ActionType,
  type ExceptionType,
  type ProposalStatus,
} from '@vigil/core';
import {
  advanceException,
  countOtherOpenProposals,
  executedCentsSince,
  getException,
  getProposal,
  isUniqueViolation,
  recordApproval,
  setProposalPolicy,
  StaleStateError,
  transitionProposal,
  type Actor,
  type Db,
} from '@vigil/db';
import { MOCK_CODES, type MockCode, type PayPalHttp } from '@vigil/paypal';
import {
  POLICY_V1,
  checkTypedAmount,
  evaluatePolicy,
  mintApprovalToken,
  type PolicyConfig,
  type PolicyResult,
} from '@vigil/policy';
import type { TaskRunner } from '@vigil/tasks';
import { freshStateFor, parseTargetRef } from './fresh.js';

export interface GateDeps {
  db: Db;
  http: PayPalHttp;
  runner: TaskRunner;
  approvalSecret: string;
  executionEnabled: boolean;
  policy?: PolicyConfig;
  now?: () => Date;
}

const MINUTE = 60_000;
const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Every id-like string in the exception's evidence, plus the exception and target ids (R7). */
export function evidenceUniverse(exception: {
  id: string;
  targetRef: string;
  evidence: unknown;
}): string[] {
  const ids = new Set<string>([exception.id, parseTargetRef(exception.targetRef).id]);
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (/^[A-Za-z0-9_-]{3,64}$/.test(v)) ids.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(exception.evidence);
  return [...ids];
}

async function runPolicy(
  deps: GateDeps,
  proposalId: string,
): Promise<{ result: PolicyResult; status: ProposalStatus } | null> {
  const now = deps.now?.() ?? new Date();
  const p = await getProposal(deps.db, proposalId);
  if (!p) return null;
  const e = await getException(deps.db, p.exceptionId);
  if (!e) return null;
  const actionType = p.actionType as ActionType;
  const fresh = await freshStateFor(deps.db, deps.http, actionType, p.targetRef);
  const result = evaluatePolicy(
    {
      exception: { id: e.id, type: e.type as ExceptionType, targetRef: e.targetRef },
      proposal: {
        id: p.id,
        actionType,
        targetRef: p.targetRef,
        params: p.params,
        evidenceRefs: p.evidenceRefs,
      },
      fresh,
      context: {
        now,
        otherOpenProposalsOnTarget: await countOtherOpenProposals(deps.db, p.targetRef, p.id),
        executedTodayCents: await executedCentsSince(deps.db, startOfUtcDay(now), [
          ...MONETARY_ACTIONS,
        ]),
        executionEnabled: deps.executionEnabled,
        evidenceUniverse: evidenceUniverse(e),
      },
    },
    deps.policy ?? POLICY_V1,
  );
  return { result, status: p.status as ProposalStatus };
}

/** DRAFT → PENDING_APPROVAL or POLICY_REJECTED, with the checklist stored on the proposal. */
export async function evaluateDraft(
  deps: GateDeps,
  proposalId: string,
): Promise<PolicyResult | null> {
  const r = await runPolicy(deps, proposalId);
  if (!r || r.status !== 'DRAFT') return r?.result ?? null;
  const now = deps.now?.() ?? new Date();
  const policy = deps.policy ?? POLICY_V1;
  await setProposalPolicy(deps.db, proposalId, {
    policyVersion: r.result.policyVersion,
    policyResult: r.result,
    riskTier: r.result.tier,
    expiresAt: new Date(now.getTime() + policy.proposalTtlMinutes * MINUTE),
  });
  await transitionProposal(
    deps.db,
    proposalId,
    'DRAFT',
    r.result.verdict === 'PASS' ? 'PENDING_APPROVAL' : 'POLICY_REJECTED',
    { type: 'policy', id: r.result.policyVersion },
    { riskTier: r.result.tier },
  );
  return r.result;
}

export type ApproveResult =
  | { ok: true; status: 'QUEUED'; runId: string; policy: PolicyResult }
  | {
      ok: false;
      code:
        | 'not_found'
        | 'not_pending'
        | 'expired'
        | 'policy_failed'
        | 'typed_amount_required'
        | 'mock_not_supported';
      status?: string;
      policy?: PolicyResult;
    };

export interface ApproveInput {
  proposalId: string;
  approver: string;
  /** T3 only: the amount typed by the approver, e.g. "612.00". */
  typedAmount?: string | null;
  /** Negative test: PayPal-Mock-Response code (Orders v2 / Payments v2 actions only). */
  mockCode?: string | null;
}

/** Actions whose PayPal call accepts PayPal-Mock-Response (see paypal/mock-response.ts). */
export const MOCKABLE_ACTIONS: ReadonlySet<string> = new Set([
  'capture_authorization',
  'void_authorization',
  'refund',
]);

/**
 * Human approval. Re-runs policy on fresh PayPal state, checks T3 typed confirmation, records
 * the one decision allowed per proposal, mints the token and queues execution. A second
 * approve (double click, two tabs) gets `not_pending` and queues nothing.
 */
export async function approveProposal(deps: GateDeps, input: ApproveInput): Promise<ApproveResult> {
  const now = deps.now?.() ?? new Date();
  const policy = deps.policy ?? POLICY_V1;
  const human: Actor = { type: 'human', id: input.approver };
  const p = await getProposal(deps.db, input.proposalId);
  if (!p) return { ok: false, code: 'not_found' };
  if (p.status !== 'PENDING_APPROVAL') return { ok: false, code: 'not_pending', status: p.status };
  let mock: MockCode | undefined;
  if (input.mockCode) {
    if (
      !MOCKABLE_ACTIONS.has(p.actionType) ||
      !(MOCK_CODES as readonly string[]).includes(input.mockCode)
    ) {
      return { ok: false, code: 'mock_not_supported' };
    }
    mock = input.mockCode as MockCode;
  }

  if (p.expiresAt && p.expiresAt <= now) {
    await transitionProposal(deps.db, p.id, 'PENDING_APPROVAL', 'EXPIRED', {
      type: 'system',
      id: 'gate',
    }).catch(() => {});
    return { ok: false, code: 'expired' };
  }

  // Params may never change after policy ran; recompute the hash from what is stored.
  if (paramsHash(p.params) !== p.paramsHash) return { ok: false, code: 'policy_failed' };

  const r = await runPolicy(deps, p.id);
  if (!r) return { ok: false, code: 'not_found' };
  if (r.result.verdict === 'FAIL') {
    await setProposalPolicy(deps.db, p.id, {
      policyVersion: r.result.policyVersion,
      policyResult: r.result,
      riskTier: r.result.tier,
    });
    // The target changed since the proposal was made: it can no longer be approved.
    await transitionProposal(deps.db, p.id, 'PENDING_APPROVAL', 'EXPIRED', {
      type: 'policy',
      id: r.result.policyVersion,
    }).catch(() => {});
    return { ok: false, code: 'policy_failed', policy: r.result };
  }
  if (
    r.result.requiresTypedAmount &&
    !checkTypedAmount(input.typedAmount, r.result.amountCents!, r.result.currency!)
  ) {
    return { ok: false, code: 'typed_amount_required', policy: r.result };
  }

  const expiresAt = new Date(now.getTime() + policy.approvalTokenTtlMinutes * MINUTE);
  const { token, tokenHash } = mintApprovalToken(deps.approvalSecret, {
    proposalId: p.id,
    paramsHash: p.paramsHash,
    expiresAt,
  });
  try {
    await recordApproval(
      deps.db,
      {
        proposalId: p.id,
        decision: 'APPROVED',
        approver: input.approver,
        paramsHash: p.paramsHash,
        tokenHash,
        typedConfirmation: input.typedAmount ?? null,
      },
      human,
    );
    await transitionProposal(deps.db, p.id, 'PENDING_APPROVAL', 'APPROVED', human, {
      riskTier: r.result.tier,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'approvals_proposal_uq') || error instanceof StaleStateError) {
      return {
        ok: false,
        code: 'not_pending',
        status: (await getProposal(deps.db, p.id))?.status ?? 'unknown',
      };
    }
    throw error;
  }
  await setProposalPolicy(deps.db, p.id, {
    policyVersion: r.result.policyVersion,
    policyResult: r.result,
    riskTier: r.result.tier,
  });
  await transitionProposal(deps.db, p.id, 'APPROVED', 'QUEUED', { type: 'system', id: 'gate' });
  const run = await deps.runner.start(
    'execute_proposal',
    mock ? [p.id, token, { mock }] : [p.id, token],
  );
  return { ok: true, status: 'QUEUED', runId: run.runId, policy: r.result };
}

export async function rejectProposal(
  deps: GateDeps,
  input: { proposalId: string; approver: string; reason?: string },
): Promise<{ ok: boolean; status?: string }> {
  const human: Actor = { type: 'human', id: input.approver };
  const p = await getProposal(deps.db, input.proposalId);
  if (!p || p.status !== 'PENDING_APPROVAL')
    return { ok: false, ...(p ? { status: p.status } : {}) };
  try {
    await recordApproval(
      deps.db,
      {
        proposalId: p.id,
        decision: 'REJECTED',
        approver: input.approver,
        paramsHash: p.paramsHash,
        reason: input.reason ?? null,
      },
      human,
    );
    await transitionProposal(deps.db, p.id, 'PENDING_APPROVAL', 'REJECTED', human);
  } catch (error) {
    if (isUniqueViolation(error, 'approvals_proposal_uq') || error instanceof StaleStateError)
      return { ok: false };
    throw error;
  }
  await advanceException(deps.db, p.exceptionId, 'TRIAGING', human, {
    reason: 'proposal rejected',
  });
  return { ok: true, status: 'REJECTED' };
}
