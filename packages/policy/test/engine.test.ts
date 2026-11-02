import type { ActionType, ExceptionType } from '@vigil/core';
import { describe, expect, it } from 'vitest';
import { POLICY_V1, evaluatePolicy, riskTier } from '../src/engine.js';
import type { FreshState, PolicyInput, RuleId } from '../src/types.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const H = 3_600_000;
const usd = (value: string) => ({ currency_code: 'USD', value });

const authState = (
  over: Partial<Extract<FreshState, { kind: 'authorization' }>> = {},
): FreshState => ({
  kind: 'authorization',
  id: 'AUTH1',
  status: 'CREATED',
  amountCents: 4800,
  currency: 'USD',
  capturedCents: 0,
  createdAt: new Date(NOW.getTime() - 61 * H),
  ...over,
});

const captureState = (
  over: Partial<Extract<FreshState, { kind: 'capture' }>> = {},
): FreshState => ({
  kind: 'capture',
  id: 'CAP1',
  status: 'COMPLETED',
  amountCents: 3200,
  currency: 'USD',
  refundedCents: 0,
  disputed: false,
  ...over,
});

function input(
  over: {
    type?: ExceptionType;
    exceptionTarget?: string;
    action?: ActionType;
    target?: string;
    params?: unknown;
    evidence?: string[];
    fresh?: FreshState;
    context?: Partial<PolicyInput['context']>;
  } = {},
): PolicyInput {
  return {
    exception: {
      id: 'ex-1',
      type: over.type ?? 'AUTH_HONOR_EXPIRING',
      targetRef: over.exceptionTarget ?? 'authorization:AUTH1',
    },
    proposal: {
      actionType: over.action ?? 'capture_authorization',
      targetRef: over.target ?? 'authorization:AUTH1',
      params: over.params ?? {
        authorization_id: 'AUTH1',
        amount: usd('48.00'),
        final_capture: true,
      },
      evidenceRefs: over.evidence ?? ['AUTH1'],
    },
    fresh: over.fresh ?? authState(),
    context: {
      now: NOW,
      otherOpenProposalsOnTarget: 0,
      executedTodayCents: 0,
      executionEnabled: true,
      evidenceUniverse: ['AUTH1', 'ORDER-1', 'CAP1', 'TX1', 'ex-1'],
      ...over.context,
    },
  };
}

const rule = (i: PolicyInput, id: RuleId) => evaluatePolicy(i).rules.find((r) => r.id === id)!;
const refund = (value?: string) => ({
  type: 'UNMATCHED_TXN' as const,
  exceptionTarget: 'txn:TX1',
  action: 'refund' as const,
  target: 'capture:CAP1',
  params: value ? { capture_id: 'CAP1', amount: usd(value) } : { capture_id: 'CAP1' },
  evidence: ['TX1', 'CAP1'],
  fresh: captureState(),
});

describe('policy engine', () => {
  it('passes a well-formed capture inside the honor period, tier T2', () => {
    const r = evaluatePolicy(input());
    expect(r.verdict).toBe('PASS');
    expect(r.tier).toBe(2);
    expect(r.amountCents).toBe(4800);
    expect(r.rules.map((x) => x.id)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
      'R7',
      'R8',
      'R9',
      'R10',
    ]);
    expect(r.rules.every((x) => x.status === 'pass')).toBe(true);
    expect(r.policyVersion).toBe('policy.v1');
  });

  describe('R1 allowlist', () => {
    it('fails a refund on an E3 exception', () => {
      expect(
        rule(
          input({
            action: 'refund',
            target: 'capture:CAP1',
            params: { capture_id: 'CAP1' },
            fresh: captureState(),
          }),
          'R1',
        ).status,
      ).toBe('fail');
    });
  });

  describe('R2 schema', () => {
    it('fails unknown keys and bad amounts', () => {
      expect(
        rule(
          input({
            params: { authorization_id: 'AUTH1', amount: usd('48.001'), final_capture: true },
          }),
          'R2',
        ).status,
      ).toBe('fail');
      expect(
        rule(
          input({
            params: { authorization_id: 'AUTH1', amount: usd('1.00'), final_capture: true, x: 1 },
          }),
          'R2',
        ).status,
      ).toBe('fail');
    });
    it('fails when params point at another target than the proposal', () => {
      const r = rule(
        input({ params: { authorization_id: 'OTHER', amount: usd('1.00'), final_capture: true } }),
        'R2',
      );
      expect(r).toMatchObject({ status: 'fail' });
      expect(r.detail).toContain('authorization:OTHER');
    });
    it('skips R4 when params are invalid', () => {
      expect(rule(input({ params: {} }), 'R4').status).toBe('skip');
    });
  });

  describe('R3 fresh state', () => {
    it.each(['CAPTURED', 'VOIDED', 'DENIED'])(
      'fails capture when authorization is %s',
      (status) => {
        expect(rule(input({ fresh: authState({ status }) }), 'R3').status).toBe('fail');
      },
    );
    it('fails when the target could not be re-read', () => {
      expect(rule(input({ fresh: { kind: 'unavailable', reason: '404' } }), 'R3').status).toBe(
        'fail',
      );
    });
    it('reauthorize only after the honor period (day 4–29)', () => {
      const reauth = (ageH: number) =>
        rule(
          input({
            action: 'reauthorize',
            params: { authorization_id: 'AUTH1', amount: usd('48.00') },
            fresh: authState({ createdAt: new Date(NOW.getTime() - ageH * H) }),
          }),
          'R3',
        ).status;
      expect(reauth(71)).toBe('fail');
      expect(reauth(73)).toBe('pass');
      expect(reauth(29 * 24 + 1)).toBe('fail');
    });
    it('fails add_tracking on a capture that already has a tracker', () => {
      const base = {
        type: 'UNTRACKED_CAPTURE' as const,
        exceptionTarget: 'capture:CAP1',
        action: 'add_tracking' as const,
        target: 'capture:CAP1',
        params: {
          order_id: 'O1',
          capture_id: 'CAP1',
          tracking_number: '1Z',
          carrier: 'UPS',
          notify_payer: true,
        },
        evidence: ['CAP1'],
      };
      const fresh = (hasTracker: boolean): FreshState => ({
        kind: 'capture_for_tracking',
        captureId: 'CAP1',
        orderId: 'O1',
        captureStatus: 'COMPLETED',
        hasTracker,
      });
      expect(rule(input({ ...base, fresh: fresh(false) }), 'R3').status).toBe('pass');
      expect(rule(input({ ...base, fresh: fresh(true) }), 'R3').status).toBe('fail');
    });
  });

  describe('R4 bounds', () => {
    it('capture above the authorized remaining fails', () => {
      expect(
        rule(
          input({
            params: { authorization_id: 'AUTH1', amount: usd('48.01'), final_capture: true },
          }),
          'R4',
        ).status,
      ).toBe('fail');
      expect(
        rule(
          input({ fresh: authState({ status: 'PARTIALLY_CAPTURED', capturedCents: 1000 }) }),
          'R4',
        ).status,
      ).toBe('fail');
    });
    it('currency must match the target', () => {
      expect(
        rule(
          input({
            params: {
              authorization_id: 'AUTH1',
              amount: { currency_code: 'EUR', value: '1.00' },
              final_capture: true,
            },
          }),
          'R4',
        ).status,
      ).toBe('fail');
    });
    it('refund above the remaining refundable amount fails', () => {
      expect(rule(input(refund('32.00')), 'R4').status).toBe('pass');
      expect(rule(input(refund('32.01')), 'R4').status).toBe('fail');
      expect(
        rule(
          input({
            ...refund('20.00'),
            fresh: captureState({ refundedCents: 1500, status: 'PARTIALLY_REFUNDED' }),
          }),
          'R4',
        ).status,
      ).toBe('fail');
    });
    it('full refund needs something left to refund', () => {
      expect(
        rule(
          input({
            ...refund(),
            fresh: captureState({ refundedCents: 3200, status: 'PARTIALLY_REFUNDED' }),
          }),
          'R4',
        ).status,
      ).toBe('fail');
      expect(evaluatePolicy(input(refund())).amountCents).toBe(3200);
    });
    it('reauthorization above 115% fails', () => {
      // $48.00 → 115% = $55.20 (the +$75 cap is not binding here)
      const re = (value: string) =>
        rule(
          input({
            action: 'reauthorize',
            params: { authorization_id: 'AUTH1', amount: usd(value) },
            fresh: authState({ createdAt: new Date(NOW.getTime() - 80 * H) }),
          }),
          'R4',
        ).status;
      expect(re('55.20')).toBe('pass');
      expect(re('55.21')).toBe('fail');
    });
    it('reauthorization above +$75 fails even under 115%', () => {
      // $600.00 → 115% = $690.00, but +$75 cap = $675.00
      const fresh = authState({ amountCents: 60000, createdAt: new Date(NOW.getTime() - 80 * H) });
      const re = (value: string) =>
        rule(
          input({
            action: 'reauthorize',
            params: { authorization_id: 'AUTH1', amount: usd(value) },
            fresh,
          }),
          'R4',
        ).status;
      expect(re('675.00')).toBe('pass');
      expect(re('675.01')).toBe('fail');
    });
  });

  describe('R5 caps', () => {
    it('above the per-action cap passes but becomes T3 with typed confirmation', () => {
      const r = evaluatePolicy(
        input({
          params: { authorization_id: 'AUTH1', amount: usd('612.00'), final_capture: true },
          fresh: authState({ amountCents: 61200 }),
        }),
      );
      expect(r.verdict).toBe('PASS');
      expect(r).toMatchObject({ tier: 3, requiresTypedAmount: true });
    });
    it('fails when the daily cap would be exceeded', () => {
      expect(rule(input({ context: { executedTodayCents: 199_000 } }), 'R5').status).toBe('fail');
      expect(rule(input({ context: { executedTodayCents: 195_200 } }), 'R5').status).toBe('pass');
    });
    it('fails when the judge-session cap would be exceeded', () => {
      expect(rule(input({ context: { sessionExecutedTodayCents: 99_000 } }), 'R5').status).toBe(
        'fail',
      );
    });
  });

  describe('R6 uniqueness', () => {
    it('fails with a second open proposal on the same target', () => {
      expect(rule(input({ context: { otherOpenProposalsOnTarget: 1 } }), 'R6').status).toBe('fail');
    });
  });

  describe('R7 grounding', () => {
    it('fails on an invented evidence id', () => {
      const r = rule(input({ evidence: ['AUTH1', 'AUTH-INVENTED'] }), 'R7');
      expect(r.status).toBe('fail');
      expect(r.detail).toContain('AUTH-INVENTED');
    });
    it('fails with no evidence', () => {
      expect(rule(input({ evidence: [] }), 'R7').status).toBe('fail');
    });
  });

  describe('R8 dispute guard', () => {
    it('blocks refunds on a disputed capture', () => {
      expect(
        rule(input({ ...refund('10.00'), fresh: captureState({ disputed: true }) }), 'R8').status,
      ).toBe('fail');
      expect(rule(input(refund('10.00')), 'R8').status).toBe('pass');
    });
  });

  describe('R9 kill switch', () => {
    it('fails when execution is disabled', () => {
      expect(rule(input({ context: { executionEnabled: false } }), 'R9').status).toBe('fail');
    });
    it('fails when the action type is disabled by policy', () => {
      const r = evaluatePolicy(input(), {
        ...POLICY_V1,
        disabledActions: ['capture_authorization'],
      });
      expect(r.rules.find((x) => x.id === 'R9')!.status).toBe('fail');
    });
  });

  describe('R10 tiering', () => {
    it.each([
      ['dismiss', null, 0],
      ['add_tracking', null, 1],
      ['journal_entry', 1000, 1],
      ['suspend_subscription', null, 1],
      ['capture_authorization', 50000, 2],
      ['capture_authorization', 50001, 3],
      ['refund', 1000, 2],
      ['void_authorization', null, 3],
    ] as const)('%s (%s cents) → T%i', (action, cents, tier) => {
      expect(riskTier(action, cents, POLICY_V1)).toBe(tier);
    });
  });

  it('the prompt-injection refund ($900 on a $21.50 capture) is blocked regardless of the note', () => {
    const r = evaluatePolicy(
      input({
        ...refund('900.00'),
        fresh: captureState({ amountCents: 2150 }),
      }),
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.rules.find((x) => x.id === 'R4')!.status).toBe('fail');
    expect(r.tier).toBe(3);
  });

  it('is deterministic', () => {
    expect(evaluatePolicy(input())).toEqual(evaluatePolicy(input()));
  });
});
