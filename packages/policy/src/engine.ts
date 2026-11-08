// Deterministic policy rules R1–R10 (HACKATHON_ARCHITECTURE_PLAN.md, "Deterministic policy rules").
// Every rule is evaluated so the Proposal Card can show the whole checklist; the verdict is
// PASS only if no rule fails. Free text (rationale, customer notes) is never read here.
import {
  ALLOWED_ACTIONS,
  MONETARY_ACTIONS,
  formatDisplay,
  money,
  multiplyRatio,
  parseMoney,
  safeParseActionParams,
  targetRefOf,
  type ActionParams,
  type ActionType,
  type ProposedAction,
  type RiskTier,
} from '@vigil/core';
import policyV1 from './policy.v1.json' with { type: 'json' };
import {
  PolicyConfigSchema,
  type FreshState,
  type PolicyConfig,
  type PolicyInput,
  type PolicyResult,
  type RuleId,
  type RuleStatus,
  type RuleVerdict,
} from './types.js';

export const POLICY_V1: PolicyConfig = PolicyConfigSchema.parse(policyV1);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const NAMES: Record<RuleId, string> = {
  R1: 'Allowlist',
  R2: 'Schema',
  R3: 'Fresh state',
  R4: 'Bounds',
  R5: 'Caps',
  R6: 'Uniqueness',
  R7: 'Grounding',
  R8: 'Dispute guard',
  R9: 'Kill switch',
  R10: 'Tiering',
};

/** Statuses that make each action valid right now (R3). */
const PRECONDITIONS: Partial<Record<ActionType, { kind: FreshState['kind']; statuses: string[] }>> =
  {
    capture_authorization: { kind: 'authorization', statuses: ['CREATED', 'PARTIALLY_CAPTURED'] },
    void_authorization: { kind: 'authorization', statuses: ['CREATED', 'PARTIALLY_CAPTURED'] },
    reauthorize: { kind: 'authorization', statuses: ['CREATED'] },
    refund: { kind: 'capture', statuses: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
    retry_outstanding_balance: { kind: 'subscription', statuses: ['ACTIVE', 'SUSPENDED'] },
    suspend_subscription: { kind: 'subscription', statuses: ['ACTIVE'] },
    add_tracking: { kind: 'capture_for_tracking', statuses: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
  };

/** The amount a proposal moves (cents), or null for non-monetary actions. */
export function proposalAmount(
  action: ProposedAction,
  fresh: FreshState,
): { cents: number; currency: string } | null {
  const fromAmount = (a: { currency_code: string; value: string }) => {
    const m = parseMoney(a.value, a.currency_code);
    return { cents: m.cents, currency: m.currency };
  };
  switch (action.action_type) {
    case 'capture_authorization':
    case 'reauthorize':
    case 'retry_outstanding_balance':
    case 'journal_entry':
      return fromAmount(action.params.amount);
    case 'refund':
      if (action.params.amount) return fromAmount(action.params.amount);
      // Full refund: everything not yet refunded.
      return fresh.kind === 'capture'
        ? { cents: fresh.amountCents - fresh.refundedCents, currency: fresh.currency }
        : null;
    default:
      return null;
  }
}

/** T0 read · T1 non-monetary mutation · T2 money ≤ cap · T3 money above cap or irreversible. */
export function riskTier(
  action: ActionType,
  amountCents: number | null,
  config: PolicyConfig,
): RiskTier {
  if (action === 'dismiss') return 0;
  if (action === 'void_authorization') return 3;
  if (
    action === 'journal_entry' ||
    action === 'add_tracking' ||
    action === 'suspend_subscription' ||
    action === 'send_invoice_reminder'
  ) {
    return 1;
  }
  if (MONETARY_ACTIONS.has(action)) {
    return amountCents !== null && Math.abs(amountCents) > config.perActionCapCents ? 3 : 2;
  }
  return 1;
}

export function evaluatePolicy(input: PolicyInput, config: PolicyConfig = POLICY_V1): PolicyResult {
  const { exception, proposal, fresh, context } = input;
  const rules = new Map<RuleId, RuleVerdict>();
  const set = (id: RuleId, status: RuleStatus, detail: string) =>
    rules.set(id, { id, name: NAMES[id], status, detail });
  const fmt = (cents: number, currency: string) => formatDisplay(money(cents, currency));

  // R1 Allowlist
  const allowed = ALLOWED_ACTIONS[exception.type].includes(proposal.actionType);
  set(
    'R1',
    allowed ? 'pass' : 'fail',
    allowed
      ? `${proposal.actionType} is allowed for ${exception.type}`
      : `${proposal.actionType} is not allowed for ${exception.type} (allowed: ${ALLOWED_ACTIONS[exception.type].join(', ')})`,
  );

  // R2 Schema (and the params must point at the proposal's target)
  const parsed = safeParseActionParams(proposal.actionType, proposal.params);
  let action: ProposedAction | null = null;
  if (!parsed.success) {
    set(
      'R2',
      'fail',
      `Invalid params: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
    );
  } else {
    action = { action_type: proposal.actionType, params: parsed.data } as ProposedAction;
    const derived = targetRefOf(action, exception.targetRef);
    if (derived !== proposal.targetRef) {
      set('R2', 'fail', `Params target ${derived} but the proposal targets ${proposal.targetRef}`);
      action = null;
    } else {
      set('R2', 'pass', 'Params match the action schema');
    }
  }

  const amount = action ? proposalAmount(action, fresh) : null;

  // R3 Fresh state
  const pre = PRECONDITIONS[proposal.actionType];
  if (!pre) {
    set(
      'R3',
      fresh.kind === 'unavailable' ? 'fail' : 'pass',
      fresh.kind === 'unavailable' ? fresh.reason : 'No PayPal precondition (internal action)',
    );
  } else if (fresh.kind === 'unavailable') {
    set('R3', 'fail', `Could not re-read the target: ${fresh.reason}`);
  } else if (fresh.kind !== pre.kind) {
    set('R3', 'fail', `Expected fresh ${pre.kind} state, got ${fresh.kind}`);
  } else {
    const status =
      fresh.kind === 'capture_for_tracking'
        ? fresh.captureStatus
        : 'status' in fresh
          ? fresh.status
          : '';
    let ok = pre.statuses.includes(status);
    let detail = ok
      ? `Target is ${status}`
      : `Target is ${status}; ${proposal.actionType} needs ${pre.statuses.join(' or ')}`;
    if (ok && proposal.actionType === 'reauthorize' && fresh.kind === 'authorization') {
      const age = fresh.createdAt ? context.now.getTime() - fresh.createdAt.getTime() : null;
      const minAge = config.reauthorize.honorHours * HOUR;
      const maxAge = config.reauthorize.validityDays * DAY;
      if (age === null || age < minAge || age >= maxAge) {
        ok = false;
        detail = `Reauthorize is only allowed after the ${config.reauthorize.honorHours}h honor period and before day ${config.reauthorize.validityDays}`;
      }
    }
    if (
      ok &&
      proposal.actionType === 'add_tracking' &&
      fresh.kind === 'capture_for_tracking' &&
      fresh.hasTracker
    ) {
      ok = false;
      detail = 'The capture already has a tracker';
    }
    set('R3', ok ? 'pass' : 'fail', detail);
  }

  // R4 Bounds
  if (!action) {
    set('R4', 'skip', 'Skipped: params invalid');
  } else {
    set('R4', ...bounds(action, fresh, config));
  }

  // R5 Caps (above the per-action cap is allowed but becomes T3; the daily caps are hard)
  if (amount === null || !MONETARY_ACTIONS.has(proposal.actionType)) {
    set('R5', 'pass', 'Moves no PayPal money');
  } else {
    const cents = Math.abs(amount.cents);
    const daily = context.executedTodayCents + cents;
    const session = (context.sessionExecutedTodayCents ?? 0) + cents;
    if (daily > config.dailyCapCents) {
      set(
        'R5',
        'fail',
        `Daily cap: ${fmt(daily, amount.currency)} would exceed ${fmt(config.dailyCapCents, amount.currency)}`,
      );
    } else if (
      context.sessionExecutedTodayCents !== undefined &&
      session > config.sessionDailyCapCents
    ) {
      set(
        'R5',
        'fail',
        `Session cap: ${fmt(session, amount.currency)} would exceed ${fmt(config.sessionDailyCapCents, amount.currency)}`,
      );
    } else if (cents > config.perActionCapCents) {
      set(
        'R5',
        'pass',
        `${fmt(cents, amount.currency)} is above the ${fmt(config.perActionCapCents, amount.currency)} per-action cap: needs T3 typed confirmation`,
      );
    } else {
      set('R5', 'pass', `${fmt(cents, amount.currency)} within caps`);
    }
  }

  // R6 Uniqueness
  set(
    'R6',
    context.otherOpenProposalsOnTarget === 0 ? 'pass' : 'fail',
    context.otherOpenProposalsOnTarget === 0
      ? 'No other open proposal on this target'
      : `${context.otherOpenProposalsOnTarget} other open proposal(s) on ${proposal.targetRef}`,
  );

  // R7 Grounding
  const universe = new Set(context.evidenceUniverse);
  const unknown = proposal.evidenceRefs.filter((r) => !universe.has(r));
  if (proposal.evidenceRefs.length === 0) set('R7', 'fail', 'No evidence cited');
  else if (unknown.length)
    set('R7', 'fail', `Evidence not found on this exception: ${unknown.join(', ')}`);
  else
    set('R7', 'pass', `All ${proposal.evidenceRefs.length} evidence ids belong to this exception`);

  // R8 Dispute guard
  if (proposal.actionType === 'refund') {
    const disputed = fresh.kind === 'capture' && fresh.disputed;
    set(
      'R8',
      disputed ? 'fail' : 'pass',
      disputed
        ? 'The capture is under dispute: refunds are blocked'
        : 'No open dispute on the capture',
    );
  } else {
    set('R8', 'pass', 'Not a refund');
  }

  // R9 Kill switch
  if (!context.executionEnabled)
    set('R9', 'fail', 'Execution is disabled (EXECUTION_ENABLED=false)');
  else if (config.disabledActions.includes(proposal.actionType))
    set('R9', 'fail', `${proposal.actionType} is disabled by policy`);
  else set('R9', 'pass', 'Execution enabled');

  // R10 Tiering (never fails; classifies)
  const tier = riskTier(proposal.actionType, amount?.cents ?? null, config);
  set('R10', 'pass', `Tier T${tier}${tier === 3 ? ': approver must type the exact amount' : ''}`);

  const ordered = (Object.keys(NAMES) as RuleId[]).map((id) => rules.get(id)!);
  return {
    policyVersion: config.version,
    verdict: ordered.some((r) => r.status === 'fail') ? 'FAIL' : 'PASS',
    tier,
    requiresTypedAmount: tier === 3 && amount !== null,
    amountCents: amount?.cents ?? null,
    currency: amount?.currency ?? null,
    rules: ordered,
    evaluatedAt: context.now.toISOString(),
  };
}

function bounds(
  action: ProposedAction,
  fresh: FreshState,
  config: PolicyConfig,
): [RuleStatus, string] {
  const amountOf = (a: ActionParams['capture_authorization']['amount']) =>
    parseMoney(a.value, a.currency_code);
  const fmt = (cents: number, currency: string) => formatDisplay(money(cents, currency));
  const currencyCheck = (currency: string, target: string): [RuleStatus, string] | null =>
    currency === target
      ? null
      : ['fail', `Currency ${currency} does not match the target's ${target}`];

  switch (action.action_type) {
    case 'capture_authorization': {
      if (fresh.kind !== 'authorization') return ['fail', 'No fresh authorization state'];
      const a = amountOf(action.params.amount);
      const cur = currencyCheck(a.currency, fresh.currency);
      if (cur) return cur;
      const remaining = fresh.amountCents - fresh.capturedCents;
      if (a.cents <= 0) return ['fail', 'Capture amount must be positive'];
      if (a.cents > remaining)
        return [
          'fail',
          `Capture ${fmt(a.cents, a.currency)} exceeds the ${fmt(remaining, a.currency)} still authorized`,
        ];
      return [
        'pass',
        `Capture ${fmt(a.cents, a.currency)} ≤ ${fmt(remaining, a.currency)} authorized remaining`,
      ];
    }
    case 'reauthorize': {
      if (fresh.kind !== 'authorization') return ['fail', 'No fresh authorization state'];
      const a = amountOf(action.params.amount);
      const cur = currencyCheck(a.currency, fresh.currency);
      if (cur) return cur;
      const original = money(fresh.amountCents, fresh.currency);
      const pctCap = multiplyRatio(original, config.reauthorize.maxPercent, 100, 'floor').cents;
      const absCap = fresh.amountCents + config.reauthorize.maxIncreaseCents;
      const cap = Math.min(pctCap, absCap);
      if (a.cents <= 0) return ['fail', 'Reauthorization amount must be positive'];
      if (a.cents > cap) {
        return [
          'fail',
          `Reauthorize ${fmt(a.cents, a.currency)} exceeds the limit ${fmt(cap, a.currency)} (≤ ${config.reauthorize.maxPercent}% and ≤ +${fmt(config.reauthorize.maxIncreaseCents, a.currency)})`,
        ];
      }
      return ['pass', `Reauthorize ${fmt(a.cents, a.currency)} ≤ limit ${fmt(cap, a.currency)}`];
    }
    case 'refund': {
      if (fresh.kind !== 'capture') return ['fail', 'No fresh capture state'];
      const refundable = fresh.amountCents - fresh.refundedCents;
      if (!action.params.amount) {
        return refundable > 0
          ? ['pass', `Full refund of ${fmt(refundable, fresh.currency)}`]
          : ['fail', 'Nothing left to refund'];
      }
      const a = amountOf(action.params.amount);
      const cur = currencyCheck(a.currency, fresh.currency);
      if (cur) return cur;
      if (a.cents <= 0) return ['fail', 'Refund amount must be positive'];
      if (a.cents > refundable)
        return [
          'fail',
          `Refund ${fmt(a.cents, a.currency)} exceeds the ${fmt(refundable, a.currency)} still refundable`,
        ];
      return [
        'pass',
        `Refund ${fmt(a.cents, a.currency)} ≤ ${fmt(refundable, a.currency)} refundable`,
      ];
    }
    case 'retry_outstanding_balance': {
      if (fresh.kind !== 'subscription') return ['fail', 'No fresh subscription state'];
      const a = amountOf(action.params.amount);
      const cur = currencyCheck(a.currency, fresh.currency);
      if (cur) return cur;
      if (a.cents <= 0) return ['fail', 'Amount must be positive'];
      if (a.cents > fresh.outstandingCents)
        return [
          'fail',
          `${fmt(a.cents, a.currency)} exceeds the outstanding balance ${fmt(fresh.outstandingCents, a.currency)}`,
        ];
      return [
        'pass',
        `${fmt(a.cents, a.currency)} ≤ outstanding ${fmt(fresh.outstandingCents, a.currency)}`,
      ];
    }
    case 'journal_entry': {
      const a = amountOf(action.params.amount);
      return a.cents > 0
        ? ['pass', 'Internal ledger entry; amount positive']
        : ['fail', 'Amount must be positive'];
    }
    default:
      return ['pass', 'No amount to bound'];
  }
}
