import { describe, expect, it } from 'vitest';
import { ALLOWED_ACTIONS, ActionType, ExceptionType } from '../src/enums.js';
import {
  ACTION_PARAMS,
  ProposalMetaSchema,
  ProposedActionSchema,
  parseActionParams,
  safeParseActionParams,
  targetRefOf,
  type ProposedAction,
} from '../src/schemas.js';

const amount = (value: string, currency_code = 'USD') => ({ currency_code, value });

describe('action params schemas', () => {
  it('has a schema for every action type', () => {
    expect(Object.keys(ACTION_PARAMS).sort()).toEqual([...ActionType.options].sort());
  });

  it('every exception type has an allowlist of known actions', () => {
    for (const t of ExceptionType.options) {
      for (const a of ALLOWED_ACTIONS[t]) expect(ActionType.options).toContain(a);
    }
  });

  it('accepts a valid capture', () => {
    const p = parseActionParams('capture_authorization', {
      authorization_id: '0VF52814937998046',
      amount: amount('48.00'),
      final_capture: true,
    });
    expect(p.amount.value).toBe('48.00');
  });

  it('rejects unknown keys, bad amounts and bad ids', () => {
    const base = { authorization_id: 'A1', amount: amount('1.00') };
    const reauth = (p: unknown) => safeParseActionParams('reauthorize', p).success;
    expect(reauth(base)).toBe(true);
    expect(reauth({ ...base, extra: 1 })).toBe(false);
    expect(reauth({ ...base, amount: amount('1.001') })).toBe(false);
    expect(reauth({ ...base, amount: amount('-1.00') })).toBe(false);
    expect(reauth({ ...base, amount: amount('1.50', 'JPY') })).toBe(false);
    expect(safeParseActionParams('void_authorization', { authorization_id: 'a b' }).success).toBe(
      false,
    );
  });

  it('refund amount is optional (full refund)', () => {
    expect(safeParseActionParams('refund', { capture_id: 'C1' }).success).toBe(true);
  });

  it('caps rationale length and confidence range', () => {
    const ok = { evidence_refs: ['x'], rationale: 'r', confidence: 0.5 };
    expect(ProposalMetaSchema.safeParse(ok).success).toBe(true);
    expect(ProposalMetaSchema.safeParse({ ...ok, rationale: 'x'.repeat(601) }).success).toBe(false);
    expect(ProposalMetaSchema.safeParse({ ...ok, confidence: 1.1 }).success).toBe(false);
    expect(ProposalMetaSchema.safeParse({ ...ok, evidence_refs: [] }).success).toBe(false);
  });

  it('discriminates proposed actions and derives target refs', () => {
    const action = ProposedActionSchema.parse({
      action_type: 'refund',
      params: { capture_id: 'CAP1' },
    }) as ProposedAction;
    expect(targetRefOf(action, 'txn:T1')).toBe('capture:CAP1');
    expect(targetRefOf({ action_type: 'dismiss', params: { reason: 'dup' } }, 'txn:T1')).toBe(
      'txn:T1',
    );
    expect(
      ProposedActionSchema.safeParse({ action_type: 'refund', params: { authorization_id: 'x' } })
        .success,
    ).toBe(false);
  });
});
