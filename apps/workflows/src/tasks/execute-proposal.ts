// Tier 3: execute an approved proposal. The ONLY place that calls the money-moving actions.
// No LLM here (lint-enforced). Order of operations:
//   verify token + params hash → consume token (single use) → persist PayPal-Request-Id →
//   call PayPal → record status/debug_id. Retryable failures reuse the same id while PayPal
//   still remembers it; past retention or attempts, the outcome is decided by a GET
//   (NEEDS_RECONCILE), never by a blind retry.
import { randomUUID } from 'node:crypto';
import {
  paramsHash,
  parseActionParams,
  parseMoney,
  type ActionParams,
  type ActionType,
  type ProposalStatus,
} from '@vigil/core';
import {
  advanceException,
  consumeApprovalToken,
  finishExecution,
  getApproval,
  getAuthorizationMirror,
  getCaptureMirror,
  getException,
  getProposal,
  insertLedgerEntries,
  listExecutions,
  reserveIdempotencyKey,
  setIdempotencyResult,
  startExecution,
  transitionProposal,
  updateAuthorizationMirror,
  updateCaptureMirror,
  upsertCapture,
  type Actor,
} from '@vigil/db';
import {
  PayPalApiError,
  PayPalError,
  canRetryWithSameId,
  paypalRequestId,
  reads,
  retentionUntil,
  supportsRequestId,
  type MockCode,
  type MutatingOperation,
  type PayPalResponse,
} from '@vigil/paypal';
import * as actions from '@vigil/paypal/actions';
import { tokenHash, verifyApprovalToken } from '@vigil/policy';
import type { WorkflowContext } from '../context.js';
import { captureRow } from '../sync/mappers.js';

const ACTOR: Actor = { type: 'system', id: 'execute_proposal' };

const OPERATION: Partial<Record<ActionType, MutatingOperation>> = {
  capture_authorization: 'authorizations.capture',
  reauthorize: 'authorizations.reauthorize',
  void_authorization: 'authorizations.void',
  refund: 'captures.refund',
  add_tracking: 'orders.track',
  retry_outstanding_balance: 'subscriptions.capture',
  suspend_subscription: 'subscriptions.suspend',
};

const ENDPOINT: Record<MutatingOperation, (p: Record<string, string>) => string> = {
  'authorizations.capture': (p) => `/v2/payments/authorizations/${p.authorization_id}/capture`,
  'authorizations.reauthorize': (p) =>
    `/v2/payments/authorizations/${p.authorization_id}/reauthorize`,
  'authorizations.void': (p) => `/v2/payments/authorizations/${p.authorization_id}/void`,
  'captures.refund': (p) => `/v2/payments/captures/${p.capture_id}/refund`,
  'orders.track': (p) => `/v2/checkout/orders/${p.order_id}/track`,
  'subscriptions.capture': (p) => `/v1/billing/subscriptions/${p.subscription_id}/capture`,
  'subscriptions.suspend': (p) => `/v1/billing/subscriptions/${p.subscription_id}/suspend`,
  'orders.create': () => '/v2/checkout/orders',
  'orders.authorize': () => '',
  'orders.capture': () => '',
  'subscriptions.create': () => '',
  'plans.create': () => '',
  'products.create': () => '',
};

export type ExecuteOutcome =
  | { status: 'SUCCEEDED' | 'SETTLED' | 'FAILED_FINAL'; proposalId: string; attempts: number }
  | { status: 'rejected'; proposalId: string; reason: string }
  | { status: 'in_progress' | 'already_done'; proposalId: string; current: string };

export interface ExecuteOptions {
  /** Negative test: PayPal-Mock-Response (Orders v2 / Payments v2 operations only). */
  mock?: MockCode;
}

type Call = (requestId: string | undefined) => Promise<PayPalResponse<unknown>>;

function callFor(ctx: WorkflowContext, action: ActionType, params: unknown, mock?: MockCode): Call {
  const h = ctx.http;
  const m = mock ? { mock } : {};
  switch (action) {
    case 'capture_authorization':
      return (rid) =>
        actions.captureAuthorization(h, params as ActionParams['capture_authorization'], {
          requestId: rid!,
          ...m,
        });
    case 'reauthorize':
      return (rid) =>
        actions.reauthorizeAuthorization(h, params as ActionParams['reauthorize'], {
          requestId: rid!,
        });
    case 'void_authorization':
      return (rid) =>
        actions.voidAuthorization(h, params as ActionParams['void_authorization'], {
          requestId: rid!,
          ...m,
        });
    case 'refund':
      return (rid) =>
        actions.refundCapture(h, params as ActionParams['refund'], { requestId: rid!, ...m });
    case 'add_tracking':
      return () => actions.addTracking(h, params as ActionParams['add_tracking']);
    case 'retry_outstanding_balance':
      return (rid) =>
        actions.captureSubscriptionBalance(h, params as ActionParams['retry_outstanding_balance'], {
          requestId: rid!,
        });
    case 'suspend_subscription':
      return () => actions.suspendSubscription(h, params as ActionParams['suspend_subscription']);
    default:
      throw new Error(`${action} is not a PayPal action`);
  }
}

/** Has PayPal already applied this action? Used for check-before-act and NEEDS_RECONCILE. */
export async function effectApplied(
  ctx: WorkflowContext,
  action: ActionType,
  params: Record<string, unknown>,
): Promise<boolean | null> {
  try {
    switch (action) {
      case 'capture_authorization': {
        const a = await reads.getAuthorization(ctx.http, String(params.authorization_id));
        return a.status === 'CAPTURED' || a.status === 'PARTIALLY_CAPTURED';
      }
      case 'void_authorization':
        return (
          (await reads.getAuthorization(ctx.http, String(params.authorization_id))).status ===
          'VOIDED'
        );
      case 'refund': {
        const c = await reads.getCapture(ctx.http, String(params.capture_id));
        return c.status === 'REFUNDED' || c.status === 'PARTIALLY_REFUNDED';
      }
      case 'add_tracking': {
        const trackers = await reads.listTrackers(ctx.http, String(params.capture_id));
        return trackers.some((t) => t.tracking_number === params.tracking_number);
      }
      case 'suspend_subscription':
        return (
          (await reads.getSubscription(ctx.http, String(params.subscription_id))).status ===
          'SUSPENDED'
        );
      case 'retry_outstanding_balance': {
        const s = await reads.getSubscription(ctx.http, String(params.subscription_id));
        return Number(s.billing_info?.outstanding_balance?.value ?? '0') === 0;
      }
      default:
        return null; // reauthorize: a new authorization id can't be found by GET → undecidable
    }
  } catch (error) {
    if (error instanceof PayPalError) return null;
    throw error;
  }
}

/** Keep the mirror in step with what we just did (detectors and policy read it). */
async function updateMirrors(
  ctx: WorkflowContext,
  action: ActionType,
  params: Record<string, unknown>,
  data: unknown,
) {
  if (action === 'capture_authorization') {
    const id = String(params.authorization_id);
    const prev = await getAuthorizationMirror(ctx.db, id);
    const amount = params.amount as { value: string; currency_code: string };
    const captured =
      (prev?.capturedTotalCents ?? 0) + parseMoney(amount.value, amount.currency_code).cents;
    if (prev) {
      await updateAuthorizationMirror(ctx.db, id, {
        capturedTotalCents: captured,
        status:
          params.final_capture || captured >= prev.amountCents ? 'CAPTURED' : 'PARTIALLY_CAPTURED',
      });
    }
    const cap = data as { id?: string; amount?: unknown };
    if (cap?.id && cap.amount)
      await upsertCapture(ctx.db, { ...captureRow(cap as never), authorizationId: id });
  } else if (action === 'void_authorization') {
    await updateAuthorizationMirror(ctx.db, String(params.authorization_id), { status: 'VOIDED' });
  } else if (action === 'refund') {
    const id = String(params.capture_id);
    const prev = await getCaptureMirror(ctx.db, id);
    if (prev) {
      const amount = params.amount as { value: string; currency_code: string } | undefined;
      const refunded = amount
        ? prev.refundedTotalCents + parseMoney(amount.value, amount.currency_code).cents
        : prev.amountCents;
      await updateCaptureMirror(ctx.db, id, {
        refundedTotalCents: refunded,
        status: refunded >= prev.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      });
    }
  } else if (action === 'add_tracking') {
    await updateCaptureMirror(ctx.db, String(params.capture_id), { hasTracker: true });
  }
}

async function succeed(
  ctx: WorkflowContext,
  proposalId: string,
  exceptionId: string,
  from: ProposalStatus,
  settled: boolean,
) {
  await transitionProposal(ctx.db, proposalId, from, 'SUCCEEDED', ACTOR);
  if (settled) {
    await transitionProposal(ctx.db, proposalId, 'SUCCEEDED', 'SETTLED', ACTOR);
  } else {
    await advanceException(ctx.db, exceptionId, 'AWAITING_SETTLEMENT', ACTOR);
  }
}

export async function executeProposal(
  ctx: WorkflowContext,
  proposalId: string,
  token: string,
  options: ExecuteOptions = {},
): Promise<ExecuteOutcome> {
  const now = ctx.now();
  const p = await getProposal(ctx.db, proposalId);
  if (!p) return { status: 'rejected', proposalId, reason: 'not_found' };

  // 1. The token must be valid for exactly these params (recomputed, not trusted from the row).
  const recomputed = paramsHash(p.params);
  if (recomputed !== p.paramsHash)
    return { status: 'rejected', proposalId, reason: 'params_changed' };
  const check = verifyApprovalToken(ctx.approvalSecret, token, {
    proposalId,
    paramsHash: recomputed,
    now,
  });
  if (!check.ok) return { status: 'rejected', proposalId, reason: `token_${check.reason}` };
  const approval = await getApproval(ctx.db, proposalId);
  if (
    !approval ||
    approval.decision !== 'APPROVED' ||
    approval.tokenHash !== tokenHash(token) ||
    approval.paramsHash !== recomputed
  ) {
    return { status: 'rejected', proposalId, reason: 'no_matching_approval' };
  }

  // 2. Single use: consume on first execution; a retried task may resume only its own run.
  let status = p.status as ProposalStatus;
  if (status === 'QUEUED') {
    if (!(await consumeApprovalToken(ctx.db, proposalId, approval.tokenHash!))) {
      return { status: 'rejected', proposalId, reason: 'token_used' };
    }
    await transitionProposal(ctx.db, proposalId, 'QUEUED', 'EXECUTING', ACTOR);
    await advanceException(ctx.db, p.exceptionId, 'EXECUTING', ACTOR);
    status = 'EXECUTING';
  } else if (
    status === 'EXECUTING' ||
    status === 'FAILED_RETRYABLE' ||
    status === 'NEEDS_RECONCILE'
  ) {
    if (!approval.tokenUsedAt)
      return { status: 'rejected', proposalId, reason: 'token_not_consumed' };
    const last = (await listExecutions(ctx.db, proposalId)).at(-1);
    if (
      status === 'EXECUTING' &&
      last &&
      !last.finishedAt &&
      now.getTime() - last.startedAt.getTime() < 120_000
    ) {
      return { status: 'in_progress', proposalId, current: status };
    }
  } else {
    return { status: 'already_done', proposalId, current: status };
  }

  const action = p.actionType as ActionType;
  const params = parseActionParams(action, p.params) as Record<string, unknown>;

  // 3. Internal actions (no PayPal call).
  if (action === 'dismiss' || action === 'journal_entry') {
    const exec = await startExecution(ctx.db, {
      proposalId,
      attempt: 1,
      operation: `internal.${action}`,
      endpoint: 'internal',
    });
    if (action === 'journal_entry') {
      const jp = params as ActionParams['journal_entry'];
      const m = parseMoney(jp.amount.value, jp.amount.currency_code);
      const exception = await getException(ctx.db, p.exceptionId);
      await insertLedgerEntries(ctx.db, [
        {
          id: proposalId, // one correction per proposal, idempotent
          source: 'vigil_correction',
          externalRef: jp.transaction_id ?? jp.ledger_entry_id ?? exception?.targetRef ?? null,
          amountCents: jp.direction === 'credit' ? -m.cents : m.cents,
          currency: m.currency,
          bookedOn: now.toISOString().slice(0, 10),
          memo: jp.memo,
          matchedTxnId: jp.transaction_id ?? null,
        },
      ]);
    }
    await finishExecution(ctx.db, exec.id, { httpStatus: 200, paypalStatus: 'INTERNAL' });
    await succeed(ctx, proposalId, p.exceptionId, 'EXECUTING', true);
    await advanceException(
      ctx.db,
      p.exceptionId,
      action === 'dismiss' ? 'DISMISSED' : 'AWAITING_SETTLEMENT',
      ACTOR,
    );
    if (action === 'journal_entry')
      await advanceException(ctx.db, p.exceptionId, 'RESOLVED', ACTOR);
    return { status: 'SETTLED', proposalId, attempts: 1 };
  }

  // 4. PayPal action. Persist the request id BEFORE the call (reused on every retry).
  const operation = OPERATION[action]!;
  const withId = supportsRequestId(operation);
  const key = await reserveIdempotencyKey(ctx.db, {
    operation,
    businessKey: proposalId,
    paypalRequestId: withId ? paypalRequestId(proposalId, operation) : randomUUID(),
    requestHash: recomputed,
    retentionUntil: retentionUntil(operation, now),
  });
  const requestId = withId ? key.paypalRequestId : undefined;
  const call = callFor(ctx, action, params, options.mock);

  // No PayPal-Request-Id for this API: never call twice. Check-before-act on any re-entry.
  if (!withId && (await listExecutions(ctx.db, proposalId)).length > 0) {
    if (status !== 'NEEDS_RECONCILE') {
      if (status === 'EXECUTING')
        await transitionProposal(ctx.db, proposalId, 'EXECUTING', 'FAILED_RETRYABLE', ACTOR);
      await transitionProposal(ctx.db, proposalId, 'FAILED_RETRYABLE', 'NEEDS_RECONCILE', ACTOR);
    }
    return reconcile(ctx, proposalId, p.exceptionId, action, params);
  }

  // Check-before-act for APIs without a request id (tracking, suspend).
  if (!withId && (await effectApplied(ctx, action, params)) === true) {
    await succeed(ctx, proposalId, p.exceptionId, 'EXECUTING', false);
    ctx.log('execute.already_applied', { proposalId, operation });
    return { status: 'SUCCEEDED', proposalId, attempts: 0 };
  }

  let attempts = (await listExecutions(ctx.db, proposalId)).length;
  if (status === 'NEEDS_RECONCILE')
    return reconcile(ctx, proposalId, p.exceptionId, action, params);

  for (;;) {
    if (status === 'FAILED_RETRYABLE') {
      await transitionProposal(ctx.db, proposalId, 'FAILED_RETRYABLE', 'EXECUTING', ACTOR, {});
      status = 'EXECUTING';
    }
    attempts++;
    const exec = await startExecution(ctx.db, {
      proposalId,
      attempt: attempts,
      paypalRequestId: requestId ?? null,
      operation,
      endpoint: ENDPOINT[operation](params as Record<string, string>),
      mockCode: options.mock ?? null,
    });
    try {
      const res = await call(requestId);
      const data = res.data as { status?: string } | undefined;
      await finishExecution(ctx.db, exec.id, {
        httpStatus: res.status,
        paypalStatus: data?.status ?? null,
        debugId: res.debugId ?? null,
        response: res.data ?? null,
      });
      await setIdempotencyResult(ctx.db, operation, proposalId, exec.id);
      await updateMirrors(ctx, action, params, res.data);
      await succeed(ctx, proposalId, p.exceptionId, 'EXECUTING', false);
      ctx.log('execute.succeeded', {
        proposalId,
        operation,
        attempts,
        request_id: requestId,
        debug_id: res.debugId,
      });
      return { status: 'SUCCEEDED', proposalId, attempts };
    } catch (error) {
      if (!(error instanceof PayPalError)) throw error;
      const api = error instanceof PayPalApiError ? error : null;
      await finishExecution(ctx.db, exec.id, {
        httpStatus: api?.status ?? null,
        paypalStatus: api?.issue ?? error.kind,
        debugId: api?.debugId ?? null,
        response: api?.body ?? { error: error.message },
      });
      ctx.log('execute.failed', {
        proposalId,
        operation,
        attempt: attempts,
        kind: error.kind,
        debug_id: api?.debugId,
      });

      if (!error.retryable) {
        // "Already captured" after a lost response: a GET decides whether it was us.
        if (error.kind === 'already_captured') {
          await transitionProposal(ctx.db, proposalId, 'EXECUTING', 'FAILED_RETRYABLE', ACTOR);
          await transitionProposal(
            ctx.db,
            proposalId,
            'FAILED_RETRYABLE',
            'NEEDS_RECONCILE',
            ACTOR,
          );
          return reconcile(ctx, proposalId, p.exceptionId, action, params);
        }
        await transitionProposal(ctx.db, proposalId, 'EXECUTING', 'FAILED_FINAL', ACTOR);
        await advanceException(ctx.db, p.exceptionId, 'FAILED', ACTOR, {
          issue: api?.issue,
          debug_id: api?.debugId,
        });
        return { status: 'FAILED_FINAL', proposalId, attempts };
      }

      await transitionProposal(ctx.db, proposalId, 'EXECUTING', 'FAILED_RETRYABLE', ACTOR);
      status = 'FAILED_RETRYABLE';
      const retentionOk = canRetryWithSameId(key.retentionUntil, ctx.now());
      if (withId && retentionOk && attempts < ctx.maxAttempts) {
        await ctx.sleep(250 * 2 ** (attempts - 1));
        continue;
      }
      await transitionProposal(ctx.db, proposalId, 'FAILED_RETRYABLE', 'NEEDS_RECONCILE', ACTOR);
      return reconcile(ctx, proposalId, p.exceptionId, action, params);
    }
  }
}

/** NEEDS_RECONCILE: a GET decides. Never a blind retry. */
async function reconcile(
  ctx: WorkflowContext,
  proposalId: string,
  exceptionId: string,
  action: ActionType,
  params: Record<string, unknown>,
): Promise<ExecuteOutcome> {
  const applied = await effectApplied(ctx, action, params);
  const attempts = (await listExecutions(ctx.db, proposalId)).length;
  if (applied === true) {
    await transitionProposal(ctx.db, proposalId, 'NEEDS_RECONCILE', 'SUCCEEDED', ACTOR, {});
    await advanceException(ctx.db, exceptionId, 'AWAITING_SETTLEMENT', ACTOR, { reconciled: true });
    ctx.log('execute.reconciled', { proposalId, applied });
    return { status: 'SUCCEEDED', proposalId, attempts };
  }
  if (applied === false) {
    await transitionProposal(ctx.db, proposalId, 'NEEDS_RECONCILE', 'FAILED_FINAL', ACTOR);
    await advanceException(ctx.db, exceptionId, 'FAILED', ACTOR, { reconciled: true });
    return { status: 'FAILED_FINAL', proposalId, attempts };
  }
  // Undecidable right now (PayPal unreachable, or reauthorize): stay in NEEDS_RECONCILE for settle_check / a human.
  ctx.log('execute.reconcile_pending', { proposalId });
  return { status: 'in_progress', proposalId, current: 'NEEDS_RECONCILE' };
}
