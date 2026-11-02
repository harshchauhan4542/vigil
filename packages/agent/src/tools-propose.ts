// propose_* tools: the ONLY write the agent can do is INSERT a DRAFT proposal.
// Policy evaluation, approval and execution happen elsewhere and are unreachable from here.
import {
  ACTION_PARAMS,
  ProposalMetaSchema,
  paramsHash,
  parseMoney,
  targetRefOf,
  type ActionType,
  type ProposedAction,
} from '@vigil/core';
import { DuplicateOpenProposalError, getException, insertDraftProposal } from '@vigil/db';
import type { z } from 'zod';
import type { AgentTool } from './tool.js';

const DESCRIPTIONS: Partial<Record<ActionType, string>> = {
  capture_authorization: 'Propose capturing an authorization (all or part of the held amount).',
  reauthorize: 'Propose reauthorizing an authorization after its honor period (new hold, new id).',
  void_authorization: 'Propose voiding an authorization (irreversible; releases the hold).',
  refund:
    'Propose refunding a capture (omit amount for a full refund). Only for a genuine overcharge.',
  add_tracking: 'Propose adding a carrier tracking number to a captured order.',
  retry_outstanding_balance: "Propose charging a subscription's outstanding balance.",
  suspend_subscription: 'Propose suspending a subscription.',
  journal_entry: "Propose an internal correction to the merchant's books (never touches PayPal).",
  dismiss: 'Propose closing the exception with no action, with the reason.',
};

/** Actions exposed to the model in P0/P1 (send_invoice_reminder is P2). */
export const PROPOSABLE: ActionType[] = [
  'capture_authorization',
  'reauthorize',
  'void_authorization',
  'refund',
  'add_tracking',
  'retry_outstanding_balance',
  'suspend_subscription',
  'journal_entry',
  'dismiss',
];

function proposeTool(action: ActionType): AgentTool {
  const params = ACTION_PARAMS[action] as z.ZodObject;
  const schema = params.extend(ProposalMetaSchema.shape);
  return {
    name: `propose_${action}`,
    description: `${DESCRIPTIONS[action]} Creates a DRAFT for policy checks and human approval; nothing executes now. evidence_refs must be ids you read in this conversation.`,
    schema,
    async run(input, ctx) {
      if (!ctx.exceptionId) return { error: 'No exception in scope: proposals need an exception.' };
      const exception = await getException(ctx.db, ctx.exceptionId);
      if (!exception) return { error: 'exception not found' };
      const { evidence_refs, rationale, confidence, ...rest } = input as Record<string, unknown> &
        z.infer<typeof ProposalMetaSchema>;
      const parsed = params.parse(rest);
      const proposed = { action_type: action, params: parsed } as ProposedAction;
      const targetRef = targetRefOf(proposed, exception.targetRef);
      const amt = (parsed as { amount?: { value: string; currency_code: string } }).amount;
      const money = amt ? parseMoney(amt.value, amt.currency_code) : null;
      try {
        const p = await insertDraftProposal(
          ctx.db,
          {
            exceptionId: exception.id,
            agentRunId: ctx.agentRunId,
            actionType: action,
            targetRef,
            params: parsed as Record<string, unknown>,
            paramsHash: paramsHash(parsed),
            rationale,
            evidenceRefs: evidence_refs,
            confidence,
            amountCents: money?.cents ?? null,
            currency: money?.currency ?? null,
          },
          { type: 'agent', id: ctx.agentRunId },
        );
        return {
          proposal_id: p.id,
          status: 'DRAFT',
          target_ref: targetRef,
          next: 'Policy checks and human approval decide whether this runs.',
        };
      } catch (error) {
        if (error instanceof DuplicateOpenProposalError) {
          return {
            error: `An open proposal already exists for ${targetRef}. Do not propose again; summarise instead.`,
          };
        }
        throw error;
      }
    },
  };
}

export const PROPOSE_TOOLS: AgentTool[] = PROPOSABLE.map(proposeTool);
