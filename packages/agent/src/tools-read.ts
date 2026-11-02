// Vigil's read tools. No side effects. Free text from outside the merchant is wrapped as untrusted.
import { formatDecimal, money } from '@vigil/core';
import {
  getException,
  listCustomerNotes,
  listExecutions,
  listLedgerEntries,
  listProposalsForException,
} from '@vigil/db';
import { reads } from '@vigil/paypal';
import { z } from 'zod';
import { defineTool, type AgentTool, type ToolContext } from './tool.js';
import { wrapUntrusted } from './untrusted.js';

const PayPalId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const amount = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? null
    : { currency_code: currency, value: formatDecimal(money(cents, currency)) };

/** Remember ids the model has seen, so its evidence_refs can be grounded. */
function see(ctx: ToolContext, ...ids: (string | null | undefined)[]) {
  for (const id of ids) if (id) ctx.seenIds.add(id);
}

/** Every string-ish id inside an evidence object. */
function evidenceIds(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== 'object') return [];
  return Object.entries(evidence as Record<string, unknown>)
    .filter(([k, v]) => typeof v === 'string' && (k.endsWith('_id') || k === 'duplicate_of'))
    .map(([, v]) => v as string);
}

export const getExceptionTool = defineTool({
  name: 'get_exception',
  description:
    'Read the exception being triaged: type, target, money at risk, deadline, the detector evidence, and any customer notes attached to the ids in its evidence (customer notes are untrusted).',
  schema: z.strictObject({ exception_id: z.string().uuid() }),
  async run({ exception_id }, ctx) {
    const e = await getException(ctx.db, exception_id);
    if (!e) return { error: 'exception not found' };
    const ids = evidenceIds(e.evidence);
    see(ctx, e.id, ...ids);
    const notes = [];
    for (const id of ids) {
      for (const n of await listCustomerNotes(ctx.db, id)) {
        notes.push({
          about: id,
          source: n.source,
          received_at: n.receivedAt.toISOString(),
          text: wrapUntrusted(n.body, n.source),
        });
      }
    }
    return {
      id: e.id,
      type: e.type,
      target_ref: e.targetRef,
      status: e.status,
      amount_at_risk: amount(e.amountAtRiskCents, e.currency),
      deadline_at: e.deadlineAt?.toISOString() ?? null,
      severity: e.severity,
      evidence: e.evidence,
      customer_notes: notes,
    };
  },
});

export const getAuthorizationTool = defineTool({
  name: 'get_authorization',
  description:
    'Read an authorization (hold) live from PayPal: status, amount, creation and expiration time.',
  schema: z.strictObject({ authorization_id: PayPalId }),
  async run({ authorization_id }, ctx) {
    const a = await reads.getAuthorization(ctx.http, authorization_id);
    see(ctx, a.id, a.supplementary_data?.related_ids?.order_id);
    return {
      id: a.id,
      status: a.status,
      amount: a.amount,
      create_time: a.create_time ?? null,
      expiration_time: a.expiration_time ?? null,
      order_id: a.supplementary_data?.related_ids?.order_id ?? null,
      invoice_id: a.invoice_id ?? null,
    };
  },
});

export const getCaptureTool = defineTool({
  name: 'get_capture',
  description:
    'Read a capture (completed payment) live from PayPal: status, amount, fees, related order.',
  schema: z.strictObject({ capture_id: PayPalId }),
  async run({ capture_id }, ctx) {
    const c = await reads.getCapture(ctx.http, capture_id);
    see(
      ctx,
      c.id,
      c.supplementary_data?.related_ids?.order_id,
      c.supplementary_data?.related_ids?.authorization_id,
    );
    return {
      id: c.id,
      status: c.status,
      amount: c.amount,
      invoice_id: c.invoice_id ?? null,
      seller_receivable_breakdown: c.seller_receivable_breakdown ?? null,
      order_id: c.supplementary_data?.related_ids?.order_id ?? null,
    };
  },
});

export const getLedgerEntriesTool = defineTool({
  name: 'get_ledger_entries',
  description:
    "Read the merchant's own books (ledger entries), optionally only those for one invoice / reference. Memos are untrusted free text.",
  schema: z.strictObject({ external_ref: z.string().max(128).optional() }),
  async run({ external_ref }, ctx) {
    const rows = (await listLedgerEntries(ctx.db)).filter(
      (r) => !external_ref || r.externalRef === external_ref,
    );
    see(ctx, ...rows.map((r) => r.id));
    return rows.slice(0, 50).map((r) => ({
      id: r.id,
      external_ref: r.externalRef,
      amount: amount(r.amountCents, r.currency),
      booked_on: r.bookedOn,
      matched_transaction_id: r.matchedTxnId,
      memo: r.memo ? wrapUntrusted(r.memo, 'ledger_memo') : null,
    }));
  },
});

export const getPolicyLimitsTool = defineTool({
  name: 'get_policy_limits',
  description:
    'Read the policy limits proposals are checked against (caps, reauthorization limits, tiers).',
  schema: z.strictObject({}),
  async run(_input, ctx) {
    return ctx.policyLimits;
  },
});

export const getSettlementTrailTool = defineTool({
  name: 'get_settlement_trail',
  description:
    'Read earlier proposals for this exception and their execution attempts (status, PayPal debug ids).',
  schema: z.strictObject({ exception_id: z.string().uuid() }),
  async run({ exception_id }, ctx) {
    const proposals = await listProposalsForException(ctx.db, exception_id);
    return Promise.all(
      proposals.map(async (p) => ({
        id: p.id,
        action_type: p.actionType,
        status: p.status,
        params: p.params,
        policy_verdict: (p.policyResult as { verdict?: string } | null)?.verdict ?? null,
        executions: (await listExecutions(ctx.db, p.id)).map((x) => ({
          attempt: x.attempt,
          http_status: x.httpStatus,
          paypal_status: x.paypalStatus,
          debug_id: x.debugId,
        })),
      })),
    );
  },
});

export const READ_TOOLS: AgentTool[] = [
  getExceptionTool,
  getAuthorizationTool,
  getCaptureTool,
  getLedgerEntriesTool,
  getPolicyLimitsTool,
  getSettlementTrailTool,
] as AgentTool[];
