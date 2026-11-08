// Zod schemas for proposals and every propose_* action's params.
// The same schemas become Claude tool JSON Schemas later (z.toJSONSchema).
import { z } from 'zod';
import { ActionType, ProposalStatus, RiskTier } from './enums.js';
import { minorUnits } from './money.js';

/** PayPal money object. `value` is a non-negative decimal string valid for the currency. */
export const PayPalAmountSchema = z
  .strictObject({
    currency_code: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD'),
    value: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Decimal string, e.g. "48.00"'),
  })
  .refine((a) => (a.value.split('.')[1]?.length ?? 0) <= minorUnits(a.currency_code), {
    message: 'Too many decimal places for this currency',
    path: ['value'],
  });

const PayPalId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'PayPal resource id');

/** Fields every propose_* tool must supply. */
export const ProposalMetaSchema = z.strictObject({
  evidence_refs: z.array(z.string().min(1).max(128)).min(1).max(20),
  rationale: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1),
});
export type ProposalMeta = z.infer<typeof ProposalMetaSchema>;

export const CaptureAuthorizationParams = z.strictObject({
  authorization_id: PayPalId,
  amount: PayPalAmountSchema,
  final_capture: z.boolean(),
  invoice_id: z.string().max(127).optional(),
  note_to_payer: z.string().max(255).optional(),
});

export const ReauthorizeParams = z.strictObject({
  authorization_id: PayPalId,
  amount: PayPalAmountSchema,
});

export const VoidAuthorizationParams = z.strictObject({
  authorization_id: PayPalId,
});

export const RefundParams = z.strictObject({
  capture_id: PayPalId,
  /** Omitted means a full refund. */
  amount: PayPalAmountSchema.optional(),
  invoice_id: z.string().max(127).optional(),
  note_to_payer: z.string().max(255).optional(),
});

export const AddTrackingParams = z.strictObject({
  order_id: PayPalId,
  capture_id: PayPalId,
  tracking_number: z.string().min(1).max(64),
  carrier: z.string().min(1).max(64),
  notify_payer: z.boolean(),
});

export const RetryOutstandingBalanceParams = z.strictObject({
  subscription_id: PayPalId,
  amount: PayPalAmountSchema,
  note: z.string().min(1).max(128),
});

export const SuspendSubscriptionParams = z.strictObject({
  subscription_id: PayPalId,
  reason: z.string().min(1).max(128),
});

/** Internal ledger correction only; never calls PayPal. */
export const JournalEntryParams = z.strictObject({
  transaction_id: z.string().min(1).max(64).optional(),
  ledger_entry_id: z.string().min(1).max(64).optional(),
  amount: PayPalAmountSchema,
  direction: z.enum(['debit', 'credit']),
  memo: z.string().min(1).max(255),
});

export const SendInvoiceReminderParams = z.strictObject({
  invoice_id: PayPalId,
  note: z.string().max(500).optional(),
});

export const DismissParams = z.strictObject({
  reason: z.string().min(1).max(300),
});

export const ACTION_PARAMS = {
  capture_authorization: CaptureAuthorizationParams,
  reauthorize: ReauthorizeParams,
  void_authorization: VoidAuthorizationParams,
  refund: RefundParams,
  add_tracking: AddTrackingParams,
  retry_outstanding_balance: RetryOutstandingBalanceParams,
  suspend_subscription: SuspendSubscriptionParams,
  journal_entry: JournalEntryParams,
  send_invoice_reminder: SendInvoiceReminderParams,
  dismiss: DismissParams,
} as const satisfies Record<ActionType, z.ZodType>;

export type ActionParams = { [K in ActionType]: z.infer<(typeof ACTION_PARAMS)[K]> };

/** A typed (action_type, params) pair, discriminated on action_type. */
export const ProposedActionSchema = z.discriminatedUnion(
  'action_type',
  (Object.keys(ACTION_PARAMS) as ActionType[]).map((action) =>
    z.strictObject({ action_type: z.literal(action), params: ACTION_PARAMS[action] }),
  ) as unknown as [
    z.ZodObject<{ action_type: z.ZodLiteral<ActionType>; params: z.ZodType }>,
    ...z.ZodObject<{ action_type: z.ZodLiteral<ActionType>; params: z.ZodType }>[],
  ],
);
export type ProposedAction = {
  [K in ActionType]: { action_type: K; params: ActionParams[K] };
}[ActionType];

export function parseActionParams<K extends ActionType>(
  action: K,
  params: unknown,
): ActionParams[K] {
  return ACTION_PARAMS[action].parse(params) as ActionParams[K];
}

export function safeParseActionParams(action: ActionType, params: unknown) {
  return ACTION_PARAMS[action].safeParse(params);
}

/** The PayPal (or ledger) object a proposal acts on; used for the one-open-proposal rule. */
export function targetRefOf(action: ProposedAction, exceptionTargetRef: string): string {
  switch (action.action_type) {
    case 'capture_authorization':
    case 'reauthorize':
    case 'void_authorization':
      return `authorization:${action.params.authorization_id}`;
    case 'refund':
      return `capture:${action.params.capture_id}`;
    case 'add_tracking':
      return `capture:${action.params.capture_id}`;
    case 'retry_outstanding_balance':
    case 'suspend_subscription':
      return `subscription:${action.params.subscription_id}`;
    case 'send_invoice_reminder':
      return `invoice:${action.params.invoice_id}`;
    case 'journal_entry':
    case 'dismiss':
      return exceptionTargetRef;
  }
}

/** A proposal as stored and shown to the approver. */
export const ProposalSchema = z.object({
  id: z.uuid(),
  exception_id: z.uuid(),
  agent_run_id: z.uuid().nullable(),
  action_type: ActionType,
  target_ref: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  params_hash: z.string().regex(/^[0-9a-f]{64}$/),
  rationale: z.string().max(600),
  evidence_refs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  status: ProposalStatus,
  risk_tier: RiskTier.nullable(),
  amount_cents: z.number().int().nullable(),
  currency: z.string().length(3).nullable(),
  created_at: z.date(),
  expires_at: z.date().nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
