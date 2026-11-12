// Workflow tasks other than execute_proposal (which lives in its own LLM-free module).
import {
  advanceException,
  getException,
  getProposal,
  listExecutions,
  listProposalsByStatus,
  transitionProposal,
  type Actor,
} from '@vigil/db';
import { evaluateDraft } from '@vigil/gate';
import { PayPalError, reads } from '@vigil/paypal';
import { runSeed } from '@vigil/scripts/seed';
import type { TaskHandlers } from '@vigil/tasks';
import { gateDeps, type WorkflowContext } from '../context.js';
import { detectExceptions } from '../sync/detect.js';
import { executeProposal, type ExecuteOptions } from './execute-proposal.js';
import { processWebhookTask } from './process-webhook.js';

const actor = (id: string): Actor => ({ type: 'system', id });

/** detect_exceptions: sweep PayPal, upsert exceptions, fan out triage for new / re-opened ones. */
export async function detectTask(ctx: WorkflowContext, searchDays?: number) {
  const summary = await detectExceptions({
    db: ctx.db,
    http: ctx.http,
    now: ctx.now(),
    ...(searchDays ? { searchDays } : {}),
  });
  for (const id of [...summary.created, ...summary.reopened]) {
    await ctx.runner.start('triage_exception', [id]);
  }
  ctx.log('detect.done', {
    ...summary,
    created: summary.created.length,
    reopened: summary.reopened.length,
  });
  return summary;
}

/**
 * triage_exception: the agent proposes (DRAFTs), policy evaluates each one, and the exception
 * moves to AWAITING_APPROVAL if anything passed, otherwise to ESCALATED for a human.
 */
export async function triageTask(ctx: WorkflowContext, exceptionId: string) {
  const e = await getException(ctx.db, exceptionId);
  if (!e) throw new Error(`exception ${exceptionId} not found`);
  if (e.status !== 'TRIAGING') {
    const moved = await advanceException(ctx.db, exceptionId, 'TRIAGING', actor('triage'));
    if (!moved) return { exceptionId, skipped: `exception is ${e.status}` };
  }
  if (!ctx.triage) {
    await advanceException(ctx.db, exceptionId, 'ESCALATED', actor('triage'), {
      reason: 'no agent configured',
    });
    return { exceptionId, escalated: true, proposals: [] };
  }

  let run: Awaited<ReturnType<NonNullable<WorkflowContext['triage']>>>;
  try {
    run = await ctx.triage(exceptionId);
  } catch (error) {
    // An AI failure (rate limit, malformed tool call, outage) must not leave the exception stuck
    // in TRIAGING where nobody sees it: hand it to the merchant instead.
    const reason = `AI review failed: ${(error as Error).message}`.slice(0, 300);
    await advanceException(ctx.db, exceptionId, 'ESCALATED', actor('triage'), { reason });
    ctx.log('triage.failed', { exceptionId, reason });
    return { exceptionId, escalated: true, proposals: [] };
  }
  const results = [];
  for (const proposalId of run.proposalIds) {
    const policy = await evaluateDraft(gateDeps(ctx), proposalId);
    const p = await getProposal(ctx.db, proposalId);
    results.push({ proposalId, verdict: policy?.verdict, status: p?.status });
  }
  const pending = results.some((r) => r.status === 'PENDING_APPROVAL');
  if (results.length > 0)
    await advanceException(ctx.db, exceptionId, 'PROPOSED', actor('triage'), {
      agent_run_id: run.runId,
    });
  await advanceException(
    ctx.db,
    exceptionId,
    pending ? 'AWAITING_APPROVAL' : 'ESCALATED',
    actor('triage'),
    pending
      ? {}
      : { reason: results.length ? 'all proposals rejected by policy' : 'agent made no proposal' },
  );
  ctx.log('triage.done', { exceptionId, runId: run.runId, results });
  return { exceptionId, runId: run.runId, proposals: results };
}

/**
 * settle_check: confirm SUCCEEDED proposals with a GET when the webhook is late, and retry the
 * decision for proposals stuck in NEEDS_RECONCILE.
 */
export async function settleCheckTask(ctx: WorkflowContext) {
  const settled: string[] = [];
  for (const p of await listProposalsByStatus(ctx.db, ['SUCCEEDED'])) {
    const last = (await listExecutions(ctx.db, p.id))
      .filter((x) => x.httpStatus && x.httpStatus < 300)
      .at(-1);
    const response = (last?.response ?? {}) as { id?: string; status?: string };
    let done = false;
    try {
      switch (p.actionType) {
        case 'capture_authorization':
          done = response.id
            ? (await reads.getCapture(ctx.http, response.id)).status === 'COMPLETED'
            : true;
          break;
        case 'refund':
          done = response.id
            ? (await reads.getRefund(ctx.http, response.id)).status === 'COMPLETED'
            : true;
          break;
        default:
          done = true; // void / reauthorize / tracking / suspend are final once PayPal accepted them
      }
    } catch (error) {
      if (!(error instanceof PayPalError)) throw error;
    }
    if (!done) continue;
    await transitionProposal(ctx.db, p.id, 'SUCCEEDED', 'SETTLED', actor('settle_check'), {});
    await advanceException(ctx.db, p.exceptionId, 'RESOLVED', actor('settle_check'), {
      via: 'settle_check',
    });
    settled.push(p.id);
  }
  return { settled };
}

/** reconcile_window: Transaction Search over a window → mirrors → E4 matching. */
export async function reconcileWindowTask(ctx: WorkflowContext, days = 31) {
  return detectTask(ctx, days);
}

/** reseed_demo: top up demo data (a dated cohort of holds), then sweep. */
export async function reseedTask(ctx: WorkflowContext, cohort?: string) {
  const seed = await runSeed({
    http: ctx.http,
    db: ctx.db,
    card: ctx.seedCard,
    cohort: cohort ?? ctx.now().toISOString().slice(0, 10),
  });
  const detect = await detectTask(ctx);
  return { seed: { created: seed.created.length, pending: seed.pending.length }, detect };
}

export function buildHandlers(getCtx: () => Promise<WorkflowContext>): TaskHandlers {
  return {
    detect_exceptions: async (days) => detectTask(await getCtx(), days as number | undefined),
    triage_exception: async (id) => triageTask(await getCtx(), String(id)),
    execute_proposal: async (id, token, opts) =>
      executeProposal(await getCtx(), String(id), String(token), (opts ?? {}) as ExecuteOptions),
    settle_check: async () => settleCheckTask(await getCtx()),
    process_webhook: async (id) => processWebhookTask(await getCtx(), String(id)),
    reconcile_window: async (days) =>
      reconcileWindowTask(await getCtx(), days as number | undefined),
    reseed_demo: async (cohort) => reseedTask(await getCtx(), cohort as string | undefined),
  };
}
